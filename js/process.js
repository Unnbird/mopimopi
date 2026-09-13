var lastDPS = null,
    lastHPS = null,
    firstCombat = false,
    _ = '' 
var barSize = new Array(),
    encounterArray = new Array(),
    encounterCount = 1;

var onStopFlag = false;

// The pair currently drawn. update() is handed the live encounter most of the time but the
// settings screen feeds it the canned preview, so a header click has to re-render whichever of
// the two is actually on screen rather than reaching for lastDPS.
var curDPS = null,
    curHPS = null;

// Columns holding a label or an mm:ss string. There is no ordering to give them, so their header
// stays inert instead of sorting every row by NaN.
var noSort = { Class: 1, name: 1, duration: 1, EncounterDuration: 1 };

// The field a column sorts and draws its bar from. Anything missing here sorts by its own name;
// these entries exist because the column shows a rate or a label while the ordering belongs to the
// running total behind it. Leaving DPS/HPS on the bare "damage"/"healed" matters: Combatant.sort()
// swaps those two for their merged twins once pets are attached, which is what keeps summoner and
// scholar pet output inside the owner's bar.
var sortAlias = {
    encdps: 'damage',
    mergedDamage: 'damage',
    enchps: 'healed',
    mergedHealed: 'healed',
    maxhit: 'mergedmaxhitval',
    maxheal: 'mergedmaxhealval'
};

function isSortable(col) {
    return !noSort[col] && init.ColData[col] != undefined
}
function sortColumn(flag) {
    var col = init.q['sort' + flag]
    if (isSortable(col) && init.Order[flag].indexOf(col) > -1)
        return col
    // The stored column can have been dropped from the layout since it was picked; fall back to
    // the leftmost column that does sort so the table never ranks by a key nobody is showing.
    for (var i in init.Order[flag]) {
        if (isSortable(init.Order[flag][i]))
            return init.Order[flag][i]
    }
    return flag == 'HPS' ? 'enchps' : 'encdps'
}
function applySort(last, flag) {
    // sortkey is set directly rather than through resort(), which runs the key past activeSort().
    // That rewrite turns any "...Pct" into "...%", which is what ACT sends for damagePct and
    // crithitPct but not for the ones recalculate() derives itself - there is no DirectHit% - and a
    // sortkey nothing answers to ranks every row by undefined and flattens the bars to nothing.
    last.sortkey = sortAlias[sortColumn(flag)] || sortColumn(flag)
    last.sort(init.q['sortDesc' + flag] ? true : false)
}

function onOverlayDataUpdate(e) {
    if (lastCombat == null) return;
    lastDPS = lastCombat
    lastHPS = new Combatant(e, 'enchps');

    //console.log(lastDPS.isActive)
    //console.log(onStopFlag)

    if (lastDPS.isActive == "true") {
        if (view != 'settings') {
            if (!firstCombat) {
                $('[name=notice], [name=history]').fadeOut(0)
                $('[name=main]').fadeIn(0)
                view = 'main'
                firstCombat = true
            }
            update(lastDPS, lastHPS)
            hiddenTable()
        }
        onStopFlag = true;
    }
    else {
        if (!onStopFlag)
            return;
        else {
            if (view != 'settings') {
                if (!firstCombat) {
                    $('[name=notice], [name=history]').fadeOut(0)
                    $('[name=main]').fadeIn(0)
                    view = 'main'
                    firstCombat = true
                }
                saveLog()
                update(lastDPS, lastHPS)
                hiddenTable()
            }
            onStopFlag = false;
        }
    }
}

function update(lastDPS, lastHPS) {
    curDPS = lastDPS;
    curHPS = lastHPS;
    if (lastDPS.zone == 'HAERU') {
        _ = '_P'
    } else
        _ = ''        
    if (init.q.pets == 0) {
        lastDPS.summonerMerge = false;
        lastDPS.DetachPets();
        applySort(lastDPS, 'DPS');
        lastHPS.summonerMerge = false;
        lastHPS.DetachPets();
        applySort(lastHPS, 'HPS')
    } else {
        lastDPS.summonerMerge = true;
        lastDPS.AttachPets();
        applySort(lastDPS, 'DPS');
        lastHPS.summonerMerge = true;
        lastHPS.AttachPets();
        applySort(lastHPS, 'HPS')
    }
    if (init.q.act == 2) {
        $('nav table[name=ACT_2line]').fadeIn(0)
        $('nav table[name=ACT_1line]').fadeOut(0)
    } else {
        $('nav table[name=ACT_2line]').fadeOut(0)
        $('nav table[name=ACT_1line]').fadeIn(0)
    }    
    $('[name=target]').text(lastDPS.Encounter.title)
    // Whose figures the table shows. Only tagged messages carry `fflogs` (the settings preview and
    // a mopimopi without the parser do not), so those keep the header exactly as it was.
    if (lastDPS.fflogs && typeof FflogsMeter !== 'undefined' && init.q.fflogs != 0)
        $('[name=target]').append(' <font class="ex">' + (lastDPS.fflogs.applied ? 'FFLogs' : 'ACT') + '</font>')
    $('[name=time]').text(lastDPS.Encounter.duration)
    if (init.q.tableOrder == 1)
        $('div[name=main' + _ + ']').html('<div id="DPSHeader' + _ + '"><div id="DPSoldHeader' + _ + '"></div></div><div id="DPSBody' + _ + '"><div id="DPSoldBody' + _ + '"></div></div><div id="HPSHeader' + _ + '"><div id="HPSoldHeader' + _ + '"></div></div><div id="HPSBody' + _ + '"><div id="HPSoldBody' + _ + '"></div></div>')
    else
        $('div[name=main' + _ + ']').html('<div id="HPSHeader' + _ + '"><div id="HPSoldHeader' + _ + '"></div></div><div id="HPSBody' + _ + '"><div id="HPSoldBody' + _ + '"></div></div><div id="DPSHeader' + _ + '"><div id="DPSoldHeader' + _ + '"></div></div><div id="DPSBody' + _ + '"><div id="DPSoldBody' + _ + '"></div></div>')
        
    if (lastDPS.Combatant["YOU"] == undefined && lastDPS.Combatant["YOU"] == null) {        
        $('[name=rps]').text(l.NAV.main.tt.rps[lang])
    } else {
        var rd = "Total DPS " + addComma(lastDPS.Encounter.ENCDPS) + "　"
        var rh = "Total HPS " + addComma(lastHPS.Encounter.ENCHPS) + "　"
        var md = "My DPS " + addComma(lastDPS.Combatant.YOU.encdps) + "　"
        var mh = "My HPS " + addComma(lastHPS.Combatant.YOU.enchps) + "　"
        var rk = "Rank " + parseInt(lastDPS.Combatant.YOU.rank + 1) + "/" + parseInt(lastHPS.Combatant.YOU.rank + 1) + "/" + lastDPS.partys + "　"
        var msg = ''
        if (init.q.swap == 0)
            var max = '<span name="swapBtn">MaxHit </span>' + addData('maxhit', null, lastDPS.Combatant.YOU).replace('<font class="ex">', '').replace("</font>", '')
        else
            var max = '<span name="swapBtn">MaxHeal </span>' + addData('maxheal', null, lastHPS.Combatant.YOU).replace('<font class="ex">', '').replace("</font>", '')
        if (init.q.act_rd) msg += rd
        if (init.q.act_rh) msg += rh
        if (init.q.act_md) msg += md
        if (init.q.act_mh) msg += mh
        if (init.q.act_rank) msg += rk
        if (init.q.act_max) msg += max.replace('<font class="ex">', '').replace("</font>", '')

        $('[name=rps]').html(msg)
        $('[name=swapBtn]').on({
            click: function() {
                if (init.q.swap == 0) {
                    init.q.swap = 1
                } else {
                    init.q.swap = 0
                }                
                localStorage.setItem('Mopi2_HAERU', JSON.stringify(init))
                update(lastDPS, lastHPS)
            },
            mouseover: function() {
                $(this).css({ color: '#' + init.Color.accent })
            },
            mouseleave: function() {
                $(this).css({ color: '' })
            },
        })
        if ((lastDPS.partys >= init.q.view24_Number && init.q.view24) || view == 'preview24') {
            if (init.q.viewDPS == 1)
                onRaidCombatDataUpdate('DPS', lastDPS)
            if (init.q.viewHPS == 1)
                onRaidCombatDataUpdate('HPS', lastHPS)
        } else {            
            if (init.q.viewDPS == 1)
                onCombatDataUpdate('DPS', lastDPS)
            if (init.q.viewHPS == 1)
                onCombatDataUpdate('HPS', lastHPS)
        }
    }    
    ui()
}
function onRaidCombatDataUpdate(flag, last) {
    if (last.Combatant["YOU"] != undefined || last.Combatant["YOU"] != null) {
        var row = $('<div class="rRow"></div>'),
            set = 1,
            newBody = $('<div id="' + flag + 'Body' + _ + '"></div>')
        for (var d in last.persons) {
            var a = last.persons[d];
            var userName = a.name.replace(/ /g, "").replace("(", "").replace(")", "").replace(/'/g, "_");
            if (init.q.pets == 1 && a.Job == 'AVA' || a.Class == '') {} else {
                if (flag == "HPS") {
                    if (init.q.HPS_T == 1 && a.role == 'Tanker' || init.q.HPS_H == 1 && a.role == 'Healer' || init.q.HPS_D == 1 && a.role == 'DPS' || init.q.HPS_C == 1 && a.Job == 'CBO' || init.q.HPS_M == 1 && a.role == 'Crafter' || init.q.HPS_M == 1 && a.role == 'Gathering') {
                        if (set <= init.Range.size24TableSlice) {
                            row.append(createRaidTableBody(flag, a, userName))
                            set++
                        } else {
                            set = 2
                            newBody.append(row)
                            row = $('<div class="rRow"></div>')
                            row.append(createRaidTableBody(flag, a, userName))
                        }
                    }
                } else {
                    if (init.q.DPS_T == 1 && a.role == 'Tanker' || init.q.DPS_H == 1 && a.role == 'Healer' || init.q.DPS_D == 1 && a.role == 'DPS' || init.q.DPS_C == 1 && a.Job == 'CBO' || init.q.DPS_M == 1 && a.role == 'Crafter' || init.q.DPS_M == 1 && a.role == 'Gathering') {
                        if (set <= init.Range.size24TableSlice) {
                            row.append(createRaidTableBody(flag, a, userName))
                            set++
                        } else {
                            set = 2
                            newBody.append(row)
                            row = $('<div class="rRow"></div>')
                            row.append(createRaidTableBody(flag, a, userName))
                        }
                    }
                }
            }
        }
        newBody.append(row)
        $('#' + flag + 'Body' + _).replaceWith(newBody)
    }
}
function createRaidTableBody(flag, a, userName) {
    return '<table id="' + userName + '" class="rCell"><tr><td rowspan="2" class="rIdx" style="background:' + graphColor(a.Class, a.role, userName) + '"></td><td class="rIcon">' + addData('Class', a.Class, a) + '</td><td class="rName">' + addData('name', a.name, a) + '</td></tr><tr><td colspan="2" class="rData">' + addData('enc' + flag.toLowerCase(), a['enc' + flag.toLowerCase()], a) + '</td></tr></table>'
}
function onCombatDataUpdate(flag, last) {
    if (last.Combatant["YOU"] != undefined || last.Combatant["YOU"] != null) {        
        var Height = 0;
        var tableHeader = document.getElementById(flag + "Header" + _);
        var oldHeader = document.getElementById(flag + "oldHeader" + _);
        var newHeader = document.createElement("div");
        createTableHeader(flag, newHeader);
        tableHeader.replaceChild(newHeader, oldHeader);
        newHeader.id = flag + 'oldHeader' + _;        
        var tableBody = document.getElementById(flag + "Body" + _);
        var oldBody = document.getElementById(flag + "oldBody" + _);
        var newBody = document.createElement("div");
        for (var d in last.persons) {
            var a = last.persons[d];
            var userName = a.name.replace(/ /g, "").replace("(", "").replace(")", "").replace(/'/g, "_");
            if (init.q.pets == 1 && a.Job == 'AVA' || a.Class == '') {} else {
                var bodyHeight = parseInt(init.Range.sizeBody) + parseInt(init.Range.sizeLine)
                if (flag == "HPS") {
                    if (init.q.HPS_T == 1 && a.role == 'Tanker' || init.q.HPS_H == 1 && a.role == 'Healer' || init.q.HPS_D == 1 && a.role == 'DPS' || init.q.HPS_C == 1 && a.Job == 'CBO' || init.q.HPS_M == 1 && a.role == 'Crafter' || init.q.HPS_M == 1 && a.role == 'Gathering') {
                        createTableBody(userName, flag, newBody, a);
                        if (Height < parseFloat(bodyHeight * init.Range.sizeHPSTable)) {
                            Height += bodyHeight
                            $('#HPSBody' + _).height(Height / 10 + 'rem')
                        }
                    }
                } else {
                    if (init.q.DPS_T == 1 && a.role == 'Tanker' || init.q.DPS_H == 1 && a.role == 'Healer' || init.q.DPS_D == 1 && a.role == 'DPS' || init.q.DPS_C == 1 && a.Job == 'CBO' || init.q.DPS_M == 1 && a.role == 'Crafter' || init.q.DPS_M == 1 && a.role == 'Gathering') {
                        createTableBody(userName, flag, newBody, a);
                        if (Height < parseFloat(bodyHeight * init.Range.sizeDPSTable)) {
                            Height += bodyHeight
                            $('#DPSBody' + _).height(Height / 10 + 'rem')
                        }
                    }
                }
            }
        }
        tableBody.replaceChild(newBody, oldBody);
        newBody.id = flag + 'oldBody' + _;        
        if (Height == 0)
            $('#' + flag + 'Header' + _).html('<div id="' + flag + 'oldHeader' + _ + '"></div>')        
        for (var d in last.persons) {
            var a = last.persons[d];
            var userName = a.name.replace(/ /g, "").replace("(", "").replace(")", "").replace(/'/g, "_");
            if (init.q.pets == 1 && a.Job == 'AVA' || a.Class == '') {} else
                inputGraph(userName, flag, a.parent.maxdamage, a)
        }
    }
}
function createTableHeader(flag, newHeader) {
    var tableHeader = document.createElement("TABLE");
    tableHeader.className = "tableHeader";
    var tr = tableHeader.insertRow()
    var active = sortColumn(flag)
    for (var i in init.Order[flag]) {
        var n = init.Order[flag][i]
        var td = tr.insertCell();
        td.innerHTML = init.ColData[n].tt;
        td.className = n + " cell";
        if (isSortable(n)) {
            td.className += " sortable";
            td.setAttribute('data-sort', n);
            td.setAttribute('data-flag', flag);
            if (n == active) {
                td.className += " sorted";
                // The marker is absolutely positioned (see .sortArrow) because the cell is
                // width-locked by ColData and clips what overflows: appended inline it would push
                // a label like "Last180" out of its own column.
                td.innerHTML += '<span class="sortArrow">' + (init.q['sortDesc' + flag] ? '▼' : '▲') + '</span>';
            }
        }
    }
    newHeader.appendChild(tableHeader)
}
function createTableBody(userName, flag, newBody, a) {
    var wrap = document.createElement("div");
    wrap.id = userName;
    wrap.className = 'tableWrap';
    if ((a.Job == "AVA" || a.Job == "CBO") && userName.indexOf('YOU') > -1) {
        wrap.className = "tableWrap myPet";
    }
    var table = document.createElement("TABLE");
    table.className = "tableBody";
    var bar = document.createElement("div");
    bar.className = "bar";
    var barBg = document.createElement("div");
    barBg.className = "barBg";
    var tr = table.insertRow();
    for (var i in init.Order[flag]) {
        var n = init.Order[flag][i]
        if (init.ColData[n][flag] == true) {
            var td = tr.insertCell();
            td.innerHTML = addData(n, a[n], a);
            td.className = n + " cell";
        }
    }
    wrap.appendChild(table);
    var miniBar = document.createElement("div");
    miniBar.className = "mini";
    if (flag == "DPS") {
        if (init.q.bar_pet == 1) {
            var bar1 = document.createElement("div");
            bar1.className = "pet";
            miniBar.appendChild(bar1);
        }
    } else {
        if (init.q.bar_oh == 1) {
            var bar1 = document.createElement("div");
            bar1.className = "oh";
            miniBar.appendChild(bar1);
        }
        if (init.q.bar_ds == 1) {
            var bar2 = document.createElement("div");
            bar2.className = "ds";
            miniBar.appendChild(bar2);
        }
        if (init.q.bar_pet == 1) {
            var bar3 = document.createElement("div");
            bar3.className = "pet";
            miniBar.appendChild(bar3);
        }
    }
    wrap.appendChild(bar);
    wrap.appendChild(miniBar);
    wrap.appendChild(barBg);
    newBody.appendChild(wrap)
}
function printName(name) {
    var tmp = name.split(' ');
    if (tmp.length >= 2) {
        if (init.q.cnt == 1)
            return name
        else if (init.q.cnt == 2)
            return tmp[0] + ' ' + tmp[1].substr(0, 1) + '.'
        else if (init.q.cnt == 3)
            return tmp[0].substr(0, 1) + '. ' + tmp[1]
        else
            return tmp[0].substr(0, 1) + '. ' + tmp[1].substr(0, 1) + '.'
    } else
        return name
}
function cutName(name) {
    if (name.indexOf("(") > -1) {        
        var tmp = name.split('(');
        var cn = tmp[1].substr(0, tmp[1].length - 1)        
        if (myName == "") 
            myName = 'YOU'
        if (init.q.myName == false && cn == "YOU")
            return tmp[0] + ' (' + printName(myName) + ')'
        else
            return tmp[0] + ' (' + printName(cn) + ')'
    } else {        
        return printName(name)
    }
}
function petName(job, name) {
    if (job == 'CBO') {
        return d.CBO.tt[lang] + " (YOU)"
    } else
        return name.split('(')[0] + '(YOU)';
}
function addData(colName, a, p) {
    switch (colName) {
        case 'Class':
            if (a != undefined)
                return '<img src="./images/icon/' + init.q.iconSet + '/' + p.Job.toUpperCase() + '.png"/>';
            else return ''
        case 'name':
            var name = ''                
            if (init.q.hideName == false) {                
                if (a == "YOU" && init.q.myName == false) {
                    if (myName != '')
                        name = cutName(myName);
                    else
                        name = a
                }                
                else {
                    if ((p.petOwner == myName || p.petOwner == 'YOU') && p.petOwner != '' && init.q.myName == true)
                        name = petName(p.Job, a)
                    else {
                        name = cutName(a);
                    }
                }
            }            
            else {
                if (a == "YOU") {                    
                    name = a
                } else {                    
                    if ((p.petOwner == myName || p.petOwner == 'YOU') && myName != "")
                        name = petName(p.Job, a)                        
                    else {
                        if (p.Job == "LMB")
                            name = d.LMB.tt[lang];
                        else
                            name = '';
                    }
                }
            }            
            if (init.q.rank == 1)
                return (p.rank + 1) + '. ' + name
            else
                return name
        case 'duration':
        case 'EncounterDuration':
            return a
        case 'gcdUptime':
            // One decimal, fixed: the plugin measures this to 0.01 and a whole percent hides the
            // difference between a clean rotation and one clipping every few GCDs.
            return addComma(a, null, 1) + '<font class="ex">%</font>';
        case 'ParryPct':
        case 'BlockPct':
            return addComma(a) + '<font class="ex">%</font>';
        case 'dps':
        case 'rdps':
        case 'adps':
        case 'ndps':
        case 'cdps':
        case 'rdpsDelta':
        case 'mergedLast10DPS':
        case 'mergedLast30DPS':
        case 'mergedLast60DPS':
        case 'mergedLast180DPS':
        case 'encdps':
        case 'enchps':
            if (a != 'Infinity') {
                if (a >= 10000 && init.q.unit == 1) return addComma(a, 1000, init.q.unit_ns)
                else return addComma(a, null, init.q.ns * init.q.dpsType);
            } else
                return '∞'
        case 'gcdCount':
        case 'gcdClip':
        case 'mergedDamage':
        case 'mergedSwings':
        case 'mergedHits':
        case 'mergedDirectHitCount':
        case 'mergedCrithits':
        case 'mergedCritDirectHitCount':
        case 'mergedMisses':
        case 'hitfailed':
        case 'mergedDamagetaken':
        case 'mergedHealstaken':
        case 'mergedHealed':
        case 'mergedEffHealed':
        case 'mergedDamageShield':
        case 'mergedOverHeal':
        case 'mergedHeals':
        case 'mergedCritheals':
        case 'mergedCures':
        case 'mergedAbsorbHeal':
        case 'powerheal':
        case 'deaths':
            if (a >= 1000000 && init.q.unit == 1) return addComma(a, 1000000, init.q.unit_ns)
            else if (a >= 10000 && init.q.unit == 1) return addComma(a, 1000, init.q.unit_ns)
            else return addComma(a);
        case 'maxhit':
        case 'maxheal':
            var val = 'merged' + colName + 'val'
            var str = 'merged' + colName + 'str'
            var unit = 'merged' + colName + 'unit'
            var data = ''
            var abb = p[str]
            for (var i in init.Alias) {
                if (p[str] == i) {
                    abb = init.Alias[i]
                    break
                }
            }
            if (p[unit] == 'K')
                data = addComma(p[val], 1000, init.q.unit_ns)
            else if (p[unit] == 'M')
                data = addComma(p[val], 1000000, init.q.unit_ns)
            else {
                if (p[val] >= 1000 && init.q.max_unit == 1)
                    data = addComma(p[val], 1000, init.q.unit_ns)
                else if (p[val] >= 1000000 && init.q.max_unit == 1)
                    data = addComma(p[val], 1000000, init.q.unit_ns)
                else
                    data = addComma(p[val])
            }
            if (init.q.mhh == 1)
                return '<font class="ex">' + abb + ' ' + init.q.mhh_unit + ' </font>' + data
            else if (init.q.mhh == 2)
                return data + '<font class="ex"> ' + init.q.mhh_unit + ' ' + abb + '</font>'
            else if (init.q.mhh == 3)
                return abb
            else
                return data
        default:
            return addComma(a, null, init.q.ns * init.q.perType) + '<font class="ex">%</font>';
    }
}
function addComma(num, dd, ds) {
    if (num == 'NaN' || num == undefined || num == Infinity || num == '--') return 0;
    else {
        if (dd == null) dd = 1
        if (ds == null) ds = 0            
        num = (num / dd).toFixed(ds)        
        if (init.q.ds == '_')
            num = num.toString().replace('.', ' ')
        else
            num = num.toString().replace('.', init.q.ds)            
        if (init.q.gs == 0)
            num = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '')
        else if (init.q.gs == '_')
            num = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
        else
            num = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, init.q.gs)
        if (dd == 1000)
            return num + '<font class="ex">k</font>'
        else if (dd == 1000000)
            return num + '<font class="ex">M</font>'
        else
            return num
    }
}
function inputGraph(userName, flag, maxDamage, p) {
    // The bar length reads whatever the table is ranked by, so it stays a picture of the column the
    // order came from. maxDamage is the top row's value for that same key - Combatant.sort()
    // recomputes it over the active sortkey - so the leader is always full width.
    var userWidth = barPct(p[p.parent.sortkey], maxDamage);
    if (flag != 'DPS') {
        var overheal = barPct(p.mergedOverHeal, p.mergedHealed)
        var shield = barPct(p.mergedDamageShield, p.mergedHealed)
    }
    var width = graphAnimate(userWidth, 'bar', flag, userName, p.Class, p.role)
    $('#' + flag + 'Body' + _).find('#' + userName).find('.mini').css({
        width: width + '%',
    })
    if (init.q.pets == 1) {
        // The sub-bars live inside .mini, which is already scaled to this row's bar, so they are
        // shares of the row's own total and not of the encounter maximum. Measured against
        // maxDamage they read short for everyone below the leader, and once the ranking is a
        // percentage column - whose maximum is a far smaller number - they overflow the bar.
        if (flag == 'DPS') {
            graphAnimate(barPct(p.mergedDamage - p.damage, p.mergedDamage), 'pet', flag, userName, 'pet')
        } else {
            graphAnimate(barPct(p.mergedEffHealed - p.effHealed, p.mergedHealed), 'pet', flag, userName, 'pet')
            graphAnimate(shield, 'ds', flag, userName, 'ds')
            graphAnimate(overheal, 'oh', flag, userName, 'oh')
        }
    } else {
        if (flag == 'HPS') {
            graphAnimate(shield, 'ds', flag, userName, 'ds')
            graphAnimate(overheal, 'oh', flag, userName, 'oh')
        }
    }
}
// Any column can be the ranking now, including ones that go negative (rdpsDelta) or sit at zero
// for the whole party before the first hit lands, so the share is clamped rather than trusted.
function barPct(val, max) {
    val = parseFloat(val);
    max = parseFloat(max);
    if (!isFinite(val) || !isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(100, parseInt(val / max * 100)))
}
function graphAnimate(width, bar, flag, userName, job, role) {
    if (init.q.gradient == 1) {
        if (bar == 'bar')
            var bg = '-webkit-linear-gradient(' + init.q.direction + ', rgba(0,0,0,0),' + graphColor(job, role, userName) + ')'
        else
            var bg = '-webkit-linear-gradient(' + init.q.direction + ', rgba(0,0,0,0),' + graphColor(job, role, userName) + ')'
    } else
        var bg = graphColor(job, role, userName)
    if (barSize[userName + bar + flag] == undefined) {
        $('#' + flag + 'Body' + _).find('#' + userName).find('.' + bar).css({
            width: 0 + '%',
            background: bg,
            opacity: parseFloat(init.Range[bar] / 100)
        });
        barSize[userName + bar + flag] = 0;
    } else {
        if (isNaN(width))
            barSize[userName + bar + flag] = 0;
        $('#' + flag + 'Body' + _).find('#' + userName).find('.' + bar).css({
            width: parseInt(barSize[userName + bar + flag]) + '%',
            background: bg,
            opacity: parseFloat(init.Range[bar] / 100)
        });
    }
    if (init.q.ani == 1 && (view != 'settings')) {
        $('#' + flag + 'Body' + _).find('#' + userName).find('.' + bar).animate({
            width: width + '%',
            background: bg,
            opacity: parseFloat(init.Range[bar] / 100)
        });
    } else {
        $('#' + flag + 'Body' + _).find('#' + userName).find('.' + bar).css({
            width: width + '%',
            background: bg,
            opacity: parseFloat(init.Range[bar] / 100)
        });
    }
    barSize[userName + bar + flag] = width;
    return width
}
function graphColor(job, role, userName) {
    switch (init.q.palette) {
        case "job":
            if (init.q.myColorUse == 1 && userName.indexOf("YOU") > -1 && job != "ds" && job != "oh" && job != "pet")
                return '#' + init.Color.myColor
            else
                return '#' + init.Color[job]
        case "role":
            if (init.q.myColorUse == 1 && userName.indexOf("YOU") > -1 && job != "ds" && job != "oh" && job != "pet")
                return '#' + init.Color.myColor
            else {
                if (role != undefined || role != null) {
                    if (job == "LMB")
                        return '#' + init.Color[job]
                    else
                        return '#' + init.Color[role]
                } else
                    return '#' + init.Color[job]
            }
        case "meYou":
            if (job == "ds" || job == "oh" || job == "LMB" || job == "CBO" || job == "pet")
                return '#' + init.Color[job]
            else {
                if (userName == "YOU")
                    return '#' + init.Color.YOU
                else
                    return '#' + init.Color.Other
            }
    }
}
function saveLog() {
    if (lastDPS == null)
        return;
    else {
        if (String(lastCombat.isActive) == "false") {
            encounterArray.unshift({
                lastDPS: lastDPS,
                lastHPS: lastHPS,
                combatKey: lastCombat.combatKey
            });
            if (encounterArray.length >= 2) {
                if (encounterArray[1].combatKey == lastDPS.combatKey)
                    encounterArray.shift()
                else historyAddRow()
            } else historyAddRow()
        }
        barSize.length = 0; 
    }
}
function historyAddRow() {
    var wrap = document.getElementById('HISTORYBody');
    var newHistory = document.createElement("div");
    newHistory.className = 'tableWrap'
    var oldHistory = document.getElementById('HISTORYoldBody');
    $('#HISTORYBody').find('td#viewIcon').html('');
    var table = document.createElement("TABLE");
    table.id = lastDPS.combatKey;
    table.className = "tableBody";
    var tr = table.insertRow();
    var td = tr.insertCell();
    td.innerHTML = '<img src="./images/menu/eye.svg" style="width:1.5rem"/>';
    td.className = "cell_5";
    td.id = "viewIcon";
    var td = tr.insertCell();
    if (lastDPS.title != 'Encounter')
        td.innerHTML = lastDPS.title + '<span class="ex"> / ' + lastDPS.zone + '</span>';
    else
        td.innerHTML = 'No Data' + '<span class="ex"> / ' + lastDPS.zone + '</span>';
    td.className = "cell_1";
    var td = tr.insertCell();
    td.innerHTML = lastDPS.Encounter.duration;
    td.className = "cell_5";
    var td = tr.insertCell();
    td.innerHTML = addComma(lastDPS.Encounter.ENCDPS)
    td.className = "cell_6";
    var td = tr.insertCell();
    td.innerHTML = addComma(lastHPS.Encounter.ENCHPS)
    td.className = "cell_6";
    var td = tr.insertCell();
    if (lastDPS.persons.YOU != null)
        td.innerHTML = addComma(lastDPS.persons.YOU.ENCDPS)
    else
        td.innerHTML = 'No Data'
    td.className = "cell_6 ac";
    var td = tr.insertCell();
    if (lastHPS.persons.YOU != null)
        td.innerHTML = addComma(lastHPS.persons.YOU.ENCHPS)
    else
        td.innerHTML = 'No Data'
    td.className = "cell_6 ac";
    var td = tr.insertCell();
    td.className = "cell_5";
    td.id = "CNT";
    if (encounterArray.length == 1)
        td.innerText = 1;
    else {
        if (encounterArray[0].lastDPS.Encounter.CurrentZoneName == encounterArray[1].lastDPS.Encounter.CurrentZoneName) {
            encounterCount++;
            td.innerText = addComma(parseInt(encounterCount))
        } else {
            encounterCount = 1;
            td.innerText = encounterCount
        }
    }
    var barBg = document.createElement("div");
    barBg.className = "barBg";
    newHistory.appendChild(table);
    newHistory.appendChild(barBg);
    if (oldHistory == null)
        wrap.appendChild(newHistory);
    else wrap.insertBefore(newHistory, oldHistory);
    newHistory.id = 'HISTORYoldBody';
    $('#HISTORYBody .tableWrap').on({
        mouseover: function() {
            if (init.Range.bar == 0)
                var tmp = 25
            else
                var tmp = init.Range.bar
            $(this).find('.barBg').css({
                background: oHexColor(init.Color.accent, parseFloat(tmp / 100))
            })
        },
        mouseleave: function() {
            $(this).find('.barBg').css({
                background: oHexColor(init.Color.tableBg, parseFloat(init.Range.tableBg / 100))
            })
        },
        click: function() {
            $('#HISTORYBody').find('td#viewIcon').html('');
            var listName = $(this).find('table').attr("id")
            for (var i in encounterArray) {
                if (listName == encounterArray[i].combatKey) {
                    lastDPS = encounterArray[i].lastDPS
                    lastHPS = encounterArray[i].lastHPS
                    $(this).find('#viewIcon').html('<img src="./images/menu/eye.svg" style="width:' + parseFloat(init.Range.sizeBodyIcon / 10) + 'rem' + '"/>')
                    $('#DPSBody').html('<div id="DPSoldBody"></div>')
                    $('#HPSBody').html('<div id="HPSoldBody"></div>')
                    update(lastDPS, lastHPS)
                    button('Back', 'main')
                }
            }
        }
    })
    firstCombat = false
    hiddenTable()
}

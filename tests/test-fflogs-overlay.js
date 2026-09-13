/**
 * Checks the FFLogs overlay step (js/fflogs/apply.js on top of js/fflogs/host-logic.js): a fake
 * fight from FFLogs' parser is written over a fake ACT CombatData message and every field the
 * README promises comes out FFLogs-first, as strings, with ACT's figures kept where FFLogs has
 * none.
 *
 * Usage:  node tests/test-fflogs-overlay.js
 */

'use strict';

const path = require('path');
const host = require(path.join(__dirname, '..', 'js', 'fflogs', 'host-logic.js'));
const apply = require(path.join(__dirname, '..', 'js', 'fflogs', 'apply.js'));

let failures = 0;
function check(label, actual, expected) {
	const ok = Object.is(actual, expected)
		|| (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 1e-6);
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(58)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------- the parser's fight

const hits = (n, c, d, cd, max) => ({ hitCount: n, criticalCount: c, directHitCount: d, criticalDirectHitCount: cd, maxHit: max, minHit: 1 });
const ability = (id, name, h) => ({ id, name, hitDetails: h });

const fight = {
	id: 2,
	state: 'inprogress',
	startTime: 1000000,
	endTime: 1000000 + 515200,
	zone: { id: 1, name: 'Recollection (Extreme)' },
	friendlyDamage: {
		actors: {
			1: { id: 1, name: 'Viper A', fullType: 'Viper', amount: 16803305, amountTaken: 1806745, singleTargetAmountTaken: 1258057, amountGiven: 0, over: 0,
				hitDetails: hits(400, 100, 120, 30, 89000),
				abilities: { 5: ability(5, 'Reawaken', hits(10, 5, 5, 2, 89000)), 6: ability(6, 'Steel Fangs', hits(390, 95, 115, 28, 40000)) } },
			2: { id: 2, name: 'Summoner S', fullType: 'Summoner', amount: 1000000, amountTaken: 50000, singleTargetAmountTaken: 0, amountGiven: 120000, over: 0,
				hitDetails: hits(200, 50, 60, 10, 30000),
				abilities: { 7: ability(7, 'Ruin III', hits(200, 50, 60, 10, 30000)) } },
			// Demi-Bahamut does not mirror its owner's buffs, so the parser books it on its own.
			3: { id: 3, name: 'Demi-Bahamut', fullType: 'Summoner', amount: 500000, amountTaken: 25000, singleTargetAmountTaken: 0, amountGiven: 0, over: 0,
				hitDetails: hits(20, 5, 5, 1, 60000),
				abilities: { 8: ability(8, 'Wyrmwave', hits(20, 5, 5, 1, 60000)) } },
			4: { id: 4, name: 'Limit Break', fullType: 'LimitBreak', amount: 999999, amountTaken: 0, singleTargetAmountTaken: 0, amountGiven: 0, over: 0, hitDetails: hits(1, 0, 0, 0, 999999), abilities: {} },
			5: { id: 5, name: 'My Name', fullType: 'Scholar', amount: 5538352, amountTaken: 106862, singleTargetAmountTaken: 0, amountGiven: 985383, over: 0,
				hitDetails: hits(300, 60, 0, 0, 20000),
				abilities: { 10: ability(10, 'Broil IV', hits(300, 60, 0, 0, 20000)) } },
		},
	},
	friendlyHealing: {
		actors: {
			5: { id: 5, name: 'My Name', fullType: 'Scholar', amount: 3000000, amountTaken: 0, singleTargetAmountTaken: 0, amountGiven: 0, over: 900000,
				hitDetails: hits(500, 100, 0, 0, 45000),
				abilities: { 9: ability(9, 'Adloquium', hits(500, 100, 0, 0, 45000)) } },
		},
	},
	deaths: {
		actors: {
			1: { deaths: [{ timeOffset: 1 }, { timeOffset: 2 }] },
			5: { deaths: [{ timeOffset: 3 }] },
		},
	},
};

const pets = {
	petsIdTable: new Map([[3, 1]]),
	petsTable: [{ pet: 3, owner: 2, summon: 0 }],
	nameOf: (id) => (id === 2 ? 'Summoner S' : ''),
};

function snapshotOf(f) {
	const damage = host.foldActors(f.friendlyDamage.actors, pets);
	return {
		fight: f,
		damageRows: damage.rows,
		healingRows: host.healingRows(f, pets),
		deaths: host.deathCounts(f, pets.nameOf),
		durationSeconds: (f.endTime - f.startTime) / 1000,
		parserVersion: '3075',
		logVersion: 75,
		fightId: f.id,
		fightState: f.state,
	};
}

// ---------------------------------------------------------------- ACT's message

const row = (name, job, extra) => Object.assign({
	name, Job: job, damage: '1', hits: '1', swings: '1', misses: '0', crithits: '0', DirectHitCount: '0', CritDirectHitCount: '0',
	maxhit: 'Old-1', MAXHIT: '1', healed: '0', overHeal: '0', damageShield: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0',
	deaths: '0', damagetaken: '0', healstaken: '0', kills: '0', DURATION: '513',
}, extra);

const combatData = {
	Encounter: { title: 'Recollection', duration: '08:33', DURATION: '513', damage: '25000000', healed: '3500000', ENCDPS: '48700', ENCHPS: '6800', encdps: '48700', CurrentZoneName: 'Recollection (Extreme)' },
	Combatant: {
		'Viper A': row('Viper A', 'VPR', { damage: '16700000', hits: '380', swings: '390', misses: '10', crithits: '90', DirectHitCount: '110', CritDirectHitCount: '25', maxhit: 'Reawaken-80000', MAXHIT: '80000', damagetaken: '123456', rdpsTotal: '1', adpsTotal: '1', ndpsTotal: '1', cdpsTotal: '1', gcdUptime: '95.5' }),
		'Summoner S': row('Summoner S', 'SMN', { damage: '1400000', hits: '210' }),
		'Demi-Bahamut (Summoner S)': row('Demi-Bahamut (Summoner S)', '', { damage: '480000', hits: '19' }),
		'Carbuncle (Summoner S)': row('Carbuncle (Summoner S)', '', { damage: '50000', hits: '30' }),
		'YOU': row('YOU', 'SCH', { damage: '5500000', healed: '3800000', overHeal: '950000', heals: '480', critheals: '90', maxheal: 'Adloquium-40000', MAXHEAL: '40000' }),
		'Eos (YOU)': row('Eos (YOU)', '', { damage: '0', healed: '400000', overHeal: '100000', heals: '50' }),
		// ACT's figure differs from the parser's on purpose, to show which one wins.
		'Limit Break': row('Limit Break', '', { damage: '123' }),
	},
	isActive: 'true',
};

const before = JSON.stringify(combatData);
const out = apply.applyFflogs(combatData, snapshotOf(fight), 'My Name', host);
const c = out.Combatant;

console.log('=============== what happened ===============');
check('applied', out.fflogs.applied, true);
check('seven rows matched (Limit Break included)', out.fflogs.matched, 7);
check('nothing left to ACT', out.fflogs.unmatched.join(','), '');
check('input message not mutated', JSON.stringify(combatData), before);
check('isActive passes through', out.isActive, 'true');
check('parser version travels', out.fflogs.parserVersion, '3075');

console.log('\n=============== a plain player takes every FFLogs figure ===============');
const v = c['Viper A'];
check('damage = amount', v.damage, '16803305');
check('hits', v.hits, '400');
check('crithits', v.crithits, '100');
check('DirectHitCount', v.DirectHitCount, '120');
check('CritDirectHitCount', v.CritDirectHitCount, '30');
check('maxhit names the ability', v.maxhit, 'Reawaken-89000');
check('MAXHIT', v.MAXHIT, '89000');
check('deaths', v.deaths, '2');
check('fflogsAmount', v.fflogsAmount, '16803305');
check('fflogsAmountTaken', v.fflogsAmountTaken, '1806745');
check('fflogsSingleTargetAmountTaken', v.fflogsSingleTargetAmountTaken, '1258057');
check('fflogsAmountGiven', v.fflogsAmountGiven, '0');
check('legacy rdpsTotal from the plugin is not what carries rDPS any more', v.rdpsTotal, '1');
check('swings stay ACT (FFLogs has no misses)', v.swings, '390');
check('misses stay ACT', v.misses, '10');
check('damagetaken stays ACT', v.damagetaken, '123456');
check('gcdUptime stays as the plugin sent it', v.gcdUptime, '95.5');
check('no healing from FFLogs -> zero, not ACT', v.healed, '0');
check('every written value is a string', Object.keys(v).every((k) => typeof v[k] === 'string'), true);

console.log('\n=============== pets: own + pet rows add back up to the parser total ===============');
const s = c['Summoner S'];
const demi = c['Demi-Bahamut (Summoner S)'];
const carby = c['Carbuncle (Summoner S)'];
check('owner row = own figures only', s.damage, '1000000');
check('owner hits exclude the pet', s.hits, '200');
check('owner FFLogs amount is the folded total', s.fflogsAmount, '1500000');
check('owner FFLogs amountTaken folded', s.fflogsAmountTaken, '75000');
check('owner FFLogs amountGiven', s.fflogsAmountGiven, '120000');
check('Demi-Bahamut row = its own share', demi.damage, '500000');
check('Demi-Bahamut hits', demi.hits, '20');
check('Demi-Bahamut maxhit', demi.maxhit, 'Wyrmwave-60000');
check('pet rows carry no FFLogs totals of their own', demi.fflogsAmount, '0');
check('Carbuncle (already inside the owner) reads zero', carby.damage, '0');
check('Carbuncle hits zero', carby.hits, '0');
check('Carbuncle maxhit empty', carby.maxhit, '');
check('own + pets = parser total', Number(s.damage) + Number(demi.damage) + Number(carby.damage), 1500000);

console.log('\n=============== YOU is the logging player ===============');
const me = c['YOU'];
check('YOU damage from "My Name"', me.damage, '5538352');
check('healed = amount + over', me.healed, '3900000');
check('overHeal = over', me.overHeal, '900000');
check('heals', me.heals, '500');
check('critheals', me.critheals, '100');
check('maxheal names the ability', me.maxheal, 'Adloquium-45000');
check('MAXHEAL', me.MAXHEAL, '45000');
check('deaths', me.deaths, '1');
check('healer FFLogs amountGiven', me.fflogsAmountGiven, '985383');
check('healer FFLogs amountTaken', me.fflogsAmountTaken, '106862');
const eos = c['Eos (YOU)'];
check('Eos (folded by the parser) reads zero healing', eos.healed, '0');
check('Eos overHeal zero', eos.overHeal, '0');

console.log('\n=============== Limit Break is a combatant of its own ===============');
// It used to be dropped, which left the line with ACT\'s DPS and every rDPS column at 0. FFLogs
// lists it too, with nothing taken or given, so its rDPS is simply its DPS.
const lb = c['Limit Break'];
check('Limit Break damage from FFLogs', lb.damage, '999999');
check('Limit Break FFLogs amount = its own damage', lb.fflogsAmount, '999999');
check('Limit Break takes nothing', lb.fflogsAmountTaken, '0');
check('Limit Break gives nothing', lb.fflogsAmountGiven, '0');
check('Limit Break hits', lb.hits, '1');

console.log('\n=============== rows FFLogs does not know keep ACT ===============');
const stranger = apply.applyFflogs(Object.assign({}, combatData, { Combatant: { 'Some NPC': row('Some NPC', '', { damage: '4242' }) } }), snapshotOf(fight), 'My Name', host);
check('unknown combatant keeps ACT damage', stranger.Combatant['Some NPC'].damage, '4242');
check('and is reported as unmatched', stranger.fflogs.unmatched.join(','), 'Some NPC');

console.log('\n=============== encounter totals ===============');
const enc = out.Encounter;
check('DURATION from the fight', enc.DURATION, '515');
check('matched rows take the fight duration too', [c['Viper A'].DURATION, c['YOU'].DURATION, c['Eos (YOU)'].DURATION, c['Limit Break'].DURATION].join('/'), '515/515/515/515');
check('duration formatted mm:ss', enc.duration, '08:35');
check('damage = every FFLogs row, Limit Break included', enc.damage, String(16803305 + 1500000 + 5538352 + 999999));
check('healed = FFLogs healing incl. overheal', enc.healed, '3900000');
check('ENCDPS = damage / fight seconds', enc.ENCDPS, String(Math.round((16803305 + 1500000 + 5538352 + 999999) / 515.2)));
check('lowercase encdps kept in step', enc.encdps, enc.ENCDPS);
check('title untouched', enc.title, 'Recollection');

console.log('\n=============== without the logging player\'s name ===============');
const anon = apply.applyFflogs(combatData, snapshotOf(fight), '', host);
check('YOU cannot be matched -> ACT figure kept', anon.Combatant['YOU'].damage, '5500000');
check('others still applied', anon.Combatant['Viper A'].damage, '16803305');
// Without the real name neither YOU nor a pet owned by YOU can be resolved, so both stay ACT.
check('YOU and its pet counted as unmatched', anon.fflogs.unmatched.join(','), 'YOU,Eos (YOU)');

console.log('\n=============== a fight the parser booked no healing for keeps ACT\'s healing ===============');
// Seen on a real log: friendlyHealing.actors came back empty for a whole kill. That is "no
// figure", not "zero healing", so the healing columns must not be blanked.
const noHealFight = JSON.parse(JSON.stringify(fight));
noHealFight.friendlyHealing = { actors: {} };
const noHeal = apply.applyFflogs(combatData, snapshotOf(noHealFight), 'My Name', host);
check('applied all the same', noHeal.fflogs.applied, true);
check('flagged as no healing', noHeal.fflogs.healing, false);
check('YOU healed stays ACT', noHeal.Combatant['YOU'].healed, '3800000');
check('YOU overHeal stays ACT', noHeal.Combatant['YOU'].overHeal, '950000');
check('Eos healing stays ACT', noHeal.Combatant['Eos (YOU)'].healed, '400000');
check('YOU damage still FFLogs', noHeal.Combatant['YOU'].damage, '5538352');
check('Encounter.healed stays ACT', noHeal.Encounter.healed, '3500000');
check('ENCHPS re-divided by the fight clock', noHeal.Encounter.ENCHPS, String(Math.round(3500000 / 515.2)));
const noDeathFight = JSON.parse(JSON.stringify(fight));
delete noDeathFight.deaths;
const snapNoDeaths = snapshotOf(noDeathFight);
snapNoDeaths.hasDeaths = false;
const noDeath = apply.applyFflogs(Object.assign({}, combatData, { Combatant: { 'Viper A': row('Viper A', 'VPR', { deaths: '3' }) } }), snapNoDeaths, 'My Name', host);
check('no deaths table -> ACT deaths kept', noDeath.Combatant['Viper A'].deaths, '3');

console.log('\n=============== helpers ===============');
check('fightMatches: same pull', apply.fightMatches('513', 515.2), true);
check('fightMatches: new pull vs old fight', apply.fightMatches('30', 515.2), false);
check('fightMatches: 85s apart still one pull', apply.fightMatches(600, 515), true);
check('fightMatches: 91s apart is not', apply.fightMatches(606, 515), false);
check('fightMatches: garbage', apply.fightMatches(undefined, 515), false);

// ACT split M8S at the phase transition: the parser's one fight ran 0..839s (the first body died
// at 403s, the second appeared at 451s, and its death ended the fight); ACT's second encounter
// began at 451s. Log time, so the fight starts at S.
const S = 1789278218402;
check('within: encounter opened mid-fight while it runs', apply.encounterWithinFight(S + 451000, S, S + 403000, true), true);
check('within: still that fight once it ended as a kill', apply.encounterWithinFight(S + 451000, S, S + 839000, false), true);
check('within: pre-pull start inside the tolerance', apply.encounterWithinFight(S - 30000, S, S + 100000, true), true);
check('within: ACT began long before the fight', apply.encounterWithinFight(S - 120000, S, S + 100000, true), false);
check('within: a new pull after a wipe is not the old fight', apply.encounterWithinFight(S + 430000, S, S + 400000, false), false);
check('within: a hair after a closed fight still is', apply.encounterWithinFight(S + 403000, S, S + 400000, false), true);
check('within: no anchor', apply.encounterWithinFight(NaN, S, S + 400000, true), false);
check('formatDuration 515', apply.formatDuration(515), '08:35');
check('formatDuration 3725', apply.formatDuration(3725), '1:02:05');
check('formatDuration 0', apply.formatDuration(0), '00:00');
check('splitPetName pet', JSON.stringify(apply.splitPetName('Eos (Owner Name)')), JSON.stringify({ base: 'Eos', owner: 'Owner Name' }));
check('splitPetName plain', apply.splitPetName('Owner Name'), null);

console.log('\n=============== host-logic extensions ===============');
const damage = host.foldActors(fight.friendlyDamage.actors, pets);
const smn = damage.rows.find((r) => r.name === 'Summoner S');
check('owner total folds the pet', smn.amount, 1500000);
check('owner own figures kept apart', smn.own.amount, 1000000);
check('one pet under the owner', smn.pets.length, 1);
check('pet by name', smn.pets[0].name, 'Demi-Bahamut');
check('hitDetails folded', smn.hitDetails.hitCount, 220);
check('hitDetails maxHit is the max', smn.hitDetails.maxHit, 60000);
check('healingRows', host.healingRows(fight, pets)[0].amount, 3000000);
check('deathCounts by name', host.deathCounts(fight, pets.nameOf).get('Viper A'), 2);
check('maxHitOf names the ability', host.maxHitOf(fight.friendlyDamage.actors[1]).name, 'Reawaken');
check('maxHitOf value', host.maxHitOf(fight.friendlyDamage.actors[1]).value, 89000);
check('maxHitOf with no hits', host.maxHitOf({ hitDetails: hits(0, 0, 0, 0, 0), abilities: {} }).value, 0);

console.log('');
if (failures > 0) {
	console.log(`==> ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('==> all checks passed');

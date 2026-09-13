/**
 * Drives js/gcd/meter.js with synthetic network log lines, the way OverlayPlugin's "Chat"
 * broadcasts deliver them, and checks what ends up in a CombatData message: who counts as a
 * player, which lines are GCDs, cast-bar pairing and de-duplication, interrupted casts, haste
 * statuses, the "YOU" alias, the encounter cutoff read off CombatData, and actions the category
 * snapshot has never heard of.
 *
 * Usage:  node tests/test-gcd-meter.js
 */

'use strict';

const ActionData = require('../js/gcd/action-data.js');
const GcdTracker = require('../js/gcd/tracker.js');
const StatusTracker = require('../js/gcd/status-tracker.js');
const ActionCategories = require('../js/gcd/categories.js');
const Apply = require('../js/gcd/apply.js');
const Factory = require('../js/gcd/meter.js');
const categoryData = require('../js/gcd/action-categories-data.js');
const actionTable = require('../js/gcd/actions-data.js');

let failures = 0;
function check(label, actual, expected, tol) {
	const ok = typeof expected === 'number'
		? typeof actual === 'number' && Math.abs(actual - expected) <= (tol === undefined ? 0.001 : tol)
		: Object.is(actual, expected);
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(58)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function section(title) { console.log(`\n=============== ${title} ===============`); }

const deps = { ActionData, GcdTracker, StatusTracker, ActionCategories, Apply, categoryData, actionTable };
const newMeter = () => Factory.create(deps);

// ---------------------------------------------------------------- synthetic log lines

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const ts = (seconds) => new Date(Math.round(T0 + seconds * 1000)).toISOString();

const ENEMY = '40001234';
const ALICE = { id: '10001234', name: 'Alice Dancer' };
const BOB = { id: '10005678', name: 'Bob Mage' };
const CARA = { id: '10009ABC', name: 'Cara Healer' };
const DAN = { id: '10004444', name: 'Dan New' };

// Action ids as the lines carry them (hex), categories from the real snapshot.
const CASCADE = '3E75';      // DNC weaponskill - GCD
const FOUNTAIN = '3E76';     // DNC weaponskill - GCD
const FAN_DANCE = '3E87';    // DNC ability - oGCD
const AUTO_ATTACK = '7';
const BLIZZARD_I = '8E';     // 142: spell, 2.5s cast on a 2.5s recast
const GLARE_III = '6503';    // WHM spell
const PRESENCE_OF_MIND = '9D';   // status 157: 0.8 haste
const UNKNOWN_NEW = 'EA60';  // 60000: past the end of the snapshot

const hit = (s, actor, action) => ['21', ts(s), actor.id, actor.name, action, 'Skill', ENEMY, 'Boss', '710003', '1234', '0', '0', '0', '0'].join('|');
const aoe = (s, actor, action, targetId) => ['22', ts(s), actor.id, actor.name, action, 'Skill', targetId, 'Add', '710003', '1234', '0', '0', '0', '0'].join('|');
const cast = (s, actor, action, castSeconds) => ['20', ts(s), actor.id, actor.name, action, 'Skill', ENEMY, 'Boss', castSeconds.toFixed(3), '0', '0', '0', '0'].join('|');
const cancel = (s, actor, action) => ['23', ts(s), actor.id, actor.name, action, 'Skill', 'Interrupted'].join('|');
const status = (s, apply, statusHex, name, actor) => [apply ? '26' : '30', ts(s), statusHex, name, '15.00', actor.id, actor.name, actor.id, actor.name, '00', '75000', '75000'].join('|');
const enemyHit = (s, action) => ['21', ts(s), ENEMY, 'Boss', action, 'Boss Skill', ALICE.id, ALICE.name, '710003', '5000'].join('|');
const primary = (actor) => ['02', ts(0), actor.id, actor.name].join('|');

// ---------------------------------------------------------------- start

section('start');
const meter = newMeter();
check('starts', meter.init(), true);
check('available', meter.state.available, true);
check('category snapshot loaded', meter.state.categories.count > 30000, true);
check('recast table loaded', meter.state.actions.count, 146);
check('haste statuses loaded', meter.state.actions.speedStatuses, 5);

section('timestamps');
check('seven fractional digits with zone', Factory.parseTimestamp('2026-09-13T10:31:22.1234567+08:00') - Date.UTC(2026, 8, 13, 2, 31, 22), 123.4567, 0.001);
check('ISO with Z', Factory.parseTimestamp('2026-01-01T00:00:02.500Z') - T0, 2500);
check('negative offset', Factory.parseTimestamp('2026-01-01T00:00:00.000-05:00') - T0, 5 * 3600 * 1000);
check('garbage is NaN', Number.isNaN(Factory.parseTimestamp('not a time')), true);
check('non-string is NaN', Number.isNaN(Factory.parseTimestamp(undefined)), true);

// ---------------------------------------------------------------- who and what counts

section('players, oGCDs and auto-attacks');
meter.feed(enemyHit(0, '1F3A'));
check('an enemy line is not a player GCD', meter.state.abilityLinesNonPlayer, 1);
check('nobody identified yet', meter.snapshot().knownPlayers.length, 0);
meter.feed(hit(0.5, ALICE, FAN_DANCE));
check('Fan Dance (ability) is not a GCD', meter.state.abilityLinesNotGcd, 1);
check('but its line identifies Alice as a player', meter.statuses.isPlayer(ALICE.name), true);
meter.feed(hit(0.6, ALICE, AUTO_ATTACK));
check('auto-attack is not a GCD', meter.state.abilityLinesNotGcd, 2);
check('nothing recorded so far', meter.statsFor(ALICE.name).count, 0);

section('a clean instant rotation');
for (let i = 0; i < 12; i++) meter.feed(hit(1 + 2.5 * i, ALICE, CASCADE));
let st = meter.statsFor(ALICE.name);
check('12 Cascades counted', st.count, 12);
check('uptime 100%', st.uptime * 100, 100, 0.1);
check('recast 2.50s', st.recast, 2.5, 0.01);
check('no lost time', st.clip, 0, 0.01);

section('AoE hitting eight targets counts once');
for (let k = 0; k < 8; k++) meter.feed(aoe(31, ALICE, FOUNTAIN, '4000' + (1000 + k)));
check('one more GCD, not eight', meter.statsFor(ALICE.name).count, 13);

// ---------------------------------------------------------------- cast bars

section('hard casts: the cast-start line is the press, the effect is a duplicate');
meter.feed(cast(0, BOB, BLIZZARD_I, 2.5));
check('a cast bar identifies its player', meter.statuses.isPlayer(BOB.name), true);
check('recorded at cast start', meter.statsFor(BOB.name).count, 1);
check('as a hard cast', meter.state.hardCastsRecorded, 1);
check('pending until it lands', meter.casting.has(BOB.name), true);
meter.feed(hit(2.5, BOB, BLIZZARD_I));
check('the effect does not count twice', meter.statsFor(BOB.name).count, 1);
check('and clears the pending cast', meter.casting.has(BOB.name), false);
// Blizzard I: 2.5s cast on a 2.5s recast, caster tax follows, so a 2.6s cadence is clean.
for (let k = 1; k < 10; k++) {
	meter.feed(cast(2.6 * k, BOB, BLIZZARD_I, 2.5));
	meter.feed(hit(2.6 * k + 2.5, BOB, BLIZZARD_I));
}
st = meter.statsFor(BOB.name);
check('ten casts', st.count, 10);
check('uptime 100%', st.uptime * 100, 100, 0.1);
check('tax is not lost time', st.clip, 0, 0.01);
check('recast from the bar: 2.50s', st.recast, 2.5, 0.01);
check('spell speed samples, not skill speed', st.spellSpeedSamples > 0 && st.skillSpeedSamples === 0, true);

section('an interrupted cast never happened');
meter.feed(cast(26.0, BOB, BLIZZARD_I, 2.5));
check('provisionally counted', meter.statsFor(BOB.name).count, 11);
meter.feed(cancel(27.0, BOB, BLIZZARD_I));
check('removed on cancel', meter.statsFor(BOB.name).count, 10);
check('pending cleared', meter.casting.has(BOB.name), false);
check('hard cast counter rewound', meter.state.hardCastsRecorded, 10);
meter.feed(hit(27.5, BOB, BLIZZARD_I));          // Swiftcast: instant, no bar
check('an instant of the same spell still counts', meter.statsFor(BOB.name).count, 11);
check('but not as a hard cast', meter.state.hardCastsRecorded, 10);

section('a stale cast bar does not pair with a much later effect');
meter.feed(cast(40.0, BOB, BLIZZARD_I, 2.5));
meter.feed(hit(40.0 + 15.001 + 0.1, BOB, BLIZZARD_I));   // older than MAX_CAST_AGE_MS
check('the late effect is its own instant press', meter.statsFor(BOB.name).count, 13);
check('hard casts unchanged by it', meter.state.hardCastsRecorded, 11);

// ---------------------------------------------------------------- haste

section('haste statuses shorten the GCD, not the score');
meter.feed(status(0, true, PRESENCE_OF_MIND, 'Presence of Mind', CARA));
check('status is on Cara', meter.statuses.activeOn(CARA.name).length, 1);
for (let i = 0; i < 20; i++) meter.feed(hit(0.5 + 2.0 * i, CARA, GLARE_III));   // 2.0s cadence under 0.8
st = meter.statsFor(CARA.name);
check('20 GCDs', st.count, 20);
check('normalised recast 2.50s', st.recast, 2.5, 0.01);
check('no lost time under haste', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.1);
meter.feed(status(40.0, false, PRESENCE_OF_MIND, 'Presence of Mind', CARA));
check('status removed', meter.statuses.activeOn(CARA.name).length, 0);
for (let i = 0; i < 10; i++) meter.feed(hit(40.5 + 2.5 * i, CARA, GLARE_III));
st = meter.statsFor(CARA.name);
check('back at 2.5s: still clean', st.clip, 0, 0.01);

// ---------------------------------------------------------------- ninja

section('Ninja: mudras and Ninjutsu are GCDs although the game files them as abilities');
// FFXIV's ActionCategory for Ten/Chi/Jin and every Ninjutsu is 4 ("Ability"). Asked alone, the
// category table saw Ten - Chi - Raiton as a 2.5s hole after Aeolian Edge and booked it as lost
// time on every single Ninjutsu. xivanalysis' onGcd flag has to win.
const NIN = { id: '1000AAAA', name: 'Nami Ninja' };
const SPINNING_EDGE = '8C0', GUST_SLASH = '8C2', AEOLIAN_EDGE = '8CF';
const TEN = '8D3', CHI = '8D5', RAITON = '8DB';
const FUMA_TCJ = '49B9', RAITON_TCJ = '49BD', SUITON_TCJ = '49C1';
check('Raiton is category 4 in the game data', meter.categories.categoryOf(0x8DB), 4);
check('Ten too', meter.categories.categoryOf(0x8D3), 4);
check('but xivanalysis says Raiton rolls the GCD', meter.actions.isOnGcd(0x8DB), true);
check('and so do the mudras', meter.actions.isOnGcd(0x8D3) && meter.actions.isOnGcd(0x8D5), true);
// A Ninja's GCD is 2.12s at minimum skill speed (the 15% job haste). Six combos, each followed by
// Ten (0.5s) - Chi (0.5s) - Raiton (1.5s), then Ten Chi Jin: three 1.0s / 1.0s / 1.5s Ninjutsu.
let ninT = 0;
let ninPresses = 0;
const press = (s, action) => { meter.feed(hit(s, NIN, action)); ninPresses++; };
for (let cycle = 0; cycle < 6; cycle++) {
	press(ninT, SPINNING_EDGE); ninT += 2.12;
	press(ninT, GUST_SLASH); ninT += 2.12;
	press(ninT, AEOLIAN_EDGE); ninT += 2.12;
	press(ninT, TEN); ninT += 0.5;
	press(ninT, CHI); ninT += 0.5;
	press(ninT, RAITON); ninT += 1.5;
}
press(ninT, FUMA_TCJ); ninT += 1.0;
press(ninT, RAITON_TCJ); ninT += 1.0;
press(ninT, SUITON_TCJ); ninT += 1.5;
press(ninT, SPINNING_EDGE);
st = meter.statsFor(NIN.name);
check('every press counted, mudras and Ninjutsu included', st.count, ninPresses);
// Within one 45ms batch: an exact synthetic cadence reads the batch midpoint (see test-gcd-tracker 12b).
check('recast 2.12s (job haste absorbed by the estimate)', st.recast, 2.12, 0.03);
check('nothing lost across the Ninjutsu', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.1);
check('nothing counted as unknown', meter.state.unknownActions, 0);

// ---------------------------------------------------------------- unknown actions

section('an action the snapshot never heard of');
meter.feed(hit(0, DAN, UNKNOWN_NEW));
check('an unknown instant is not counted', meter.statsFor(DAN.name).count, 0);
meter.feed(cast(2.5, DAN, UNKNOWN_NEW, 2.5));
check('an unknown hard cast is', meter.statsFor(DAN.name).count, 1);
check('unknown actions noted', meter.state.unknownActions >= 2, true);

// ---------------------------------------------------------------- CombatData

function combatData(isActive, duration) {
	return {
		Encounter: { title: 'Boss', duration: '00:00', DURATION: String(duration), damage: '1', ENCDPS: '1' },
		Combatant: {
			YOU: { name: 'YOU', Job: 'DNC', damage: '100' },
			'Bob Mage': { name: 'Bob Mage', Job: 'BLM', damage: '100' },
			'Cara Healer': { name: 'Cara Healer', Job: 'WHM', damage: '10' },
			'Eos (YOU)': { name: 'Eos (YOU)', Job: '', damage: '1' },
			Boss: { name: 'Boss', Job: '', damage: '5' },
		},
		isActive,
	};
}

section('overlay writes the five columns as the addon did');
let detail = combatData('true', 600);
let out = meter.overlay(detail, ALICE.name);
check('same object, written in place', out === detail, true);
check('applied', out.gcd.applied, true);
check('rows written', out.gcd.written, 5);
check('YOU is Alice', out.Combatant.YOU.gcdCount, '13');
check('YOU uptime', out.Combatant.YOU.gcdUptime, '100');
check('YOU recast', out.Combatant.YOU.gcdRecast, '2.5');
check('YOU lost', out.Combatant.YOU.gcdClip, '0');
check('YOU occupied', out.Combatant.YOU.gcdOccupied, String(12 * 2.5));
check('Bob', out.Combatant['Bob Mage'].gcdCount, '13');
check('Cara', out.Combatant['Cara Healer'].gcdCount, '30');
check('a pet reads zero', out.Combatant['Eos (YOU)'].gcdCount, '0');
check('a pet keeps the default recast', out.Combatant['Eos (YOU)'].gcdRecast, '2.5');
check('an NPC reads zero', out.Combatant.Boss.gcdUptime, '0');
check('first CombatData counted as an encounter', meter.state.encounters, 1);
check('nothing dropped: the pull is longer than the presses', meter.statsFor(ALICE.name).count, 13);

section('the local name falls back to log line 02');
meter.feed(primary(ALICE));
out = meter.overlay(combatData('true', 600), '');
check('YOU resolved through line 02', out.Combatant.YOU.gcdCount, '13');

section('a new encounter forgets the presses before it');
meter.overlay(combatData('false', 640), ALICE.name);                  // the pull ended
check('ending is not a new encounter', meter.state.encounters, 1);
for (let i = 0; i < 10; i++) meter.feed(hit(100 + 2.5 * i, ALICE, CASCADE));   // 100 .. 122.5: the next pull
out = meter.overlay(combatData('true', 5), ALICE.name);
check('isActive turning true is a new encounter', meter.state.encounters, 2);
// Estimated start: 122.5 - (5 + 1) - 1 = 115.5 -> the presses at 117.5, 120 and 122.5 remain.
check('Alice keeps the presses inside the pull', out.Combatant.YOU.gcdCount, '3');
check('Bob, who has not pressed anything this pull, reads zero', out.Combatant['Bob Mage'].gcdCount, '0');
check('Bob is gone from the tracker', meter.tracker.players.indexOf(BOB.name) < 0, true);
check('the window restarts inside the pull', out.Combatant.YOU.gcdUptime, '100');

section('DURATION shrinking while active is a new encounter too');
meter.overlay(combatData('true', 8), ALICE.name);
check('growing duration is the same encounter', meter.state.encounters, 2);
for (let i = 0; i < 4; i++) meter.feed(hit(130 + 2.5 * i, ALICE, CASCADE));   // 130 .. 137.5
out = meter.overlay(combatData('true', 2), ALICE.name);
check('detected', meter.state.encounters, 3);
// 137.5 - 3 - 1 = 133.5 -> 135 and 137.5 remain.
check('cut at the estimated start', out.Combatant.YOU.gcdCount, '2');

// ---------------------------------------------------------------- failure modes

section('without the category snapshot');
const blind = Factory.create(Object.assign({}, deps, { categoryData: undefined }));
check('refuses to start', blind.init(), false);
check('says why', /unavailable/.test(blind.state.reason), true);
blind.feed(hit(0, ALICE, CASCADE));
detail = combatData('true', 10);
out = blind.overlay(detail, ALICE.name);
check('leaves the message alone', 'gcdCount' in out.Combatant.YOU, false);
check('and says so', out.gcd.applied, false);

section('without the recast table');
const bare = Factory.create(Object.assign({}, deps, { actionTable: undefined }));
check('still starts', bare.init(), true);
check('but records the problem', typeof bare.state.actions.error, 'string');
for (let i = 0; i < 6; i++) bare.feed(hit(2.5 * i, ALICE, CASCADE));
check('every GCD is a plain 2.5s', bare.statsFor(ALICE.name).recast, 2.5, 0.01);

section('malformed lines are counted, not thrown');
const before = meter.state.malformed;
meter.feed('21|not a time|10001234|Alice Dancer|3E75|Skill|40001234|Boss');
meter.feed('20|' + ts(1) + '|10001234|Alice Dancer|zz');
meter.feed('21|' + ts(1) + '|10001234');
meter.feed('');
meter.feed('garbage without bars');
check('three malformed lines', meter.state.malformed - before, 3);
check('no error escaped', meter.state.lastError, '');

section('dump');
const text = meter.dump(ALICE.name);
check('names the player', text.indexOf(ALICE.name) === 0, true);
check('one row per GCD plus the header', text.split('\n').length, 2 + meter.statsFor(ALICE.name).count);

console.log('');
if (failures > 0) {
	console.log(`==> ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('==> all checks passed');

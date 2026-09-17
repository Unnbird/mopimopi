/**
 * Runs mopimopi's real Person / Combatant code (js/core.js) on a CombatData message and checks the
 * one job this page still has for the numbers: choosing, per row, between ACT's figure and the one
 * OverlayPluginAddon worked out with FFLogs' parser.
 *
 * Nothing is computed from log lines here any more. The rDPS family and the GCD columns arrive
 * already divided and must be shown exactly as they came; everything else arrives twice, once
 * under ACT's name and once prefixed, and preferFflogs picks. The distinction that matters most is
 * empty versus zero: empty means FFLogs has nothing for this row and ACT's figure stands, zero
 * means FFLogs counted it under someone else and the row really is worth nothing.
 *
 * Usage:  node tests/test-core-person.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// core.js is written for a browser and starts by firing an XHR at a preview log. Stub out just
// enough of the environment for the file to evaluate; nothing below touches the network or DOM.
const sandbox = {
	console,
	XMLHttpRequest: function () {
		this.open = () => {};
		this.send = () => {};
	},
	WebSocket: function () {},
	document: { addEventListener: () => {}, dispatchEvent: () => {} },
	window: { addEventListener: () => {}, location: { search: '' } },
	navigator: { userAgent: '' },
	location: { search: '' },
	wsUri: '',
	init: { q: { pets: 1, fflogs: 1 } },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8'), sandbox, { filename: 'core.js' });

let failures = 0;
function check(label, actual, expected) {
	const ok = typeof expected === 'number'
		? typeof actual === 'number' && Math.abs(actual - expected) < 0.001
		: Object.is(actual, expected);
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(58)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function section(title) { console.log(`\n=============== ${title} ===============`); }

// The two clocks the plugin exports: damage is divided by the fight minus its downtime, healing by
// the whole fight. ACT's own DURATION is neither, and is deliberately different here so that a
// column dividing by the wrong one is visible.
const duration = 455;
const healDuration = 515;
const actDuration = 600;

// One CombatData message as OverlayPluginAddon leaves it. Every row carries ACT's figures and,
// beside them, the plugin's: the rDPS family under its own names, the rest prefixed.
const combatData = {
	Encounter: {
		title: 'M4S', duration: '10:00',
		DURATION: String(actDuration), damage: '99999999', healed: '1', ENCDPS: '1',
		fflogsDuration: String(duration), fflogsHealDuration: String(healDuration),
		fflogsDamage: String(9784320 + 9784320 + 500000), fflogsHealed: '1536000',
		fflogsRdps: '19218384', fflogsDowntime: '60', fflogsApplied: '1', fflogsParserVersion: '3075',
		// The pull's own clock and id. ACT's duration above restarts at a phase transition; these
		// do not, which is how the header keeps the pull's time and how a row ACT has momentarily
		// forgotten is told from a player who left.
		fflogsDurationText: '08:35', fflogsFightId: '7',
		// The header totals. Divided in the plugin against the same two clocks the rows were.
		fflogsEncdps: String(Math.round((9784320 + 9784320 + 500000) / duration)),
		fflogsEnchps: String(Math.round(1536000 / healDuration)),
	},
	Combatant: {
		'Fflogs Player': {
			name: 'Fflogs Player', Job: 'RPR',
			// ACT's figures, which the plugin's must win over.
			DURATION: String(actDuration), damage: '1', hits: '1', swings: '400', misses: '0',
			crithits: '1', DirectHitCount: '1', CritDirectHitCount: '1', maxhit: 'Ignored-1', MAXHIT: '1',
			healed: '1', overHeal: '1', heals: '1', critheals: '1', maxheal: '', MAXHEAL: '0', deaths: '1',
			damagetaken: '0', healstaken: '0',
			// The plugin's.
			fflogsDuration: String(duration), fflogsHealDuration: String(healDuration),
			fflogsDamage: '9784320', fflogsHits: '400', fflogsCrithits: '100',
			fflogsDirectHitCount: '80', fflogsCritDirectHitCount: '20',
			fflogsMaxhit: 'Communio-89000', fflogsMAXHIT: '89000',
			fflogsHealed: '1024000', fflogsOverHeal: '24000', fflogsHeals: '10', fflogsCritheals: '2',
			fflogsMaxheal: 'Arcane Crest-4000', fflogsMAXHEAL: '4000', fflogsDeaths: '0',
			rdps: '19241.5', adps: '19107.2', ndps: '17201.3', cdps: '20345.8',
			rdpsDelta: '234.1', rdpsPct: '51.2',
			gcdUptime: '92.6', gcdCount: '198', gcdClip: '4.2', gcdRecast: '2.5',
		},
		// A summoner and the pet FFLogs keeps as a row of its own: the owner's damage excludes it,
		// the pet's row carries it, and AttachPets adds them back to the parser's total.
		'Summoner S': {
			name: 'Summoner S', Job: 'SMN',
			DURATION: String(actDuration), damage: '1', hits: '1', swings: '200', misses: '0',
			crithits: '0', DirectHitCount: '0', CritDirectHitCount: '0', maxhit: '', MAXHIT: '0',
			healed: '0', overHeal: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0',
			damagetaken: '0', healstaken: '0',
			fflogsDuration: String(duration), fflogsHealDuration: String(healDuration),
			fflogsDamage: '9784320', fflogsHits: '200', fflogsCrithits: '50',
			fflogsDirectHitCount: '0', fflogsCritDirectHitCount: '0',
			fflogsMaxhit: 'Ruin III-30000', fflogsMAXHIT: '30000',
			fflogsHealed: '0', fflogsOverHeal: '0', fflogsHeals: '0', fflogsCritheals: '0',
			fflogsMaxheal: '', fflogsMAXHEAL: '0', fflogsDeaths: '0',
			rdps: '18000', adps: '18000', ndps: '18000', cdps: '18000',
			rdpsDelta: '0', rdpsPct: '48.8',
			gcdUptime: '88.1', gcdCount: '190', gcdClip: '9.9', gcdRecast: '2.37',
		},
		'Demi-Bahamut (Summoner S)': {
			name: 'Demi-Bahamut (Summoner S)', Job: '',
			DURATION: String(actDuration), damage: '7777', hits: '20', swings: '20', misses: '0',
			crithits: '0', DirectHitCount: '0', CritDirectHitCount: '0', maxhit: '', MAXHIT: '0',
			healed: '0', overHeal: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0',
			damagetaken: '0', healstaken: '0',
			fflogsDuration: String(duration), fflogsHealDuration: String(healDuration),
			fflogsDamage: '500000', fflogsHits: '20', fflogsCrithits: '5',
			fflogsDirectHitCount: '0', fflogsCritDirectHitCount: '0',
			fflogsMaxhit: 'Wyrmwave-60000', fflogsMAXHIT: '60000',
			fflogsHealed: '0', fflogsOverHeal: '0', fflogsHeals: '0', fflogsCritheals: '0',
			fflogsMaxheal: '', fflogsMAXHEAL: '0', fflogsDeaths: '0',
			// A pet gets no rate of its own: the owner's row already carries the folded rDPS.
			rdps: '0', adps: '0', ndps: '0', cdps: '0', rdpsDelta: '0', rdpsPct: '0',
			gcdUptime: '0', gcdCount: '0', gcdClip: '0', gcdRecast: '2.5',
		},
		// A pet the parser folded into its owner: every plugin figure is zero, and zero must win
		// over ACT's 4242 or the owner would be handed its pet's damage twice.
		'Carbuncle (Summoner S)': {
			name: 'Carbuncle (Summoner S)', Job: '',
			DURATION: String(actDuration), damage: '4242', hits: '9', swings: '9', misses: '0',
			crithits: '0', DirectHitCount: '0', CritDirectHitCount: '0', maxhit: '', MAXHIT: '0',
			healed: '0', overHeal: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0',
			damagetaken: '0', healstaken: '0',
			fflogsDuration: String(duration), fflogsHealDuration: String(healDuration),
			fflogsDamage: '0', fflogsHits: '0', fflogsCrithits: '0',
			fflogsDirectHitCount: '0', fflogsCritDirectHitCount: '0',
			fflogsMaxhit: '', fflogsMAXHIT: '0',
			fflogsHealed: '0', fflogsOverHeal: '0', fflogsHeals: '0', fflogsCritheals: '0',
			fflogsMaxheal: '', fflogsMAXHEAL: '0', fflogsDeaths: '0',
			rdps: '0', adps: '0', ndps: '0', cdps: '0', rdpsDelta: '0', rdpsPct: '0',
			gcdUptime: '0', gcdCount: '0', gcdClip: '0', gcdRecast: '2.5',
		},
		// A row FFLogs never saw: every plugin column is empty, and empty is what gets shown.
		'Striking Dummy': {
			name: 'Striking Dummy', Job: 'MNK',
			DURATION: String(actDuration), damage: '123456', hits: '77', swings: '77', misses: '0',
			crithits: '7', DirectHitCount: '7', CritDirectHitCount: '1', maxhit: 'Bootshine-5000', MAXHIT: '5000',
			healed: '6000', overHeal: '1000', heals: '3', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '2',
			damagetaken: '0', healstaken: '0',
			fflogsDuration: '', fflogsHealDuration: '',
			fflogsDamage: '', fflogsHits: '', fflogsCrithits: '',
			fflogsDirectHitCount: '', fflogsCritDirectHitCount: '', fflogsMaxhit: '', fflogsMAXHIT: '',
			fflogsHealed: '', fflogsOverHeal: '', fflogsHeals: '', fflogsCritheals: '',
			fflogsMaxheal: '', fflogsMAXHEAL: '', fflogsDeaths: '',
			rdps: '', adps: '', ndps: '', cdps: '', rdpsDelta: '', rdpsPct: '',
			gcdUptime: '73.4', gcdCount: '60', gcdClip: '30.1', gcdRecast: '2.5',
		},
	},
	isActive: 'true',
};

const parsed = new sandbox.Combatant({ detail: combatData }, 'encdps');
parsed.summonerMerge = true;
parsed.AttachPets();
parsed.resort('mergedDamage', 1);

const reaper = parsed.Combatant['Fflogs Player'];
const summoner = parsed.Combatant['Summoner S'];
const demi = parsed.Combatant['Demi-Bahamut (Summoner S)'];
const carbuncle = parsed.Combatant['Carbuncle (Summoner S)'];
const dummy = parsed.Combatant['Striking Dummy'];

console.log('=============== the plugin\'s figures win over ACT\'s ===============');
check('damage', reaper.damage, 9784320);
check('hits', reaper.hits, 400);
check('crits', reaper.crithits, 100);
check('direct hits', reaper.DirectHitCount, 80);
check('critical direct hits', reaper.CritDirectHitCount, 20);
check('biggest hit keeps ACT\'s spelling', reaper.maxhit, 'Communio-89000');
check('and its bare number', reaper.MAXHIT, 89000);
check('healing', reaper.healed, 1024000);
check('overheal', reaper.overHeal, 24000);
check('deaths', reaper.deaths, 0);

section('the two clocks, and they are not the same one');
check('DURATION is the fight minus its downtime', reaper.DURATION, duration);
check('HEALDURATION is the whole fight', reaper.HEALDURATION, healDuration);
check('dps divides by the damage clock', reaper.dps, Math.round(9784320 / duration * 100) / 100);
check('hps divides by the healing clock', reaper.hps, Math.round(1024000 / healDuration * 100) / 100);
// The encounter row gets the same treatment, or encdps and dps would disagree on the same row.
check('the encounter clock too', parsed.DURATION, duration);
check('encdps follows it', reaper.encdps, Math.round(9784320 / duration * 100) / 100);

section('the rDPS family is shown as sent, never divided again');
check('rdps', reaper.rdps, 19241.5);
check('adps', reaper.adps, 19107.2);
check('ndps', reaper.ndps, 17201.3);
check('cdps', reaper.cdps, 20345.8);
check('rdpsDelta', reaper.rdpsDelta, 234.1);
check('rdpsPct', reaper.rdpsPct, 51.2);
// The bug this guards: dividing an already-divided column by the duration a second time.
check('not rdps / duration', reaper.rdps !== Math.round(19241.5 / duration * 100) / 100, true);

section('the GCD columns pass straight through');
check('gcdUptime', reaper.gcdUptime, 92.6);
check('gcdCount', reaper.gcdCount, 198);
check('gcdClip', reaper.gcdClip, 4.2);
check('gcdRecast', reaper.gcdRecast, 2.5);

section('pets: a share each, adding back up to the parser\'s total');
check('the owner\'s own damage', summoner.damage, 9784320);
check('the pet FFLogs kept apart', demi.damage, 500000);
// Zero, and ACT's 4242 does not come back: the parser counted Carbuncle under its owner already,
// so anything here would be counted twice once AttachPets sums the pet rows into the owner.
check('one it folded in reads zero', carbuncle.damage, 0);
check('merged lands on the parser\'s total', summoner.mergedDamage, 9784320 + 500000);
check('and not on ACT\'s figures', summoner.mergedDamage !== 1 + 7777 + 4242, true);
check('the owner keeps its own rDPS', summoner.rdps, 18000);
check('the pet has none', demi.rdps, 0);

section("a row FFLogs never saw keeps ACT's figures");
// Empty is the addon saying it measured nothing here, which is not a measurement of nothing. The
// whole row stays ACT's - and so does the whole table on a pull the parser is not reporting, where
// every column arrives empty and the alternative is a table of zeros.
check('damage', dummy.damage, 123456);
check('hits', dummy.hits, 77);
check('healing', dummy.healed, 6000);
check('deaths', dummy.deaths, 2);
check("and ACT's clock with them", dummy.DURATION, actDuration);
check('no rDPS, which is FFLogs\' to have', dummy.rdps, 0);
// GCD uptime is measured off the log lines, not off FFLogs' fight, so it is there regardless.
check('but GCD uptime is still measured', dummy.gcdUptime, 73.4);

section('the healing block moves on its own');
// This build of the parser never measures player healing: it marks only NPCs and pets as friendly
// for its healing meters. The addon reports that as empty rather than as zero, and the healing
// columns stay ACT's - taking the zeros left healing at 0 next to ACT's shield and overheal, and
// effective healing went negative.
const noHealing = JSON.parse(JSON.stringify(combatData));
for (const row of Object.values(noHealing.Combatant)) {
	// The figures go; the clock stays, because it belongs to the fight and not to the table.
	row.fflogsHealed = row.fflogsOverHeal = row.fflogsHeals = row.fflogsCritheals = '';
	row.fflogsMaxheal = row.fflogsMAXHEAL = row.fflogsHps = '';
}
noHealing.Encounter.fflogsHealed = noHealing.Encounter.fflogsEnchps = '';
const acted = noHealing.Combatant['Fflogs Player'];
acted.healed = '600000';
acted.overHeal = '100000';
acted.heals = '40';
acted.damageShield = '50000';
const withHealing = new sandbox.Combatant({ detail: noHealing }, 'encdps');
withHealing.summonerMerge = true;
withHealing.AttachPets();
const healer = withHealing.Combatant['Fflogs Player'];
check("healing is ACT's", healer.healed, 600000);
check('overheal too', healer.overHeal, 100000);
check('and the heal count', healer.heals, 40);
// The bug: FFLogs' zero healing over ACT's shield and overheal, which are not zero.
check('effective healing is not negative', healer.effHealed, 600000 - 100000 - 50000);
check("HPS divides ACT's healing by the fight's clock", healer.hps, Math.round(600000 / healDuration * 100) / 100);
check("the encounter keeps ACT's healing too", withHealing.Encounter.healed, 1);
check("while the damage block is still FFLogs'", healer.damage, 9784320);
check("on the fight's clock", healer.DURATION, duration);

section("the header clock is the pull's, not ACT's encounter");
// ACT ends its encounter whenever combat drops for its idle timeout, and a scripted phase
// transition is exactly that - so its clock restarted mid-pull while every figure beside it went
// on describing the whole fight.
check('the clock the header prints', parsed.duration, '08:35');
check("ACT's own is not it", combatData.Encounter.duration, '10:00');
check('and the row carries it too', reaper.EncounterDuration, '08:35');

section('the encounter row, so D% is a share of the same table');
check('encounter damage', parsed.Encounter.damage, 9784320 + 9784320 + 500000);
check('encounter healing', parsed.Encounter.healed, 1536000);
// The header prints these. ACT's own ENCDPS was 1 in this message; the plugin's must have won, or
// the header would be describing a different pull from the table under it.
check('raid DPS', parsed.Encounter.ENCDPS, Math.round((9784320 + 9784320 + 500000) / duration));
check('raid HPS', parsed.Encounter.ENCHPS, Math.round(1536000 / healDuration));
// Owners only: damagePct is a share of the merged total, and a pet's share is already inside its
// owner's. The dummy is outside this sum because FFLogs never saw it - its damage is ACT's and the
// encounter total is FFLogs', which is exactly the mix the plugin leaves behind for rows it does
// not know.
const pct = reaper.damagePct + summoner.damagePct;
check('the FFLogs rows add up to 100%', Math.round(pct * 10) / 10, 100);

section('where the figures came from');
check('applied', parsed.fflogs.applied, true);
check('which parser', parsed.fflogs.parserVersion, '3075');
check('downtime', parsed.fflogs.downtimeSeconds, 60);

section('the setting is a display choice now');
sandbox.init.q.fflogs = 0;
const actOnly = new sandbox.Combatant({ detail: combatData }, 'encdps');
check('ACT\'s damage', actOnly.Combatant['Fflogs Player'].damage, 1);
check('ACT\'s duration', actOnly.Combatant['Fflogs Player'].DURATION, actDuration);
check('ACT\'s encounter total', actOnly.Encounter.damage, 99999999);
// The rDPS family is not ACT's to have, so it is left alone either way.
check('rdps is still shown', actOnly.Combatant['Fflogs Player'].rdps, 19241.5);
sandbox.init.q.fflogs = 1;

section('solo: rDPS is just DPS when there is nobody to give or take buffs');
// The bug this guards: rDPS is divided in the plugin, against the exact length of the fight. Every
// per-second column that was divided anywhere else ended up on a different divisor, and a solo
// pull - where the two columns are by definition the same number - showed them apart. First it was
// whole seconds against 30.4; then, once the plugin exported milliseconds, it was 30.456 against
// the 30.45 this page's two-decimal parse left of it. So the plugin divides DPS too, and the clock
// it divided by arrives here unrounded for the columns that still do their own arithmetic.
const soloDamage = 4823917;
const soloSeconds = 30.456;                       // what Clock()'s "0.###" actually sends
const soloRate = Math.round(soloDamage / soloSeconds * 100) / 100;   // what Rate()'s "0.##" sends
const soloRow = {
	name: 'Solo Player', Job: 'SAM',
	DURATION: '30', damage: String(soloDamage), hits: '90', swings: '90', misses: '0',
	crithits: '20', DirectHitCount: '18', CritDirectHitCount: '5', maxhit: 'Midare-120000', MAXHIT: '120000',
	healed: '0', overHeal: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0',
	damagetaken: '0', healstaken: '0',
	fflogsDuration: String(soloSeconds), fflogsHealDuration: String(soloSeconds),
	fflogsDamage: String(soloDamage), fflogsHits: '90', fflogsCrithits: '20',
	fflogsDirectHitCount: '18', fflogsCritDirectHitCount: '5',
	fflogsMaxhit: 'Midare Setsugekka-120000', fflogsMAXHIT: '120000',
	fflogsHealed: '0', fflogsOverHeal: '0', fflogsHeals: '0', fflogsCritheals: '0',
	fflogsMaxheal: '', fflogsMAXHEAL: '0', fflogsDeaths: '0',
	// Divided in the plugin, like the four below it.
	fflogsDps: String(soloRate), fflogsHps: '0',
	// Nobody to take from and nobody to give to, so all four are the same figure.
	rdps: String(soloRate), adps: String(soloRate), ndps: String(soloRate), cdps: String(soloRate),
	rdpsDelta: '0', rdpsPct: '100',
	gcdUptime: '96.4', gcdCount: '12', gcdClip: '0.4', gcdRecast: '2.5',
};
const soloMessage = {
	Encounter: {
		title: 'Striking Dummy', duration: '00:30',
		DURATION: '30', damage: String(soloDamage), healed: '0', ENCDPS: '160797',
		fflogsDuration: String(soloSeconds), fflogsHealDuration: String(soloSeconds),
		fflogsDamage: String(soloDamage), fflogsHealed: '0',
		fflogsRdps: String(soloDamage), fflogsDowntime: '0',
		fflogsApplied: '1', fflogsParserVersion: '3075',
	},
	Combatant: { 'Solo Player': soloRow },
	isActive: 'true',
};
const solo = new sandbox.Combatant({ detail: soloMessage }, 'encdps');
// process.js does this on every message before drawing; it is what fills the derived columns in.
solo.AttachPets();
const player = solo.Combatant['Solo Player'];
check('the clock keeps its milliseconds', player.DURATION, soloSeconds);
check('the encounter clock too', solo.DURATION, soloSeconds);
check('DPS is the plugin\'s, shown as it came', player.encdps, soloRate);
check('so rDPS and DPS agree exactly', player.encdps - player.rdps, 0);
check('and so do the other three', player.adps + player.ndps + player.cdps, player.encdps * 3);
check('nothing was given or taken', player.rdpsDelta, 0);

// An addon from before fflogsDps existed. The page divides for itself again - and still lands on
// the same figure, because the clock it divides by kept its milliseconds.
const soloOld = JSON.parse(JSON.stringify(soloMessage));
delete soloOld.Combatant['Solo Player'].fflogsDps;
delete soloOld.Combatant['Solo Player'].fflogsHps;
const older = new sandbox.Combatant({ detail: soloOld }, 'encdps');
older.AttachPets();
check('an older addon still agrees', older.Combatant['Solo Player'].encdps, soloRate);

section('a pet FFLogs keeps apart: its rate reaches the owner and leaves again');
// rDPS is the folded total on the owner's row. The DPS column only matches it while the pet's line
// is merged in, and the pet's line carries a rate of its own for exactly that.
const petSeconds = 61.125;
const ownerDamage = 2000000, petDamage = 500000;
const ownRate = Math.round(ownerDamage / petSeconds * 100) / 100;
const petRate = Math.round(petDamage / petSeconds * 100) / 100;
const foldedRate = Math.round((ownerDamage + petDamage) / petSeconds * 100) / 100;
const blank = {
	DURATION: '61', hits: '1', swings: '1', misses: '0', crithits: '0',
	DirectHitCount: '0', CritDirectHitCount: '0', maxhit: '', MAXHIT: '0',
	healed: '0', overHeal: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0',
	deaths: '0', damagetaken: '0', healstaken: '0',
	fflogsDuration: String(petSeconds), fflogsHealDuration: String(petSeconds),
	fflogsHits: '1', fflogsCrithits: '0', fflogsDirectHitCount: '0', fflogsCritDirectHitCount: '0',
	fflogsMaxhit: '', fflogsMAXHIT: '0', fflogsHealed: '0', fflogsOverHeal: '0',
	fflogsHeals: '0', fflogsCritheals: '0', fflogsMaxheal: '', fflogsMAXHEAL: '0', fflogsDeaths: '0',
	fflogsHps: '0', rdpsDelta: '0', gcdUptime: '0', gcdCount: '0', gcdClip: '0', gcdRecast: '2.5',
};
const withPet = new sandbox.Combatant({
	detail: {
		Encounter: {
			title: 'Striking Dummy', duration: '01:01', DURATION: '61',
			damage: String(ownerDamage + petDamage), healed: '0', ENCDPS: '1',
			fflogsDuration: String(petSeconds), fflogsHealDuration: String(petSeconds),
			fflogsDamage: String(ownerDamage + petDamage), fflogsHealed: '0',
			fflogsRdps: String(ownerDamage + petDamage), fflogsDowntime: '0',
			fflogsApplied: '1', fflogsParserVersion: '3075',
		},
		Combatant: {
			'Summoner S': Object.assign({}, blank, {
				name: 'Summoner S', Job: 'SMN', damage: String(ownerDamage),
				fflogsDamage: String(ownerDamage), fflogsDps: String(ownRate),
				// The plugin folds the pet into the rDPS family and nowhere else.
				rdps: String(foldedRate), adps: String(foldedRate),
				ndps: String(foldedRate), cdps: String(foldedRate), rdpsPct: '100',
			}),
			'Demi-Bahamut (Summoner S)': Object.assign({}, blank, {
				name: 'Demi-Bahamut (Summoner S)', Job: '', damage: String(petDamage),
				fflogsDamage: String(petDamage), fflogsDps: String(petRate),
				rdps: '0', adps: '0', ndps: '0', cdps: '0', rdpsPct: '0',
			}),
		},
		isActive: 'true',
	},
}, 'encdps');
// process.js's order on every message: attach (or detach) first, then sort - sort() is what folds
// a pet's line into its owner.
withPet.AttachPets();
withPet.resort('mergedDamage', 1);
const smn = withPet.Combatant['Summoner S'];
check('the owner\'s DPS is own plus pet', smn.encdps, foldedRate);
check('which is what rDPS is a rate on', smn.encdps - smn.rdps, 0);
withPet.DetachPets();
withPet.resort('mergedDamage', 1);
check('pets off takes the pet back out', smn.encdps, ownRate);
check('and the pet keeps its own', withPet.Combatant['Demi-Bahamut (Summoner S)'].encdps, petRate);

section('the plugin\'s rate follows the same setting every other column does');
sandbox.init.q.fflogs = 0;
const soloAct = new sandbox.Combatant({ detail: soloMessage }, 'encdps');
soloAct.AttachPets();
check('DPS is ACT\'s again', soloAct.Combatant['Solo Player'].encdps,
	Math.round(soloDamage / 30 * 100) / 100);
check('rDPS is not ACT\'s to have', soloAct.Combatant['Solo Player'].rdps, soloRate);
sandbox.init.q.fflogs = 1;

section('a message from a mopimopi with no addon');
const bare = JSON.parse(JSON.stringify(combatData));
for (const key of Object.keys(bare.Encounter)) if (key.startsWith('fflogs')) delete bare.Encounter[key];
for (const row of Object.values(bare.Combatant)) {
	for (const key of Object.keys(row)) if (key.startsWith('fflogs')) delete row[key];
}
const untagged = new sandbox.Combatant({ detail: bare }, 'encdps');
check('no tag', untagged.fflogs, null);
check('ACT\'s figures throughout', untagged.Combatant['Fflogs Player'].damage, 1);
check('and ACT\'s clock', untagged.Combatant['Fflogs Player'].DURATION, actDuration);

section("rows ACT forgets mid-pull are carried, rows from another pull are not");
// ACT lists the combatants of its current encounter, and at a phase transition that encounter is a
// brand new one: the table emptied and then refilled a player at a time, while every figure in the
// message was still the whole pull's. Same fight id, same pull, so a row that was here a moment ago
// is one ACT is about to book again.
const pullRow = (name, damage) => ({
	name, Job: 'RPR', DURATION: '100', damage: String(damage), hits: '1', swings: '1', misses: '0',
	crithits: '0', DirectHitCount: '0', CritDirectHitCount: '0', maxhit: '', MAXHIT: '0',
	healed: '0', overHeal: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0',
	damagetaken: '0', healstaken: '0',
});
const pullMessage = (fightId, names) => ({
	Encounter: { title: 'M4S', duration: '01:00', DURATION: '100', damage: '2', healed: '0', fflogsFightId: fightId },
	Combatant: Object.fromEntries(names.map((n, i) => [n, pullRow(n, 100 + i)])),
	isActive: 'true',
});

sandbox.carryOverRows(pullMessage('7', ['Alice', 'Bob']));
const transition = sandbox.carryOverRows(pullMessage('7', ['Alice']));
check('the row ACT still has', 'Alice' in transition.Combatant, true);
check('and the one it forgot', 'Bob' in transition.Combatant, true);
check('with the figures it last had', transition.Combatant['Bob'].damage, '101');

// Still gone two messages later, and still carried.
const stillGone = sandbox.carryOverRows(pullMessage('7', ['Alice']));
check('carried again on the next message', 'Bob' in stillGone.Combatant, true);

const nextPull = sandbox.carryOverRows(pullMessage('8', ['Alice']));
check('a new pull carries nothing', 'Bob' in nextPull.Combatant, false);

// No addon, or a pull the parser is not reporting: no id, and nothing is carried.
sandbox.carryOverRows(pullMessage('', ['Alice', 'Bob']));
const noId = sandbox.carryOverRows(pullMessage('', ['Alice']));
check('no fight id, no carrying', 'Bob' in noId.Combatant, false);

console.log(failures === 0 ? '\n==> all checks passed' : `\n==> ${failures} check(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;

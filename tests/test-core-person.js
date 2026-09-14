/**
 * Runs mopimopi's real Person / Combatant code (js/core.js) on a CombatData message and checks
 * where the rDPS family comes from now: the FFLogs parser's four totals that js/fflogs/apply.js
 * writes into a row, and nothing else. The export variables the retired RdpsOverlay addon used
 * to inject (rdpsTotal, rdps, rawdps, ...) must be ignored on the way in, while the GCD columns
 * (written by js/gcd/apply.js, or by the OverlayPluginAddon ACT addon) pass straight through.
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
	init: { q: { pets: 1 } },
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

const duration = 512;        // the fight minus its downtime: what damage is divided by
const healDuration = 600;    // the whole fight: what healing is divided by
const rate = (total) => Math.round(total / duration * 100) / 100;
const healRate = (total) => Math.round(total / healDuration * 100) / 100;

// One row as apply.js leaves it (FFLogs totals written in), one as a stale RdpsOverlay would
// have sent it (legacy export variables only), both with the GCD columns already written in.
const combatData = {
	// Two clocks, as js/fflogs/apply.js writes them: DURATION is the fight without its downtime
	// and divides every damage column, HEALDURATION is the whole fight and divides the healing.
	// fflogsRdps is the raid's rDPS total apply.js writes beside the damage total: every parsed
	// row's (amount - taken + given), plus ACT's damage for the rows FFLogs never matched -
	// here the legacy one. rdpsPct is a share of it.
	Encounter: { title: 'M4S', duration: '10:00', DURATION: String(duration), HEALDURATION: String(healDuration), damage: '19568640', fflogsRdps: String(9434064 + 9784320), healed: '2048000', ENCDPS: '38220' },
	Combatant: {
		'Fflogs Player': {
			name: 'Fflogs Player', Job: 'RPR', DURATION: String(duration), HEALDURATION: String(healDuration), damage: '9784320', hits: '400', swings: '400', misses: '0',
			crithits: '100', DirectHitCount: '80', CritDirectHitCount: '20', maxhit: 'Communio-89000', MAXHIT: '89000',
			healed: '1024000', overHeal: '0', damageShield: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0',
			damagetaken: '0', healstaken: '0',
			fflogsAmount: '9784320', fflogsAmountTaken: '975872', fflogsSingleTargetAmountTaken: '0', fflogsAmountGiven: '625616',
			// A stale RdpsOverlay still exporting its columns alongside: these must lose.
			rdpsTotal: '1', adpsTotal: '1', ndpsTotal: '1', cdpsTotal: '1', rdps: '1', adps: '1', ndps: '1', cdps: '1', rdpsDelta: '1', rawdps: '1',
			gcdUptime: '92.6', gcdCount: '198', gcdClip: '4.2', gcdRecast: '2.5',
		},
		'Legacy Only': {
			// No HEALDURATION: a row the parser never touched keeps ACT's single duration for both.
			name: 'Legacy Only', Job: 'BLM', DURATION: String(duration), damage: '9784320', hits: '400', swings: '400', misses: '0',
			crithits: '100', DirectHitCount: '80', CritDirectHitCount: '20', maxhit: 'Fire IV-70000', MAXHIT: '70000',
			healed: '512000', overHeal: '0', damageShield: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0',
			damagetaken: '0', healstaken: '0',
			rdpsTotal: '9434064', adpsTotal: '9784320', ndpsTotal: '8808448', cdpsTotal: '10405376', rawdps: '19105',
			gcdUptime: '88.1', gcdCount: '190', gcdClip: '9.9', gcdRecast: '2.37',
		},
	},
	isActive: 'true',
};

const parsed = new sandbox.Combatant({ detail: combatData }, 'encdps');
parsed.summonerMerge = true;
parsed.AttachPets();
parsed.resort('mergedDamage', 1);

const fflogs = parsed.Combatant['Fflogs Player'];
const legacy = parsed.Combatant['Legacy Only'];

console.log('=============== rDPS family derives from the FFLogs totals ===============');
check('rdps = (amount - taken + given) / DURATION', fflogs.rdps, rate(9784320 - 975872 + 625616));
check('adps = (amount - single) / DURATION', fflogs.adps, rate(9784320));
check('ndps = (amount - taken) / DURATION', fflogs.ndps, rate(9784320 - 975872));
check('cdps = (amount - single + given) / DURATION', fflogs.cdps, rate(9784320 + 625616));
check('rdpsDelta = rdps - own damage rate', fflogs.rdpsDelta, rate(625616 - 975872));
check('encdps for comparison', fflogs.encdps, rate(9784320));
check('the four FFLogs totals parse as numbers', fflogs.fflogsAmountGiven, 625616);

console.log('\n=============== rDPS% is a share of the raid total, not of a duration ===============');
check('rdpsPct = own rDPS / the raid rDPS total', fflogs.rdpsPct, Math.round(9434064 / (9434064 + 9784320) * 10000) / 100);
check('a row with no FFLogs totals has no rdpsPct', legacy.rdpsPct, undefined);
// The per-row totals without the encounter one - an older apply.js, or a message that predates
// it - must leave the column out rather than divide by nothing.
const noTotal = new sandbox.Combatant({
	detail: Object.assign({}, combatData, { Encounter: Object.assign({}, combatData.Encounter, { fflogsRdps: '0' }) }),
}, 'encdps');
noTotal.AttachPets();
check('no raid total: rdps still derived', noTotal.Combatant['Fflogs Player'].rdps, rate(9784320 - 975872 + 625616));
check('no raid total: no rdpsPct', noTotal.Combatant['Fflogs Player'].rdpsPct, undefined);

console.log('\n=============== damage and healing divide by different clocks ===============');
// FFLogs takes downtime off the damage clock only. Dividing healing by the same shortened clock
// would print an HPS the FFLogs report never shows.
check('dps divides by DURATION', fflogs.dps, rate(9784320));
check('hps divides by HEALDURATION', fflogs.hps, healRate(1024000));
check('enchps too', fflogs.enchps, healRate(1024000));
check('a row without HEALDURATION falls back to DURATION', legacy.hps, rate(512000));
// A message no parser ever touched: one duration, both rates on it, exactly as before.
const actOnly = new sandbox.Combatant({
	detail: {
		Encounter: { title: 'ACT only', duration: '08:32', DURATION: String(duration), damage: '1', healed: '512000' },
		Combatant: { Solo: { name: 'Solo', Job: 'WHM', DURATION: String(duration), damage: '0', healed: '512000', overHeal: '0', damageShield: '0', heals: '1', critheals: '0', maxheal: '', MAXHEAL: '0', deaths: '0', hits: '1', swings: '1', misses: '0', crithits: '0', DirectHitCount: '0', CritDirectHitCount: '0', maxhit: '', MAXHIT: '0', damagetaken: '0', healstaken: '0' } },
		isActive: 'true',
	},
}, 'encdps');
actOnly.AttachPets();
check('so does the encounter when the parser is not on', actOnly.Combatant.Solo.enchps, rate(512000));

console.log('\n=============== legacy RdpsOverlay export variables are ignored ===============');
check('rdpsTotal never copied onto the Person', fflogs.rdpsTotal, undefined);
check('rawdps never copied', fflogs.rawdps, undefined);
check('a legacy-only row has no rdps', legacy.rdps, undefined);
check('a legacy-only row has no adps', legacy.adps, undefined);
check('a legacy-only row has no rdpsDelta', legacy.rdpsDelta, undefined);
check('legacy rdps rate did not leak in either', legacy.rdpsTotal, undefined);
check('its plain columns are untouched', legacy.damage, 9784320);

console.log('\n=============== GCD columns pass straight through, undivided ===============');
check('gcdUptime shown as sent', fflogs.gcdUptime, 92.6);
check('gcdCount', fflogs.gcdCount, 198);
check('gcdClip', fflogs.gcdClip, 4.2);
check('gcdRecast', fflogs.gcdRecast, 2.5);
check('gcdUptime on the legacy row too', legacy.gcdUptime, 88.1);

console.log('\n=============== pet merge leaves the derived columns alone ===============');
parsed.summonerMerge = true;
parsed.AttachPets();
const merged = parsed.Combatant['Fflogs Player'];
check('rdps after AttachPets', merged.rdps, rate(9784320 - 975872 + 625616));
check('rdpsDelta stays negative', merged.rdpsDelta, rate(625616 - 975872));
check('gcdUptime after AttachPets', merged.gcdUptime, 92.6);

console.log('\n=============== an untagged message ===============');
check('no fflogs tag -> null', parsed.fflogs, null);

console.log('');
if (failures > 0) {
	console.log(`==> ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('==> all checks passed');

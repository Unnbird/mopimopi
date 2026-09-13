/**
 * Checks the action category snapshot (js/gcd/action-categories-data.js) through its reader
 * (js/gcd/categories.js): it loads, it is the full table, and known actions classify the way
 * FFXIV does. OverlayPluginAddon's tools/Test-ActionCategories.ps1, for the page.
 *
 * Usage:  node tests/test-gcd-categories.js
 */

'use strict';

const ActionCategories = require('../js/gcd/categories.js');
const data = require('../js/gcd/action-categories-data.js');

let failures = 0;
function check(label, actual, expected) {
	const ok = Object.is(actual, expected);
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(52)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

console.log('=============== snapshot absent ===============');
const absent = ActionCategories.load(undefined);
check('reports unavailable', absent.available, false);
check('explains why', typeof absent.loadError === 'string' && absent.loadError.length > 0, true);
check('no phantom actions', absent.count, 0);
check('knows nothing', absent.knows(0x3E75), false);
check('classifies nothing', absent.isGcd(0x3E75), false);

console.log('\n=============== snapshot present ===============');
const table = ActionCategories.load(data);
check('loads', table.available, true);
check('found the GCD list', table.count > 30000, true);
check('spells are a subset', table.spellCount > 0 && table.spellCount < table.count, true);
check('one character per id', table.table.length, data.entries + 1);
check('says where it came from', /FFXIV_ACT_Plugin/.test(table.source), true);
console.log(`     ${table.count} GCDs (${table.spellCount} spells), ${data.entries} actions, from ${table.source} on ${table.generatedAt}`);

console.log('\n=============== classification spot checks ===============');
// Ids taken from ActionCategoryList itself; category numbers as in categories.js.
const cases = [
	{ id: 0x3E75, name: 'Cascade (DNC weaponskill)', gcd: true, spell: false },
	{ id: 0x3E76, name: 'Fountain (DNC weaponskill)', gcd: true, spell: false },
	{ id: 0xDF9, name: 'Fire IV (BLM spell)', gcd: true, spell: true },
	{ id: 0x6503, name: 'Glare III (WHM spell)', gcd: true, spell: true },
	{ id: 0x8E, name: 'Blizzard (BLM spell)', gcd: true, spell: true },
	{ id: 0x3E87, name: 'Fan Dance (oGCD ability)', gcd: false, spell: false },
	{ id: 0xDE5, name: 'Battle Litany (oGCD ability)', gcd: false, spell: false },
	{ id: 0x8D2, name: 'Trick Attack (oGCD ability)', gcd: false, spell: false },
	{ id: 0x7, name: 'attack (auto-attack)', gcd: false, spell: false },
];
for (const c of cases) {
	check(c.name + ' isGcd', table.isGcd(c.id), c.gcd);
	check(c.name + ' isSpell', table.isSpell(c.id), c.spell);
}
check('auto-attack category', table.categoryOf(0x7), ActionCategories.CATEGORY_AUTO_ATTACK);
check('ability category', table.categoryOf(0x3E87), ActionCategories.CATEGORY_ABILITY);

console.log('\n=============== ids past the snapshot ===============');
check('not known', table.knows(data.entries + 1000), false);
check('category -1', table.categoryOf(data.entries + 1000), -1);
check('not a GCD by itself', table.isGcd(data.entries + 1000), false);
check('negative id', table.knows(-1), false);
check('non-integer id', table.knows(1.5), false);

console.log('');
if (failures > 0) {
	console.log(`==> ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('==> all checks passed');

/**
 * Two wiring checks that only a browser would otherwise catch:
 *
 *  1. The js/gcd scripts load in the order index.html lists them, as plain <script> tags (no
 *     module system), and leave a working window.GcdMeter behind - the UMD browser branch and the
 *     auto-instantiation at the bottom of meter.js.
 *  2. Every GCD column exists in all four places the settings page and the table dereference:
 *     Mopi2.ColData (init.js), the tooltip dictionary (dic.js, seven languages), both format lists
 *     in lang.js, and a format case in process.js. Missing one shows up as "undefined" in the
 *     settings list or a thrown error while rendering. And that no on/off switch crept back in:
 *     GCD uptime is always computed.
 *
 * Usage:  node tests/test-gcd-columns.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function check(label, actual, expected) {
	const ok = Object.is(actual, expected);
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(60)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------- 1. browser load order

console.log('=============== js/gcd scripts as index.html loads them ===============');
const html = read('index.html');
const scripts = [];
const tag = /<script[^>]*src="([^"]+)"[^>]*>/g;
let m;
while ((m = tag.exec(html)) !== null) scripts.push(m[1]);
const gcdScripts = scripts.filter((s) => s.startsWith('js/gcd/'));
check('eight js/gcd scripts', gcdScripts.length, 8);
check('data before logic', gcdScripts.indexOf('js/gcd/action-categories-data.js') < gcdScripts.indexOf('js/gcd/categories.js'), true);
check('action-data before tracker', gcdScripts.indexOf('js/gcd/action-data.js') < gcdScripts.indexOf('js/gcd/tracker.js'), true);
check('meter last', gcdScripts[gcdScripts.length - 1], 'js/gcd/meter.js');
check('all before core.js', scripts.indexOf('js/gcd/meter.js') < scripts.indexOf('js/core.js'), true);

// A page, minimally: window === self === globalThis, no module/require.
const page = { console };
page.window = page;
page.self = page;
page.globalThis = page;
vm.createContext(page);
for (const s of gcdScripts) vm.runInContext(read(s), page, { filename: s });

check('window.GcdMeterFactory defined', typeof page.GcdMeterFactory, 'object');
check('window.GcdMeter instantiated', typeof page.GcdMeter, 'object');
check('starts on the page globals', page.GcdMeter.init(), true);
check('category snapshot seen', page.GcdMeter.state.categories.count > 30000, true);
check('recast table seen', page.GcdMeter.state.actions.count > 100, true);

const T0 = Date.UTC(2026, 0, 1);
const ts = (s) => new Date(T0 + s * 1000).toISOString();
for (let i = 0; i < 6; i++) {
	page.GcdMeter.feed(['21', ts(2.5 * i), '10001234', 'Alice Dancer', '3E75', 'Cascade', '40001234', 'Boss', '710003', '1234'].join('|'));
}
const detail = { Encounter: { DURATION: '600' }, Combatant: { YOU: { name: 'YOU' } }, isActive: 'true' };
page.GcdMeter.overlay(detail, 'Alice Dancer');
check('overlay writes through the page instance', detail.Combatant.YOU.gcdCount, '6');
check('and tags the message', detail.gcd.applied, true);

// ---------------------------------------------------------------- 2. column wiring

console.log('\n=============== every GCD column in init / dic / lang / process ===============');
const ui = { console };
ui.window = ui;
vm.createContext(ui);
vm.runInContext(read('js/init.js'), ui, { filename: 'init.js' });
vm.runInContext(read('js/dic.js'), ui, { filename: 'dic.js' });
vm.runInContext(read('js/lang.js'), ui, { filename: 'lang.js' });
const processSource = read('js/process.js');

const LANGS = ['KR', 'JP', 'EN', 'FR', 'DE', 'CN', 'TW'];
const COLUMNS = ['gcdUptime', 'gcdCount', 'gcdClip', 'gcdRecast'];

/** Objects anywhere under `node` that carry `key` as an own property. */
function holders(node, key, out, seen) {
	out = out || [];
	seen = seen || new Set();
	if (!node || typeof node !== 'object' || seen.has(node)) return out;
	seen.add(node);
	if (Object.prototype.hasOwnProperty.call(node, key)) out.push(node);
	for (const k of Object.keys(node)) holders(node[k], key, out, seen);
	return out;
}

for (const col of COLUMNS) {
	check(`${col}: Mopi2.ColData entry`, typeof ui.Mopi2.ColData[col], 'object');
	check(`${col}: ColData has a header`, typeof ui.Mopi2.ColData[col].tt, 'string');
	check(`${col}: dic entry`, typeof ui.d[col], 'object');
	check(`${col}: dic tooltip in ${LANGS.length} languages`, LANGS.every((l) => typeof ui.d[col].m[l] === 'string' && ui.d[col].m[l].length > 0), true);
	check(`${col}: no stale "requires the plugin" note`, LANGS.some((l) => /OverlayPluginAddon/.test(ui.d[col].m[l])), false);
	const lists = holders(ui.l, col).filter((h) => h[col] === ui.d[col]);
	check(`${col}: in both lang format lists`, lists.length, 2);
	check(`${col}: process.js format case`, new RegExp(`case '${col}':`).test(processSource), true);
}

console.log('\n=============== no user switch: always on ===============');
check('no setting in the defaults', 'gcd' in ui.Mopi2.q, false);
check('no dictionary text for one', 'gcdEnable' in ui.d, false);
check('nothing in the settings tree toggles it', holders(ui.l, 'gcd').length, 0);

console.log('');
if (failures > 0) {
	console.log(`==> ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('==> all checks passed');

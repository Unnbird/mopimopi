/**
 * Regression test for js/gcd/tracker.js, the xivanalysis-style GCD uptime model.
 *
 * Drives the tracker with synthetic presses and checks the results against values worked out by
 * hand: clean rotations, skill/spell speed inference, flat-recast actions (dance steps, Ninjutsu),
 * haste windows, long casts and caster tax, real gaps, AoE de-duplication, instant vs hard casts,
 * Dualcast alternation, one-measurement-per-GCD, timestamp jitter, the 150ms lost-time slack, the
 * 100% ceiling and the too-few-casts default - OverlayPluginAddon's tools/Test-Gcd.ps1 carried
 * over scenario for scenario, plus the encounter cutoff this port adds.
 *
 * Run after any change to js/gcd/tracker.js, js/gcd/action-data.js or js/gcd/actions-data.js.
 *
 * Usage:  node tests/test-gcd-tracker.js
 */

'use strict';

const ActionData = require('../js/gcd/action-data.js');
const GcdTracker = require('../js/gcd/tracker.js');
const table = require('../js/gcd/actions-data.js');

let failures = 0;
const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n)).padStart(12);
function check(label, actual, expected, tol) {
	if (tol === undefined) tol = 0.5;
	const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(52)} actual=${fmt(actual)}  expected=${fmt(expected)}`);
}
function section(title) { console.log(`\n=============== ${title} ===============`); }

console.log('########## GCD tracker (xivanalysis model) ##########');
const actions = ActionData.load(table);
console.log(`actions-data.js: ${actions.actionCount} recast overrides, ${actions.speedStatusCount} haste statuses, loadError=${JSON.stringify(actions.loadError)}`);

// Real epoch milliseconds, as the meter hands them in; the tracker only ever looks at differences.
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const at = (seconds) => T0 + seconds * 1000;
const tracker = () => new GcdTracker(actions);

// Action ids straight out of js/gcd/actions-data.js.
const PLAIN = 9999901;   // absent from the table -> the 2500ms / skill-speed default
const EMBOITE = 15999;   // 1000ms flat, no speed attribute
const FUMA = 2265;       // 1500ms flat, no speed attribute (Ninjutsu)
const DRIP = 34688;      // 6000ms recast, 4000ms cast, spell speed (Rainbow Drip)

let g, st, now;

section('9. clean 2.50s rotation');
g = tracker();
for (let i = 0; i < 40; i++) g.record('Alice', PLAIN, at(2.5 * i), 1.0, false, false);
// First press to last press: 39 closed intervals occupying 39 recasts. The 40th is still turning.
st = g.statsFor('Alice');
check('count', st.count, 40, 0);
check('recast', st.recast, 2.50, 0.01);
check('speed stat = minimum', st.speedStat, 420, 0);
check('uptime %', st.uptime * 100, 100, 0.1);
check('clip', st.clip, 0, 0.01);

section('10. skill speed: a 2.40s rotation infers a higher stat');
g = tracker();
for (let i = 0; i < 40; i++) g.record('Bob', PLAIN, at(2.4 * i), 1.0, false, false);
st = g.statsFor('Bob');
check('recast', st.recast, 2.40, 0.02);
check('stat above min', st.speedStat > 420 ? 1 : 0, 1, 0);
check('uptime %', st.uptime * 100, 100, 0.5);

section('11. flat-recast GCDs: 1.0s dance steps inside a 2.5s rotation');
g = tracker();
now = 0;
for (let cycle = 0; cycle < 6; cycle++) {
	for (let i = 0; i < 8; i++) { g.record('Dancer', PLAIN, at(now), 1.0, false, false); now += 2.5; }
	for (let i = 0; i < 4; i++) { g.record('Dancer', EMBOITE, at(now), 1.0, false, false); now += 1.0; }
}
st = g.statsFor('Dancer');
check('count', st.count, 72, 0);
check('steps did not skew recast', st.recast, 2.50, 0.01);
check('no phantom clip', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.1);

section('12. flat-recast GCDs: 1.5s Ninjutsu inside a 2.5s rotation');
g = tracker();
now = 0;
for (let cycle = 0; cycle < 6; cycle++) {
	for (let i = 0; i < 8; i++) { g.record('Nin', PLAIN, at(now), 1.0, false, false); now += 2.5; }
	for (let i = 0; i < 3; i++) { g.record('Nin', FUMA, at(now), 1.0, false, false); now += 1.5; }
}
st = g.statsFor('Nin');
check('recast', st.recast, 2.50, 0.01);
check('no phantom clip', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.1);

section('12b. Ninja: 2.12s job-haste GCD with mudras and Ninjutsu in it');
// The 15% job haste is not modelled separately; the estimate absorbs it and lands within one 45ms
// batch of the 2.12s the Ninja's tooltip says (a synthetic cadence with zero jitter sits on a
// single batch and reads its midpoint, 2.14; real logs spread over neighbouring batches and
// average back). Mudras (0.5s flat) and Ninjutsu (1.5s flat) sit inside without voting on the
// estimate or leaving phantom gaps.
const TEN = 2259, CHI = 2261, RAITON = 2267;
g = tracker();
now = 0;
for (let cycle = 0; cycle < 6; cycle++) {
	for (let i = 0; i < 3; i++) { g.record('Nin2', PLAIN, at(now), 1.0, false, false); now += 2.12; }
	g.record('Nin2', TEN, at(now), 1.0, false, false); now += 0.5;
	g.record('Nin2', CHI, at(now), 1.0, false, false); now += 0.5;
	g.record('Nin2', RAITON, at(now), 1.0, false, false); now += 1.5;
}
g.record('Nin2', PLAIN, at(now), 1.0, false, false);
st = g.statsFor('Nin2');
check('count', st.count, 37, 0);
check('recast 2.12s, within one batch', st.recast, 2.12, 0.03);
check('no phantom clip', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.1);
check('only the plain weaponskills voted', st.skillSpeedSamples, 6 * 3, 0);

section('13. haste: a 0.80 modifier shortens the GCD, not the score');
g = tracker();
now = 0;
for (let i = 0; i < 20; i++) { g.record('Whm', PLAIN, at(now), 1.0, false, false); now += 2.5; }
for (let i = 0; i < 20; i++) { g.record('Whm', PLAIN, at(now), 0.8, false, false); now += 2.0; }
st = g.statsFor('Whm');
// Presence of Mind intervals normalise back to 2.5s, so the stat is unchanged by the burst.
check('haste did not skew recast', st.recast, 2.50, 0.01);
check('no phantom clip', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.5);

section('13b. Inspiration hastens aetherhue spells, not the hammers');
// "Reduces cast time and recast time of aetherhue spells and Star Prism by 25%." The hammer combo
// is what a Pictomancer presses inside Starry Muse, so a 0.75 applied to every GCD expected
// 1.875s, saw 2.5s, and booked 0.6s of lost time on each of them - a 74% uptime on a 92-GCD kill.
const INSPIRATION = 3689;
check('Fire in Red is hastened', actions.speedModifierOf(INSPIRATION, 34650), 0.75, 0.001);
check('Thunder II in Magenta too', actions.speedModifierOf(INSPIRATION, 34661), 0.75, 0.001);
check('Star Prism too', actions.speedModifierOf(INSPIRATION, 34681), 0.75, 0.001);
check('Hammer Stamp is not', actions.speedModifierOf(INSPIRATION, 34678), 1.0, 0.001);
check('Polishing Hammer is not', actions.speedModifierOf(INSPIRATION, 34680), 1.0, 0.001);
check('Comet in Black is not', actions.speedModifierOf(INSPIRATION, 34663), 1.0, 0.001);
check('Rainbow Drip is not', actions.speedModifierOf(INSPIRATION, 34688), 1.0, 0.001);
check('an unlimited haste still applies to anything', actions.speedModifierOf(157, 34678), 0.8, 0.001);
// What the tracker sees once the meter passes the per-action modifier: hammers at their real
// 2.5s under Inspiration are a clean rotation, not a run of 0.6s gaps.
g = tracker();
now = 0;
for (let i = 0; i < 12; i++) { g.record('Pct', 34678, at(now), 1.0, false, false); now += 2.5; }
st = g.statsFor('Pct');
check('hammers under Inspiration lose nothing', st.clip, 0, 0.01);
check('uptime stays 100%', st.uptime * 100, 100, 0.5);

section('14. long cast: recast and caster tax');
g = tracker();
now = 0;
for (let i = 0; i < 20; i++) { g.record('Pct', PLAIN, at(now), 1.0, false, false); now += 2.5; }
g.record('Pct', DRIP, at(now), 1.0, true, true); now += 6.0;
g.record('Pct', PLAIN, at(now), 1.0, false, false); now += 2.5;
st = g.statsFor('Pct');
// Rainbow Drip occupies its 6s recast, so following it 6s later is not a clip.
check('long recast is not clip', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.5);

section('15. a real gap is still caught');
g = tracker();
now = 0;
for (let i = 0; i < 20; i++) { g.record('Carl', PLAIN, at(now), 1.0, false, false); now += 2.5; }
now += 1.5;                                                        // 4.0s gap: 1.5s lost
for (let i = 0; i < 20; i++) { g.record('Carl', PLAIN, at(now), 1.0, false, false); now += 2.5; }
st = g.statsFor('Carl');
check('recast', st.recast, 2.50, 0.01);
check('clip = 1.5s', st.clip, 1.5, 0.05);
check('uptime < 100%', st.uptime < 1.0 ? 1 : 0, 1, 0);

section('16. AoE hitting 8 targets counts once');
g = tracker();
for (let i = 0; i < 10; i++) {
	const when = at(2.5 * i);
	for (let k = 0; k < 8; k++) g.record('Dave', PLAIN, when, 1.0, false, false);
}
st = g.statsFor('Dave');
check('count deduped', st.count, 10, 0);
check('recast', st.recast, 2.50, 0.01);

section('14b. cast equals recast: the tax is part of the GCD');
// A Black Mage spamming Blizzard I (2.5s cast on a 2.5s recast) at 2.35s spell speed: every cast
// runs 2.35s and the next press lands at 2.45s because caster tax follows a cast that gates the
// GCD. Deciding the tax by comparing the *adjusted* cast against a flat 2500 meant it was never
// paid once the player had any speed, so each cast occupied 2.35s of a 2.45s gap and a flawless
// rotation read 96%. Seen on a dummy: 32 casts, 0.8s lost, 93.7% uptime.
const BLIZZARD_I = 142;
g = tracker();
now = 0;
for (let i = 0; i < 20; i++) { g.record('Blm', BLIZZARD_I, at(now), 1.0, true, true, 2350.0); now += 2.45; }
st = g.statsFor('Blm');
check('recast estimated from the cast bar', st.recast, 2.35, 0.02);
check('tax counts toward occupancy: no lost', st.clip, 0, 0.01);
check('uptime 100%', st.uptime * 100, 100, 0.5);

// Inside Ley Lines the same spell is 0.85 of that, tax unchanged: 2.00s cast, 2.10s cadence.
for (let i = 0; i < 10; i++) { g.record('Blm', BLIZZARD_I, at(now), 0.85, true, true, 1998.0); now += 2.10; }
st = g.statsFor('Blm');
check('Ley Lines: estimate unchanged', st.recast, 2.35, 0.02);
check('Ley Lines: uptime stays 100%', st.uptime * 100, 100, 0.5);

// Blizzard III under Astral Fire III: the table says 3.5s, the bar ran 1.49s (halved, then 0.85).
// The recast gates instead, the press lands at 2.10s, and the cast must not vote on speed.
const BLIZZARD_III = 154;
g.record('Blm', BLIZZARD_III, at(now), 0.85, true, true, 1487.0); now += 2.10;
g.record('Blm', BLIZZARD_I, at(now), 0.85, true, true, 1998.0); now += 2.10;
st = g.statsFor('Blm');
check('halved cast does not skew the estimate', st.recast, 2.35, 0.02);
check('halved cast: no lost time', st.clip, 0, 0.01);
check('halved cast: uptime stays 100%', st.uptime * 100, 100, 0.5);

// Fire III cast in full (3.5s x 0.94 = 3.29s) is followed by tax; a 3.39s press is clean.
const FIRE_III = 152;
g.record('Blm', FIRE_III, at(now), 1.0, true, true, 3290.0); now += 3.39;
g.record('Blm', BLIZZARD_I, at(now), 1.0, true, true, 2350.0); now += 2.45;
st = g.statsFor('Blm');
check('full-length long cast pays tax, no lost', st.clip, 0, 0.01);
check('full-length long cast: uptime 100%', st.uptime * 100, 100, 0.5);

section('14c. a break stays a break, even under a stale table');
// What the dummy showed: Blizzard I's real cast is 2.0s (1.966s at this speed) while the table
// still says 2.5s, so the bar-over-table factor fell under 0.80, every interval was refused, and
// the estimate sat at the 2.50s default against a true 2.45s recast. Occupancy was then credited
// at 2.50 per cast for a 2.45 gap, and twenty casts of that surplus swallowed a five second pause -
// keep attacking after a break and the reading climbed back to 100%.
g = tracker();
now = 0;
for (let i = 0; i < 20; i++) { g.record('Blm2', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.45; }
st = g.statsFor('Blm2');
check('short cast: the recast gates, and votes', st.recast, 2.45, 0.02);
check('short cast: no tax, no lost', st.clip, 0, 0.01);
check('short cast: uptime 100%', st.uptime * 100, 100, 0.5);
now += 5.0;                                                        // a 7.45s gap: 5.0s lost
for (let i = 0; i < 20; i++) { g.record('Blm2', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.45; }
st = g.statsFor('Blm2');
let span = 40 * 2.45 + 5.0 - 2.45;
check('the pause is charged in full', st.clip, 5.0, 0.05);
check('and stays charged after 20 more casts', st.uptime * 100, (1 - 5.0 / span) * 100, 0.5);
check('uptime is 1 - lost/span, not occupancy', st.uptime * 100, 100 - st.clip / span * 100, 0.01);

// The same rotation before the estimate has converged (three casts): a 2.50 default against 2.45
// gaps must not print a surplus that a later break can be paid from.
g = tracker();
now = 0;
for (let i = 0; i < 3; i++) { g.record('Blm3', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.45; }
now += 3.0;
for (let i = 0; i < 30; i++) { g.record('Blm3', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.45; }
st = g.statsFor('Blm3');
check('early break survives thirty more casts', st.uptime < 0.97 ? 1 : 0, 1, 0);

// Slidecast slack only for a cast that gated the GCD. Blizzard I's bar ends long before its
// recast, so presses 0.27s and 0.50s late are idle - the dummy log showed both waved through.
g = tracker();
now = 0;
for (let i = 0; i < 10; i++) { g.record('Blm4', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.45; }
g.record('Blm4', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.72;
g.record('Blm4', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.95;
for (let i = 0; i < 10; i++) { g.record('Blm4', BLIZZARD_I, at(now), 1.0, true, true, 1966.0); now += 2.45; }
st = g.statsFor('Blm4');
check('late presses after a short cast are lost', st.clip, 0.27 + 0.50, 0.05);
// A full-length Fire III does gate the GCD, and a press 0.31s after it is inside the slidecast slack.
g.record('Blm4', FIRE_III, at(now), 1.0, true, true, 3290.0); now += 3.70;
g.record('Blm4', BLIZZARD_I, at(now), 1.0, true, true, 1966.0);
st = g.statsFor('Blm4');
check('gating cast keeps its slidecast slack', st.clip, 0.27 + 0.50, 0.05);

section('16b. instant casts do not pay their base cast time');
// Red Mage: Verthunder's data says a 5s cast, but Dualcast fires it instantly. Treating the base
// cast time as real normalised a genuine 2.5s interval to (2500-100)/2 = 1200ms, so the estimator
// settled near 1.0s and uptime read about 40% of the truth.
const VERTHUNDER = 7505;   // recast 2500, castTime 5000, SPELL_SPEED
g = tracker();
for (let i = 0; i < 30; i++) g.record('Rdm', VERTHUNDER, at(2.5 * i), 1.0, false, true);
st = g.statsFor('Rdm');
check('instant: recast stays 2.50s', st.recast, 2.50, 0.02);
check('instant: uptime 100%', st.uptime * 100, 100, 0.5);

// The same spell actually cast: 5s cast plus caster tax gates the next press, so a 5.1s cadence
// is the clean rotation rather than four seconds of clip.
g = tracker();
for (let i = 0; i < 30; i++) g.record('Rdm2', VERTHUNDER, at(5.1 * i), 1.0, true, true);
st = g.statsFor('Rdm2');
check('hard cast: recast stays 2.50s', st.recast, 2.50, 0.05);
check('hard cast: no phantom clip', st.clip, 0, 0.5);

section('16c. Dualcast: alternating instant and hard cast');
// The pattern a Red Mage actually produces, and what a real log showed: 20 cast bars against 39
// effects. Timed off when the damage lands, this rotation collapses - an instant that follows a
// 2.5s cast lands at the same instant the cast does, reading as a zero-length GCD, while the cast
// before it reads as double length. Timed off when the button went down, it is a flat 2.5s.
//
// Presses are every 2.5s. Odd ones are hard casts whose effect lands 2.5s later. Jolt is the hard
// cast that grants Dualcast, and at 2s its cast is shorter than the GCD, so the recast governs
// and no caster tax applies.
const JOLT = 9999902;   // not in the table: plain 2500ms default, category says spell
g = tracker();
for (let i = 0; i < 30; i++) {
	const press = at(2.5 * i);
	if (i % 2 === 0) g.record('Rdm3', JOLT, press, 1.0, true, true);          // Jolt, hard cast: the cast-bar start
	else g.record('Rdm3', VERTHUNDER, press, 1.0, false, true);              // Verthunder under Dualcast: instant
}
st = g.statsFor('Rdm3');
check('alternating: recast 2.50s', st.recast, 2.50, 0.05);
check('alternating: no phantom clip', st.clip, 0, 0.5);
check('alternating: uptime 100%', st.uptime * 100, 100, 0.5);

section('16d. Dualcast: a hard cast starting must not spike uptime');
// Casts are recorded when the button goes down; Jolt's damage landed 1.47s after its cast bar
// started on a real dummy log. Measured from press to press, both halves move at the same
// moments: the reading after a hard cast starts is the same 100% as the reading after the
// instant before it.
const JOLT3 = 0x908C;   // 2.0s cast, 2.5s recast; not in the table, category says spell
const VT3 = 0x64FF;     // Verthunder III: in the table, 5.0s cast, only ever fired via Dualcast
g = tracker();
for (let i = 0; i < 20; i++) {
	const press = at(2.5 * i);
	if (i % 2 === 0) g.record('Dual', JOLT3, press, 1.0, true, true);
	else g.record('Dual', VT3, press, 1.0, false, true);
	if (i >= 2) {
		st = g.statsFor('Dual');
		check(`100% after press ${i} (${i % 2 === 0 ? 'hard cast starts' : 'instant lands'})`, st.uptime * 100, 100, 0.1);
	}
}
check('no phantom clip', st.clip, 0, 0.01);

section('16d2. the number moves only when a GCD is pressed');
// Between presses nothing is re-read: the recast still turning and the gap that is not yet a clip
// stay out of both halves until the press that closes them. Then the idle is charged in full by
// that press.
g = tracker();
for (let i = 0; i < 20; i++) g.record('Live', PLAIN, at(2.5 * i), 1.0, false, false);
const lastPress = 19 * 2.5;
st = g.statsFor('Live');
check('uptime 100% after the press', st.uptime * 100, 100, 0.1);
check('clip 0 after the press', st.clip, 0, 0.01);
check('in-flight cast is not occupied', st.occupiedSeconds, 19 * 2.5, 0.01);
g.record('Live', PLAIN, at(lastPress + 30.0), 1.0, false, false);
span = lastPress + 30.0;
st = g.statsFor('Live');
check('the next press charges the idle', st.clip, 27.5, 0.1);
check('and drops uptime with it', st.uptime * 100, 20 * 2.5 / span * 100, 0.5);
check('occupied + clip = span', st.occupiedSeconds + st.clip, span, 0.01);

section('16e. jitter: a press 40ms early still cost a whole GCD');
// Log timestamps are batched (~45ms), so a clean 2.5s rotation shows gaps of 2.46 to 2.54. The
// xivanalysis model charges each cast its full recast regardless of the gap; the earlier
// min(recast, gap) version quietly shaved every early-looking press and could never read 100%.
g = tracker();
now = 0;
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (let i = 0; i < 40; i++) {
	g.record('Jit', PLAIN, at(now), 1.0, false, false);
	now += 2.5 + (rnd() - 0.5) * 0.08;   // +/- 40ms
}
st = g.statsFor('Jit');
check('jitter: recast still 2.50s', st.recast, 2.50, 0.02);
check('jitter: no lost time', st.clip, 0, 0.01);
check('jitter: uptime reads full', st.uptime * 100, 100, 1.0);

section('16f. lost time has 150ms of slack (GCD_ERROR_OFFSET)');
g = tracker();
now = 0;
for (let i = 0; i < 20; i++) { g.record('Slack', PLAIN, at(now), 1.0, false, false); now += 2.5; }
now += 0.12;                                                       // 2.62s gap: inside the slack
for (let i = 0; i < 20; i++) { g.record('Slack', PLAIN, at(now), 1.0, false, false); now += 2.5; }
now += 0.30;                                                       // 2.80s gap: 300ms past recast, over the slack
for (let i = 0; i < 20; i++) { g.record('Slack', PLAIN, at(now), 1.0, false, false); now += 2.5; }
st = g.statsFor('Slack');
check('120ms over is not lost', st.clip, 0.30, 0.02);   // only the 300ms gap counts, in full

section('17a. uptime can never exceed 100%');
// The bug this guards: counting the final cast's full recast against a window that stops at that
// cast produced n/(n-1), which is 114% over eight GCDs. The cast in flight is in neither half.
g = tracker();
for (let i = 0; i < 8; i++) g.record('Short', PLAIN, at(2.5 * i), 1.0, false, false);
st = g.statsFor('Short');
check('8-GCD pull is exactly 100%', st.uptime * 100, 100, 0.1);
check('occupied + clip = span', st.occupiedSeconds + st.clip, 7 * 2.5, 0.01);

section('17. too few casts falls back to the 2.5s default');
g = tracker();
g.record('Eve', PLAIN, at(0), 1.0, false, false);
g.record('Eve', PLAIN, at(2.1), 1.0, false, false);
st = g.statsFor('Eve');
check('recast defaults', st.recast, 2.50, 0.01);
check('flagged as default', st.recastEstimated ? 1 : 0, 0, 0);
st = g.statsFor('Nobody');
check('unknown player: zero casts', st.count, 0, 0);
check('unknown player: default recast', st.recast, 2.50, 0);
check('unknown player: zero uptime', st.uptime, 0, 0);

section('18. removeLast rewinds to the press before the interrupted cast');
g = tracker();
for (let i = 0; i < 10; i++) g.record('Cancel', PLAIN, at(2.5 * i), 1.0, false, false);
g.record('Cancel', BLIZZARD_I, at(25.0), 1.0, true, true, 2500.0);   // bar starts...
check('provisionally counted', g.statsFor('Cancel').count, 11, 0);
check('removed', g.removeLast('Cancel', BLIZZARD_I) ? 1 : 0, 1, 0);
check('count back', g.statsFor('Cancel').count, 10, 0);
check('wrong action id is refused', g.removeLast('Cancel', FIRE_III) ? 1 : 0, 0, 0);
// ...and the interval that spans the wasted bar is charged to the press that ends it.
g.record('Cancel', PLAIN, at(29.0), 1.0, false, false);
st = g.statsFor('Cancel');
check('wasted cast is lost time', st.clip, 29.0 - 22.5 - 2.5, 0.01);

section('19. dropBefore: a new encounter forgets the presses before it');
g = tracker();
for (let i = 0; i < 10; i++) g.record('Reset', PLAIN, at(2.5 * i), 1.0, false, false);   // 0 .. 22.5
g.record('Gone', PLAIN, at(1.0), 1.0, false, false);
g.dropBefore(at(10.0));
st = g.statsFor('Reset');
check('casts before the cutoff are gone', st.count, 6, 0);              // 10, 12.5, ..., 22.5
check('window restarts at the cutoff', st.occupiedSeconds, 5 * 2.5, 0.01);
check('uptime unchanged', st.uptime * 100, 100, 0.1);
check('a player with nothing left is dropped', g.players.indexOf('Gone') < 0 ? 1 : 0, 1, 0);
check('the other player stays', g.players.indexOf('Reset') >= 0 ? 1 : 0, 1, 0);
// A break straddling the cutoff is not charged: the presses that opened it are gone.
g = tracker();
for (let i = 0; i < 10; i++) g.record('Straddle', PLAIN, at(2.5 * i), 1.0, false, false);   // .. 22.5
for (let i = 0; i < 10; i++) g.record('Straddle', PLAIN, at(40 + 2.5 * i), 1.0, false, false);
check('before: the gap is lost time', g.statsFor('Straddle').clip, 40 - 22.5 - 2.5, 0.01);
g.dropBefore(at(30.0));
check('after: only the new encounter counts', g.statsFor('Straddle').clip, 0, 0.01);
check('after: count', g.statsFor('Straddle').count, 10, 0);

console.log('');
if (failures > 0) {
	console.log(`==> ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('==> all checks passed');

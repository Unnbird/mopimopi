/**
 * Checks js/fflogs/meter.js downtimeWindows() against every shape the FFLogs parser's zone
 * handlers actually keep their downtime in (js/fflogs/parser-ff.js, one hand-written handler per
 * instance). The windows feed js/gcd/tracker.js, which takes them out of both halves of the GCD
 * uptime measurement; fight.downtime, which apply.js takes off the DPS clock, is the same downtime
 * counted by the handler's own totalDowntimeForFightRange. A shape downtimeWindows() cannot read
 * is not a missing feature but a contradiction: the GCD column and the DPS columns then disagree
 * about the same pull - the untargetable minute reads as a minute of clipping, or, when a window
 * is read as never closing, every real clip after it disappears.
 *
 * So each case is checked twice: the windows themselves, and their total against a reimplementation
 * of the parser's downtimeForRange, which is what the DPS clock is built from.
 *
 * Usage:  node tests/test-fflogs-downtime.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(58)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function section(title) { console.log(`\n=============== ${title} ===============`); }

// ---------------------------------------------------------------- the page around meter.js

// meter.js is a browser IIFE that hangs its API off window and talks to the parser through
// window.LogParser. A fake one is all it takes to drive downtimeWindows(): nothing here parses a
// log, the handler object is handed in directly, exactly as the real parser exposes it.
const meterSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'fflogs', 'meter.js'), 'utf8');
const window = {
	RdpsFflogsHost: { pickFight: () => null },
	FflogsApply: { applyFflogs: (d) => d },
};

let handler = null;
window.LogParser = function FakeLogParser() {
	return {
		setLogStartDate() {},
		setLiveLoggingStartTime() {},
		prepareToParseLines() {},
		parseLine() {},
		collectMeters: () => ({ fights: [] }),
		logParserOutput: { meterFight: { get zoneHandler() { return handler; } } },
	};
};

new Function('window', meterSource)(window);
const meter = window.FflogsMeter;

// ---------------------------------------------------------------- the fight's clock

const FIGHT_START = Date.parse('2026-01-01T00:00:00.000+00:00');
const LAST_LINE = Date.parse('2026-01-01T00:10:00.000+00:00');   // the fight is 600s in, still going
const at = (seconds) => FIGHT_START + seconds * 1000;

/**
 * parser-ff.js's downtimeForRange, which every handler's totalDowntimeForFightRange is built from:
 * a start of 0 means the window never opened, an end of 0 means it has not closed and runs to the
 * end of the range. This is the downtime apply.js takes off the DPS clock, and what the windows
 * have to add up to.
 */
function parserDowntime(fightStart, fightEnd, start, end) {
	if (start === 0) return 0;
	return Math.max(0, Math.min(end === 0 ? fightEnd : end, fightEnd) - Math.max(start, fightStart));
}

/** The windows' total, clipped to the fight, in seconds. */
function windowSeconds(windows) {
	let total = 0;
	for (const w of windows) total += Math.max(0, Math.min(w.end, LAST_LINE) - Math.max(w.start, FIGHT_START));
	return total / 1000;
}

/** One shape, driven through the real downtimeWindows(). */
function windowsFor(zoneHandler) {
	handler = zoneHandler;
	return meter.downtimeWindows().map((w) => ({ start: (w.start - FIGHT_START) / 1000, end: (w.end - FIGHT_START) / 1000 }));
}

// ---------------------------------------------------------------- the clock the windows run on

// An open window runs to the latest line parsed, so meter.js has to have seen one. feed() queues
// and the drain timer reads the timestamp off the front of the line, as it does live.
async function warmUp() {
	meter.init(1);
	meter.feed(`00|2026-01-01T00:10:00.0000000+00:00|0|Fake|`);
	await new Promise((resolve) => setTimeout(resolve, 250));
}

async function main() {
	await warmUp();
	check('the page has a log clock', Number.isFinite(meter.state.lastLineMs), true);

	// ------------------------------------------------------------ shape A: a downtime tracker
	section('A: downtimeTracker (M8S, Necron, most of 7.2/7.3)');
	// The tracker keeps closed intervals in a list and the one still running on its own.
	check('committed intervals', windowsFor({
		downtimeTracker: { committedIntervals: [{ start: at(60), end: at(120) }], pendingInterval: null },
	}), [{ start: 60, end: 120 }]);
	check('plus the open one, to the latest line', windowsFor({
		downtimeTracker: {
			committedIntervals: [{ start: at(60), end: at(120) }],
			pendingInterval: { start: at(500), end: at(500) },
		},
	}), [{ start: 60, end: 120 }, { start: 500, end: 600 }]);

	// ------------------------------------------------------------ shape B: a list and a start
	section('B: downtimePeriods + downtimeStart (FRU)');
	// FRU pushes each window into the list as it closes and zeroes downtimeStart, so the pair only
	// ever describes the window still open. It has no downtimeEnd field at all.
	check('closed windows only', windowsFor({
		downtimePeriods: [{ start: at(60), end: at(120) }, { start: at(300), end: at(330) }],
		downtimeStart: 0,
	}), [{ start: 60, end: 120 }, { start: 300, end: 330 }]);
	check('a window still open runs to the latest line', windowsFor({
		downtimePeriods: [{ start: at(60), end: at(120) }],
		downtimeStart: at(500),
	}), [{ start: 60, end: 120 }, { start: 500, end: 600 }]);

	// ------------------------------------------------------------ shape C: one start/end pair
	section('C: downtimeStart + downtimeEnd (P12S, M4S, Queen Eternal)');
	// The regression this shape is here for: downtimeEnd used to be ignored, so the window never
	// closed and swallowed every gap - and therefore every real clip - to the end of the pull.
	check('a closed window ends where it ended', windowsFor({ downtimeStart: at(60), downtimeEnd: at(120) }),
		[{ start: 60, end: 120 }]);
	check('and not at the latest line', windowSeconds(meter.downtimeWindows()), 60);
	check('still open: to the latest line', windowsFor({ downtimeStart: at(500), downtimeEnd: 0 }),
		[{ start: 500, end: 600 }]);
	check('never opened: nothing', windowsFor({ downtimeStart: 0, downtimeEnd: 0 }), []);
	check('agrees with the DPS clock', windowSeconds(windowsFor({ downtimeStart: at(60), downtimeEnd: at(120) }).map(
		(w) => ({ start: at(w.start), end: at(w.end) }))),
		parserDowntime(FIGHT_START, LAST_LINE, at(60), at(120)) / 1000);

	// ------------------------------------------------------------ shape D: two named pairs
	section('D: first/secondDowntime (M5S Brute Abombinator)');
	check('both closed', windowsFor({
		firstDowntimeStart: at(60), firstDowntimeEnd: at(120),
		secondDowntimeStart: at(300), secondDowntimeEnd: at(340),
	}), [{ start: 60, end: 120 }, { start: 300, end: 340 }]);
	check('the second still open', windowsFor({
		firstDowntimeStart: at(60), firstDowntimeEnd: at(120),
		secondDowntimeStart: at(500), secondDowntimeEnd: 0,
	}), [{ start: 60, end: 120 }, { start: 500, end: 600 }]);
	check('only the first has happened', windowsFor({
		firstDowntimeStart: at(60), firstDowntimeEnd: at(120),
		secondDowntimeStart: 0, secondDowntimeEnd: 0,
	}), [{ start: 60, end: 120 }]);

	// ------------------------------------------------------------ shape E: one pair per transition
	section('E: p*Downtime fields (the Omega Protocol)');
	// TOP names every transition separately; totalDowntimeForFightRange adds all seven up.
	const top = {
		p2DowntimeStart: at(60), p2DowntimeEnd: at(100),
		p3TransitionStart: at(150), p3TransitionEnd: at(180),
		p4BlueScreenCast: at(220), p5OmegaMTargetable: at(260),
		p5DeltaDynamisStart: at(300), p5DeltaDynamisEnd: at(320),
		p5SigmaDynamisStart: at(360), p5SigmaDynamisEnd: at(380),
		p5OmegaDynamisStart: at(420), p5OmegaDynamisEnd: at(440),
		blindFaithCast: at(500), targetableAfterBlindFaith: at(520),
	};
	check('every transition', windowsFor(top), [
		{ start: 60, end: 100 }, { start: 150, end: 180 }, { start: 220, end: 260 },
		{ start: 300, end: 320 }, { start: 360, end: 380 }, { start: 420, end: 440 },
		{ start: 500, end: 520 },
	]);
	const topPairs = [
		[top.p2DowntimeStart, top.p2DowntimeEnd],
		[top.p3TransitionStart, top.p3TransitionEnd],
		[top.p4BlueScreenCast, top.p5OmegaMTargetable],
		[top.p5DeltaDynamisStart, top.p5DeltaDynamisEnd],
		[top.p5SigmaDynamisStart, top.p5SigmaDynamisEnd],
		[top.p5OmegaDynamisStart, top.p5OmegaDynamisEnd],
		[top.blindFaithCast, top.targetableAfterBlindFaith],
	];
	let parserTotal = 0;
	for (const [s, e] of topPairs) parserTotal += parserDowntime(FIGHT_START, LAST_LINE, s, e);
	check('the total agrees with the DPS clock', windowSeconds(meter.downtimeWindows()), parserTotal / 1000);
	check('the fight before its first transition', windowsFor({ p2DowntimeStart: 0, p2DowntimeEnd: 0 }), []);

	// ------------------------------------------------------------ nothing to read
	section('a handler with no downtime, and no handler at all');
	check('a handler that books none', windowsFor({ somethingElse: 1 }), []);
	check('no handler', windowsFor(null), []);
	// A handler that throws on access must not take the page down with it: the GCD columns go back
	// to charging every gap and the reason is kept for the debug dump.
	check('a handler that throws', windowsFor({ get downtimeTracker() { throw new Error('boom'); } }), []);
	check('and the error is kept', meter.state.lastError, 'downtimeWindows: boom');

	for (const t of meter.state.timers) clearInterval(t);
	console.log(failures === 0 ? '\n==> all checks passed' : `\n==> ${failures} check(s) FAILED`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main();

#!/usr/bin/env node
/**
 * Replays an ACT network log through mopimopi's real intake - js/fflogs/meter.js and
 * js/gcd/meter.js, loaded the way index.html loads them - while simulating the CombatData
 * messages ACT would have sent, one per second of log time. ACT's encounter boundaries are read
 * off the log's own 260 (InCombat) lines; each combatant row carries a sentinel damage string so
 * the report shows whether the FFLogs overlay replaced it and with what.
 *
 * This is how "the table went to zero in the second half of M8S" was reproduced: ACT splits that
 * pull at the phase transition, the parser does not, and the two clocks never agreed again.
 *
 *   node tools/Replay-Overlay.js <Network_*.log> [from] [to] [--every N] [--around HH:MM:SS]
 *
 *   from / to    ISO prefixes in the log's own zone, e.g. 2026-09-13T13:39 2026-09-13T13:58:30
 *                (default: the whole file - slow for a full day; slice first)
 *   --every N    print one line every N seconds of log time (default 30)
 *   --around T   also print every 5 s for two minutes around log time T (HH:MM:SS, log zone)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const LOG = positional[0];
if (!LOG) {
  console.error('usage: node tools/Replay-Overlay.js <Network_*.log> [from] [to] [--every N] [--around HH:MM:SS]');
  process.exit(2);
}
const FROM = positional[1] || '';
const TO = positional[2] || '9999';
const EVERY = Number(opt('--every', '30'));
const AROUND = opt('--around', null);
const repo = path.join(__dirname, '..');

// ---------------------------------------------------------------- log
const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter((l) => {
  const bar = l.indexOf('|');
  if (bar < 1) return false;
  const ts = l.substring(bar + 1, bar + 1 + 19);
  return ts >= FROM && ts < TO;
});
if (lines.length === 0) { console.error('no lines in range'); process.exit(1); }
console.log(`${lines.length} lines in [${FROM || 'start'}, ${TO === '9999' ? 'end' : TO})`);
const tsOf = (l) => l.split('|')[1];
const msOf = (l) => new Date(tsOf(l)).getTime();
const zone = (() => { const m = /([+-]\d{2}:\d{2}|Z)$/.exec(tsOf(lines[0])); return m ? m[1] : 'Z'; })();
const localClock = (ms) => {
  // HH:MM:SS in the log's own zone, for reading against the game.
  const off = zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  return new Date(ms + off * 60000).toISOString().substring(11, 19);
};

// The page's clock runs at log time: FflogsMeter.init hands the parser Date.now() as the live
// logging start, and the parser ignores lines older than that.
let simNow = msOf(lines[0]);
class SimDate extends Date {
  constructor(...a) { if (a.length === 0) super(simNow); else super(...a); }
  static now() { return simNow; }
}

// ---------------------------------------------------------------- page sandbox
const timers = [];
const page = {
  console, Math, JSON, Number, String, Object, Array, Map, Set, RegExp, Error, parseInt, parseFloat, isNaN, isFinite,
  Date: SimDate,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  document: { attachEvent() {}, detachEvent() {}, addEventListener() {}, dispatchEvent() {} },
  performance: require('perf_hooks').performance,
  navigator: { userAgent: 'node' },
  location: { search: '' },
};
page.window = page;
page.self = page;
page.globalThis = page;
vm.createContext(page);

// The same scripts, in the same order, as index.html.
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const scripts = [];
const tag = /<script[^>]*src="([^"]+)"[^>]*>/g;
let m;
while ((m = tag.exec(html)) !== null) if (m[1].startsWith('js/fflogs/') || m[1].startsWith('js/gcd/')) scripts.push(m[1]);
for (const s of scripts) vm.runInContext(fs.readFileSync(path.join(repo, s), 'utf8'), page, { filename: s });

const F = page.FflogsMeter;
const G = page.GcdMeter;
if (!F || !F.init(1)) throw new Error('FflogsMeter failed: ' + (F ? F.state.reason : 'not loaded'));
if (!G || !G.init()) throw new Error('GcdMeter failed: ' + (G ? G.state.reason : 'not loaded'));
const drain = timers.find((t) => t.ms === 100).fn;   // the parser's 100 ms batch

// ---------------------------------------------------------------- ACT, as far as the log tells
// 260|timestamp|inACTCombat|inGameCombat|isACTChanged|isGameChanged
const encounters = [];
let open = null;
for (const l of lines) {
  const f = l.split('|');
  if (f[0] !== '260') continue;
  const inAct = f[2] === '1';
  const t = new Date(f[1]).getTime();
  if (inAct && !open) open = { start: t, end: null };
  else if (!inAct && open) { open.end = t; encounters.push(open); open = null; }
}
if (open) { open.end = msOf(lines[lines.length - 1]); encounters.push(open); }
console.log('ACT encounters, from the 260 lines:');
for (const e of encounters) console.log(`   ${localClock(e.start)} -> ${localClock(e.end)}  ${((e.end - e.start) / 1000).toFixed(0)}s`);

let local = '';
for (const l of lines) { const f = l.split('|'); if (f[0] === '02') { local = f[3]; break; } }
console.log('local player (02 line):', local || '(none in range)');

const players = new Map();
const encounterAt = (t) => encounters.find((e) => t >= e.start && t <= e.end) || null;

// ---------------------------------------------------------------- run
let cursor = 0;
let lastEnc = null;
let hitsSince = new Map();
const report = [];
const first = msOf(lines[0]);
const last = msOf(lines[lines.length - 1]);
for (let now = first; now <= last; now += 1000) {
  simNow = now;
  while (cursor < lines.length && msOf(lines[cursor]) <= now) {
    const l = lines[cursor++];
    G.feed(l);
    F.feed(l);
    const f = l.split('|');
    if ((f[0] === '21' || f[0] === '22') && f[2] && f[2][0] === '1' && f[3]) {
      if (!players.has(f[3])) players.set(f[3], { job: '' });
      hitsSince.set(f[3], (hitsSince.get(f[3]) || 0) + 1);
    }
    if (f[0] === '03' && f[2] && f[2][0] === '1' && f[3]) {
      if (!players.has(f[3])) players.set(f[3], { job: f[4] }); else players.get(f[3]).job = f[4];
    }
  }
  drain();

  const enc = encounterAt(now);
  if (enc && enc !== lastEnc) { hitsSince = new Map(); lastEnc = enc; }
  const active = !!enc;
  // ACT keeps reporting the ended encounter, DURATION frozen, until the next one begins.
  const duration = lastEnc ? Math.floor(((enc ? now : lastEnc.end) - lastEnc.start) / 1000) : 0;

  const detail = {
    Encounter: { title: 'replay', duration: '00:00', DURATION: String(duration), damage: '1', ENCDPS: '1', healed: '0', ENCHPS: '0' },
    Combatant: {},
    isActive: active ? 'true' : 'false',
  };
  for (const [name, p] of players) {
    const key = name === local ? 'YOU' : name;
    // "ACT<n>" is the sentinel: n is this player's hit count in ACT's encounter, so a row the
    // FFLogs overlay left alone still reads as ACT's and still moves.
    detail.Combatant[key] = {
      name: key, Job: p.job, DURATION: String(duration), damage: 'ACT' + (hitsSince.get(name) || 0), healed: '0',
      hits: '1', swings: '1', misses: '0', crithits: '0', DirectHitCount: '0', CritDirectHitCount: '0', maxhit: '', MAXHIT: '0',
      deaths: '0', damagetaken: '0', healstaken: '0', overHeal: '0', damageShield: '0', heals: '0', critheals: '0', maxheal: '', MAXHEAL: '0',
    };
  }

  // Same order as core.js.
  let out = G.overlay(detail, local);
  out = F.overlay(out, local);
  const you = out.Combatant.YOU || {};
  const snap = F.snapshot();
  report.push({
    ms: now,
    t: localClock(now),
    act: active ? duration : '-',
    fflogs: out.fflogs ? (out.fflogs.applied ? 'APPLIED' : out.fflogs.reason) : 'none',
    fight: snap ? `#${snap.fightId} ${snap.durationSeconds.toFixed(0)}s ${snap.fightState}` : '-',
    youDamage: you.damage, rowDuration: you.DURATION, encDamage: out.Encounter.damage, encDuration: out.Encounter.DURATION,
    gcd: `${you.gcdUptime}% n=${you.gcdCount} lost=${you.gcdClip} r=${you.gcdRecast}`,
    gcdEncounters: G.state.encounters,
  });
}

// ---------------------------------------------------------------- print
const show = (r) => console.log(
  `${r.t}  act=${String(r.act).padStart(4)}  ${r.fflogs.padEnd(36)} ${r.fight.padEnd(22)} YOU dmg=${String(r.youDamage).padEnd(10)} rowDUR=${String(r.rowDuration).padEnd(5)} enc=${String(r.encDamage).padEnd(11)}/${String(r.encDuration).padEnd(4)}s gcd=${r.gcd} encs=${r.gcdEncounters}`
);
console.log(`\n--- every ${EVERY} s ---`);
for (let i = 0; i < report.length; i += EVERY) show(report[i]);
if (AROUND) {
  console.log(`\n--- around ${AROUND}, every 5 s ---`);
  const centre = report.findIndex((r) => r.t >= AROUND);
  if (centre >= 0) for (let i = Math.max(0, centre - 60); i < Math.min(report.length, centre + 60); i += 5) show(report[i]);
}

console.log('\n--- tally ---');
const byReason = {};
for (const r of report) byReason[r.fflogs] = (byReason[r.fflogs] || 0) + 1;
console.log(byReason);
console.log('FflogsMeter.state:', JSON.stringify({ lines: F.state.lines, errors: F.state.errors, collectErrors: F.state.collectErrors, lastError: F.state.lastError, parserWarning: F.state.parserWarning, parserError: F.state.parserError, act: F.state.act }));
console.log('GcdMeter.state:', JSON.stringify({ lines: G.state.lines, gcds: G.state.gcdsRecorded, hardCasts: G.state.hardCastsRecorded, encounters: G.state.encounters, unknown: G.state.unknownActions, lastError: G.state.lastError }));

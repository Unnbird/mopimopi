/**
 * Runs FFLogs' own log parser (js/fflogs/parser-ff.js) inside mopimopi.
 *
 * OverlayPlugin already hands this page every network log line: in ACTWebSocket compatibility
 * mode each LogLine arrives as a broadcast with msgtype "Chat" and the raw line as msg
 * (MiniParseOverlay.HandleEvent), and core.js routes those here through feed(). The parser's
 * live meters then work out each player's amount / amountTaken / singleTargetAmountTaken /
 * amountGiven, hit details, healing and deaths, and overlay() writes them over the CombatData
 * message before mopimopi parses it (see apply.js).
 *
 * Never calls OverlayPluginApi.callHandler / callOverlayHandler: that flips the overlay to the
 * modern API and unsubscribes the CombatData feed this page lives on.
 *
 * Nothing here talks to fflogs.com.
 */
(function () {
  'use strict';

  // parser-ff.js reports through these globals; the Archon host forwards them over postMessage.
  if (typeof window.sendLogMessage !== 'function') window.sendLogMessage = function () {};
  if (typeof window.setWarningText !== 'function') window.setWarningText = function (t) { state.parserWarning = String(t || ''); };
  if (typeof window.setErrorText !== 'function') window.setErrorText = function (t) { state.parserError = String(t || ''); };
  if (typeof window.sendEventMessage !== 'function') window.sendEventMessage = function () {};

  const PARSE_INTERVAL_MS = 100;
  const COLLECT_INTERVAL_MS = 500;
  const FRESH_MS = 10000;

  const state = {
    available: false,
    reason: 'not started',
    region: 1,
    parserVersion: typeof window.FFLOGS_PARSER_VERSION !== 'undefined' ? String(window.FFLOGS_PARSER_VERSION) : '3075',
    logVersion: 0,
    queue: [],
    position: 0,
    lastFight: null,
    lastCollectAt: 0,
    lines: 0,
    errors: 0,
    collectErrors: 0,
    lastError: '',
    parserWarning: '',
    parserError: '',
    timers: [],
  };

  let parser = null;

  const message = (e) => String((e && e.message) || e || 'unknown error');
  const host = () => window.RdpsFflogsHost;
  const apply = () => window.FflogsApply;

  function enabled() {
    try {
      return !(typeof init !== 'undefined' && init && init.q && Number(init.q.fflogs) === 0);
    } catch (e) {
      return true;
    }
  }

  function init_(region) {
    setRegion(region);
    if (typeof window.LogParser !== 'function') { state.reason = 'parser-ff.js not loaded'; return false; }
    if (!host() || !apply()) { state.reason = 'host-logic.js / apply.js not loaded'; return false; }
    try {
      // Same construction the Archon host uses: line signing off, no game-content detection,
      // meters on. The start date is what the parser folds line timestamps onto; live lines carry
      // a full ISO timestamp, so today's midnight is only a formality.
      parser = new window.LogParser(0, false, [], false, false, true, null);
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      parser.setLogStartDate(day);
      parser.setLiveLoggingStartTime(Date.now());
    } catch (e) {
      state.reason = 'parser failed to start: ' + message(e);
      state.lastError = state.reason;
      return false;
    }
    state.available = true;
    state.reason = 'ok';
    for (const t of state.timers) clearInterval(t);
    state.timers = [setInterval(drain, PARSE_INTERVAL_MS), setInterval(collect, COLLECT_INTERVAL_MS)];
    return true;
  }

  /** Takes effect at the next batch; the parser reads it from prepareToParseLines. */
  function setRegion(region) {
    const r = Number(region);
    state.region = Number.isFinite(r) && r > 0 ? r : 1;
  }

  function feed(line) {
    if (!state.available || typeof line !== 'string' || line.length === 0) return;
    state.queue.push(line);
  }

  // Lines are batched so the parser sees one prepareToParseLines per burst rather than one per
  // line. It expects a running byte position the way the uploader reports file offsets.
  function drain() {
    if (!parser || state.queue.length === 0) return;
    const lines = state.queue;
    state.queue = [];

    const start = state.position;
    state.position += lines.reduce((n, l) => n + l.length + 1, 0);

    try {
      parser.prepareToParseLines(false, state.region, [], {
        filePath: 'live.log',
        currentPosition: state.position,
        startingPosition: start,
      }, false, true, null);
    } catch (e) {
      state.errors += lines.length;
      state.lastError = 'prepareToParseLines: ' + message(e);
      return;
    }

    for (const line of lines) {
      try {
        parser.parseLine(line);
        state.lines++;
      } catch (e) {
        state.errors++;
        state.lastError = message(e);
      }
    }
  }

  function collect() {
    if (!parser) return false;
    try {
      const meters = parser.collectMeters();
      state.logVersion = meters && meters.logVersion ? Number(meters.logVersion) : state.logVersion;
      state.lastFight = host().pickFight(meters && meters.fights, state.lastFight);
      state.lastCollectAt = Date.now();
      return true;
    } catch (e) {
      state.collectErrors++;
      state.lastError = 'collectMeters: ' + message(e);
      return false;
    }
  }

  /** Everything apply.js needs, from the last fight seen; null before the first fight. */
  function snapshot() {
    const fight = state.lastFight;
    if (!fight) return null;
    const h = host();
    const pets = h.petTablesOf(parser);
    const damage = h.foldActors(fight.friendlyDamage && fight.friendlyDamage.actors, pets);
    const healing = h.healingRows(fight, pets);
    return {
      fight,
      damageRows: damage.rows,
      healingRows: healing,
      // Whether FFLogs has these tables for this fight at all; apply.js keeps ACT's figures
      // for a table the parser never filled.
      hasHealing: healing.length > 0,
      hasDeaths: !!(fight.deaths && fight.deaths.actors),
      deaths: h.deathCounts(fight, pets && pets.nameOf),
      durationSeconds: Math.max(0, (Number(fight.endTime) - Number(fight.startTime)) / 1000),
      parserVersion: state.parserVersion,
      logVersion: state.logVersion,
      fightId: Number(fight.id) || 0,
      fightState: String(fight.state || ''),
    };
  }

  /**
   * Whether the parser's fight is the encounter this CombatData message describes: someone has
   * been booked, the parser answered recently, and the two clocks agree on the pull.
   */
  function isAuthoritative(detail, snap) {
    if (!snap || !snap.damageRows || snap.damageRows.length === 0) return false;
    if (Date.now() - state.lastCollectAt > FRESH_MS) return false;
    const actDuration = detail && detail.Encounter ? detail.Encounter.DURATION : undefined;
    return apply().fightMatches(actDuration, snap.durationSeconds);
  }

  function tag(detail, applied, reason) {
    if (detail && typeof detail === 'object') {
      detail.fflogs = {
        applied,
        reason,
        available: state.available,
        parserVersion: state.parserVersion,
        logVersion: state.logVersion,
        fightId: state.lastFight ? Number(state.lastFight.id) || 0 : 0,
        fightState: state.lastFight ? String(state.lastFight.state || '') : '',
      };
    }
    return detail;
  }

  /**
   * The CombatData message mopimopi should parse: FFLogs' figures written in when the parser is
   * on, running, and on the same pull; the message as it came otherwise.
   */
  function overlay(detail, myName) {
    if (!detail || typeof detail !== 'object') return detail;
    if (!enabled()) return tag(detail, false, 'disabled');
    if (!state.available) return tag(detail, false, state.reason);

    collect();
    const snap = snapshot();
    if (!isAuthoritative(detail, snap)) return tag(detail, false, snap ? 'fight does not match the encounter' : 'no fight yet');

    try {
      return apply().applyFflogs(detail, snap, myName, host());
    } catch (e) {
      state.lastError = 'apply: ' + message(e);
      return tag(detail, false, 'apply failed');
    }
  }

  window.FflogsMeter = {
    init: init_,
    setRegion,
    feed,
    collect,
    snapshot,
    isAuthoritative,
    overlay,
    get state() { return state; },
  };
})();

/**
 * Measures every player's GCD uptime inside mopimopi, off the raw log lines OverlayPlugin already
 * hands this page, and writes the result into each CombatData message before mopimopi parses it.
 * Port of OverlayPluginAddon's GcdEventSource.cs: no ACT plugin involved.
 *
 * In ACTWebSocket compatibility mode every network log line arrives as a broadcast with msgtype
 * "Chat" and the raw line as msg (MiniParseOverlay.HandleEvent); core.js routes those here through
 * feed(). The model is xivanalysis' - see js/gcd/tracker.js. This file only feeds it: which lines
 * are GCDs (js/gcd/categories.js), when the button actually went down, whether the cast bar ran,
 * and what haste was on the player at that moment (js/gcd/status-tracker.js).
 *
 * Encounter boundaries are the one thing the addon had that a page does not: it reset the
 * tracker when ACT's ActiveEncounter changed. Here the CombatData message says so instead -
 * isActive going true, or DURATION shrinking - and the presses before the new encounter's start
 * are dropped (see syncEncounter). The start is estimated from the latest ability line and the
 * duration, erring early rather than late, so nothing inside the pull is ever lost.
 *
 * Never calls OverlayPluginApi.callHandler / callOverlayHandler: that flips the overlay to the
 * modern API and unsubscribes the CombatData feed this page lives on.
 *
 * Browser: window.GcdMeterFactory (this module) and window.GcdMeter (the page's instance, created
 * at the bottom). Node: require() and create() with explicit deps.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GcdMeterFactory = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // Log line types we care about, as emitted by FFXIV_ACT_Plugin.
  const LINE_CHANGE_ZONE = 1;
  const LINE_PRIMARY_PLAYER = 2;
  const LINE_ADD_COMBATANT = 3;
  const LINE_REMOVE_COMBATANT = 4;
  const LINE_STARTS_CASTING = 20;
  const LINE_ABILITY = 21;
  const LINE_AOE_ABILITY = 22;
  const LINE_CANCEL_CAST = 23;
  const LINE_DEATH = 25;
  const LINE_STATUS_APPLY = 26;
  const LINE_STATUS_REMOVE = 30;

  // 21|ts|sourceId|sourceName|abilityId|abilityName|targetId|targetName|...
  const FIELD_TIMESTAMP = 1;
  const FIELD_SOURCE_ID = 2;
  const FIELD_SOURCE_NAME = 3;
  const FIELD_ACTION_ID = 4;
  const ABILITY_MIN_FIELDS = 6;

  // 20|timestamp|sourceId|sourceName|actionId|actionName|targetId|targetName|castTime(s)|x|y|z|heading
  const FIELD_CAST_DURATION = 8;

  /**
   * A cast bar older than this never produced an effect and was missed by the cancel line. Longer
   * than the longest cast in the game so a slow Verraise still pairs.
   */
  const MAX_CAST_AGE_MS = 15000;

  /**
   * Extra margin when estimating where a new encounter began, on top of the one second DURATION
   * may have been floored by. Erring early keeps a pre-pull press or two; erring late would drop
   * real ones.
   */
  const ENCOUNTER_START_SLACK_MS = 1000;

  const HEX = /^[0-9a-fA-F]+$/;
  const hex = (s) => (typeof s === 'string' && HEX.test(s) ? parseInt(s, 16) : NaN);
  const message = (e) => String((e && e.message) || e || 'unknown error');

  // 2026-09-13T10:31:22.1234567+08:00 - seven fractional digits, as FFXIV_ACT_Plugin writes them.
  const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?$/;

  /**
   * A log line timestamp as epoch milliseconds, fractional part kept (the addon worked in .NET
   * ticks, and the de-duplication of a cast-start against its effect relies on the two parsing to
   * the same number). NaN when it is not a timestamp. Without a zone the time is read as UTC;
   * only differences between lines matter here.
   */
  function parseTimestamp(text) {
    if (typeof text !== 'string') return NaN;
    const m = TIMESTAMP.exec(text.trim());
    if (!m) {
      const fallback = Date.parse(text);
      return Number.isFinite(fallback) ? fallback : NaN;
    }
    let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) ms += Number('0.' + m[7]) * 1000;
    if (m[8] && m[8] !== 'Z') {
      const sign = m[8][0] === '-' ? -1 : 1;
      const digits = m[8].slice(1).replace(':', '');
      const offsetMinutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
      ms -= sign * offsetMinutes * 60000;
    }
    return ms;
  }

  /**
   * Builds one meter. deps default to the page globals the js/gcd/*.js scripts define; tests pass
   * them in explicitly.
   */
  function create(deps) {
    deps = deps || {};
    const ActionData = deps.ActionData || root.GcdActionData;
    const Tracker = deps.GcdTracker || root.GcdTracker;
    const StatusTracker = deps.StatusTracker || root.GcdStatusTracker;
    const Categories = deps.ActionCategories || root.GcdActionCategories;
    const Apply = deps.Apply || root.GcdApply;
    const categoryData = deps.categoryData !== undefined ? deps.categoryData : root.GcdActionCategoryData;
    const actionTable = deps.actionTable !== undefined ? deps.actionTable : root.GcdActionTable;

    // Every counter between "a line reached the page" and "a number reached a row". The first
    // thing to read (GcdMeter.state in the overlay's console) when the columns read zero.
    const state = {
      available: false,
      reason: 'not started',
      lines: 0,
      castStarts: 0,
      castCancels: 0,
      abilityLines: 0,
      abilityLinesNonPlayer: 0,
      abilityLinesNotGcd: 0,
      gcdsRecorded: 0,
      hardCastsRecorded: 0,
      unknownActions: 0,
      malformed: 0,
      encounters: 0,
      applied: 0,
      lastLineMs: NaN,
      lastAbilityMs: NaN,
      lastActive: null,
      lastDuration: NaN,
      lastError: '',
      categories: { available: false, count: 0, source: '', generatedAt: '', error: null },
      actions: { count: 0, speedStatuses: 0, error: null },
    };

    let statuses = null;
    let tracker = null;
    let categories = null;
    let actions = null;

    /**
     * A cast that started but has not landed yet, per player. Pairing the cast bar with the effect
     * answers two things at once: whether the press was instant (Dualcast, Swiftcast and every
     * proc make the base cast time in the data wrong for that press) and *when the GCD actually
     * started*, which is when the button went down, not when the damage landed.
     */
    const casting = new Map();

    function start() {
      try {
        if (!ActionData || !Tracker || !StatusTracker || !Categories || !Apply) {
          state.reason = 'js/gcd scripts not loaded';
          return false;
        }

        categories = Categories.load(categoryData);
        state.categories = {
          available: categories.available, count: categories.count,
          source: categories.source, generatedAt: categories.generatedAt, error: categories.loadError,
        };

        actions = ActionData.load(actionTable);
        state.actions = { count: actions.actionCount, speedStatuses: actions.speedStatusCount, error: actions.loadError };

        statuses = new StatusTracker();
        tracker = new Tracker(actions);
        casting.clear();

        if (!categories.available) {
          state.reason = 'GCD uptime unavailable: ' + categories.loadError;
          return false;
        }
      } catch (e) {
        state.reason = 'failed to start: ' + message(e);
        state.lastError = state.reason;
        return false;
      }

      state.available = true;
      state.reason = 'ok';
      return true;
    }

    // ------------------------------------------------------------------ log line intake

    /** One raw network log line, as OverlayPlugin broadcasts it. */
    function feed(line) {
      if (!state.available || typeof line !== 'string' || line.length === 0) return;

      // Cheap prefix check before paying for a split on every single log line.
      const bar = line.indexOf('|');
      if (bar < 1 || bar > 3) return;
      const type = Number(line.substring(0, bar));
      if (!Number.isInteger(type)) return;

      state.lines++;

      try {
        switch (type) {
          case LINE_STARTS_CASTING:
            handleCastStart(line.split('|'));
            break;

          case LINE_CANCEL_CAST:
            // 23|timestamp|sourceId|sourceName|actionId|... - the cast bar was interrupted, so the
            // GCD provisionally recorded when it started never happened.
            handleCastCancel(line.split('|'));
            break;

          case LINE_ABILITY:
          case LINE_AOE_ABILITY:
            handleAbilityLine(line.split('|'));
            break;

          case LINE_STATUS_APPLY:
          case LINE_STATUS_REMOVE:
            statuses.handleStatusLine(type === LINE_STATUS_APPLY, line.split('|'));
            break;

          case LINE_DEATH: {
            // 25|timestamp|targetId|targetName|sourceId|sourceName - death wipes every status.
            const f = line.split('|');
            if (f.length > 3) statuses.removeActor(f[3]);
            break;
          }

          case LINE_PRIMARY_PLAYER:
            // Tells us the logging player's real name, which ACT hides behind "YOU".
            statuses.handlePrimaryPlayer(line.split('|'));
            break;

          case LINE_ADD_COMBATANT:
            // Names actors authoritatively, which is how we learn who is a player.
            statuses.handleAddCombatant(line.split('|'));
            break;

          case LINE_REMOVE_COMBATANT: {
            // 04|timestamp|actorId|actorName|...
            const f = line.split('|');
            if (f.length > 3) statuses.removeActor(f[3]);
            break;
          }

          case LINE_CHANGE_ZONE:
            statuses.clear();
            break;

          default:
            break;
        }
      } catch (e) {
        state.lastError = 'feed: ' + message(e);
      }
    }

    /**
     * Whether the action is a GCD. The snapshot decides for every id it knows. An id it has never
     * heard of - added by a patch after the snapshot - counts only when it showed a cast bar:
     * players' hard casts are weaponskills and spells, and an instant of unknown kind could as
     * easily be an oGCD.
     */
    function isGcdAction(actionId, hardCast) {
      if (categories.knows(actionId)) return categories.isGcd(actionId);
      state.unknownActions++;
      return hardCast;
    }

    function isSpellAction(actionId) {
      return categories.knows(actionId) ? categories.isSpell(actionId) : true;
    }

    function lineTime(f) {
      const when = parseTimestamp(f[FIELD_TIMESTAMP]);
      if (Number.isFinite(when)) state.lastLineMs = when;
      return when;
    }

    function handleCastStart(f) {
      state.castStarts++;
      if (f.length <= FIELD_ACTION_ID) { state.malformed++; return; }

      const actionId = hex(f[FIELD_ACTION_ID]);
      if (!Number.isFinite(actionId)) { state.malformed++; return; }

      const source = f[FIELD_SOURCE_NAME];
      if (!source) return;

      const when = lineTime(f);
      if (!Number.isFinite(when)) { state.malformed++; return; }

      // The client states how long this bar will run, with speed, haste and job mechanics already
      // applied. The table only knows the unmodified value.
      let castMs = 0;
      if (f.length > FIELD_CAST_DURATION) {
        const castSeconds = parseFloat(f[FIELD_CAST_DURATION]);
        if (Number.isFinite(castSeconds) && castSeconds > 0) castMs = castSeconds * 1000;
      }

      // A cast bar carries the actor id too, so a page opened mid-pull learns the player from it
      // rather than waiting for their first instant.
      statuses.notePlayer(f[FIELD_SOURCE_ID], source);

      casting.set(source, { actionId, startedAtMs: when, castMs });

      // Recorded now rather than when the damage lands. The GCD is already turning while the cast
      // bar fills, so waiting for the effect leaves uptime sagging for the whole cast and snapping
      // back afterwards. When the effect does arrive it carries this same timestamp and is
      // dropped as a duplicate.
      if (isGcdAction(actionId, true) && statuses.isPlayer(source)) {
        if (tracker.record(source, actionId, when, speedModifierOn(source, actionId), true, isSpellAction(actionId), castMs)) {
          state.gcdsRecorded++;
          state.hardCastsRecorded++;
        }
      }
    }

    function handleCastCancel(f) {
      state.castCancels++;
      if (f.length <= FIELD_ACTION_ID) return;

      const source = f[FIELD_SOURCE_NAME];
      if (!source) return;

      const pending = casting.get(source);
      if (!pending) return;
      casting.delete(source);

      if (tracker.removeLast(source, pending.actionId)) {
        if (state.gcdsRecorded > 0) state.gcdsRecorded--;
        if (state.hardCastsRecorded > 0) state.hardCastsRecorded--;
      }
    }

    /**
     * Counts a player's GCDs. Driven off the ability line rather than off damage, so that GCDs
     * which heal or only apply a buff still count - a healer's uptime would be nonsense otherwise.
     */
    function handleAbilityLine(f) {
      state.abilityLines++;
      if (f.length < ABILITY_MIN_FIELDS) { state.malformed++; return; }

      const source = f[FIELD_SOURCE_NAME];
      const sourceId = f[FIELD_SOURCE_ID];

      // Ability lines are how we learn who the players are. They fire constantly, unlike
      // AddCombatant, which only turns up on a zone change.
      statuses.notePlayer(sourceId, source);

      const when = lineTime(f);
      if (!Number.isFinite(when)) { state.malformed++; return; }

      // ACT's encounter clock advances on combat actions like this one, whoever performed it;
      // syncEncounter reads the new encounter's start off this.
      state.lastAbilityMs = when;

      // Only players have a GCD worth measuring; pets and mobs are noise here.
      if (!source) return;
      if (!sourceId || sourceId[0] !== '1') { state.abilityLinesNonPlayer++; return; }

      const actionId = hex(f[FIELD_ACTION_ID]);
      if (!Number.isFinite(actionId)) { state.malformed++; return; }

      // Landed with a matching cast bar behind it, rather than fired instantly.
      const pending = casting.get(source);
      const hardCast = !!pending && pending.actionId === actionId && when - pending.startedAtMs <= MAX_CAST_AGE_MS;

      if (!isGcdAction(actionId, hardCast)) { state.abilityLinesNotGcd++; return; }

      let pressedAt = when;
      let actualCastMs = 0;
      if (hardCast) {
        // The GCD started turning when the button went down. Timing a caster off the moment their
        // damage lands mixes cast time into every interval: an instant following a 2.5s cast looks
        // like a zero-length GCD, and the cast before it looks like a double-length one.
        pressedAt = pending.startedAtMs;
        actualCastMs = pending.castMs;
        casting.delete(source);
      }

      // The cast bar's length travels with the pending cast, so a hard cast that gets recorded here
      // - its cast-start line fell before the page learned the player - is still measured off the
      // bar rather than the table.
      if (tracker.record(source, actionId, pressedAt, speedModifierOn(source, actionId), hardCast, isSpellAction(actionId), actualCastMs)) {
        state.gcdsRecorded++;
        if (hardCast) state.hardCastsRecorded++;
      }
    }

    /**
     * Product of the haste statuses on an actor that apply to the action being pressed. Read at
     * cast time because the status tracker only holds the present, and the GCD that matters is the
     * one in force when the button was pressed. Per action, not per actor: Inspiration quickens a
     * Pictomancer's aetherhue spells and not the hammers pressed beside them.
     */
    function speedModifierOn(actor, actionId) {
      let modifier = 1;
      for (const status of statuses.activeOn(actor)) {
        modifier *= actions.speedModifierOf(status.statusId, actionId);
      }
      return modifier;
    }

    // ------------------------------------------------------------------ encounters

    const num = (v) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v === undefined || v === null ? '' : v).replace(/,/g, ''));
      return Number.isFinite(n) ? n : NaN;
    };

    /**
     * Reads the encounter state off a CombatData message and, when a new encounter has begun,
     * forgets the presses that belong to the previous one.
     *
     * A new encounter is isActive turning true, or DURATION getting smaller while active. Its
     * start is estimated as (latest ability line) - (DURATION + 1s) - slack: ACT's end-of-encounter
     * clock only moves on combat actions, so the latest ability line is at or before it, and
     * DURATION is floored to whole seconds, so the estimate lands at or before the true start.
     * Never after it - a press inside the pull is never dropped; at worst a pre-pull press or two
     * stays, as the addon's own boundary was fuzzy by about one press as well.
     *
     * Returns true when a new encounter was detected.
     */
    function syncEncounter(detail) {
      if (!detail || typeof detail !== 'object') return false;
      const active = String(detail.isActive) === 'true';
      const duration = detail.Encounter ? num(detail.Encounter.DURATION) : NaN;

      const began = active && (
        state.lastActive !== true
        || (Number.isFinite(duration) && Number.isFinite(state.lastDuration) && duration < state.lastDuration)
      );

      state.lastActive = active;
      state.lastDuration = Number.isFinite(duration) ? duration : state.lastDuration;
      if (!began) return false;

      state.encounters++;
      if (Number.isFinite(state.lastAbilityMs) && Number.isFinite(duration)) {
        tracker.dropBefore(state.lastAbilityMs - (duration + 1) * 1000 - ENCOUNTER_START_SLACK_MS);
      }
      // Pending cast bars and statuses deliberately survive: a haste status applied a second
      // before the pull started is still up during the opener, and a bar started before the first
      // hit is the opener.
      return true;
    }

    // ------------------------------------------------------------------ output

    /** One player's numbers, by the name the log lines use. Zeros and the 2.5s default for anyone unknown. */
    function statsFor(name) {
      if (!tracker) return Tracker.emptyStats();
      return tracker.statsFor(name);
    }

    /** The logging player's real name: what OverlayPlugin told us, else what log line 02 said. */
    function localName(myName) {
      if (myName) return String(myName);
      return statuses && statuses.localPlayerName ? statuses.localPlayerName : '';
    }

    function tag(detail, applied, reason, written) {
      if (detail && typeof detail === 'object') {
        detail.gcd = {
          applied,
          reason,
          written: written || 0,
          available: state.available,
          players: tracker ? tracker.players.length : 0,
          encounters: state.encounters,
          categories: state.categories.source,
        };
      }
      return detail;
    }

    /**
     * The CombatData message mopimopi should parse: the GCD columns written into every row when
     * the meter is running; the message as it came otherwise (so a row an ACT addon filled in
     * stays as the addon left it). There is no user switch: the page always computes.
     */
    function overlay(detail, myName) {
      if (!detail || typeof detail !== 'object') return detail;
      if (!state.available) return tag(detail, false, state.reason);

      try {
        syncEncounter(detail);
        const written = Apply.applyGcd(detail, statsFor, localName(myName));
        state.applied++;
        return tag(detail, true, 'applied', written);
      } catch (e) {
        state.lastError = 'apply: ' + message(e);
        return tag(detail, false, 'apply failed');
      }
    }

    /** Every player's numbers, rounded for reading. */
    function snapshot() {
      const players = {};
      if (tracker) {
        for (const player of tracker.players) {
          const gcd = tracker.statsFor(player);
          players[player] = {
            gcdUptime: Math.round(gcd.uptime * 1000) / 10,
            gcdCount: gcd.count,
            gcdClip: Math.round(gcd.clip * 10) / 10,
            gcdOccupied: Math.round(gcd.occupiedSeconds * 10) / 10,
            gcdRecast: Math.round(gcd.recast * 100) / 100,
            speedStat: gcd.speedStat,
            recastEstimated: gcd.recastEstimated,
            skillSpeedSamples: gcd.skillSpeedSamples,
            spellSpeedSamples: gcd.spellSpeedSamples,
          };
        }
      }
      return {
        players,
        gcdActionsKnown: categories ? categories.count : 0,
        actionRecastsKnown: actions ? actions.actionCount : 0,
        hasteStatusesKnown: actions ? actions.speedStatusCount : 0,
        knownPlayers: statuses ? statuses.knownPlayers : [],
      };
    }

    /**
     * One line per GCD for a player - what it was, when, what recast it was charged, how long until
     * the next one, and what that turned into - the view that settles "the GCD logic is wrong".
     * Paste GcdMeter.dump('Name') into the overlay's console.
     */
    function dump(name) {
      if (!tracker) return 'not started';
      const names = name ? [name] : tracker.players;
      const lines = [];
      for (const player of names) {
        const gcd = tracker.statsFor(player, true);
        if (gcd.count === 0) continue;
        lines.push(
          player + '  gcd: ' + gcd.count + ' casts, uptime ' + (gcd.uptime * 100).toFixed(1) + '%, lost ' + gcd.clip.toFixed(1)
          + 's, recast ' + gcd.recast.toFixed(2) + 's (speed stat ' + gcd.speedStat + ', ' + gcd.skillSpeedSamples + ' skill / '
          + gcd.spellSpeedSamples + ' spell samples)' + (gcd.recastEstimated ? '' : ' - default, too few casts to measure')
        );
        if (gcd.trace && gcd.trace.length > 0) {
          const first = gcd.trace[0].timeMs;
          lines.push('    t(s)    action  cast  recast   gap   occupied  lost');
          for (const c of gcd.trace) {
            lines.push(
              '    ' + ((c.timeMs - first) / 1000).toFixed(2).padStart(6) + '  ' + c.actionId.toString(16).toUpperCase().padStart(6)
              + '  ' + (c.hardCast ? 'hard' : 'inst') + '  ' + (c.recastMs / 1000).toFixed(2).padStart(6) + '  ' + (c.gapMs / 1000).toFixed(2).padStart(6)
              + '  ' + (c.occupiedMs / 1000).toFixed(2).padStart(8) + '  ' + (c.lostMs / 1000).toFixed(2).padStart(5)
            );
          }
        }
      }
      return lines.join('\n');
    }

    /** Forgets every press and pending cast; statuses and player identities stay. */
    function reset() {
      if (tracker) tracker.clear();
      casting.clear();
    }

    return {
      init: start,
      feed,
      overlay,
      syncEncounter,
      statsFor,
      snapshot,
      dump,
      reset,
      parseTimestamp,
      get state() { return state; },
      get tracker() { return tracker; },
      get statuses() { return statuses; },
      get categories() { return categories; },
      get actions() { return actions; },
      get casting() { return casting; },
    };
  }

  return { create, parseTimestamp, MAX_CAST_AGE_MS, ENCOUNTER_START_SLACK_MS };
});

// The page's one instance, over the globals the other js/gcd scripts defined. core.js starts it.
if (typeof window !== 'undefined' && !(typeof module === 'object' && module.exports)) {
  window.GcdMeter = window.GcdMeterFactory.create();
}

/**
 * Per-player GCD uptime, following the model xivanalysis uses. Port of OverlayPluginAddon's
 * GcdTracker.cs, number for number.
 *
 * The naive approach - measure each action's recast from how long it takes that player to press
 * the next button - falls apart because recasts differ per action (dance steps 1s, Ninjutsu and
 * Hypercharge filler 1.5s, Six-sided Star 5s) and there is rarely enough of any one action to
 * measure it. xivanalysis inverts the problem:
 *
 *   1. Every action's *base* recast is known data (js/gcd/actions-data.js, from xivanalysis).
 *   2. So an observed interval can be normalised: divide out the leading action's base recast and
 *      any haste that was active, and every interval in the fight collapses onto one distribution
 *      regardless of which button produced it.
 *   3. The mode of that distribution is the player's 2.5s-base GCD, which inverts to a single
 *      speed stat.
 *   4. That one stat then re-derives the true recast of every action they press.
 *
 * One learned parameter explains the whole rotation, and an action pressed twice all fight gets
 * as good a recast as the one pressed two hundred times.
 *
 * Intervals led by an action with no speed attribute are excluded from step 2 - a 1s dance step
 * is 1s at any amount of skill speed, so it carries no information about the stat - but those
 * actions still occupy their flat recast in step 4.
 *
 * Times are milliseconds (log timestamps parsed to epoch ms, fractional part kept).
 *
 * Pure: no DOM, no globals. Browser: window.GcdTracker. Node: require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./action-data.js'));
  else root.GcdTracker = factory(root.GcdActionData);
})(typeof self !== 'undefined' ? self : this, function (ActionData) {
  'use strict';

  /**
   * Log timestamps arrive quantised, so a 2.50s recast shows up spread across a band rather than
   * as one value. Batching before taking the mode is what stops the estimate landing on whichever
   * single millisecond happened to repeat most. 45ms matches xivanalysis.
   */
  const BATCH_SIZE_MS = 45;

  /** Batches either side of the mode folded into the weighted average. */
  const BATCH_RADIUS = 2;

  const MIN_INTERVAL_SAMPLE = 5;

  /**
   * The game never lets a GCD recast go below this, and an action whose base recast is already at
   * or under it is not scaled by speed at all. Mirrors MIN_RECAST_TIME in xivanalysis' CastTime.
   */
  const MIN_RECAST_MS = 1500;

  /**
   * Slack before a gap between GCDs is called lost time: 100ms of caster tax plus 50ms of
   * timestamp jitter. Without it every clean rotation reports a few seconds of "clip" made
   * entirely of log noise. GCD_ERROR_OFFSET in xivanalysis.
   */
  const GCD_ERROR_OFFSET_MS = 150;

  /**
   * A hard cast can be slidecast: movement is allowed in its last half second and the effect
   * still lands, so the recast has effectively been turning that long already. Only applied to
   * gap measurement, as xivanalysis does. SLIDECAST_OFFSET.
   */
  const SLIDECAST_OFFSET_MS = 500;

  /** Intervals outside this are downtime or log artefacts, not a recast. */
  const MIN_USABLE_INTERVAL_MS = 400;
  const MAX_USABLE_INTERVAL_MS = 7000;

  /**
   * How far a cast bar may sit from the table's cast time before it stops being evidence of
   * spell speed. Speed alone cannot take more than ~20% off; anything shorter is a halved cast or
   * a proc, anything longer is slowed.
   */
  const MIN_CAST_FACTOR = 0.80;
  const MAX_CAST_FACTOR = 1.02;

  /**
   * Safety valve for a page that never sees a CombatData reset (ACT closed mid-session, say):
   * roughly four hours of GCDs, after which the oldest half is let go.
   */
  const MAX_CASTS_PER_PLAYER = 6000;

  const SpeedAttribute = ActionData.SpeedAttribute;

  /** .NET's Math.Round: half to even. */
  function roundHalfEven(x) {
    const f = Math.floor(x);
    const d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  function emptyStats() {
    return {
      count: 0,
      /** This player's plain 2.5s-base GCD in seconds, after their speed stat. */
      recast: ActionData.BASE_GCD_MS / 1000,
      /** The speed stat inferred for this player, or 0 when nothing could be inferred. */
      speedStat: 0,
      /** Fraction of the time from this player's first press to their latest one that a GCD was occupying, 0..1. */
      uptime: 0,
      /** Total seconds lost to gaps longer than the GCD that preceded them. */
      clip: 0,
      /** Seconds the player's closed casts occupied - uptime's numerator, before any division. */
      occupiedSeconds: 0,
      /** Whether the speed stat came from observation rather than the default. */
      recastEstimated: false,
      skillSpeedSamples: 0,
      spellSpeedSamples: 0,
      /** Every cast with the numbers that went into it. Filled only when asked for. */
      trace: null,
    };
  }

  function newState() {
    return {
      casts: [],
      lastActionId: 0,
      lastTimeMs: NaN,
      // One distribution per speed attribute: a Red Mage's spells and weaponskills are governed
      // by different stats and must not be pooled.
      skillSpeedIntervals: [],
      spellSpeedIntervals: [],
      // What the overlay is showing. Measured when a cast is recorded or removed, and only then.
      snapshot: emptyStats(),
    };
  }

  class GcdTracker {
    /** @param actions an ActionData instance (js/gcd/action-data.js). */
    constructor(actions) {
      this.actions = actions;
      this.byPlayer = new Map();
    }

    clear() { this.byPlayer.clear(); }

    get players() { return Array.from(this.byPlayer.keys()); }

    /**
     * Records one GCD cast. Returns false when the press was a duplicate (an AoE hitting eight
     * targets emits one line per target, sharing id and timestamp) or unusable.
     *
     * @param speedModifier product of the haste statuses active on the caster right now. Captured
     *        at record time rather than reconstructed later, since the status tracker only holds
     *        current state.
     * @param hardCast whether this press was actually cast rather than fired instantly. The base
     *        cast time in the data is only what it costs when nothing made it instant, and for a
     *        Red Mage under Dualcast that is half the rotation.
     * @param isSpell used only when the recast table knows nothing and the category has to decide
     *        which speed stat governs.
     * @param actualCastMs how long the cast bar actually ran, from the cast-start line; 0 when
     *        unknown. The client reports this with spell speed, haste and every job mechanic
     *        already folded in, where the table only knows the unmodified value.
     */
    record(player, actionId, timeMs, speedModifier, hardCast, isSpell, actualCastMs) {
      if (!player) return false;
      if (!Number.isFinite(timeMs)) return false;

      let state = this.byPlayer.get(player);
      if (!state) { state = newState(); this.byPlayer.set(player, state); }

      if (state.lastActionId === actionId && state.lastTimeMs === timeMs) return false;

      const cast = {
        actionId,
        timeMs,
        speedModifier: speedModifier === undefined || speedModifier === null ? 1 : speedModifier,
        hardCast: !!hardCast,
        isSpell: !!isSpell,
        actualCastMs: hardCast && actualCastMs > 0 ? actualCastMs : 0,
      };
      this._append(state, cast);

      if (state.casts.length > MAX_CASTS_PER_PLAYER) {
        state = this._rebuild(player, state.casts.slice(-Math.floor(MAX_CASTS_PER_PLAYER / 2)));
        return true;
      }

      state.snapshot = this._measure(state, null);
      return true;
    }

    /** Files the interval the new cast closes, then appends it. */
    _append(state, cast) {
      if (!Number.isNaN(state.lastTimeMs)) this._recordInterval(state, cast.timeMs - state.lastTimeMs);
      state.casts.push(cast);
      state.lastActionId = cast.actionId;
      state.lastTimeMs = cast.timeMs;
    }

    /** Replaces a player's state with one built from these casts, in order. */
    _rebuild(player, casts) {
      const fresh = newState();
      for (const c of casts) this._append(fresh, c);
      fresh.snapshot = this._measure(fresh, null);
      this.byPlayer.set(player, fresh);
      return fresh;
    }

    /**
     * Normalises one raw interval against the action that opened it and files it under that
     * action's speed attribute. This is what lets a 1.5s Ninjutsu and a 2.5s weaponskill vote on
     * the same estimate.
     */
    _recordInterval(state, rawMs) {
      if (rawMs < MIN_USABLE_INTERVAL_MS || rawMs > MAX_USABLE_INTERVAL_MS) return;
      if (state.casts.length === 0) return;

      const previous = state.casts[state.casts.length - 1];
      const def = this.actions.get(previous.actionId);
      const attribute = this._attributeFor(previous, def);

      // A flat recast tells us nothing about the player's speed stat - whether the data says so
      // outright or the base is already at the 1.5s floor the game never scales.
      if (attribute === SpeedAttribute.None || def.recast <= MIN_RECAST_MS) return;

      let recast = def.recast;
      let animationLock = 0;
      let adjusted;

      // Whether the cast bar or the recast gated the next press. When the bar's length is known
      // it decides: a bar that could not have reached the recast even at the slowest plausible
      // speed (Blizzard I's 1.97s against a 2.5s recast, Blizzard III halved under Astral Fire
      // III) left the recast in charge, whatever the table says the cast is - and the table is
      // what goes stale between patches.
      const castGates = previous.hardCast && (previous.actualCastMs > 0
        ? previous.actualCastMs >= def.recast * previous.speedModifier * MIN_CAST_FACTOR
        : def.castTime >= def.recast);

      if (castGates) {
        // The cast gates the next press, not the recast, and caster tax follows it.
        if (previous.actualCastMs > 0) {
          // The cast bar itself is the measurement: its length over the table's is the player's
          // speed factor, with no tax or jitter in it. A bar far shorter than the table allows
          // for - Blizzard III halved under Astral Fire III, Fire III under Umbral Ice III - is a
          // mechanic, not speed, and says nothing about the stat. Fed in, one such cast read as a
          // 1.7s GCD and dragged the estimate down.
          const factor = previous.actualCastMs / (def.castTime * previous.speedModifier);
          if (factor < MIN_CAST_FACTOR || factor > MAX_CAST_FACTOR) return;
          adjusted = ActionData.BASE_GCD_MS * factor;
        } else {
          animationLock = ActionData.ANIMATION_LOCK_MS;
          recast = def.castTime;
          const scale = recast / ActionData.BASE_GCD_MS;
          if (scale <= 0 || previous.speedModifier <= 0) return;
          adjusted = (rawMs - animationLock) / scale / previous.speedModifier;
        }
      } else {
        const castTimeScale = recast / ActionData.BASE_GCD_MS;
        if (castTimeScale <= 0 || previous.speedModifier <= 0) return;
        adjusted = rawMs / castTimeScale / previous.speedModifier;
      }

      if (adjusted < MIN_USABLE_INTERVAL_MS || adjusted > MAX_USABLE_INTERVAL_MS) return;

      if (attribute === SpeedAttribute.SpellSpeed) state.spellSpeedIntervals.push(adjusted);
      else state.skillSpeedIntervals.push(adjusted);
    }

    /**
     * Drops the most recent cast, for a cast bar that was interrupted before it landed. Returns
     * whether anything was removed.
     */
    removeLast(player, actionId) {
      const state = this.byPlayer.get(player || '');
      if (!state || state.casts.length === 0) return false;

      const last = state.casts[state.casts.length - 1];
      if (last.actionId !== actionId) return false;

      state.casts.pop();

      if (state.casts.length === 0) {
        state.lastActionId = 0;
        state.lastTimeMs = NaN;
        state.snapshot = this._measure(state, null);
        return true;
      }

      // Rewind so the next cast measures its interval from the one before the interruption. That
      // interval spans the wasted cast time, which is exactly the loss it represents.
      const previous = state.casts[state.casts.length - 1];
      state.lastActionId = previous.actionId;
      state.lastTimeMs = previous.timeMs;
      state.snapshot = this._measure(state, null);
      return true;
    }

    /**
     * Forgets every cast before the cutoff, for every player - a new encounter has begun and the
     * presses of the previous one must not carry into it. Players left with nothing are dropped.
     * Intervals are re-derived from the surviving casts, so the numbers are exactly what they
     * would have been had recording started at the cutoff.
     */
    dropBefore(cutoffMs) {
      if (!Number.isFinite(cutoffMs)) return;
      for (const [player, state] of Array.from(this.byPlayer.entries())) {
        const keep = state.casts.filter((c) => c.timeMs >= cutoffMs);
        if (keep.length === state.casts.length) continue;
        if (keep.length === 0) { this.byPlayer.delete(player); continue; }
        this._rebuild(player, keep);
      }
    }

    /**
     * This player's GCD numbers as of their last press.
     *
     * Measured once per GCD, at the press, over the player's own presses only: the numerator is
     * what every earlier cast occupied, the denominator is the time from their first press to
     * this one. Nothing about the encounter is consulted.
     *
     * The denominator is the point. An earlier version divided by ACT's encounter duration, and
     * ACT's clock is driven by damage: it advances when a hit lands and not otherwise. Casts are
     * recorded when the button goes down, and for a hard cast the hit lands a cast time later. So
     * at the moment a hard cast begins, the instant before it closes and is charged its full
     * recast, while the denominator still ends at that instant's hit - uptime jumps, and falls
     * back when the next press drags the clock forward. Measured from press to press, both halves
     * move at the same moments by construction.
     *
     * Two things are outside the window. The cast in flight, whose recast is still turning: it is
     * in the count but not yet in either half. And the tail after the final press: idle time is
     * charged by the press that ends it, so a player who dies with two minutes left keeps the
     * uptime they had when they died.
     */
    statsFor(player, includeTrace) {
      const state = player ? this.byPlayer.get(player) : undefined;
      if (!state) return emptyStats();

      if (!includeTrace) return state.snapshot;

      // Nothing outside the cast list goes into the measurement, so re-deriving it with a trace
      // attached reproduces the snapshot exactly: the rows add up to the number shown.
      return this._measure(state, []);
    }

    _measure(state, trace) {
      const stats = emptyStats();

      stats.count = state.casts.length;
      if (stats.count === 0) return stats;

      const skillStat = this._estimateStat(state.skillSpeedIntervals);
      const spellStat = this._estimateStat(state.spellSpeedIntervals);

      stats.recastEstimated = skillStat !== null || spellStat !== null;
      const headline = skillStat !== null ? skillStat : spellStat;
      if (headline !== null) {
        stats.speedStat = headline;
        stats.recast = ActionData.adjustedDuration(headline, ActionData.BASE_GCD_MS) / 1000;
      }

      // Accumulated per closed *interval*: each cast except the newest opens one, running to the
      // next press. The numerator is what those casts occupied, the denominator is the sum of
      // those intervals - first press to latest press - so the two halves cover the same window
      // by construction and the newest cast, whose recast is still turning, is in neither.
      //
      // Occupied is the xivanalysis model: every closed cast contributes its full GCD duration,
      // never min(recast, gap). Log timestamps are batched at ~45ms, so a clean 2.5s rotation
      // shows gaps of 2.46 to 2.54; charging the gap would shave every early-looking press and
      // never read 100%.
      //
      // Lost time is the separate question xivanalysis' downtime windows answer, and it does look
      // at gaps - with 150ms of slack for caster tax and jitter, and the slidecast window after a
      // hard cast, so that a clean rotation reports zero rather than a few seconds of noise. The
      // gap after the newest cast is not closed yet, which is why an idle stretch is charged by
      // the press that ends it.
      let occupiedMs = 0;
      let clipMs = 0;

      for (let i = 0; i + 1 < state.casts.length; i++) {
        const cast = state.casts[i];
        const occupied = this._occupiedMs(cast, skillStat, spellStat);
        const recast = occupied.ms;
        const gap = state.casts[i + 1].timeMs - cast.timeMs;

        occupiedMs += recast;

        // Slidecast slack belongs only to a cast that gated the GCD: that is the one whose bar the
        // next press waited on. A Blizzard I runs 1.97s under a 2.45s recast - the recast gates,
        // the bar is irrelevant, and a press 0.5s after the recast ended is half a second of idle,
        // not a slidecast.
        const slack = GCD_ERROR_OFFSET_MS + (occupied.castGated ? SLIDECAST_OFFSET_MS : 0);
        const lost = gap > recast + slack ? gap - recast : 0;
        clipMs += lost;

        if (trace) {
          trace.push({
            actionId: cast.actionId, timeMs: cast.timeMs, hardCast: cast.hardCast,
            recastMs: recast, gapMs: gap, occupiedMs: recast, lostMs: lost,
          });
        }
      }

      // The newest cast, for the trace only: its recast is known, its gap is not yet.
      const newest = state.casts[state.casts.length - 1];
      if (trace) {
        trace.push({
          actionId: newest.actionId, timeMs: newest.timeMs, hardCast: newest.hardCast,
          recastMs: this._occupiedMs(newest, skillStat, spellStat).ms, gapMs: 0, occupiedMs: 0, lostMs: 0,
        });
      }

      stats.trace = trace;
      stats.skillSpeedSamples = state.skillSpeedIntervals.length;
      stats.spellSpeedSamples = state.spellSpeedIntervals.length;
      stats.occupiedSeconds = occupiedMs / 1000;
      stats.clip = clipMs / 1000;

      // Uptime is one minus lost time, xivanalysis' downtime model, and NOT occupied over span.
      // The two agree when the recast estimate is exact and differ in the one way that matters
      // when it is not: an estimate a few percent high hands every cast more occupancy than the
      // gap it sat in, and thirty such casts manufacture the seconds a real pause cost. Lost time
      // is charged only past the slack, so jitter never counts and a break never stops counting.
      const spanMs = newest.timeMs - state.casts[0].timeMs;
      if (spanMs > 0) stats.uptime = Math.max(0, Math.min(1, 1 - clipMs / spanMs));

      return stats;
    }

    /**
     * How long one cast tied up the GCD: the greater of its recast and its cast time, with caster
     * tax added when the cast is at least a full GCD. Returns { ms, castGated }.
     */
    _occupiedMs(cast, skillStat, spellStat) {
      let castGated = false;
      const def = this.actions.get(cast.actionId);
      const attribute = this._attributeFor(cast, def);

      let recast = def.recast;
      let castTime = def.castTime;

      // xivanalysis' getAdjustedTime, step for step: a base recast already at the 1.5s floor is
      // left alone entirely; otherwise the speed stat applies, then haste, then the result is
      // floored to 10ms and clamped back to the floor.
      if (attribute !== SpeedAttribute.None && recast > MIN_RECAST_MS) {
        const stat = attribute === SpeedAttribute.SpellSpeed
          ? (spellStat !== null ? spellStat : skillStat)
          : (skillStat !== null ? skillStat : spellStat);

        if (stat !== null) {
          recast = ActionData.adjustedDuration(stat, recast);
          if (castTime > 0) castTime = ActionData.adjustedDuration(stat, castTime);
        }

        recast = Math.max(MIN_RECAST_MS, Math.floor(recast * cast.speedModifier / 10) * 10);
        if (castTime > 0) castTime = Math.floor(castTime * cast.speedModifier / 10) * 10;
      }

      if (!cast.hardCast) {
        castTime = 0;
      } else {
        // Prefer what the client reported over the table when it is known - the table cannot see
        // Astral Fire halving a Blizzard III.
        if (cast.actualCastMs > 0) castTime = cast.actualCastMs;

        // Caster tax follows a cast that gates the GCD: one at least as long as the recast it sits
        // on. Compared at the same scale - both already adjusted - and with the table's unmodified
        // pair as the tie-breaker, because after spell speed a 2.5s cast on a 2.5s recast is 2.35s
        // on 2.35s and must still pay.
        castGated = castTime > 0 && (castTime >= recast - 10 || (def.castTime >= def.recast && cast.actualCastMs <= 0));
        if (castGated) castTime += ActionData.ANIMATION_LOCK_MS;
      }

      return { ms: Math.max(recast, castTime), castGated };
    }

    /**
     * Which speed stat governs this press. The recast table only carries the actions that differ
     * from the default, so everything else has to fall back on the action's category - a caster's
     * whole rotation pooling into the skill-speed distribution would leave both estimates built
     * from the wrong samples.
     */
    _attributeFor(cast, def) {
      if (this.actions.knows(cast.actionId)) return def.speedAttribute;
      return cast.isSpell ? SpeedAttribute.SpellSpeed : SpeedAttribute.SkillSpeed;
    }

    /** The player's 2.5s-base GCD, as a speed stat. Null when there is not enough to go on. */
    _estimateStat(normalisedIntervals) {
      if (normalisedIntervals.length < MIN_INTERVAL_SAMPLE) return null;

      const batches = new Map();
      let modeBatch = 0;
      let modeCount = 0;

      for (const interval of normalisedIntervals) {
        const batch = Math.floor(interval / BATCH_SIZE_MS);
        const count = (batches.get(batch) || 0) + 1;
        batches.set(batch, count);
        if (count > modeCount) { modeCount = count; modeBatch = batch; }
      }

      // Weighted average over the mode and its neighbours, so an estimate that straddles a batch
      // boundary is not thrown off by which side happened to win.
      let intervalSum = 0;
      let countSum = 0;

      for (let batch = modeBatch - BATCH_RADIUS; batch <= modeBatch + BATCH_RADIUS; batch++) {
        const count = batches.get(batch);
        if (!count) continue;

        const averageInterval = (batch * BATCH_SIZE_MS + (batch + 1) * BATCH_SIZE_MS - 1) / 2;
        intervalSum += averageInterval * count;
        countSum += count;
      }

      if (countSum === 0) return null;

      // Tooltip GCDs are tiered to 0.01s, so round there rather than carrying noise into the stat
      // conversion.
      const estimate = roundHalfEven(intervalSum / countSum / 10) * 10;
      return ActionData.speedStatFor(estimate);
    }
  }

  GcdTracker.emptyStats = emptyStats;
  return GcdTracker;
});

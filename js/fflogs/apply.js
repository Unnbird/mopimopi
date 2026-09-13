/**
 * Writes FFLogs' parser figures over one ACT CombatData message before mopimopi parses it.
 *
 * mopimopi builds every Person from the string fields of the CombatData message, derives every
 * rate in Person.recalculate(), merges pets in Combatant.sort(), and files finished fights into
 * the history from the same objects. Replacing the strings at the intake point is therefore the
 * one change that makes every column, bar, sort and history entry follow FFLogs without touching
 * the rest of the overlay.
 *
 * Pure: no DOM, no parser, no globals - the snapshot is handed in - so tests/test-fflogs-overlay.js
 * drives it under Node. Loaded in the browser as window.FflogsApply.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FflogsApply = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v === undefined || v === null ? '' : v).replace(/[,%]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const whole = (v) => String(Math.round(num(v)));

  /** How far ACT's encounter clock and the parser's fight clock may disagree and still be one pull. */
  const FIGHT_TOLERANCE_SECONDS = 90;

  /**
   * Both clocks run off the same log lines and both start near the first hit, so on the same pull
   * their durations stay within seconds of each other. After a wipe ACT opens a new encounter at
   * the next hit while the parser is still reporting the finished fight, and the gap is the whole
   * previous pull - which is the case this has to refuse.
   */
  function fightMatches(actDurationSeconds, fightDurationSeconds, toleranceSeconds) {
    const a = num(actDurationSeconds);
    const f = num(fightDurationSeconds);
    const tol = toleranceSeconds === undefined ? FIGHT_TOLERANCE_SECONDS : num(toleranceSeconds);
    if (!Number.isFinite(a) || !Number.isFinite(f)) return false;
    return Math.abs(a - f) <= tol;
  }

  /** ACT's duration string: mm:ss, h:mm:ss past an hour. */
  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(num(seconds)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : pad(m) + ':' + pad(sec);
  }

  /** "Eos (Owner Name)" -> { base: "Eos", owner: "Owner Name" }; null for a plain name. */
  function splitPetName(name) {
    const m = /^(.*) \((.+)\)$/.exec(String(name || ''));
    return m ? { base: m[1], owner: m[2] } : null;
  }

  const emptyHits = () => ({ hitCount: 0, criticalCount: 0, directHitCount: 0, criticalDirectHitCount: 0, maxHit: 0, minHit: 0 });
  const ZERO = { amount: 0, amountTaken: 0, singleTargetAmountTaken: 0, amountGiven: 0, over: 0, hitDetails: emptyHits(), abilities: {} };

  function hitOf(actorLike) {
    return actorLike && actorLike.hitDetails ? actorLike.hitDetails : emptyHits();
  }

  /** The biggest hit as ACT spells it: "Ability-123" plus the bare number. */
  function maxHitStrings(actorLike, host) {
    const found = host && typeof host.maxHitOf === 'function' ? host.maxHitOf(actorLike) : { name: '', value: num(hitOf(actorLike).maxHit) };
    if (!found || found.value <= 0) return { text: '', value: '0' };
    return { text: (found.name || '?') + '-' + whole(found.value), value: whole(found.value) };
  }

  function setDamage(c, source, host) {
    const h = hitOf(source);
    c.damage = whole(source.amount);
    c.hits = whole(h.hitCount);
    c.crithits = whole(h.criticalCount);
    c.DirectHitCount = whole(h.directHitCount);
    c.CritDirectHitCount = whole(h.criticalDirectHitCount);
    const max = maxHitStrings(source, host);
    c.maxhit = max.text;
    c.MAXHIT = max.value;
  }

  function setHealing(c, source, host) {
    const h = hitOf(source);
    // ACT's healed includes overheal; the parser splits the two.
    c.healed = whole(source.amount + source.over);
    c.overHeal = whole(source.over);
    c.heals = whole(h.hitCount);
    c.critheals = whole(h.criticalCount);
    const max = maxHitStrings(source, host);
    c.maxheal = max.text;
    c.MAXHEAL = max.value;
  }

  /**
   * FFLogs' four per-actor totals, undivided. Person.recalculate() turns them into rDPS / aDPS /
   * nDPS / cDPS against the same duration as encdps. A pet row gets zeros: its owner's row already
   * carries the folded total, and mopimopi's merge() must not add anything on top.
   */
  function setFflogsTotals(c, row) {
    c.fflogsAmount = whole(row ? row.amount : 0);
    c.fflogsAmountTaken = whole(row ? row.amountTaken : 0);
    c.fflogsSingleTargetAmountTaken = whole(row ? row.singleTargetAmountTaken : 0);
    c.fflogsAmountGiven = whole(row ? row.amountGiven : 0);
  }

  function findPet(row, baseName) {
    if (!row || !Array.isArray(row.pets)) return null;
    for (const pet of row.pets) if (pet.name === baseName) return pet;
    return null;
  }

  /**
   * @param detail    one CombatData message: { Encounter, Combatant, isActive }
   * @param snapshot  { damageRows, healingRows, deaths (Map name -> count), durationSeconds,
   *                    parserVersion, logVersion, fightId, fightState }
   * @param myName    the logging player's real name (ACT calls them "YOU")
   * @param host      RdpsFflogsHost, for maxHitOf
   * @returns a new detail with FFLogs' figures written in, plus `fflogs` describing what happened
   */
  function applyFflogs(detail, snapshot, myName, host) {
    const out = JSON.parse(JSON.stringify(detail));
    if (!out.Combatant || typeof out.Combatant !== 'object') out.Combatant = {};
    if (!out.Encounter || typeof out.Encounter !== 'object') out.Encounter = {};

    const damageByName = new Map((snapshot.damageRows || []).map((r) => [r.name, r]));
    const healingByName = new Map((snapshot.healingRows || []).map((r) => [r.name, r]));
    const deaths = snapshot.deaths instanceof Map ? snapshot.deaths : new Map(Object.entries(snapshot.deaths || {}));
    const me = String(myName || '');
    const resolve = (n) => (n === 'YOU' && me ? me : n);

    // "FFLogs first" only where FFLogs actually has the figure. A fight whose healing table is
    // empty altogether means the parser produced no healing at all for it (seen on real logs),
    // not that nobody healed - ACT's healing stays. Once the table has anyone in it, a player
    // missing from it did no healing and reads zero. Deaths likewise follow the table's presence.
    const hasHealing = snapshot.hasHealing !== undefined ? !!snapshot.hasHealing : healingByName.size > 0;
    const hasDeaths = snapshot.hasDeaths !== undefined ? !!snapshot.hasDeaths : true;

    let matched = 0;
    const unmatched = [];
    let actDamageUnmatched = 0;
    let actHealedUnmatched = 0;

    for (const key of Object.keys(out.Combatant)) {
      const c = out.Combatant[key];
      if (!c || typeof c !== 'object') continue;

      const pet = splitPetName(key);
      if (pet) {
        // A pet row: the parser either kept this pet apart (Demi-Bahamut and friends, found under
        // the owner's `pets`) or folded it into the owner already (Carbuncle, Eos...). Either way
        // the owner's row carries the total, so this row gets the pet's own share or nothing -
        // never ACT's figure, which would be added on top by mopimopi's merge().
        const ownerName = resolve(pet.owner);
        const ownerDamage = damageByName.get(ownerName);
        const ownerHealing = healingByName.get(ownerName);
        if (!ownerDamage && !ownerHealing) {
          unmatched.push(key);
          actDamageUnmatched += num(c.damage);
          actHealedUnmatched += num(c.healed);
          continue;
        }
        setDamage(c, findPet(ownerDamage, pet.base) || ZERO, host);
        if (hasHealing) setHealing(c, findPet(ownerHealing, pet.base) || ZERO, host);
        setFflogsTotals(c, null);
        if (hasDeaths) c.deaths = whole(deaths.get(pet.base) || 0);
        matched++;
        continue;
      }

      const name = resolve(key);
      const row = damageByName.get(name);
      const healing = healingByName.get(name);
      if (!row && !healing) {
        // NPCs, a name the two sides spell differently: ACT's figures stay. (Limit Break is not
        // one of these - the parser lists it as a combatant and it lands here like a player.)
        unmatched.push(key);
        actDamageUnmatched += num(c.damage);
        actHealedUnmatched += num(c.healed);
        continue;
      }

      // The owner's own figures exclude the pets the parser kept apart; mopimopi adds those pet
      // rows back in merge(), so own + pets lands exactly on the parser's total.
      setDamage(c, row ? row.own : ZERO, host);
      if (hasHealing) setHealing(c, healing ? healing.own : ZERO, host);
      setFflogsTotals(c, row);
      if (hasDeaths) c.deaths = whole(deaths.get(name) || 0);
      matched++;
    }

    // Encounter totals: the parser's for everyone it knows, ACT's for the rows it does not, so
    // damage% keeps adding up across the table. Healing totals only move when healing did.
    let fflogsDamage = 0;
    for (const r of snapshot.damageRows || []) fflogsDamage += num(r.amount);
    let fflogsHealed = 0;
    for (const r of snapshot.healingRows || []) fflogsHealed += num(r.amount) + num(r.over);

    const seconds = Math.max(0, num(snapshot.durationSeconds));
    const divisor = seconds > 0 ? seconds : 1;
    const encDamage = fflogsDamage + actDamageUnmatched;

    out.Encounter.DURATION = whole(seconds);
    out.Encounter.duration = formatDuration(seconds);
    out.Encounter.damage = whole(encDamage);
    out.Encounter.ENCDPS = whole(encDamage / divisor);
    if ('encdps' in out.Encounter) out.Encounter.encdps = out.Encounter.ENCDPS;
    if ('DPS' in out.Encounter) out.Encounter.DPS = out.Encounter.ENCDPS;
    if (hasHealing) {
      const encHealed = fflogsHealed + actHealedUnmatched;
      out.Encounter.healed = whole(encHealed);
      out.Encounter.ENCHPS = whole(encHealed / divisor);
      if ('enchps' in out.Encounter) out.Encounter.enchps = out.Encounter.ENCHPS;
    } else {
      // ACT's healing total over the parser's duration, so HPS keeps the same clock as DPS.
      out.Encounter.ENCHPS = whole(num(out.Encounter.healed) / divisor);
      if ('enchps' in out.Encounter) out.Encounter.enchps = out.Encounter.ENCHPS;
    }

    out.fflogs = {
      applied: true,
      reason: 'applied',
      matched,
      unmatched,
      healing: hasHealing,
      deaths: hasDeaths,
      parserVersion: String(snapshot.parserVersion === undefined ? '' : snapshot.parserVersion),
      logVersion: num(snapshot.logVersion),
      fightId: num(snapshot.fightId),
      fightState: String(snapshot.fightState || ''),
      durationSeconds: seconds,
    };
    return out;
  }

  return { applyFflogs, fightMatches, formatDuration, splitPetName, FIGHT_TOLERANCE_SECONDS };
});

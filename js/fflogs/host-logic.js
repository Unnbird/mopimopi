/**
 * Pure helpers over FFLogs' parser output: which fight to report, how to fold the parser's actor
 * table into per-player rows, and the message the plugin's rdpsFflogsMeters handler expects.
 *
 * No DOM, no OverlayPlugin, no parser instance - everything is handed in - so the same file runs
 * in the parser host page (as window.RdpsFflogsHost), inside mopimopi (js/fflogs/host-logic.js is
 * a verbatim copy of this file; tools/Test-OverlayFields.js checks they match) and under Node
 * (tools/Test-FflogsHost.js, tools/fflogs-local/replay.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RdpsFflogsHost = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  /** The parser's per-actor hit summary, zeroed. */
  function emptyHitDetails() {
    return { hitCount: 0, criticalCount: 0, directHitCount: 0, criticalDirectHitCount: 0, maxHit: 0, minHit: 0 };
  }

  function readHitDetails(h) {
    const out = emptyHitDetails();
    if (!h || typeof h !== 'object') return out;
    out.hitCount = num(h.hitCount);
    out.criticalCount = num(h.criticalCount);
    out.directHitCount = num(h.directHitCount);
    out.criticalDirectHitCount = num(h.criticalDirectHitCount);
    out.maxHit = num(h.maxHit);
    out.minHit = num(h.minHit);
    return out;
  }

  function mergeHitDetails(into, from) {
    into.hitCount += from.hitCount;
    into.criticalCount += from.criticalCount;
    into.directHitCount += from.directHitCount;
    into.criticalDirectHitCount += from.criticalDirectHitCount;
    into.maxHit = Math.max(into.maxHit, from.maxHit);
    if (from.minHit > 0) into.minHit = into.minHit > 0 ? Math.min(into.minHit, from.minHit) : from.minHit;
    return into;
  }

  /** One actor's own figures, as the parser booked them, in a fixed shape. */
  function readActor(actor) {
    return {
      id: num(actor.id),
      name: String(actor.name || ''),
      fullType: String(actor.fullType || ''),
      amount: num(actor.amount),
      amountTaken: num(actor.amountTaken),
      singleTargetAmountTaken: num(actor.singleTargetAmountTaken),
      amountGiven: num(actor.amountGiven),
      over: num(actor.over),
      hitDetails: readHitDetails(actor.hitDetails),
      abilities: actor.abilities && typeof actor.abilities === 'object' ? actor.abilities : {},
    };
  }

  /**
   * The fight to report out of one collectMeters() result.
   *
   * The parser hands a finished fight over exactly once: the collect that returns it is also the
   * one that filters it out of the list, and later collects come back empty until the next pull.
   * So the caller keeps the last fight it saw and only moves on when one with a higher id shows
   * up. Ids are assigned when a fight books its first actor and only ever grow.
   */
  function pickFight(fights, previous) {
    let best = previous || null;
    if (!Array.isArray(fights)) return best;
    for (const fight of fights) {
      if (!fight || typeof fight !== 'object') continue;
      if (best === null || num(fight.id) >= num(best.id)) best = fight;
    }
    return best;
  }

  /**
   * Flattens an actors table (fight.friendlyDamage.actors or fight.friendlyHealing.actors) into
   * one row per player.
   *
   * Pets whose buffs mirror their owner's are already booked under the owner by the parser
   * (updateMeterAmounts). The ones that are not - Demi-Bahamut, Phoenix, Solar Bahamut and the
   * like - arrive as actors of their own, and FFLogs' own tables merge them later. petsIdTable maps
   * a pet's actor id to a 1-based index into petsTable, whose entry names the owner's actor id.
   *
   * Each row carries the folded totals (amount, amountTaken, ..., hitDetails), the owner's own
   * figures under `own`, and the folded pets one by one under `pets` - so a consumer that keeps
   * pets as separate lines (mopimopi does) can hand each its share and still add back up to the
   * total. Limit Break stays a row of its own (fullType "LimitBreak"): nobody owns it, it takes
   * and gives no buffs, and both ACT and FFLogs list it as a combatant - so its rDPS is its DPS.
   *
   * @param actors  keyed by actor id
   * @param pets    { petsIdTable, petsTable, nameOf(actorId) } or null
   */
  function foldActors(actors, pets) {
    const rows = new Map();
    const folded = [];
    if (!actors || typeof actors !== 'object') return { rows: [], folded };

    const petsIdTable = pets && pets.petsIdTable;
    const petsTable = pets && pets.petsTable;
    const nameOf = pets && typeof pets.nameOf === 'function' ? pets.nameOf : () => '';

    const ownerOf = (id) => {
      if (!petsIdTable || !petsTable || typeof petsIdTable.get !== 'function') return null;
      const index = petsIdTable.get(id);
      const entry = index !== undefined ? petsTable[index - 1] : undefined;
      return entry && num(entry.owner) > 0 ? num(entry.owner) : null;
    };

    const rowFor = (id) => {
      let row = rows.get(id);
      if (!row) {
        row = {
          id,
          name: '',
          fullType: '',
          amount: 0,
          amountTaken: 0,
          singleTargetAmountTaken: 0,
          amountGiven: 0,
          over: 0,
          hitDetails: emptyHitDetails(),
          own: null,
          pets: [],
        };
        rows.set(id, row);
      }
      return row;
    };

    const addTotals = (row, source) => {
      row.amount += source.amount;
      row.amountTaken += source.amountTaken;
      row.singleTargetAmountTaken += source.singleTargetAmountTaken;
      row.amountGiven += source.amountGiven;
      row.over += source.over;
      mergeHitDetails(row.hitDetails, source.hitDetails);
    };

    for (const key of Object.keys(actors)) {
      const raw = actors[key];
      if (!raw || typeof raw !== 'object') continue;

      const actor = readActor(raw);
      if (!actor.id) actor.id = Number(key);

      const owner = ownerOf(actor.id);
      if (owner !== null && owner !== actor.id) {
        const row = rowFor(owner);
        const ownerActor = actors[owner];
        const ownerName = (ownerActor && ownerActor.name) || nameOf(owner) || '';
        // A pet folded in before its owner was seen only lends a name until the owner's own
        // entry names the row, so it never ends up called "Demi-Bahamut".
        if (!row.name) {
          row.name = ownerName;
          row.fullType = ownerActor ? String(ownerActor.fullType || '') : '';
        }
        addTotals(row, actor);
        row.pets.push(actor);
        folded.push({ pet: actor.name, owner: ownerName, amount: actor.amount });
      } else {
        const row = rowFor(actor.id);
        row.name = actor.name || row.name;
        row.fullType = actor.fullType || row.fullType;
        row.own = actor;
        addTotals(row, actor);
      }
    }

    // An owner every one of whose figures came from pets has no entry of its own; give it an
    // empty one so consumers can always read row.own.
    for (const row of rows.values()) {
      if (row.own === null) {
        row.own = readActor({ id: row.id, name: row.name, fullType: row.fullType });
      }
    }

    const list = Array.from(rows.values()).filter((r) => r.name.length > 0);
    list.sort((a, b) => b.amount - a.amount);
    return { rows: list, folded };
  }

  /** fight.friendlyHealing folded the same way as the damage table. */
  function healingRows(fight, pets) {
    const actors = fight && fight.friendlyHealing ? fight.friendlyHealing.actors : null;
    return foldActors(actors, pets).rows;
  }

  /**
   * Deaths per actor name. fight.deaths.actors is keyed by actor id; the name comes from the
   * damage table when the actor dealt damage, from the parser's actor table otherwise.
   */
  function deathCounts(fight, nameOf) {
    const out = new Map();
    const deaths = fight && fight.deaths ? fight.deaths.actors : null;
    if (!deaths || typeof deaths !== 'object') return out;
    const damageActors = fight.friendlyDamage ? fight.friendlyDamage.actors : null;
    const lookup = typeof nameOf === 'function' ? nameOf : () => '';

    for (const key of Object.keys(deaths)) {
      const entry = deaths[key];
      const count = entry && Array.isArray(entry.deaths) ? entry.deaths.length : 0;
      if (count === 0) continue;
      const id = Number(key);
      const fromDamage = damageActors && damageActors[key] ? damageActors[key].name : '';
      const name = String(fromDamage || lookup(id) || '');
      if (!name) continue;
      out.set(name, (out.get(name) || 0) + count);
    }
    return out;
  }

  /**
   * The biggest single hit of one actor (or one row's `own` / pet entry) and the ability that
   * dealt it: the ability whose own hitDetails.maxHit equals the actor's. Empty name when the
   * parser recorded no hits or no ability matches.
   */
  function maxHitOf(actorLike) {
    const value = actorLike && actorLike.hitDetails ? num(actorLike.hitDetails.maxHit) : 0;
    if (value <= 0) return { name: '', value: 0 };
    const abilities = actorLike.abilities && typeof actorLike.abilities === 'object' ? actorLike.abilities : {};
    for (const key of Object.keys(abilities)) {
      const ability = abilities[key];
      if (ability && ability.hitDetails && num(ability.hitDetails.maxHit) === value) {
        return { name: String(ability.name || ''), value };
      }
    }
    return { name: '', value };
  }

  /** The four metrics the way FFLogs' front end derives them from one actor's totals. */
  function metrics(row, seconds) {
    const t = seconds > 0 ? seconds : 1;
    const amount = num(row.amount);
    const taken = num(row.amountTaken);
    const single = num(row.singleTargetAmountTaken);
    const given = num(row.amountGiven);
    return {
      dps: amount / t,
      rdps: (amount - taken + given) / t,
      adps: (amount - single) / t,
      ndps: (amount - taken) / t,
      cdps: (amount - single + given) / t,
    };
  }

  /** The pet tables and name lookup out of a live LogParser, or null before it has any output. */
  function petTablesOf(parser) {
    const out = parser && parser.logParserOutput;
    if (!out || !out.petsIdTable || !out.petsTable) return null;
    return {
      petsIdTable: out.petsIdTable,
      petsTable: out.petsTable,
      nameOf: (id) => {
        try {
          const actor = typeof out.getActor === 'function' ? out.getActor(id) : undefined;
          return actor && actor.unitName ? String(actor.unitName) : '';
        } catch (e) {
          return '';
        }
      },
    };
  }

  /** The message posted to the plugin. `fight` may be null when nothing has been booked yet. */
  function toPayload(info) {
    const fight = info.fight || null;
    const actors = fight && fight.friendlyDamage ? fight.friendlyDamage.actors : null;
    const { rows, folded } = foldActors(actors, info.pets);
    return {
      call: 'rdpsFflogsMeters',
      parserVersion: String(info.parserVersion === undefined || info.parserVersion === null ? '' : info.parserVersion),
      logVersion: num(info.logVersion),
      region: num(info.region),
      fight: fight
        ? {
            id: num(fight.id),
            state: String(fight.state || ''),
            startTime: num(fight.startTime),
            endTime: num(fight.endTime),
            zone: fight.zone && fight.zone.name ? String(fight.zone.name) : '',
          }
        : null,
      actors: rows.map((r) => ({
        name: r.name,
        fullType: r.fullType,
        amount: r.amount,
        amountTaken: r.amountTaken,
        singleTargetAmountTaken: r.singleTargetAmountTaken,
        amountGiven: r.amountGiven,
      })),
      folded: folded.map((f) => ({ pet: f.pet, owner: f.owner })),
      stats: Object.assign({}, info.stats || {}),
    };
  }

  return { pickFight, foldActors, healingRows, deathCounts, maxHitOf, metrics, petTablesOf, toPayload, emptyHitDetails };
});

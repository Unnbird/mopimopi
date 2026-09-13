/**
 * Writes the GCD columns into one ACT CombatData message before mopimopi parses it.
 *
 * OverlayPluginAddon published the same five keys as ACT export variables, so they arrived inside
 * every combatant row as strings; Person keeps them as they come (gcdUptime is already a
 * percentage, the rest are counts and seconds - nothing is divided by the duration). Writing the
 * same strings at the intake point keeps every column, tooltip and history entry working
 * unchanged, with or without the addon.
 *
 * Pure: no DOM, no tracker - the stats come in through a function - so tests drive it under Node.
 * Browser: window.GcdApply.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GcdApply = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LOCAL_PLAYER_ALIAS = 'YOU';

  /** The addon exported with ToString("0.##"): up to two decimals, no trailing zeros. */
  function format(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    const r = Math.round(n * 100) / 100;
    return r === 0 ? '0' : String(r);
  }

  /** A row's five GCD strings, from one player's stats (GcdTracker.statsFor). */
  function columnsOf(stats) {
    return {
      gcdUptime: format(stats.uptime * 100),
      gcdCount: format(stats.count),
      gcdClip: format(stats.clip),
      gcdOccupied: format(stats.occupiedSeconds),
      gcdRecast: format(stats.recast),
    };
  }

  /**
   * The name a CombatData row goes by in the log lines. ACT calls the logging player "YOU" and
   * their pets "Pet (YOU)"; the lines use the real name. Identity when the real name is unknown.
   */
  function resolveName(actName, localName) {
    if (!actName || !localName) return actName;
    if (actName === LOCAL_PLAYER_ALIAS) return localName;
    const open = actName.indexOf(' (' + LOCAL_PLAYER_ALIAS + ')');
    if (open > 0) return actName.substring(0, open) + ' (' + localName + ')';
    return actName;
  }

  /**
   * Writes the GCD columns into every combatant row, in place. A row nobody has recorded a GCD
   * for (pets, NPCs, a player who has not pressed anything yet) reads zeros and the 2.5s default,
   * exactly as the addon's export variables did.
   *
   * @param detail    one CombatData message: { Encounter, Combatant, isActive }
   * @param statsFor  (name) => stats, as GcdTracker.statsFor
   * @param localName the logging player's real name, or '' when unknown
   * @returns how many rows were written
   */
  function applyGcd(detail, statsFor, localName) {
    if (!detail || typeof detail !== 'object' || !detail.Combatant || typeof detail.Combatant !== 'object') return 0;

    let written = 0;
    for (const key of Object.keys(detail.Combatant)) {
      const c = detail.Combatant[key];
      if (!c || typeof c !== 'object') continue;

      const cols = columnsOf(statsFor(resolveName(key, localName)));
      c.gcdUptime = cols.gcdUptime;
      c.gcdCount = cols.gcdCount;
      c.gcdClip = cols.gcdClip;
      c.gcdOccupied = cols.gcdOccupied;
      c.gcdRecast = cols.gcdRecast;
      written++;
    }
    return written;
  }

  return { applyGcd, columnsOf, resolveName, format };
});

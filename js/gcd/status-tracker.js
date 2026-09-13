/**
 * Tracks "who currently has which status, applied by whom", fed from the raw FFXIV log lines.
 * Port of OverlayPluginAddon's StatusTracker.cs.
 *
 * The GCD tracker needs two things out of it: the haste statuses sitting on a player at the
 * moment they press a GCD (Ley Lines, Presence of Mind, Inspiration, ...), and which actors are
 * players at all, so mobs and pets stay out of the uptime table.
 *
 * Only statuses whose *source* is a player are recorded - every haste status is self-applied,
 * and a boss debuffing itself is nobody's business here.
 *
 * Field offsets below are the network status lines emitted by FFXIV_ACT_Plugin.
 *
 * Pure: no DOM, no globals. Browser: window.GcdStatusTracker. Node: require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GcdStatusTracker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 26|timestamp|statusId|statusName|duration|sourceId|sourceName|targetId|targetName|stacks|...
  // 30|timestamp|statusId|statusName|duration|sourceId|sourceName|targetId|targetName|stacks|...
  const FIELD_STATUS_ID = 2;
  const FIELD_SOURCE_ID = 5;
  const FIELD_SOURCE_NAME = 6;
  const FIELD_TARGET_ID = 7;
  const FIELD_TARGET_NAME = 8;
  const MIN_FIELDS = 9;

  /**
   * ACT renames the logging player's combatant to this, while the log lines keep using their
   * real character name. Everything keyed off a log line therefore lives under one name and
   * everything keyed off ACT lives under another, and without translating between them the
   * local player matches nothing anywhere.
   */
  const LOCAL_PLAYER_ALIAS = 'YOU';

  const HEX = /^[0-9a-fA-F]+$/;
  const hex = (s) => (typeof s === 'string' && HEX.test(s) ? parseInt(s, 16) : NaN);

  /**
   * Actor ids in the 0x1........ range are players; everything else (0x4........ and friends)
   * is an NPC/enemy.
   */
  const isPlayerId = (hexId) => typeof hexId === 'string' && hexId.length > 0 && hexId[0] === '1';

  class StatusTracker {
    constructor() {
      /** target name -> Map(statusId -> source name) */
      this.byTarget = new Map();
      /** Names positively identified as players, from actor ids in status, ability and AddCombatant lines. */
      this.players = new Set();
      this.appliesSeen = 0;
      this.removesSeen = 0;
      this.malformedLines = 0;
      /** Real character name of the player running ACT, from log line 02. */
      this.localPlayerName = null;
    }

    /** Handles a 02 ChangePrimaryPlayer line: 02|timestamp|actorId|actorName. */
    handlePrimaryPlayer(f) {
      if (f.length > 3 && f[3]) this.localPlayerName = f[3];
      if (f.length > 3) this.notePlayer(f[2], f[3]);
    }

    /**
     * Turns a name ACT gave us into the one the log lines use. Identity for everybody except the
     * logging player, and identity for them too if ACT is not aliasing.
     */
    resolve(actName) {
      if (!actName) return actName;
      if (this.localPlayerName === null) return actName;

      if (actName === LOCAL_PLAYER_ALIAS) return this.localPlayerName;

      // Pets carry the owner in brackets, and the owner is aliased the same way.
      const open = actName.indexOf(' (' + LOCAL_PLAYER_ALIAS + ')');
      if (open > 0) return actName.substring(0, open) + ' (' + this.localPlayerName + ')';

      return actName;
    }

    isPlayer(name) { return typeof name === 'string' && this.players.has(name); }

    /** Everyone positively identified as a player. Empty here explains an empty GCD table. */
    get knownPlayers() { return Array.from(this.players); }

    /**
     * Notes an actor as a player, from any line that carries an actor id. Ability lines are the
     * useful source: AddCombatant only fires on zone change, so a session that starts mid-instance
     * would otherwise never identify anybody.
     */
    notePlayer(hexId, name) {
      if (isPlayerId(hexId) && name) this.players.add(name);
    }

    clear() { this.byTarget.clear(); }

    /** Handles a 03 AddCombatant line, which names actors authoritatively. */
    handleAddCombatant(f) {
      // 03|timestamp|actorId|actorName|jobId|level|...
      if (f.length > 3 && isPlayerId(f[2]) && f[3]) this.players.add(f[3]);
    }

    /** Handles one 26 (apply) or 30 (remove) line. Returns false if it could not be parsed or was not a player's. */
    handleStatusLine(isApply, f) {
      if (f.length < MIN_FIELDS) { this.malformedLines++; return false; }

      const statusId = hex(f[FIELD_STATUS_ID]);
      if (!Number.isFinite(statusId)) { this.malformedLines++; return false; }

      const sourceName = f[FIELD_SOURCE_NAME];
      const targetName = f[FIELD_TARGET_NAME];
      if (!targetName) return false;

      if (isPlayerId(f[FIELD_TARGET_ID])) this.players.add(targetName);
      if (isPlayerId(f[FIELD_SOURCE_ID]) && sourceName) this.players.add(sourceName);

      // Only player-applied statuses matter here; haste is always self-applied.
      if (!isPlayerId(f[FIELD_SOURCE_ID])) return false;

      if (isApply) {
        this.appliesSeen++;
        let onTarget = this.byTarget.get(targetName);
        if (!onTarget) { onTarget = new Map(); this.byTarget.set(targetName, onTarget); }
        onTarget.set(statusId, sourceName);
      } else {
        this.removesSeen++;
        const onTarget = this.byTarget.get(targetName);
        if (onTarget) onTarget.delete(statusId);
      }
      return true;
    }

    /** Statuses currently active on the actor: [{ statusId, sourceName }]. Never null. */
    activeOn(actorName) {
      const onTarget = actorName ? this.byTarget.get(actorName) : undefined;
      if (!onTarget) return [];
      return Array.from(onTarget, ([statusId, sourceName]) => ({ statusId, sourceName }));
    }

    /** Death or removal wipes every status off the actor. */
    removeActor(name) {
      if (name) this.byTarget.delete(name);
    }
  }

  StatusTracker.isPlayerId = isPlayerId;
  StatusTracker.LOCAL_PLAYER_ALIAS = LOCAL_PLAYER_ALIAS;
  return StatusTracker;
});

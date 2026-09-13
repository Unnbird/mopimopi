/**
 * Tells a GCD (weaponskill or spell) apart from an oGCD (ability). Port of OverlayPluginAddon's
 * ActionCategories.cs.
 *
 * The addon read FFXIV_ACT_Plugin.Resource's embedded ActionCategoryList out of the ACT process.
 * A web page cannot, so the same table ships as a snapshot in js/gcd/action-categories-data.js
 * (tools/Build-ActionCategories.ps1): one character per action id, index = id, base-36 digit =
 * category. Category numbers are FFXIV's own, confirmed against known actions:
 *   1 auto-attack, 2 spell (GCD), 3 weaponskill (GCD), 4 ability (oGCD).
 *
 * Pure: no DOM, no globals. Browser: window.GcdActionCategories. Node: require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GcdActionCategories = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORY_AUTO_ATTACK = 1;
  const CATEGORY_SPELL = 2;
  const CATEGORY_WEAPONSKILL = 3;
  const CATEGORY_ABILITY = 4;

  class ActionCategories {
    constructor(table, source, generatedAt) {
      this.table = table;
      this.source = source;
      this.generatedAt = generatedAt;
      /** Null when the table loaded cleanly, otherwise why it did not. */
      this.loadError = null;
      /** Number of weaponskills and spells in the snapshot. */
      this.count = 0;
      this.spellCount = 0;
    }

    get available() { return this.loadError === null && this.count > 0; }

    /**
     * Whether the snapshot has a row for this id at all. An id past its end was added by a patch
     * after the snapshot was taken - the caller decides what to do with those.
     */
    knows(actionId) {
      return Number.isInteger(actionId) && actionId >= 0 && actionId < this.table.length;
    }

    /** FFXIV's ActionCategory for the id, 0 for none, -1 for an id the snapshot never heard of. */
    categoryOf(actionId) {
      if (!this.knows(actionId)) return -1;
      const c = parseInt(this.table[actionId], 36);
      return Number.isFinite(c) ? c : -1;
    }

    isGcd(actionId) {
      const c = this.categoryOf(actionId);
      return c === CATEGORY_SPELL || c === CATEGORY_WEAPONSKILL;
    }

    /**
     * True for a spell, false for a weaponskill. Decides which speed stat governs an action that
     * the recast table says nothing about - guessing skill speed for every unknown pools a
     * caster's whole rotation into the wrong distribution.
     */
    isSpell(actionId) { return this.categoryOf(actionId) === CATEGORY_SPELL; }
  }

  /** @param data the object js/gcd/action-categories-data.js exports: { source, generatedAt, table }. */
  function load(data) {
    const table = data && typeof data.table === 'string' ? data.table : '';
    const t = new ActionCategories(
      table,
      data && data.source ? String(data.source) : '',
      data && data.generatedAt ? String(data.generatedAt) : ''
    );

    if (!table) {
      t.loadError = 'action category table missing (js/gcd/action-categories-data.js not loaded)';
      return t;
    }

    for (let i = 0; i < table.length; i++) {
      const ch = table[i];
      if (ch === '2') { t.count++; t.spellCount++; }
      else if (ch === '3') { t.count++; }
    }

    if (t.count === 0) t.loadError = 'action category table parsed but held no weaponskills or spells';
    return t;
  }

  return { load, CATEGORY_AUTO_ATTACK, CATEGORY_SPELL, CATEGORY_WEAPONSKILL, CATEGORY_ABILITY };
});

import { isContractNode, isPersonNode } from './entity-types.js';

// ── Node and edge colours ────────────────────────────────────────────────────

export var NODE_COLOR = {
    org: '#3b82f6',
    orgStub: '#9ca3af',
    person: '#f97316',
    contract: '#10b981',
};

export var EDGE_COLOR = {
    Director:    '#1d4ed8',
    Shareholder: '#7c3aed',
    Official:    '#0891b2',
    Employment:  '#6b7280',
    Spouse:      '#f59e0b',
    Order:       '#10b981',
    Delivery:    '#10b981',
};

// Edge types hidden on initial render (legend checkboxes start unchecked).
// LegendState seeds its global and per-node Sets from this constant.
export var HIDDEN_BY_DEFAULT = new Set(['Official', 'Employment', 'Spouse']);

export function nodeColor(attrs) {
    if (isContractNode(attrs)) return NODE_COLOR.contract;
    if (isPersonNode(attrs)) return NODE_COLOR.person;
    if (attrs.expanded) return NODE_COLOR.org;
    return NODE_COLOR.orgStub;
}

// ── Size and weight helpers ──────────────────────────────────────────────────

/**
 * Returns the visual node size for an org based on its employee count.
 * @param {number} count  employee count (>= 1)
 * @returns {8|13|19|28}
 */
export function personelSize(count) {
    if (count >= 200) return 20;
    if (count >= 50)  return 15;
    if (count >= 10)  return 13;
    return 8;
}

/**
 * Returns the visual node size for a contract based on its value (EUR).
 * @param {number} verte
 * @returns {8|13|19}
 */
export function contractSize(verte) {
    if (verte >= 1_000_000) return 19;
    if (verte >= 100_000)   return 13;
    return 8;
}

/**
 * Returns the visual edge stroke width for a contract edge.
 * Minimum is always 1.
 * @param {number} verte
 * @returns {1|3|6}
 */
export function edgeWeight(verte) {
    if (verte >= 1_000_000) return 6;
    if (verte >= 100_000)   return 3;
    return 1;
}

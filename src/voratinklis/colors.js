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

// Edge types hidden on initial render (legend checkboxes start unchecked)
export var HIDDEN_BY_DEFAULT = new Set(['Official', 'Employment']);

// Mutable shared Set; legend.js mutates this on checkbox change;
// mergeGraphElements reads it at add time.
export var hiddenEdgeTypes = new Set(HIDDEN_BY_DEFAULT);

export function nodeColor(attrs) {
    if (attrs.entityType === 'ContractEntity') return NODE_COLOR.contract;
    if (attrs.entityType === 'PersonEntity') return NODE_COLOR.person;
    if (attrs.expanded) return NODE_COLOR.org;
    return NODE_COLOR.orgStub;
}

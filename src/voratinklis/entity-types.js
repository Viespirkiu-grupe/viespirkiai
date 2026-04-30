// ── Entity type constants and predicates ─────────────────────────────────────
// Single source of truth for entityType string values.
// Consumers should use predicates instead of comparing strings directly.

export const ENTITY_TYPE = {
    Org:      'OrganizationEntity',
    Person:   'PersonEntity',
    Contract: 'ContractEntity',
};

export const isOrgNode      = (a) => a.entityType === ENTITY_TYPE.Org;
export const isPersonNode   = (a) => a.entityType === ENTITY_TYPE.Person;
export const isContractNode = (a) => a.entityType === ENTITY_TYPE.Contract;

// Expanded org/person — always kept visible as a graph anchor.
export const isAnchorNode = (a) => a.expanded && !isContractNode(a);

// Nodes that get per-node legend configuration (not contracts).
export const isConfigurableNode = (a) => isOrgNode(a) || isPersonNode(a);

// ContractEntity nodes are the only bridge candidates in rebuildViewGraph.
export const isBridgeCandidate = (a) => isContractNode(a);

// ── Entity type constants and predicates ─────────────────────────────────────
// Single source of truth for entityType string values.
// Consumers should use predicates instead of comparing strings directly.

export const ENTITY_TYPE = {
    Org:         'OrganizationEntity',
    Person:      'PersonEntity',
    Contract:    'ContractEntity',
    Procurement: 'ProcurementEntity',
} as const;

export interface NodeAttrs {
    entityType?: string;
    expanded?: boolean;
    [key: string]: unknown;
}

export const isOrgNode          = (a: NodeAttrs): boolean => a.entityType === ENTITY_TYPE.Org;
export const isPersonNode       = (a: NodeAttrs): boolean => a.entityType === ENTITY_TYPE.Person;
export const isContractNode     = (a: NodeAttrs): boolean => a.entityType === ENTITY_TYPE.Contract;
export const isProcurementNode  = (a: NodeAttrs): boolean => a.entityType === ENTITY_TYPE.Procurement;

// Expanded org/person — always kept visible as a graph anchor.
export const isAnchorNode = (a: NodeAttrs): boolean => !!a.expanded && !isContractNode(a) && !isProcurementNode(a);

// Nodes that get per-node legend configuration (not contracts).
export const isConfigurableNode = (a: NodeAttrs): boolean => isOrgNode(a) || isPersonNode(a);

// ContractEntity nodes are the only bridge candidates in rebuildViewGraph.
export const isBridgeCandidate = (a: NodeAttrs): boolean => isContractNode(a);

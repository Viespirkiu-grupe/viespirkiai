// Pure hash-state module: no DOM reads; only writes window.location.hash.
// Encodes / decodes the active edge-type filter and expanded node set into the URL hash.

export const FILTER_CHAR_MAP = {
    D: 'Director', S: 'Shareholder', O: 'Official', E: 'Employment',
    U: 'Spouse', L: 'ContractSmall', M: 'ContractMedium', G: 'ContractLarge',
    P: 'Procurement', A: 'Award', B: 'Bidder', C: 'ContractProcurementLink',
};

export const FILTER_ID_MAP = Object.fromEntries(
    Object.entries(FILTER_CHAR_MAP).map(([k, v]) => [v, k])
);

const ENTITY_URL_MAP = {
    OrganizationEntity: { urlKey: 'asmuo',           idAttr: 'jarKodas' },
    ContractEntity:     { urlKey: 'sutartis',         idAttr: 'sutartiesUnikalusId' },
    ProcurementEntity:  { urlKey: 'viesiejiPirkimai', idAttr: 'pirkimoId' },
};

/**
 * Applies a filter char string to a single node in legendState.
 * Each char in FILTER_CHAR_MAP that appears in `chars` → visible; absent chars → hidden.
 * Initialises the node if not yet configured.
 *
 * @param {LegendState} legendState
 * @param {string}      nodeId
 * @param {string}      chars  e.g. "DSO"
 */
export function applyFilterChars(legendState, nodeId, chars) {
    legendState.initNode(nodeId);
    for (const [char, type] of Object.entries(FILTER_CHAR_MAP)) {
        legendState.setTypeVisible(nodeId, type, chars.includes(char));
    }
}

/**
 * Parses a URL hash string and applies its `filter=` segment to the primary node.
 * Returns additional entities (asmuo/sutartis/viesiejiPirkimai) encoded in the hash
 * for the caller to load sequentially.
 *
 * Entity type keys must be alphabetic; entity ID values must be numeric strings —
 * invalid keys/values are silently ignored.
 *
 * @param {LegendState} legendState
 * @param {string}      primaryNodeId
 * @param {string}      [hash]  defaults to window.location.hash in browser environments
 * @returns {{ additionalEntities: Array<{ entityType, entityId, filterChars, entityNumber }> }}
 */
export function applyFilterFromHash(legendState, primaryNodeId, hash) {
    const raw = hash !== undefined
        ? hash
        : (typeof window !== 'undefined' ? window.location.hash : '');
    if (!raw || raw === '#') return { additionalEntities: [] };

    const fragment = raw.startsWith('#') ? raw.slice(1) : raw;
    const params = new Map();
    for (const part of fragment.split('&')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
    }

    const primaryChars = params.get('filter');
    if (primaryChars !== undefined) {
        applyFilterChars(legendState, primaryNodeId, primaryChars);
    }

    const additionalEntities = [];
    for (const [key, value] of params) {
        if (key === 'filter' || key.startsWith('filter_')) continue;
        const underscore = key.lastIndexOf('_');
        if (underscore === -1) continue;
        const entityType = key.slice(0, underscore);
        const N = key.slice(underscore + 1);
        if (!/^[a-zA-Z]+$/.test(entityType)) continue;
        if (!/^[1-9]\d*$/.test(N)) continue;
        if (!/^\d+$/.test(value)) continue;
        additionalEntities.push({
            entityType,
            entityId: value,
            filterChars: params.get('filter_' + N) || '',
            entityNumber: Number(N),
        });
    }
    additionalEntities.sort((a, b) => a.entityNumber - b.entityNumber);
    return { additionalEntities };
}

/**
 * Builds the URL hash string representing the current filter state.
 * Pure function — does not write to window.
 *
 * @param {LegendState} legendState
 * @param {object}      dataGraph  graphology Graph instance
 * @returns {string}  e.g. "#filter=DSO&asmuo_2=110078992&filter_2=LMG"
 */
export function buildHashString(legendState, dataGraph) {
    const parts = [];
    const extras = [];
    let primaryId = null;

    dataGraph.forEachNode((id, attrs) => {
        if (attrs.isRoot && primaryId === null) primaryId = id;
    });

    if (primaryId && legendState.hasNodeConfig(primaryId)) {
        const chars = Object.entries(FILTER_CHAR_MAP)
            .filter(([, type]) => legendState.isTypeVisible(primaryId, type))
            .map(([char]) => char)
            .join('');
        parts.push('filter=' + chars);
    }

    dataGraph.forEachNode((id, attrs) => {
        if (id === primaryId || !legendState.hasNodeConfig(id)) return;
        const mapping = ENTITY_URL_MAP[attrs.entityType];
        if (!mapping) return;
        const entityId = attrs[mapping.idAttr];
        if (!entityId) return;
        extras.push({ id, mapping, entityId });
    });

    extras.forEach(({ id, mapping, entityId }, i) => {
        const N = i + 2;
        const chars = Object.entries(FILTER_CHAR_MAP)
            .filter(([, type]) => legendState.isTypeVisible(id, type))
            .map(([char]) => char)
            .join('');
        parts.push(mapping.urlKey + '_' + N + '=' + entityId);
        parts.push('filter_' + N + '=' + chars);
    });

    return parts.length ? '#' + parts.join('&') : '';
}

/**
 * Writes the current filter state to window.location.hash.
 * Returns the assembled hash string (useful for testing).
 *
 * @param {LegendState} legendState
 * @param {object}      dataGraph
 * @returns {string}
 */
export function updateHashFromFilter(legendState, dataGraph) {
    const h = buildHashString(legendState, dataGraph);
    if (typeof window !== 'undefined') {
        if (h) {
            window.location.hash = h;
        } else {
            history.replaceState(null, '', location.pathname + location.search);
        }
    }
    return h;
}

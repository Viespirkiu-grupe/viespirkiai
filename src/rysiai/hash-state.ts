// Pure hash-state module: no DOM reads; only writes window.location.hash.
// Encodes / decodes the active edge-type filter and expanded node set into the URL hash.

import type { LegendState } from './legend-state.ts';

export const FILTER_CHAR_MAP: Record<string, string> = {
    D: 'Director', S: 'Shareholder', O: 'Official', E: 'Employment',
    U: 'Spouse', L: 'ContractSmall', M: 'ContractMedium', G: 'ContractLarge',
    P: 'Procurement', A: 'Award', B: 'Bidder', C: 'ContractProcurementLink',
};

export const FILTER_ID_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(FILTER_CHAR_MAP).map(([k, v]) => [v, k])
);

const ENTITY_URL_MAP: Record<string, { urlKey: string; idAttr: string }> = {
    OrganizationEntity: { urlKey: 'asmuo',           idAttr: 'jarKodas' },
    ContractEntity:     { urlKey: 'sutartis',         idAttr: 'sutartiesUnikalusId' },
    ProcurementEntity:  { urlKey: 'viesiejiPirkimai', idAttr: 'pirkimoId' },
};

export interface AdditionalEntity {
    entityType: string;
    entityId: string;
    filterChars: string;
    entityNumber: number;
}

export function applyFilterChars(legendState: LegendState, nodeId: string, chars: string): void {
    legendState.initNode(nodeId);
    for (const [char, type] of Object.entries(FILTER_CHAR_MAP)) {
        legendState.setTypeVisible(nodeId, type, chars.includes(char));
    }
}

export function applyFilterFromHash(
    legendState: LegendState,
    primaryNodeId: string,
    hash?: string
): { additionalEntities: AdditionalEntity[] } {
    const raw = hash !== undefined
        ? hash
        : (typeof window !== 'undefined' ? window.location.hash : '');
    if (!raw || raw === '#') return { additionalEntities: [] };

    const fragment = raw.startsWith('#') ? raw.slice(1) : raw;
    const params = new Map<string, string>();
    for (const part of fragment.split('&')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
    }

    const primaryChars = params.get('filter');
    if (primaryChars !== undefined) {
        applyFilterChars(legendState, primaryNodeId, primaryChars);
    }

    const additionalEntities: AdditionalEntity[] = [];
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

export function buildHashString(legendState: LegendState, dataGraph: { forEachNode: (cb: (id: string, attrs: Record<string, unknown>) => void) => void }): string {
    const parts: string[] = [];
    const extras: Array<{ id: string; mapping: { urlKey: string; idAttr: string }; entityId: string }> = [];
    let primaryId: string | null = null;

    dataGraph.forEachNode((id, attrs) => {
        if (attrs.isRoot && primaryId === null) primaryId = id;
    });

    if (primaryId && legendState.hasNodeConfig(primaryId)) {
        const chars = Object.entries(FILTER_CHAR_MAP)
            .filter(([, type]) => legendState.isTypeVisible(primaryId!, type))
            .map(([char]) => char)
            .join('');
        parts.push('filter=' + chars);
    }

    dataGraph.forEachNode((id, attrs) => {
        if (id === primaryId || !legendState.hasNodeConfig(id)) return;
        const mapping = ENTITY_URL_MAP[attrs.entityType as string];
        if (!mapping) return;
        const entityId = attrs[mapping.idAttr];
        if (!entityId) return;
        extras.push({ id, mapping, entityId: String(entityId) });
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

export function updateHashFromFilter(legendState: LegendState, dataGraph: { forEachNode: (cb: (id: string, attrs: Record<string, unknown>) => void) => void }): string {
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

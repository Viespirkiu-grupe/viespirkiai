// Pure hash-state module: no DOM reads; only writes window.location.hash.
// Encodes / decodes the active edge-type filter and expanded node set into the URL hash.
//
// Hash format: #f=<chars>[&<typeKey>_<N>=<entityId>&f_<N>=<chars>...]
// Entity type keys: o=OrganizationEntity, c=ContractEntity, r=ProcurementEntity, p=PersonEntity
// PersonEntity entityId is base64(encodeURIComponent(vardas + ' ' + pavarde)).

import type { LegendState } from './legend-state.ts';

export const MAX_HASH_ENTITIES = 50;
export const MAX_HASH_LENGTH = 32000;

export const FILTER_CHAR_MAP: Record<string, string> = {
    D: 'Director', S: 'Shareholder', O: 'Official', E: 'Employment',
    U: 'Spouse', L: 'ContractSmall', M: 'ContractMedium', G: 'ContractLarge',
    P: 'Procurement', A: 'Award', B: 'Bidder', C: 'ContractProcurementLink',
};

export const FILTER_ID_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(FILTER_CHAR_MAP).map(([k, v]) => [v, k])
);

// Maps full entity type name → { key (single char), idAttr (node attribute for numeric ID) }
// PersonEntity has no idAttr — its ID is base64(encodeURIComponent(vardas + ' ' + pavarde)).
const ENTITY_TYPE_KEY_MAP: Record<string, { key: string; idAttr?: string }> = {
    OrganizationEntity: { key: 'o', idAttr: 'jarKodas' },
    ContractEntity:     { key: 'c', idAttr: 'sutartiesUnikalusId' },
    ProcurementEntity:  { key: 'r', idAttr: 'pirkimoId' },
    PersonEntity:       { key: 'p' },
};

// Reverse: single-char hash key → full entity type name
const KEY_TO_ENTITY_TYPE: Record<string, string> = Object.fromEntries(
    Object.entries(ENTITY_TYPE_KEY_MAP).map(([type, { key }]) => [key, type])
);

const _btoa: (s: string) => string =
    typeof btoa === 'function' ? btoa : (s) => Buffer.from(s, 'binary').toString('base64');
const _atob: (s: string) => string =
    typeof atob === 'function' ? atob : (s) => Buffer.from(s, 'base64').toString('binary');

// Encodes a person's full name to a URL-safe base64 string that survives Lithuanian characters.
function encodePersonId(fullName: string): string {
    return _btoa(encodeURIComponent(fullName));
}

function decodePersonId(encoded: string): string {
    try { return decodeURIComponent(_atob(encoded)); } catch { return ''; }
}

export interface AdditionalEntity {
    entityType: string;   // short hash key: 'o' | 'c' | 'r' | 'p'
    entityId: string;     // numeric string for o/c/r; decoded full name for p
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
    let raw = hash !== undefined
        ? hash
        : (typeof window !== 'undefined' ? window.location.hash : '');
    if (!raw || raw === '#') return { additionalEntities: [] };

    if (raw.length > MAX_HASH_LENGTH) {
        console.error(`hash-state: hash length ${raw.length} exceeds ${MAX_HASH_LENGTH}; truncating`);
        raw = raw.slice(0, MAX_HASH_LENGTH);
    }

    const fragment = raw.startsWith('#') ? raw.slice(1) : raw;
    const params = new Map<string, string>();
    for (const part of fragment.split('&')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
    }

    const primaryChars = params.get('f');
    if (primaryChars !== undefined) {
        applyFilterChars(legendState, primaryNodeId, primaryChars);
    }

    const additionalEntities: AdditionalEntity[] = [];
    for (const [key, value] of params) {
        if (key === 'f' || key.startsWith('f_')) continue;
        const underscore = key.lastIndexOf('_');
        if (underscore === -1) continue;
        const entityKey = key.slice(0, underscore);
        const N = key.slice(underscore + 1);
        if (!(entityKey in KEY_TO_ENTITY_TYPE)) continue;
        if (!/^[1-9]\d*$/.test(N)) continue;

        let entityId: string;
        if (entityKey === 'p') {
            if (!/^[A-Za-z0-9+\/=]+$/.test(value)) continue;
            entityId = decodePersonId(value);
            if (!entityId) continue;
        } else {
            if (!/^\d+$/.test(value)) continue;
            entityId = value;
        }

        additionalEntities.push({
            entityType: entityKey,
            entityId,
            filterChars: params.get('f_' + N) || '',
            entityNumber: Number(N),
        });
    }
    additionalEntities.sort((a, b) => a.entityNumber - b.entityNumber);
    if (additionalEntities.length > MAX_HASH_ENTITIES) {
        console.error(`hash-state: hash contains ${additionalEntities.length} additional entities; only the first ${MAX_HASH_ENTITIES} will be loaded`);
        additionalEntities.splice(MAX_HASH_ENTITIES);
    }
    return { additionalEntities };
}

export function buildHashString(
    legendState: LegendState,
    dataGraph: { forEachNode: (cb: (id: string, attrs: Record<string, unknown>) => void) => void }
): string {
    const parts: string[] = [];
    const extras: Array<{ id: string; typeKey: string; entityId: string }> = [];
    let primaryId: string | null = null;

    dataGraph.forEachNode((id, attrs) => {
        if (attrs.isRoot && primaryId === null) primaryId = id;
    });

    if (primaryId && legendState.hasNodeConfig(primaryId)) {
        const chars = Object.entries(FILTER_CHAR_MAP)
            .filter(([, type]) => legendState.isTypeVisible(primaryId!, type))
            .map(([char]) => char)
            .join('');
        parts.push('f=' + chars);
    }

    dataGraph.forEachNode((id, attrs) => {
        if (id === primaryId || !legendState.hasNodeConfig(id) || !attrs.expanded) return;
        const entityTypeName = attrs.entityType as string;
        const mapping = ENTITY_TYPE_KEY_MAP[entityTypeName];
        if (!mapping) return;

        let entityId: string;
        if (entityTypeName === 'PersonEntity') {
            const vardas = attrs.vardas as string | undefined;
            const pavarde = attrs.pavarde as string | undefined;
            if (!vardas || !pavarde) return;
            entityId = encodePersonId((vardas + ' ' + pavarde).trim());
        } else {
            if (!mapping.idAttr) return;
            const rawId = attrs[mapping.idAttr];
            if (!rawId) return;
            entityId = String(rawId);
        }
        extras.push({ id, typeKey: mapping.key, entityId });
    });

    if (extras.length > MAX_HASH_ENTITIES) {
        console.error(`hash-state: graph contains ${extras.length} additional expanded entities; only the first ${MAX_HASH_ENTITIES} will be added to the hash`);
        extras.splice(MAX_HASH_ENTITIES);
    }

    extras.forEach(({ id, typeKey, entityId }, i) => {
        const N = i + 2;
        const chars = Object.entries(FILTER_CHAR_MAP)
            .filter(([, type]) => legendState.isTypeVisible(id, type))
            .map(([char]) => char)
            .join('');
        parts.push(typeKey + '_' + N + '=' + entityId);
        parts.push('f_' + N + '=' + chars);
    });

    return parts.length ? '#' + parts.join('&') : '';
}

export function updateHashFromFilter(
    legendState: LegendState,
    dataGraph: { forEachNode: (cb: (id: string, attrs: Record<string, unknown>) => void) => void }
): string {
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

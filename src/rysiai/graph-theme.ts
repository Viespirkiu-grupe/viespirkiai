// Visual vocabulary for the graph — colors, sizes, weights, icons.
// All visual decisions for entity types live here.
// graph-utils.js uses these values to label graph data; renderers.js uses them to paint pixels.

import { isOrgNode, isPersonNode, isContractNode, isProcurementNode, type NodeAttrs } from './entity-types.ts';

// ── Node and edge colours ────────────────────────────────────────────────────

export const NODE_COLOR = {
    org: '#3b82f6',
    orgStub: '#9ca3af',
    person: '#f97316',
    contract: '#10b981',
    procurement: '#8b5cf6',
} as const;

export const EDGE_COLOR: Record<string, string> = {
    Director:                '#1d4ed8',
    Shareholder:             '#7c3aed',
    Official:                '#0891b2',
    Employment:              '#6b7280',
    Spouse:                  '#f59e0b',
    ContractSmall:           '#10b981',
    ContractMedium:          '#10b981',
    ContractLarge:           '#10b981',
    Procurement:             '#8b5cf6',
    Award:                   '#22c55e',
    Bidder:                  '#ef4444',
    ContractProcurementLink: '#94a3b8',
};

// Edge types hidden on initial render (legend checkboxes start unchecked).
// LegendState seeds its global and per-node Sets from this constant.
export const HIDDEN_BY_DEFAULT = new Set(['Official', 'Employment', 'Spouse']);

export function nodeColor(attrs: NodeAttrs): string {
    if (isContractNode(attrs))    return NODE_COLOR.contract;
    if (isProcurementNode(attrs)) return NODE_COLOR.procurement;
    if (isPersonNode(attrs))      return NODE_COLOR.person;
    if (attrs.expanded)           return NODE_COLOR.org;
    return NODE_COLOR.orgStub;
}

// ── Size and weight helpers ──────────────────────────────────────────────────

export function personelSize(count: number): 8 | 13 | 15 | 20 {
    if (count >= 200) return 20;
    if (count >= 50)  return 15;
    if (count >= 10)  return 13;
    return 8;
}

export function contractSize(verte: number): 8 | 13 | 19 {
    if (verte >= 1_000_000) return 19;
    if (verte >= 100_000)   return 13;
    return 8;
}

export function edgeWeight(verte: number): 1 | 3 | 6 {
    if (verte >= 1_000_000) return 6;
    if (verte >= 100_000)   return 3;
    return 1;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const MUI_ICON_PATHS: Record<string, string> = {
    // Business icon — PrivateCompany
    PrivateCompany: 'M12 7V3H2v18h20V7zM6 19H4v-2h2zm0-4H4v-2h2zm0-4H4V9h2zm0-4H4V5h2zm4 12H8v-2h2zm0-4H8v-2h2zm0-4H8V9h2zm0-4H8V5h2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8zm-2-8h-2v2h2zm0 4h-2v2h2z',
    // DomainAdd icon — PublicCompany
    PublicCompany: 'M12 7V3H2v18h14v-2h-4v-2h2v-2h-2v-2h2v-2h-2V9h8v6h2V7zM6 19H4v-2h2zm0-4H4v-2h2zm0-4H4V9h2zm0-4H4V5h2zm4 12H8v-2h2zm0-4H8v-2h2zm0-4H8V9h2zm0-4H8V5h2zm14 12v2h-2v2h-2v-2h-2v-2h2v-2h2v2zm-6-8h-2v2h2zm0 4h-2v2h2z',
    // AccountBalance icon — Institution
    Institution: 'M4 10h3v7H4zm6.5 0h3v7h-3zM2 19h20v3H2zm15-9h3v7h-3zm-5-9L2 6v2h20V6z',
    // Person icon — Person
    Person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
    // HistoryEdu icon — Contract and Procurement (shared)
    Contract: 'M9 4v1.38c-.83-.33-1.72-.5-2.61-.5-1.79 0-3.58.68-4.95 2.05l3.33 3.33h1.11v1.11c.86.86 1.98 1.31 3.11 1.36V15H6v3c0 1.1.9 2 2 2h10c1.66 0 3-1.34 3-3V4zm-1.11 6.41V8.26H5.61L4.57 7.22a5.07 5.07 0 0 1 1.82-.34c1.34 0 2.59.52 3.54 1.46l1.41 1.41-.2.2c-.51.51-1.19.8-1.92.8-.47 0-.93-.12-1.33-.34M19 17c0 .55-.45 1-1 1s-1-.45-1-1v-2h-6v-2.59c.57-.23 1.1-.57 1.56-1.03l.2-.2L15.59 14H17v-1.41l-6-5.97V6h8z',
    // Hub icon — Expand button
    Hub: 'M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
    // Adjust icon — Collapse button
    Adjust: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5m-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11z',
};

// btoa polyfill for Node.js test environment
const _btoa = typeof btoa === 'function' ? btoa : (s: string) => Buffer.from(s).toString('base64');

export function makeIconDataUri(nodeType: string): string {
    const path = MUI_ICON_PATHS[nodeType];
    if (!path) return '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><path fill="white" d="' + path + '"/></svg>';
    return 'data:image/svg+xml;base64,' + _btoa(svg);
}

export function svgIcon(key: string): string {
    const path = MUI_ICON_PATHS[key];
    if (!path) return '';
    return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
}

export function getIconKey(attrs: NodeAttrs): string {
    if (isOrgNode(attrs)) return (attrs.orgType as string) || 'PrivateCompany';
    if (isPersonNode(attrs)) return 'Person';
    if (isContractNode(attrs) || isProcurementNode(attrs)) return 'Contract';
    return '';
}

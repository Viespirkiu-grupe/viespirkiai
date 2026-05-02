import { isOrgNode, isPersonNode, isContractNode, isProcurementNode } from './entity-types.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

const MUI_ICON_PATHS = {
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
    Hub: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    // Adjust icon — Collapse button
    Adjust: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5m-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11z',
};

// btoa polyfill for Node.js test environment
const _btoa = typeof btoa === 'function' ? btoa : (s) => Buffer.from(s).toString('base64');

export function makeIconDataUri(nodeType) {
    const path = MUI_ICON_PATHS[nodeType];
    if (!path) return '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><path fill="white" d="' + path + '"/></svg>';
    return 'data:image/svg+xml;base64,' + _btoa(svg);
}

/**
 * Returns the inline SVG HTML string for a given icon key.
 * Used for small inline icons (e.g., expand/collapse buttons).
 * @param {string} key
 * @returns {string}
 */
export function svgIcon(key) {
    const path = MUI_ICON_PATHS[key];
    if (!path) return '';
    return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
}

export function getIconKey(attrs) {
    if (isOrgNode(attrs)) return attrs.orgType || 'PrivateCompany';
    if (isPersonNode(attrs)) return 'Person';
    if (isContractNode(attrs) || isProcurementNode(attrs)) return 'Contract';
    return '';
}

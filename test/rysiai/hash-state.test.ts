import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';
import { LegendState } from '@/src/rysiai/legend-state.ts';
import {
    FILTER_CHAR_MAP, FILTER_ID_MAP,
    applyFilterChars, applyFilterFromHash, buildHashString,
    MAX_HASH_ENTITIES, MAX_HASH_LENGTH,
} from '@/src/rysiai/hash-state.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeGraph(...nodes: [string, Record<string, unknown>][]): Graph {
    const g = new Graph({ type: 'directed', multi: true });
    for (const [id, attrs] of nodes) g.addNode(id, attrs);
    return g;
}

function rootOrgAttrs(jarKodas: string): Record<string, unknown> {
    return { entityType: 'OrganizationEntity', jarKodas, isRoot: true, expanded: true };
}

function extraOrgAttrs(jarKodas: string): Record<string, unknown> {
    return { entityType: 'OrganizationEntity', jarKodas, isRoot: false, expanded: true };
}

function rootContractAttrs(sutartiesUnikalusId: string): Record<string, unknown> {
    return { entityType: 'ContractEntity', sutartiesUnikalusId, isRoot: true, expanded: true };
}

function rootProcurementAttrs(pirkimoId: string): Record<string, unknown> {
    return { entityType: 'ProcurementEntity', pirkimoId, isRoot: true, expanded: true };
}

function extraContractAttrs(sutartiesUnikalusId: string): Record<string, unknown> {
    return { entityType: 'ContractEntity', sutartiesUnikalusId, isRoot: false, expanded: true };
}

function extraPersonAttrs(vardas: string, pavarde: string): Record<string, unknown> {
    return { entityType: 'PersonEntity', vardas, pavarde, isRoot: false, expanded: true };
}

// Computes the base64 entity ID the same way buildHashString does, for test assertions.
function personB64(vardas: string, pavarde: string): string {
    const fullName = (vardas + ' ' + pavarde).trim();
    const encoded = encodeURIComponent(fullName);
    return Buffer.from(encoded, 'binary').toString('base64');
}

// ── FILTER_CHAR_MAP / FILTER_ID_MAP ───────────────────────────────────────────

describe('FILTER_CHAR_MAP / FILTER_ID_MAP', () => {
    it('has exactly 12 entries', () => {
        assert.equal(Object.keys(FILTER_CHAR_MAP).length, 12);
    });

    it('FILTER_ID_MAP is the inverse of FILTER_CHAR_MAP', () => {
        for (const [char, type] of Object.entries(FILTER_CHAR_MAP)) {
            assert.equal(FILTER_ID_MAP[type], char, `FILTER_ID_MAP[${type}] should be '${char}'`);
        }
        assert.equal(Object.keys(FILTER_ID_MAP).length, 12);
    });
});

// ── applyFilterChars ──────────────────────────────────────────────────────────

describe('applyFilterChars', () => {
    it('sets Director/Shareholder/Official visible and everything else hidden for "DSO"', () => {
        const state = new LegendState();
        applyFilterChars(state, 'org:1', 'DSO');
        assert.equal(state.isTypeVisible('org:1', 'Director'),                true);
        assert.equal(state.isTypeVisible('org:1', 'Shareholder'),             true);
        assert.equal(state.isTypeVisible('org:1', 'Official'),                true);
        assert.equal(state.isTypeVisible('org:1', 'Employment'),              false);
        assert.equal(state.isTypeVisible('org:1', 'Spouse'),                  false);
        assert.equal(state.isTypeVisible('org:1', 'ContractSmall'),           false);
        assert.equal(state.isTypeVisible('org:1', 'ContractMedium'),          false);
        assert.equal(state.isTypeVisible('org:1', 'ContractLarge'),           false);
        assert.equal(state.isTypeVisible('org:1', 'Procurement'),             false);
        assert.equal(state.isTypeVisible('org:1', 'Award'),                   false);
        assert.equal(state.isTypeVisible('org:1', 'Bidder'),                  false);
        assert.equal(state.isTypeVisible('org:1', 'ContractProcurementLink'), false);
    });

    it('hides all types for empty string', () => {
        const state = new LegendState();
        applyFilterChars(state, 'org:1', '');
        for (const type of Object.values(FILTER_CHAR_MAP)) {
            assert.equal(state.isTypeVisible('org:1', type), false, `${type} should be hidden`);
        }
    });

    it('makes all types visible when all chars are provided', () => {
        const state = new LegendState();
        const allChars = Object.keys(FILTER_CHAR_MAP).join('');
        applyFilterChars(state, 'org:1', allChars);
        for (const type of Object.values(FILTER_CHAR_MAP)) {
            assert.equal(state.isTypeVisible('org:1', type), true, `${type} should be visible`);
        }
    });

    it('initialises the node if not yet configured', () => {
        const state = new LegendState();
        assert.equal(state.hasNodeConfig('org:1'), false);
        applyFilterChars(state, 'org:1', 'D');
        assert.equal(state.hasNodeConfig('org:1'), true);
    });

    it('per-node state is independent of other nodes', () => {
        const state = new LegendState();
        applyFilterChars(state, 'org:1', 'DSO');
        applyFilterChars(state, 'org:2', 'E');
        assert.equal(state.isTypeVisible('org:1', 'Director'),   true);
        assert.equal(state.isTypeVisible('org:1', 'Employment'),  false);
        assert.equal(state.isTypeVisible('org:2', 'Employment'),  true);
        assert.equal(state.isTypeVisible('org:2', 'Director'),    false);
    });
});

// ── applyFilterFromHash ───────────────────────────────────────────────────────

describe('applyFilterFromHash', () => {
    it('returns empty additionalEntities for empty string', () => {
        const state = new LegendState();
        const result = applyFilterFromHash(state, 'org:1', '');
        assert.deepEqual(result, { additionalEntities: [] });
        assert.equal(state.hasNodeConfig('org:1'), false);
    });

    it('returns empty additionalEntities for bare "#"', () => {
        const state = new LegendState();
        const result = applyFilterFromHash(state, 'org:1', '#');
        assert.deepEqual(result, { additionalEntities: [] });
    });

    it('leaves legendState unchanged when hash contains no filter key', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#somekey=value');
        assert.equal(state.hasNodeConfig('org:1'), false);
    });

    it('applies f=DSO: Director/Shareholder/Official visible, rest hidden', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#f=DSO');
        assert.equal(state.isTypeVisible('org:1', 'Director'),    true);
        assert.equal(state.isTypeVisible('org:1', 'Shareholder'), true);
        assert.equal(state.isTypeVisible('org:1', 'Official'),    true);
        assert.equal(state.isTypeVisible('org:1', 'Employment'),  false);
        assert.equal(state.isTypeVisible('org:1', 'ContractSmall'), false);
        assert.equal(state.isTypeVisible('org:1', 'Procurement'), false);
    });

    it('applies f= (empty): all types hidden', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#f=');
        for (const type of Object.values(FILTER_CHAR_MAP)) {
            assert.equal(state.isTypeVisible('org:1', type), false, `${type} should be hidden`);
        }
    });

    it('parses a single additional org entity', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DSO&o_2=110078992&f_2=LMG',
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityType, 'o');
        assert.equal(additionalEntities[0].entityId, '110078992');
        assert.equal(additionalEntities[0].filterChars, 'LMG');
        assert.equal(additionalEntities[0].entityNumber, 2);
    });

    it('parses multiple additional entities and returns them sorted by entityNumber', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DSOELM&c_2=2008083561&f_2=LG&o_3=110055123&f_3=DS',
        );
        assert.equal(additionalEntities.length, 2);
        assert.equal(additionalEntities[0].entityNumber, 2);
        assert.equal(additionalEntities[0].entityType, 'c');
        assert.equal(additionalEntities[0].entityId, '2008083561');
        assert.equal(additionalEntities[0].filterChars, 'LG');
        assert.equal(additionalEntities[1].entityNumber, 3);
        assert.equal(additionalEntities[1].entityType, 'o');
        assert.equal(additionalEntities[1].filterChars, 'DS');
    });

    it('parses procurement (r) entity type', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DS&r_2=474742&f_2=PA',
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityType, 'r');
        assert.equal(additionalEntities[0].entityId, '474742');
    });

    it('returns empty filterChars when f_N key is absent', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#o_2=110078992',
        );
        assert.equal(additionalEntities[0].filterChars, '');
    });

    it('parses a PersonEntity (p) entity: decodes base64 to full name', () => {
        const state = new LegendState();
        const b64 = personB64('Jonas', 'Jonaitis');
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            `#f=DS&p_2=${b64}&f_2=D`,
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityType, 'p');
        assert.equal(additionalEntities[0].entityId, 'Jonas Jonaitis');
        assert.equal(additionalEntities[0].filterChars, 'D');
        assert.equal(additionalEntities[0].entityNumber, 2);
    });

    it('parses PersonEntity with Lithuanian characters in name', () => {
        const state = new LegendState();
        const b64 = personB64('Jūratė', 'Šimkūnienė');
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            `#f=D&p_2=${b64}&f_2=S`,
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityId, 'Jūratė Šimkūnienė');
    });

    it('silently ignores unknown entity type keys', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DS&x_2=110078992&f_2=LMG',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('silently ignores entity type keys with non-alphabetic characters', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DS&1nvalid_2=110078992&f_2=LMG',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('silently ignores non-numeric entity IDs for o/c/r types', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DS&o_2=abc123&f_2=LMG',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('silently ignores invalid base64 for p type', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DS&p_2=not-valid-base64!&f_2=D',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('silently ignores N=0', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#o_0=110078992&f_0=LMG',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('does not modify legendState for invalid entity entries', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#1bad_2=abc&f_2=DS');
        assert.equal(state.hasNodeConfig('org:1'), false);
    });
});

// ── buildHashString ───────────────────────────────────────────────────────────

describe('buildHashString', () => {
    it('returns empty string when no nodes are configured', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:123', rootOrgAttrs('123')]);
        assert.equal(buildHashString(state, graph), '');
    });

    it('builds #f= for an all-hidden configuration', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:123', rootOrgAttrs('123')]);
        applyFilterChars(state, 'org:123', '');
        const h = buildHashString(state, graph);
        assert.equal(h, '#f=');
    });

    it('round-trips f=DSO', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:123', rootOrgAttrs('123')]);
        applyFilterFromHash(state, 'org:123', '#f=DSO');
        assert.equal(buildHashString(state, graph), '#f=DSO');
    });

    it('round-trips f=DSLMGPABC (default-visible types)', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:123', rootOrgAttrs('123')]);
        applyFilterFromHash(state, 'org:123', '#f=DSLMGPABC');
        assert.equal(buildHashString(state, graph), '#f=DSLMGPABC');
    });

    it('emits chars in FILTER_CHAR_MAP insertion order', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:1', rootOrgAttrs('1')]);
        applyFilterChars(state, 'org:1', 'GLD'); // out-of-order input
        const h = buildHashString(state, graph);
        assert.ok(h.includes('f='), h);
        const chars = h.replace('#f=', '');
        const charOrder = Object.keys(FILTER_CHAR_MAP);
        const indices = chars.split('').map((c) => charOrder.indexOf(c));
        assert.deepEqual(indices, [...indices].sort((a, b) => a - b), 'chars not in insertion order');
    });

    it('round-trips contract entity type', () => {
        const state = new LegendState();
        const graph = makeGraph(['contract:2008083561', rootContractAttrs('2008083561')]);
        applyFilterFromHash(state, 'contract:2008083561', '#f=LG');
        assert.equal(buildHashString(state, graph), '#f=LG');
    });

    it('round-trips procurement entity type', () => {
        const state = new LegendState();
        const graph = makeGraph(['procurement:474742', rootProcurementAttrs('474742')]);
        applyFilterFromHash(state, 'procurement:474742', '#f=PA');
        assert.equal(buildHashString(state, graph), '#f=PA');
    });

    it('round-trips multi-entity hash with org secondary node', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:111', rootOrgAttrs('111')],
            ['org:222', extraOrgAttrs('222')],
        );
        applyFilterFromHash(state, 'org:111', '#f=DSO&o_2=222&f_2=LMG');
        applyFilterChars(state, 'org:222', 'LMG');
        const h = buildHashString(state, graph);
        assert.ok(h.startsWith('#f=DSO'), `primary filter: ${h}`);
        assert.ok(h.includes('o_2=222'), `secondary entity: ${h}`);
        assert.ok(h.includes('f_2=LMG'), `secondary filter: ${h}`);
    });

    it('secondary node gets N=2 starting from first non-root configured node', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:1', rootOrgAttrs('1')],
            ['org:2', extraOrgAttrs('2')],
        );
        applyFilterChars(state, 'org:1', 'D');
        applyFilterChars(state, 'org:2', 'S');
        const h = buildHashString(state, graph);
        assert.ok(h.includes('o_2=2'), h);
        assert.ok(h.includes('f_2=S'), h);
    });

    it('skips extra nodes that lack required idAttr', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:1', rootOrgAttrs('1')],
            ['org:bad', { entityType: 'OrganizationEntity', isRoot: false, expanded: true }], // no jarKodas
        );
        applyFilterChars(state, 'org:1', 'D');
        applyFilterChars(state, 'org:bad', 'S');
        const h = buildHashString(state, graph);
        assert.ok(!h.includes('o_2'), `org without jarKodas should be skipped: ${h}`);
    });

    it('uses first-encountered isRoot node as primary when multiple nodes have isRoot=true', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:111', rootOrgAttrs('111')],
            ['contract:999', rootContractAttrs('999')],
        );
        applyFilterChars(state, 'org:111', 'DS');
        applyFilterChars(state, 'contract:999', 'DSLMGPABC');
        const h = buildHashString(state, graph);
        assert.ok(h.startsWith('#f=DS'), `primary should be org:111, not contract: ${h}`);
        assert.ok(h.includes('c_2=999'), `contract should be secondary: ${h}`);
        assert.ok(h.includes('f_2=DSLMGPABC'), `contract filter: ${h}`);
    });

    it('includes contract secondary node (isRoot=false) with all filters in hash', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:190011232', rootOrgAttrs('190011232')],
            ['org:121215434', extraOrgAttrs('121215434')],
            ['contract:1675917562', extraContractAttrs('1675917562')],
        );
        applyFilterChars(state, 'org:190011232', '');
        applyFilterChars(state, 'org:121215434', '');
        applyFilterChars(state, 'contract:1675917562', 'DSLMGPABC');
        const h = buildHashString(state, graph);
        assert.equal(h, '#f=&o_2=121215434&f_2=&c_3=1675917562&f_3=DSLMGPABC');
    });

    it('includes PersonEntity secondary node as p_N=base64 in hash', () => {
        const state = new LegendState();
        const b64 = personB64('Jonas', 'Jonaitis');
        const graph = makeGraph(
            ['org:1', rootOrgAttrs('1')],
            ['person:jonas jonaitis', extraPersonAttrs('Jonas', 'Jonaitis')],
        );
        applyFilterChars(state, 'org:1', 'D');
        applyFilterChars(state, 'person:jonas jonaitis', 'S');
        const h = buildHashString(state, graph);
        assert.ok(h.startsWith('#f=D'), `primary filter: ${h}`);
        assert.ok(h.includes(`p_2=${b64}`), `person entity: ${h}`);
        assert.ok(h.includes('f_2=S'), `person filter: ${h}`);
    });

    it('skips PersonEntity node without vardas or pavarde', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:1', rootOrgAttrs('1')],
            ['person:unknown', { entityType: 'PersonEntity', isRoot: false, expanded: true }], // no vardas/pavarde
        );
        applyFilterChars(state, 'org:1', 'D');
        applyFilterChars(state, 'person:unknown', 'S');
        const h = buildHashString(state, graph);
        assert.ok(!h.includes('p_2='), `person without vardas/pavarde should be skipped: ${h}`);
    });

    it('includes contract secondary even when it also has isRoot=true', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:190011232', rootOrgAttrs('190011232')],
            ['org:121215434', extraOrgAttrs('121215434')],
            ['contract:1675917562', rootContractAttrs('1675917562')], // isRoot:true but not first
        );
        applyFilterChars(state, 'org:190011232', '');
        applyFilterChars(state, 'org:121215434', '');
        applyFilterChars(state, 'contract:1675917562', 'DSLMGPABC');
        const h = buildHashString(state, graph);
        assert.ok(h.startsWith('#f='), `org:190011232 must be primary: ${h}`);
        assert.ok(h.includes('c_2=') || h.includes('c_3='), `contract must appear in hash: ${h}`);
        assert.ok(!h.includes('o_2=190011232'), `primary org must not appear as secondary: ${h}`);
    });

    it('collapsed node (expanded:false) is excluded from hash even if legendState has config', () => {
        // Simulates: person expanded from hash → user clicks collapse → expanded becomes false
        const state = new LegendState();
        const graph = makeGraph(
            ['org:100', { entityType: 'OrganizationEntity', jarKodas: '100', isRoot: true, expanded: true }],
            ['person:alenas bulauskis', { entityType: 'PersonEntity', vardas: 'Alenas', pavarde: 'Bulauskis', isRoot: false, expanded: false }],
        );
        applyFilterChars(state, 'org:100', 'DS');
        applyFilterChars(state, 'person:alenas bulauskis', 'DSEULMGPABC'); // was expanded, has config
        const h = buildHashString(state, graph);
        assert.ok(!h.includes('p_'), `collapsed person must not appear in hash: ${h}`);
        assert.equal(h, '#f=DS', `hash must only contain primary filter: ${h}`);
    });

    it('collapsed org node (expanded:false) is excluded from hash', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:100', { entityType: 'OrganizationEntity', jarKodas: '100', isRoot: true, expanded: true }],
            ['org:200', { entityType: 'OrganizationEntity', jarKodas: '200', isRoot: false, expanded: false }],
        );
        applyFilterChars(state, 'org:100', 'DS');
        applyFilterChars(state, 'org:200', 'LMG');
        const h = buildHashString(state, graph);
        assert.equal(h, '#f=DS', `collapsed org must not appear in hash: ${h}`);
    });
});

// ── applyFilterFromHash + buildHashString round-trip ─────────────────────────

describe('round-trip: applyFilterFromHash → buildHashString', () => {
    const cases = [
        '#f=DSO',
        '#f=',
        '#f=DSLMGPABC',
        '#f=DSOEU',
    ];

    for (const hash of cases) {
        it(`round-trips "${hash}"`, () => {
            const state = new LegendState();
            const graph = makeGraph(['org:1', rootOrgAttrs('1')]);
            applyFilterFromHash(state, 'org:1', hash);
            assert.equal(buildHashString(state, graph), hash);
        });
    }

    it('round-trips full sutartis-link hash: empty filters for orgs, full filter for contract secondary', () => {
        const hash = '#f=&o_2=121215434&f_2=&c_3=1675917562&f_3=DSLMGPABC';
        const state = new LegendState();
        const graph = makeGraph(
            ['org:190011232', rootOrgAttrs('190011232')],
            ['org:121215434', extraOrgAttrs('121215434')],
            ['contract:1675917562', extraContractAttrs('1675917562')],
        );
        const { additionalEntities } = applyFilterFromHash(state, 'org:190011232', hash);
        for (const extra of additionalEntities) {
            const nodeId = extra.entityType === 'o'    ? 'org:' + extra.entityId
                         : extra.entityType === 'c'    ? 'contract:' + extra.entityId
                         : extra.entityType === 'r'    ? 'procurement:' + extra.entityId
                         : 'person:' + extra.entityId.toLowerCase().trim();
            applyFilterChars(state, nodeId, extra.filterChars);
        }
        assert.equal(buildHashString(state, graph), hash);
    });

    it('round-trips PersonEntity hash', () => {
        const state = new LegendState();
        const b64 = personB64('Jonas', 'Jonaitis');
        const hash = `#f=D&p_2=${b64}&f_2=S`;
        const graph = makeGraph(
            ['org:1', rootOrgAttrs('1')],
            ['person:jonas jonaitis', extraPersonAttrs('Jonas', 'Jonaitis')],
        );
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', hash);
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityType, 'p');
        assert.equal(additionalEntities[0].entityId, 'Jonas Jonaitis');
        applyFilterChars(state, 'person:jonas jonaitis', additionalEntities[0].filterChars);
        assert.equal(buildHashString(state, graph), hash);
    });

    it('round-trips PersonEntity with Lithuanian characters', () => {
        const state = new LegendState();
        const b64 = personB64('Jūratė', 'Šimkūnienė');
        const hash = `#f=D&p_2=${b64}&f_2=E`;
        const graph = makeGraph(
            ['org:1', rootOrgAttrs('1')],
            ['person:jūratė šimkūnienė', extraPersonAttrs('Jūratė', 'Šimkūnienė')],
        );
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', hash);
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityId, 'Jūratė Šimkūnienė');
        applyFilterChars(state, 'person:jūratė šimkūnienė', additionalEntities[0].filterChars);
        assert.equal(buildHashString(state, graph), hash);
    });
});

// ── Unhappy path: malformed and adversarial hash inputs ───────────────────────

describe('applyFilterFromHash — malformed / adversarial inputs', () => {
    it('ignores keys with no = sign', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#fDSO');
        assert.equal(additionalEntities.length, 0);
        assert.equal(state.hasNodeConfig('org:1'), false);
    });

    it('treats unknown single-segment keys as no-ops', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#unknown=value');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys with numeric characters in the type part', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#o2_2=123&f_2=DS');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys with underscore but empty type', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#_2=123');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys with N=0 (zero not a valid entity number)', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#o_0=123&f_0=DS');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys with negative N', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#o_-1=123');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys where entityId contains non-numeric characters for o/c/r types', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#o_2=abc');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys where entityId is empty string', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#o_2=');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores p entity with non-base64 entityId', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#p_2=not-valid-base64!&f_2=D');
        assert.equal(additionalEntities.length, 0);
    });

    it('still applies primary filter when additional entities are invalid', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#f=DS&1bad_2=abc&f_2=LMG',
        );
        assert.equal(additionalEntities.length, 0);
        assert.equal(state.isTypeVisible('org:1', 'Director'), true);
        assert.equal(state.isTypeVisible('org:1', 'Shareholder'), true);
        assert.equal(state.isTypeVisible('org:1', 'Employment'), false);
    });

    it('ignores filter chars that are not in FILTER_CHAR_MAP (unknown chars are no-ops)', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#f=DXZ9');
        assert.equal(state.isTypeVisible('org:1', 'Director'), true);
        assert.equal(state.isTypeVisible('org:1', 'Shareholder'), false); // S not in filter
    });

    it('handles a hash with only f_ keys (no entity keys)', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#f_2=LMG');
        assert.equal(additionalEntities.length, 0);
    });

    it('handles duplicate entity keys gracefully (last value wins via Map)', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#o_2=111&o_2=222&f_2=DS',
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityId, '222');
    });

    it('returns entities sorted by entityNumber even when hash order differs', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#o_3=333&f_3=D&o_2=222&f_2=S',
        );
        assert.equal(additionalEntities[0].entityNumber, 2);
        assert.equal(additionalEntities[1].entityNumber, 3);
    });

    it('handles URL-encoded entity IDs that are numeric after decoding', () => {
        const state = new LegendState();
        // %31%31%30 decodes to "110"
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#o_2=%31%31%30&f_2=DS',
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityId, '110');
    });
});

// ── 50-entry limits ───────────────────────────────────────────────────────────

describe('50-entry limit: applyFilterFromHash', () => {
    function buildHashWith(count: number): string {
        const parts = ['f=D'];
        for (let i = 2; i <= count + 1; i++) {
            parts.push(`o_${i}=${1000000 + i}`);
            parts.push(`f_${i}=D`);
        }
        return '#' + parts.join('&');
    }

    it('loads exactly MAX_HASH_ENTITIES additional entities when hash has exactly that many', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', buildHashWith(MAX_HASH_ENTITIES));
        assert.equal(additionalEntities.length, MAX_HASH_ENTITIES);
    });

    it('caps at MAX_HASH_ENTITIES and logs console.error when hash has one more', () => {
        const state = new LegendState();
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...args: unknown[]) => errors.push(String(args[0]));
        try {
            const { additionalEntities } = applyFilterFromHash(state, 'org:1', buildHashWith(MAX_HASH_ENTITIES + 1));
            assert.equal(additionalEntities.length, MAX_HASH_ENTITIES);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].includes(String(MAX_HASH_ENTITIES + 1)), `error should mention count: ${errors[0]}`);
        } finally {
            console.error = orig;
        }
    });

    it('caps at MAX_HASH_ENTITIES when hash has double that many entities', () => {
        const state = new LegendState();
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...args: unknown[]) => errors.push(String(args[0]));
        try {
            const { additionalEntities } = applyFilterFromHash(state, 'org:1', buildHashWith(MAX_HASH_ENTITIES * 2));
            assert.equal(additionalEntities.length, MAX_HASH_ENTITIES);
            assert.equal(errors.length, 1);
        } finally {
            console.error = orig;
        }
    });
});

describe('MAX_HASH_LENGTH: applyFilterFromHash', () => {
    it('processes hash at exactly MAX_HASH_LENGTH without truncation', () => {
        const state = new LegendState();
        const base = '#f=D';
        const padding = '&' + 'x'.repeat(MAX_HASH_LENGTH - base.length - 1);
        const hash = base + padding;
        assert.equal(hash.length, MAX_HASH_LENGTH);
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...args: unknown[]) => errors.push(String(args[0]));
        try {
            applyFilterFromHash(state, 'org:1', hash);
            assert.equal(errors.length, 0);
            assert.equal(state.isTypeVisible('org:1', 'Director'), true);
        } finally {
            console.error = orig;
        }
    });

    it('truncates and logs console.error when hash exceeds MAX_HASH_LENGTH', () => {
        const state = new LegendState();
        const hash = '#f=D' + 'x'.repeat(MAX_HASH_LENGTH);
        assert.ok(hash.length > MAX_HASH_LENGTH);
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...args: unknown[]) => errors.push(String(args[0]));
        try {
            applyFilterFromHash(state, 'org:1', hash);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].includes(String(MAX_HASH_LENGTH)), `error should mention limit: ${errors[0]}`);
            assert.equal(state.isTypeVisible('org:1', 'Director'), true);
        } finally {
            console.error = orig;
        }
    });

    it('does not parse entities that appear after MAX_HASH_LENGTH cutoff', () => {
        const state = new LegendState();
        // Place a valid entity just past the cutoff
        const prefix = '#f=D' + '&'.padEnd(MAX_HASH_LENGTH - 5, 'x');
        const suffix = '&o_2=999999&f_2=S';
        const hash = prefix + suffix;
        assert.ok(hash.length > MAX_HASH_LENGTH);
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...args: unknown[]) => errors.push(String(args[0]));
        try {
            const { additionalEntities } = applyFilterFromHash(state, 'org:1', hash);
            assert.equal(additionalEntities.length, 0, 'entity past cutoff must not be parsed');
        } finally {
            console.error = orig;
        }
    });
});

describe('50-entry limit: buildHashString', () => {
    function makeGraphWithExtras(count: number): Graph {
        const nodes: [string, Record<string, unknown>][] = [
            ['org:root', rootOrgAttrs('1')],
        ];
        for (let i = 2; i <= count + 1; i++) {
            nodes.push([`org:${i}`, extraOrgAttrs(String(i))]);
        }
        return makeGraph(...nodes);
    }

    it('encodes exactly MAX_HASH_ENTITIES extras when graph has exactly that many expanded non-root nodes', () => {
        const state = new LegendState();
        const graph = makeGraphWithExtras(MAX_HASH_ENTITIES);
        applyFilterChars(state, 'org:root', 'D');
        graph.forEachNode((id, attrs) => {
            if (!attrs.isRoot) applyFilterChars(state, id, 'S');
        });
        const h = buildHashString(state, graph);
        const matches = h.match(/o_\d+=/g) ?? [];
        assert.equal(matches.length, MAX_HASH_ENTITIES);
    });

    it('caps at MAX_HASH_ENTITIES and logs console.error when graph has one more expanded non-root node', () => {
        const state = new LegendState();
        const graph = makeGraphWithExtras(MAX_HASH_ENTITIES + 1);
        applyFilterChars(state, 'org:root', 'D');
        graph.forEachNode((id, attrs) => {
            if (!attrs.isRoot) applyFilterChars(state, id, 'S');
        });
        const errors: string[] = [];
        const orig = console.error;
        console.error = (...args: unknown[]) => errors.push(String(args[0]));
        try {
            const h = buildHashString(state, graph);
            const matches = h.match(/o_\d+=/g) ?? [];
            assert.equal(matches.length, MAX_HASH_ENTITIES);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].includes(String(MAX_HASH_ENTITIES + 1)), `error should mention count: ${errors[0]}`);
        } finally {
            console.error = orig;
        }
    });
});

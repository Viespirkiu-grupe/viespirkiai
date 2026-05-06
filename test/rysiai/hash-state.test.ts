import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';
import { LegendState } from '../../src/rysiai/legend-state.js';
import {
    FILTER_CHAR_MAP, FILTER_ID_MAP,
    applyFilterChars, applyFilterFromHash, buildHashString,
} from '../../src/rysiai/hash-state.js';

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

    it('applies filter=DSO: Director/Shareholder/Official visible, rest hidden', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#filter=DSO');
        assert.equal(state.isTypeVisible('org:1', 'Director'),    true);
        assert.equal(state.isTypeVisible('org:1', 'Shareholder'), true);
        assert.equal(state.isTypeVisible('org:1', 'Official'),    true);
        assert.equal(state.isTypeVisible('org:1', 'Employment'),  false);
        assert.equal(state.isTypeVisible('org:1', 'ContractSmall'), false);
        assert.equal(state.isTypeVisible('org:1', 'Procurement'), false);
    });

    it('applies filter= (empty): all types hidden', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#filter=');
        for (const type of Object.values(FILTER_CHAR_MAP)) {
            assert.equal(state.isTypeVisible('org:1', type), false, `${type} should be hidden`);
        }
    });

    it('parses a single additional entity', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#filter=DSO&asmuo_2=110078992&filter_2=LMG',
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityType, 'asmuo');
        assert.equal(additionalEntities[0].entityId, '110078992');
        assert.equal(additionalEntities[0].filterChars, 'LMG');
        assert.equal(additionalEntities[0].entityNumber, 2);
    });

    it('parses multiple additional entities and returns them sorted by entityNumber', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#filter=DSOELM&sutartis_2=2008083561&filter_2=LG&asmuo_3=110055123&filter_3=DS',
        );
        assert.equal(additionalEntities.length, 2);
        assert.equal(additionalEntities[0].entityNumber, 2);
        assert.equal(additionalEntities[0].entityType, 'sutartis');
        assert.equal(additionalEntities[0].entityId, '2008083561');
        assert.equal(additionalEntities[0].filterChars, 'LG');
        assert.equal(additionalEntities[1].entityNumber, 3);
        assert.equal(additionalEntities[1].entityType, 'asmuo');
        assert.equal(additionalEntities[1].filterChars, 'DS');
    });

    it('handles viesiejiPirkimai entity type', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#filter=DS&viesiejiPirkimai_2=474742&filter_2=PA',
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityType, 'viesiejiPirkimai');
        assert.equal(additionalEntities[0].entityId, '474742');
    });

    it('returns empty filterChars when filter_N key is absent', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#asmuo_2=110078992',
        );
        assert.equal(additionalEntities[0].filterChars, '');
    });

    it('silently ignores entity type keys with non-alphabetic characters', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#filter=DS&1nvalid_2=110078992&filter_2=LMG',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('silently ignores non-numeric entity IDs', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#filter=DS&asmuo_2=abc123&filter_2=LMG',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('silently ignores N=0', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#asmuo_0=110078992&filter_0=LMG',
        );
        assert.equal(additionalEntities.length, 0);
    });

    it('does not modify legendState for invalid entity entries', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#1bad_2=abc&filter_2=DS');
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

    it('builds #filter= for an all-hidden configuration', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:123', rootOrgAttrs('123')]);
        applyFilterChars(state, 'org:123', '');
        const h = buildHashString(state, graph);
        assert.equal(h, '#filter=');
    });

    it('round-trips filter=DSO', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:123', rootOrgAttrs('123')]);
        applyFilterFromHash(state, 'org:123', '#filter=DSO');
        assert.equal(buildHashString(state, graph), '#filter=DSO');
    });

    it('round-trips filter=DSLMGPABC (default-visible types)', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:123', rootOrgAttrs('123')]);
        applyFilterFromHash(state, 'org:123', '#filter=DSLMGPABC');
        assert.equal(buildHashString(state, graph), '#filter=DSLMGPABC');
    });

    it('emits chars in FILTER_CHAR_MAP insertion order', () => {
        const state = new LegendState();
        const graph = makeGraph(['org:1', rootOrgAttrs('1')]);
        applyFilterChars(state, 'org:1', 'GLD'); // out-of-order input
        const h = buildHashString(state, graph);
        // Output should always be D…L…G insertion order
        assert.ok(h.includes('filter='), h);
        const chars = h.replace('#filter=', '');
        const charOrder = Object.keys(FILTER_CHAR_MAP);
        const indices = chars.split('').map((c) => charOrder.indexOf(c));
        assert.deepEqual(indices, [...indices].sort((a, b) => a - b), 'chars not in insertion order');
    });

    it('round-trips contract entity type', () => {
        const state = new LegendState();
        const graph = makeGraph(['contract:2008083561', rootContractAttrs('2008083561')]);
        applyFilterFromHash(state, 'contract:2008083561', '#filter=LG');
        assert.equal(buildHashString(state, graph), '#filter=LG');
    });

    it('round-trips procurement entity type', () => {
        const state = new LegendState();
        const graph = makeGraph(['procurement:474742', rootProcurementAttrs('474742')]);
        applyFilterFromHash(state, 'procurement:474742', '#filter=PA');
        assert.equal(buildHashString(state, graph), '#filter=PA');
    });

    it('round-trips multi-entity hash with org secondary node', () => {
        const state = new LegendState();
        const graph = makeGraph(
            ['org:111', rootOrgAttrs('111')],
            ['org:222', extraOrgAttrs('222')],
        );
        applyFilterFromHash(state, 'org:111', '#filter=DSO&asmuo_2=222&filter_2=LMG');
        applyFilterChars(state, 'org:222', 'LMG');
        const h = buildHashString(state, graph);
        assert.ok(h.startsWith('#filter=DSO'), `primary filter: ${h}`);
        assert.ok(h.includes('asmuo_2=222'), `secondary entity: ${h}`);
        assert.ok(h.includes('filter_2=LMG'), `secondary filter: ${h}`);
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
        assert.ok(h.includes('asmuo_2=2'), h);
        assert.ok(h.includes('filter_2=S'), h);
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
        assert.ok(!h.includes('asmuo_2'), `org without jarKodas should be skipped: ${h}`);
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
        assert.ok(h.startsWith('#filter=DS'), `primary should be org:111, not contract: ${h}`);
        assert.ok(h.includes('sutartis_2=999'), `contract should be secondary: ${h}`);
        assert.ok(h.includes('filter_2=DSLMGPABC'), `contract filter: ${h}`);
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
        assert.equal(h, '#filter=&asmuo_2=121215434&filter_2=&sutartis_3=1675917562&filter_3=DSLMGPABC');
    });

    it('includes contract secondary even when it also has isRoot=true (e.g. loaded via loadSutartis on a fresh node)', () => {
        const state = new LegendState();
        // Simulates: page is asmuo/190011232, contract was NOT in dataGraph before loadSutartis,
        // so mergeGraphElements marked it isRoot=true. The org (inserted first) must remain primary.
        const graph = makeGraph(
            ['org:190011232', rootOrgAttrs('190011232')],
            ['org:121215434', extraOrgAttrs('121215434')],
            ['contract:1675917562', rootContractAttrs('1675917562')], // isRoot:true but not first
        );
        applyFilterChars(state, 'org:190011232', '');
        applyFilterChars(state, 'org:121215434', '');
        applyFilterChars(state, 'contract:1675917562', 'DSLMGPABC');
        const h = buildHashString(state, graph);
        assert.ok(h.startsWith('#filter='), `org:190011232 must be primary: ${h}`);
        assert.ok(h.includes('sutartis_2=') || h.includes('sutartis_3='), `contract must appear in hash: ${h}`);
        assert.ok(!h.includes('asmuo_2=190011232'), `primary org must not appear as secondary: ${h}`);
    });
});

// ── applyFilterFromHash + buildHashString round-trip ─────────────────────────

describe('round-trip: applyFilterFromHash → buildHashString', () => {
    const cases = [
        '#filter=DSO',
        '#filter=',
        '#filter=DSLMGPABC',
        '#filter=DSOEU',
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
        const hash = '#filter=&asmuo_2=121215434&filter_2=&sutartis_3=1675917562&filter_3=DSLMGPABC';
        const state = new LegendState();
        const graph = makeGraph(
            ['org:190011232', rootOrgAttrs('190011232')],
            ['org:121215434', extraOrgAttrs('121215434')],
            ['contract:1675917562', extraContractAttrs('1675917562')],
        );
        const { additionalEntities } = applyFilterFromHash(state, 'org:190011232', hash);
        // Simulate rysiai-app.js: always call applyFilterChars for every additional entity
        // (including those with empty filterChars so they get hasNodeConfig=true)
        for (const extra of additionalEntities) {
            const nodeId = extra.entityType === 'asmuo'            ? 'org:' + extra.entityId
                         : extra.entityType === 'sutartis'         ? 'contract:' + extra.entityId
                         : 'procurement:' + extra.entityId;
            applyFilterChars(state, nodeId, extra.filterChars);
        }
        assert.equal(buildHashString(state, graph), hash);
    });
});

// ── Unhappy path: malformed and adversarial hash inputs ───────────────────────

describe('applyFilterFromHash — malformed / adversarial inputs', () => {
    it('ignores keys with no = sign', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#filterDSO');
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
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#as2uo_2=123&filter_2=DS');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys with underscore but empty type', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#_2=123');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys with N=0 (zero not a valid entity number)', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#asmuo_0=123&filter_0=DS');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys with negative N', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#asmuo_-1=123');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys where entityId contains non-numeric characters', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#asmuo_2=abc');
        assert.equal(additionalEntities.length, 0);
    });

    it('ignores entity keys where entityId is empty string', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#asmuo_2=');
        assert.equal(additionalEntities.length, 0);
    });

    it('still applies primary filter when additional entities are invalid', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#filter=DS&1bad_2=abc&filter_2=LMG',
        );
        assert.equal(additionalEntities.length, 0);
        assert.equal(state.isTypeVisible('org:1', 'Director'), true);
        assert.equal(state.isTypeVisible('org:1', 'Shareholder'), true);
        assert.equal(state.isTypeVisible('org:1', 'Employment'), false);
    });

    it('ignores filter chars that are not in FILTER_CHAR_MAP (unknown chars are no-ops)', () => {
        const state = new LegendState();
        applyFilterFromHash(state, 'org:1', '#filter=DXZ9');
        // D is known → Director visible; X, Z, 9 are unknown → ignored
        assert.equal(state.isTypeVisible('org:1', 'Director'), true);
        assert.equal(state.isTypeVisible('org:1', 'Shareholder'), false); // S not in filter
    });

    it('handles a hash with only filter_ keys (no entity keys)', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(state, 'org:1', '#filter_2=LMG');
        assert.equal(additionalEntities.length, 0);
    });

    it('handles duplicate entity keys gracefully (last value wins via Map)', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#asmuo_2=111&asmuo_2=222&filter_2=DS',
        );
        // Map keeps last value: entityId should be '222'
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityId, '222');
    });

    it('returns entities sorted by entityNumber even when hash order differs', () => {
        const state = new LegendState();
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#asmuo_3=333&filter_3=D&asmuo_2=222&filter_2=S',
        );
        assert.equal(additionalEntities[0].entityNumber, 2);
        assert.equal(additionalEntities[1].entityNumber, 3);
    });

    it('handles URL-encoded entity IDs that are numeric after decoding', () => {
        const state = new LegendState();
        // %31%31%30 decodes to "110"
        const { additionalEntities } = applyFilterFromHash(
            state, 'org:1',
            '#asmuo_2=%31%31%30&filter_2=DS',
        );
        assert.equal(additionalEntities.length, 1);
        assert.equal(additionalEntities[0].entityId, '110');
    });
});

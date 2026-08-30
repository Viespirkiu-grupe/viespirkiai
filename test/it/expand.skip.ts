/**
 * Integration tests for modules/rysiai/expand.js DB functions.
 *
 * Run manually (requires a live DB configured via config.js):
 *
 *   npx vitest run test/it/expand.it.ts
 *
 * These tests are intentionally excluded from the default `npm test` run
 * (which only picks up test/**\/*.test.ts). Each test:
 *  1. Fetches a valid seed ID directly from the DB so there are no hardcoded IDs.
 *  2. Calls the expand function.
 *  3. Makes "smoky" assertions — that the result has the right shape and the root
 *     node exists with the expected entityType and expanded=true.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';

// Importing postgres initialises the pool via config.js.
import { postgres } from '@/postgres/postgres';
import {
    expandOrg,
    expandPerson,
    expandContract,
    expandProcurement,
    expandSutartis,
    expandPirkimas,
} from '@/modules/rysiai/expand';

afterAll(async () => {
    await postgres.end();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function assertGraphShape(result: unknown) {
    assert.ok(result && typeof result === 'object', 'result is an object');
    const { nodes, edges } = result as { nodes: unknown[]; edges: unknown[] };
    assert.ok(Array.isArray(nodes), 'nodes is an array');
    assert.ok(Array.isArray(edges), 'edges is an array');
}

function findNode(nodes: { id: string; attributes: Record<string, unknown> }[], predicate: (n: typeof nodes[0]) => boolean) {
    return nodes.find(predicate);
}

// ── expandOrg ─────────────────────────────────────────────────────────────────

describe('expandOrg (IT)', () => {
    let jarKodas: string;

    beforeAll(async () => {
        // Pick an org that appears as a buyer with at least one contract.
        const res = await postgres.query<{ perkanciosiosOrganizacijosKodas: string }>(
            `SELECT "perkanciosiosOrganizacijosKodas"
             FROM public."sutartys"
             WHERE "verte" IS NOT NULL
               AND "tipas" <> 'SP'
             ORDER BY "verte" DESC NULLS LAST
             LIMIT 1`,
        );
        jarKodas = res.rows[0].perkanciosiosOrganizacijosKodas;
        assert.ok(jarKodas, 'seed jarKodas found');
    });

    it('returns a graph object with nodes and edges arrays', async () => {
        const result = await expandOrg(jarKodas);
        assertGraphShape(result);
    });

    it('includes the root org node marked expanded', async () => {
        const { nodes } = await expandOrg(jarKodas) as { nodes: { id: string; attributes: Record<string, unknown> }[]; edges: unknown[] };
        const root = findNode(nodes, n => n.id === `org:${jarKodas}`);
        assert.ok(root, `root node org:${jarKodas} must be present`);
        assert.equal(root!.attributes.entityType, 'OrganizationEntity');
        assert.equal(root!.attributes.expanded, true);
    });

    it('produces at least one non-root node (contract or person or procurement)', async () => {
        const { nodes } = await expandOrg(jarKodas) as { nodes: { id: string }[] };
        assert.ok(nodes.length > 1, 'expected more than just the root node');
    });
});

// ── expandPerson ──────────────────────────────────────────────────────────────

describe('expandPerson (IT)', () => {
    let fullName: string;

    beforeAll(async () => {
        // Pick a person who has at least one pinreg declaration.
        const res = await postgres.query<{ vardas: string; pavarde: string }>(
            `SELECT "vardas", "pavarde"
             FROM public."pinregJuridiniaiRysiai"
             WHERE "vardas" IS NOT NULL AND "pavarde" IS NOT NULL
               AND "irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'
             ORDER BY "pateikimoData" DESC NULLS LAST
             LIMIT 1`,
        );
        const { vardas, pavarde } = res.rows[0];
        fullName = `${vardas} ${pavarde}`;
        assert.ok(fullName.trim(), 'seed person name found');
    });

    it('returns a graph object with nodes and edges arrays', async () => {
        const result = await expandPerson(fullName);
        assertGraphShape(result);
    });

    it('includes the root person node marked expanded', async () => {
        const parts = fullName.trim().split(' ');
        const expectedId = `person:${parts[0].toLowerCase()} ${parts.slice(1).join(' ').toLowerCase()}`;
        const { nodes } = await expandPerson(fullName) as { nodes: { id: string; attributes: Record<string, unknown> }[]; edges: unknown[] };
        const root = findNode(nodes, n => n.id === expectedId);
        assert.ok(root, `root person node ${expectedId} must be present`);
        assert.equal(root!.attributes.entityType, 'PersonEntity');
        assert.equal(root!.attributes.expanded, true);
    });
});

// ── expandSutartis ────────────────────────────────────────────────────────────

describe('expandSutartis (IT)', () => {
    let sutartiesUnikalusId: string;

    beforeAll(async () => {
        const res = await postgres.query<{ sutartiesUnikalusId: string }>(
            `SELECT "sutartiesUnikalusId"
             FROM public."sutartys"
             WHERE "verte" IS NOT NULL
               AND "tipas" <> 'SP'
             ORDER BY "verte" DESC NULLS LAST
             LIMIT 1`,
        );
        sutartiesUnikalusId = res.rows[0].sutartiesUnikalusId;
        assert.ok(sutartiesUnikalusId, 'seed sutartiesUnikalusId found');
    });

    it('returns a graph object with nodes and edges arrays', async () => {
        const result = await expandSutartis(sutartiesUnikalusId);
        assertGraphShape(result);
    });

    it('includes the contract node as root (isRoot=true, expanded=true)', async () => {
        const { nodes } = await expandSutartis(sutartiesUnikalusId) as { nodes: { id: string; attributes: Record<string, unknown> }[]; edges: unknown[] };
        const contractId = `contract:${sutartiesUnikalusId}`;
        const root = findNode(nodes, n => n.id === contractId);
        assert.ok(root, `contract node ${contractId} must be present`);
        assert.equal(root!.attributes.entityType, 'ContractEntity');
        assert.equal(root!.attributes.expanded, true);
        assert.equal(root!.attributes.isRoot, true);
    });

    it('includes buyer and/or seller org stubs with Order/Delivery edges', async () => {
        const { edges } = await expandSutartis(sutartiesUnikalusId) as { nodes: unknown[]; edges: { attributes: Record<string, unknown> }[] };
        const edgeTypes = edges.map(e => e.attributes.type);
        assert.ok(
            edgeTypes.includes('Order') || edgeTypes.includes('Delivery'),
            'expect at least one Order or Delivery edge',
        );
    });
});

// ── expandProcurement ─────────────────────────────────────────────────────────

describe('expandProcurement (IT)', () => {
    let pirkimoNumeris: string;

    beforeAll(async () => {
        // Find a procurement that has at least one winner contract.
        const res = await postgres.query<{ pirkimoNumeris: string }>(
            `SELECT "pirkimoNumeris"
             FROM public."sutartys"
             WHERE "pirkimoNumeris" IS NOT NULL
             GROUP BY "pirkimoNumeris"
             ORDER BY COUNT(*) DESC
             LIMIT 1`,
        );
        pirkimoNumeris = res.rows[0].pirkimoNumeris;
        assert.ok(pirkimoNumeris, 'seed pirkimoNumeris found');
    });

    it('returns a graph object with nodes and edges arrays', async () => {
        const result = await expandProcurement(pirkimoNumeris);
        assertGraphShape(result);
    });

    it('produces Award edges to winner org stubs', async () => {
        const { nodes, edges } = await expandProcurement(pirkimoNumeris) as { nodes: unknown[]; edges: { attributes: Record<string, unknown> }[] };
        assert.ok(nodes.length > 0, 'expect at least one winner node');
        const awardEdges = edges.filter(e => e.attributes.type === 'Award');
        assert.ok(awardEdges.length > 0, 'expect at least one Award edge');
    });
});

// ── expandContract ────────────────────────────────────────────────────────────

describe('expandContract (IT)', () => {
    let pirkimoNumeris: string;

    beforeAll(async () => {
        // Reuse a pirkimoNumeris that maps to a viesiejiPirkimai row.
        const res = await postgres.query<{ pirkimoNumeris: string }>(
            `SELECT s."pirkimoNumeris"
             FROM public."sutartys" s
             JOIN "eppsViesiejiPirkimai"."pirkimai" vp ON vp."pirkimoId" = s."pirkimoNumeris"
             WHERE s."pirkimoNumeris" IS NOT NULL
             GROUP BY s."pirkimoNumeris"
             ORDER BY COUNT(*) DESC
             LIMIT 1`,
        );
        pirkimoNumeris = res.rows[0].pirkimoNumeris;
        assert.ok(pirkimoNumeris, 'seed pirkimoNumeris found');
    });

    it('returns a graph object with nodes and edges arrays', async () => {
        const result = await expandContract(pirkimoNumeris);
        assertGraphShape(result);
    });

    it('includes the procurement node marked expanded', async () => {
        const { nodes } = await expandContract(pirkimoNumeris) as { nodes: { id: string; attributes: Record<string, unknown> }[]; edges: unknown[] };
        const procNode = findNode(nodes, n => n.id === `procurement:${pirkimoNumeris}`);
        assert.ok(procNode, 'procurement node must be present');
        assert.equal(procNode!.attributes.entityType, 'ProcurementEntity');
        assert.equal(procNode!.attributes.expanded, true);
    });

    it('produces Award edges for winners', async () => {
        const { edges } = await expandContract(pirkimoNumeris) as { nodes: unknown[]; edges: { attributes: Record<string, unknown> }[] };
        const awardEdges = edges.filter(e => e.attributes.type === 'Award');
        assert.ok(awardEdges.length > 0, 'expect at least one Award edge');
    });
});

// ── expandPirkimas ────────────────────────────────────────────────────────────

describe('expandPirkimas (IT)', () => {
    let pirkimoId: string;

    beforeAll(async () => {
        // Pick a procurement that has a buyer org and at least one winner contract.
        const res = await postgres.query<{ pirkimoId: string }>(
            `SELECT vp."pirkimoId"
             FROM "eppsViesiejiPirkimai"."pirkimai" vp
             JOIN public."sutartys" s ON s."pirkimoNumeris" = vp."pirkimoId"
             WHERE vp."jarKodas" IS NOT NULL
             GROUP BY vp."pirkimoId"
             ORDER BY COUNT(*) DESC
             LIMIT 1`,
        );
        pirkimoId = res.rows[0].pirkimoId;
        assert.ok(pirkimoId, 'seed pirkimoId found');
    });

    it('returns a graph object with nodes and edges arrays', async () => {
        const result = await expandPirkimas(pirkimoId);
        assertGraphShape(result);
    });

    it('includes the procurement node as root (isRoot=true, expanded=true)', async () => {
        const { nodes } = await expandPirkimas(pirkimoId) as { nodes: { id: string; attributes: Record<string, unknown> }[]; edges: unknown[] };
        const root = findNode(nodes, n => n.id === `procurement:${pirkimoId}`);
        assert.ok(root, `procurement root node must be present`);
        assert.equal(root!.attributes.entityType, 'ProcurementEntity');
        assert.equal(root!.attributes.isRoot, true);
        assert.equal(root!.attributes.expanded, true);
    });

    it('includes buyer org with Procurement edge and Award edges to winners', async () => {
        const { edges } = await expandPirkimas(pirkimoId) as { nodes: unknown[]; edges: { attributes: Record<string, unknown> }[] };
        const edgeTypes = new Set(edges.map(e => e.attributes.type));
        assert.ok(edgeTypes.has('Procurement'), 'expect a Procurement edge from buyer to root');
        assert.ok(edgeTypes.has('Award'), 'expect at least one Award edge to a winner');
    });
});

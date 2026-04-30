import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';

import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout } from '../../src/voratinklis/graph-utils.js';
import { LegendState } from '../../src/voratinklis/legend-state.js';
import { ENTITY_TYPE } from '../../src/voratinklis/entity-types.js';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function orgNodeData(id, label) {
    return {
        id,
        attributes: {
            entityType: ENTITY_TYPE.Org,
            orgType: 'PrivateCompany',
            jarKodas: id.replace('org:', ''),
            pavadinimas: label,
            label,
            expanded: false,
            size: 8,
        },
    };
}

function personNodeData(id, label) {
    return {
        id,
        attributes: {
            entityType: ENTITY_TYPE.Person,
            vardas: 'Jonas',
            pavarde: 'Jonaitis',
            label,
            expanded: false,
            size: 8,
        },
    };
}

function contractNodeData(id, label) {
    return {
        id,
        attributes: {
            entityType: ENTITY_TYPE.Contract,
            label,
            pavadinimas: 'Partner',
            verte: 50000,
            expanded: true,
            size: 8,
        },
    };
}

function edgeData(source, target, type, label) {
    return { id: `edge:${source}:${target}:${type}`, source, target, attributes: { type, label: label || '' } };
}

// ── mergeGraphElements ────────────────────────────────────────────────────────

describe('mergeGraphElements', () => {
    let graph;
    const noPos = () => null;

    beforeEach(() => {
        graph = new Graph({ type: 'directed', multi: true });
    });

    it('adds new nodes to graph', () => {
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:100', 'UAB Test')] }, null);
        assert.ok(graph.hasNode('org:100'));
    });

    it('assigns random x,y when no fromNodeId', () => {
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:100', 'UAB Test')] }, null);
        const attrs = graph.getNodeAttributes('org:100');
        assert.equal(typeof attrs.x, 'number');
        assert.equal(typeof attrs.y, 'number');
    });

    it('scatters new nodes around fromNodeId position', () => {
        graph.addNode('org:000', { x: 100, y: 200, size: 8, color: '#000', label: 'Root' });
        const getPos = (id) => graph.hasNode(id) ? graph.getNodeAttributes(id) : null;
        mergeGraphElements(graph, getPos, { nodes: [orgNodeData('org:111', 'Child')] }, 'org:000');
        const child = graph.getNodeAttributes('org:111');
        const dist = Math.hypot(child.x - 100, child.y - 200);
        // Should be within scatter range (150-250 units from origin)
        assert.ok(dist >= 100 && dist <= 300, `Expected dist 100-300, got ${dist.toFixed(1)}`);
    });

    it('does not add duplicate nodes', () => {
        graph.addNode('org:100', { x: 0, y: 0, size: 8, color: '#000', label: 'Existing' });
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:100', 'Duplicate')] }, null);
        assert.equal(graph.order, 1);
    });

    it('adds edges between existing nodes', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:B', 'Director', 'CEO')],
        }, null);
        assert.equal(graph.size, 1);
    });

    it('renames type → edgeType on edges', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:B', 'Director', '')],
        }, null);
        const edgeId = 'edge:org:A:org:B:Director';
        const attrs = graph.getEdgeAttributes(edgeId);
        assert.equal(attrs.edgeType, 'Director');
        assert.ok(!('type' in attrs), 'raw type key should be removed');
    });

    it('assigns edge color from EDGE_COLOR map', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:B', 'Shareholder', '')],
        }, null);
        const attrs = graph.getEdgeAttributes('edge:org:A:org:B:Shareholder');
        assert.equal(attrs.color, '#7c3aed');
    });

    it('does not add edge when a node is missing', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:MISSING', 'Director', '')],
        }, null);
        assert.equal(graph.size, 0);
    });

    it('returns only newly added node IDs', () => {
        graph.addNode('org:existing', { x: 0, y: 0, size: 8, color: '#000', label: 'Existing' });
        const newIds = mergeGraphElements(graph, noPos, {
            nodes: [
                orgNodeData('org:existing', 'Existing'),
                orgNodeData('org:new', 'New'),
            ],
        }, null);
        assert.deepEqual(newIds, ['org:new']);
    });

    it('gives ContractEntity green color', () => {
        mergeGraphElements(graph, noPos, { nodes: [contractNodeData('contract:x', '3 sut.')] }, null);
        const attrs = graph.getNodeAttributes('contract:x');
        assert.equal(attrs.color, '#10b981');
    });

    it('gives PersonEntity orange color', () => {
        mergeGraphElements(graph, noPos, { nodes: [personNodeData('person:jonas jonaitis', 'Jonas Jonaitis')] }, null);
        const attrs = graph.getNodeAttributes('person:jonas jonaitis');
        assert.equal(attrs.color, '#f97316');
    });

    it('preserves node label from server data', () => {
        mergeGraphElements(graph, noPos, { nodes: [contractNodeData('contract:x', '5 sut.')] }, null);
        assert.equal(graph.getNodeAttribute('contract:x', 'label'), '5 sut.');
    });

    it('does not override label with node ID', () => {
        const node = orgNodeData('org:123', 'UAB Regitra');
        mergeGraphElements(graph, noPos, { nodes: [node] }, null);
        assert.equal(graph.getNodeAttribute('org:123', 'label'), 'UAB Regitra');
    });

    it('stores edges unconditionally (no hidden flag)', () => {
        graph.addNode('p:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('p:A', 'org:B', 'Employment', 'Buhalteris')],
        }, null);
        const attrs = graph.getEdgeAttributes('edge:p:A:org:B:Employment');
        assert.ok(!('hidden' in attrs), 'mergeGraphElements must not set hidden; filtering is done by rebuildViewGraph');
    });
});

// ── runLayout ─────────────────────────────────────────────────────────────────

describe('runLayout', () => {
    it('does nothing on graph with < 2 nodes', () => {
        const graph = new Graph({ type: 'directed', multi: true });
        graph.addNode('a', { x: 5, y: 5, size: 8, color: '#000', label: 'A' });
        runLayout(graph, forceAtlas2, noverlap);
        assert.equal(graph.getNodeAttribute('a', 'x'), 5);
    });

    it('updates node positions on graph with 2+ nodes', () => {
        const graph = new Graph({ type: 'directed', multi: true });
        graph.addNode('a', { x: -10, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('b', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        graph.addEdgeWithKey('e:a:b', 'a', 'b', { edgeType: 'Director' });
        runLayout(graph, forceAtlas2, noverlap);
        const ax = graph.getNodeAttribute('a', 'x');
        const bx = graph.getNodeAttribute('b', 'x');
        // After layout, the two nodes should be separated
        assert.ok(ax !== bx, 'Layout should separate nodes');
    });
});

// ── rebuildViewGraph ──────────────────────────────────────────────────────────

describe('rebuildViewGraph', () => {
    let dataGraph, viewGraph;

    // isEdgeHidden predicate that hides a fixed set of types (global, no per-node config)
    const mkHidden = (types) => { const s = new Set(types); return (src, tgt, type) => s.has(type); };
    const noneHidden = () => false;

    function addOrg(g, id, expanded = false) {
        g.addNode(id, { entityType: ENTITY_TYPE.Org, expanded, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addPerson(g, id, expanded = false) {
        g.addNode(id, { entityType: ENTITY_TYPE.Person, expanded, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addContract(g, id) {
        g.addNode(id, { entityType: ENTITY_TYPE.Contract, expanded: true, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addEdge(g, src, tgt, type) {
        g.addEdgeWithKey(`e:${src}:${tgt}:${type}`, src, tgt, { edgeType: type, color: '#ccc' });
    }

    beforeEach(() => {
        dataGraph = new Graph({ type: 'directed', multi: true });
        viewGraph = new Graph({ type: 'directed', multi: true });
    });

    it('adds expanded non-contract anchor to viewGraph', () => {
        addOrg(dataGraph, 'org:A', true);
        rebuildViewGraph(dataGraph, viewGraph, noneHidden);
        assert.ok(viewGraph.hasNode('org:A'));
    });

    it('removes orphan person node with only hidden-type edges', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Employment');
        viewGraph.addNode('person:b', { x: 0, y: 0, size: 8, entityType: ENTITY_TYPE.Person });
        viewGraph.addNode('org:A', { x: 0, y: 0, size: 8, entityType: ENTITY_TYPE.Org, expanded: true });

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Employment']));
        assert.ok(!viewGraph.hasNode('person:b'), 'orphan person removed');
        assert.ok(viewGraph.hasNode('org:A'), 'anchor stays');
    });

    it('keeps anchor node even when ALL its edges are hidden', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Employment');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Employment']));
        assert.ok(viewGraph.hasNode('org:A'), 'anchor survives with all edges hidden');
        assert.ok(!viewGraph.hasNode('person:b'), 'orphan person absent');
    });

    it('ContractEntity is NOT an anchor (expanded=true does not protect it)', () => {
        addOrg(dataGraph, 'org:A', true);
        addContract(dataGraph, 'contract:x');
        addEdge(dataGraph, 'org:A', 'contract:x', 'Order');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Order', 'Delivery']));
        assert.ok(!viewGraph.hasNode('contract:x'), 'contract removed when Order/Delivery hidden');
    });

    it('includes nodes touching visible edges', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B');
        addEdge(dataGraph, 'org:A', 'org:B', 'Director');

        rebuildViewGraph(dataGraph, viewGraph, noneHidden);
        assert.ok(viewGraph.hasNode('org:B'), 'node with visible edge included');
    });

    it('returns IDs of newly added nodes', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B');
        addEdge(dataGraph, 'org:A', 'org:B', 'Director');
        viewGraph.addNode('org:A', { x: 0, y: 0, size: 8, entityType: ENTITY_TYPE.Org, expanded: true });

        const newNodes = rebuildViewGraph(dataGraph, viewGraph, noneHidden);
        assert.ok(newNodes.includes('org:B'), 'org:B is a new node');
        assert.ok(!newNodes.includes('org:A'), 'org:A was pre-existing');
    });

    it('restores x,y from dataGraph for re-appearing nodes', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Director');
        dataGraph.setNodeAttribute('person:b', 'x', 42);
        dataGraph.setNodeAttribute('person:b', 'y', 99);

        rebuildViewGraph(dataGraph, viewGraph, noneHidden);
        assert.equal(viewGraph.getNodeAttribute('person:b', 'x'), 42);
        assert.equal(viewGraph.getNodeAttribute('person:b', 'y'), 99);
    });

    it('adds visible edges to viewGraph', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B');
        addEdge(dataGraph, 'org:A', 'org:B', 'Director');

        rebuildViewGraph(dataGraph, viewGraph, noneHidden);
        assert.ok(viewGraph.hasEdge('e:org:A:org:B:Director'));
    });

    it('does not add hidden-type edges to viewGraph', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Employment');
        addEdge(dataGraph, 'person:b', 'org:A', 'Director'); // person has a visible edge too

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Employment']));
        assert.ok(!viewGraph.hasEdge('e:person:b:org:A:Employment'), 'hidden edge absent');
        assert.ok(viewGraph.hasEdge('e:person:b:org:A:Director'), 'visible edge present');
    });

    // ── Per-node filtering via LegendState ────────────────────────────────────
    // These tests use a real LegendState to verify the integration between
    // LegendState.isEdgeHidden and rebuildViewGraph.

    it('LegendState: configured node hides type → its edges are hidden, unconfigured node edges use global', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Director');

        const ls = new LegendState();
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false); // OrgA hides Director

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));
        assert.ok(!viewGraph.hasEdge('e:person:b:org:A:Director'), 'Director edge to OrgA hidden');
        assert.ok(!viewGraph.hasNode('person:b'), 'orphan person removed');
        assert.ok(viewGraph.hasNode('org:A'), 'anchor stays');
    });

    it('LegendState: configured node shows type → its edges are visible even if global hides', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Employment'); // Employment hidden globally

        const ls = new LegendState();
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Employment', true); // OrgA explicitly shows Employment

        // person:b unconfigured (transparent) → org:A configured and shows → edge visible
        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));
        assert.ok(viewGraph.hasEdge('e:person:b:org:A:Employment'), 'Employment edge visible when OrgA shows it');
        assert.ok(viewGraph.hasNode('person:b'), 'person:b visible because edge is visible');
    });

    it('CRITICAL: OrgA hides Employment, OrgB shows it — edges to each behave independently', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', true);
        addPerson(dataGraph, 'person:x');
        addEdge(dataGraph, 'person:x', 'org:A', 'Employment');
        addEdge(dataGraph, 'person:x', 'org:B', 'Employment');

        const ls = new LegendState();
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Employment', false); // OrgA: hide Employment

        ls.initNode('org:B');
        ls.setTypeVisible('org:B', 'Employment', true);  // OrgB: show Employment

        // person:x is NOT initialised → transparent

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));

        assert.ok(!viewGraph.hasEdge('e:person:x:org:A:Employment'), 'Employment edge to OrgA is hidden');
        assert.ok(viewGraph.hasEdge('e:person:x:org:B:Employment'), 'Employment edge to OrgB is visible');
    });

    // ── Bridge node visibility ─────────────────────────────────────────────────
    // A node adjacent to 2+ distinct expanded anchors is a "bridge". Its bridge
    // edges (to those anchors) are always visible regardless of isEdgeHidden.

    it('BRIDGE: contract between two expanded orgs is always visible even when all edge types hidden', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', true);
        addContract(dataGraph, 'contract:x');
        addEdge(dataGraph, 'org:A', 'contract:x', 'Order');
        addEdge(dataGraph, 'contract:x', 'org:B', 'Delivery');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Order', 'Delivery']));

        assert.ok(viewGraph.hasNode('contract:x'), 'bridge contract must be visible');
        assert.ok(viewGraph.hasEdge('e:org:A:contract:x:Order'), 'bridge edge Order must be visible');
        assert.ok(viewGraph.hasEdge('e:contract:x:org:B:Delivery'), 'bridge edge Delivery must be visible');
    });

    it('BRIDGE: bridge remains visible even when LegendState hides all types for both expanded nodes', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', true);
        addContract(dataGraph, 'contract:x');
        addEdge(dataGraph, 'org:A', 'contract:x', 'Order');
        addEdge(dataGraph, 'contract:x', 'org:B', 'Delivery');

        const ls = new LegendState();
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Order', false);
        ls.setTypeVisible('org:A', 'Delivery', false);
        ls.initNode('org:B');
        ls.setTypeVisible('org:B', 'Order', false);
        ls.setTypeVisible('org:B', 'Delivery', false);

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));

        assert.ok(viewGraph.hasNode('contract:x'), 'bridge contract visible despite legend hiding all types');
        assert.ok(viewGraph.hasEdge('e:org:A:contract:x:Order'), 'bridge edge Order visible');
        assert.ok(viewGraph.hasEdge('e:contract:x:org:B:Delivery'), 'bridge edge Delivery visible');
    });

    it('BRIDGE: person bridging two expanded orgs is NOT a bridge — legend still controls it', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', true);
        addPerson(dataGraph, 'person:x');
        addEdge(dataGraph, 'person:x', 'org:A', 'Director');
        addEdge(dataGraph, 'person:x', 'org:B', 'Director');

        // Only ContractEntity nodes are bridges; person nodes respect legend filtering
        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Director']));

        assert.ok(!viewGraph.hasNode('person:x'), 'person connecting two expanded orgs is NOT a bridge — hidden by legend');
        assert.ok(!viewGraph.hasEdge('e:person:x:org:A:Director'), 'Director edge to OrgA hidden');
        assert.ok(!viewGraph.hasEdge('e:person:x:org:B:Director'), 'Director edge to OrgB hidden');
    });

    it('BRIDGE: contract with only ONE expanded anchor is NOT a bridge (can be hidden)', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', false); // NOT expanded
        addContract(dataGraph, 'contract:x');
        addEdge(dataGraph, 'org:A', 'contract:x', 'Order');
        addEdge(dataGraph, 'contract:x', 'org:B', 'Delivery');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Order', 'Delivery']));

        assert.ok(!viewGraph.hasNode('contract:x'), 'non-bridge contract hidden when edges hidden');
    });

    it('BRIDGE: multi-edge to same anchor does not make it a bridge', () => {
        addOrg(dataGraph, 'org:A', true);
        addContract(dataGraph, 'contract:x');
        // Two edges to the same expanded anchor
        addEdge(dataGraph, 'org:A', 'contract:x', 'Order');
        addEdge(dataGraph, 'contract:x', 'org:A', 'Delivery');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Order', 'Delivery']));

        assert.ok(!viewGraph.hasNode('contract:x'), 'single-anchor multi-edge contract is not a bridge');
    });

    it('CRITICAL: after switching selection from A to B, OrgA settings remain unchanged', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', true);
        addPerson(dataGraph, 'person:x');
        addEdge(dataGraph, 'person:x', 'org:A', 'Director');
        addEdge(dataGraph, 'person:x', 'org:B', 'Director');

        const ls = new LegendState();

        // User selects OrgA and hides Director
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false);

        // User selects OrgB and shows Director (initNode copies global — Director was visible globally)
        ls.initNode('org:B');
        // Director is visible by default in OrgB (not in global hidden, so initNode copies it as visible)

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));

        assert.ok(!viewGraph.hasEdge('e:person:x:org:A:Director'), 'Director edge to OrgA must stay hidden');
        assert.ok(viewGraph.hasEdge('e:person:x:org:B:Director'), 'Director edge to OrgB must be visible');
    });
});

// ── syncPositionsToData ───────────────────────────────────────────────────────

describe('syncPositionsToData', () => {
    it('copies x,y from viewGraph to dataGraph', () => {
        const dg = new Graph({ type: 'directed', multi: true });
        const vg = new Graph({ type: 'directed', multi: true });
        dg.addNode('org:A', { x: 0, y: 0, size: 8 });
        vg.addNode('org:A', { x: 42, y: 99, size: 8 });

        syncPositionsToData(dg, vg);
        assert.equal(dg.getNodeAttribute('org:A', 'x'), 42);
        assert.equal(dg.getNodeAttribute('org:A', 'y'), 99);
    });

    it('ignores viewGraph nodes absent from dataGraph without throwing', () => {
        const dg = new Graph({ type: 'directed', multi: true });
        const vg = new Graph({ type: 'directed', multi: true });
        vg.addNode('org:X', { x: 5, y: 10, size: 8 });
        assert.doesNotThrow(() => syncPositionsToData(dg, vg));
    });

    it('leaves dataGraph nodes absent from viewGraph unchanged', () => {
        const dg = new Graph({ type: 'directed', multi: true });
        const vg = new Graph({ type: 'directed', multi: true });
        dg.addNode('org:A', { x: 77, y: 88, size: 8 });

        syncPositionsToData(dg, vg);
        assert.equal(dg.getNodeAttribute('org:A', 'x'), 77);
        assert.equal(dg.getNodeAttribute('org:A', 'y'), 88);
    });
});

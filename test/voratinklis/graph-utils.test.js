import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';

import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout } from '../../src/voratinklis/graph-utils.js';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function orgNodeData(id, label) {
    return {
        id,
        attributes: {
            entityType: 'OrganizationEntity',
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
            entityType: 'PersonEntity',
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
            entityType: 'ContractEntity',
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
    const noHidden = new Set();

    function addOrg(g, id, expanded = false) {
        g.addNode(id, { entityType: 'OrganizationEntity', expanded, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addPerson(g, id, expanded = false) {
        g.addNode(id, { entityType: 'PersonEntity', expanded, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addContract(g, id) {
        g.addNode(id, { entityType: 'ContractEntity', expanded: true, x: 1, y: 2, size: 8, color: '#000', label: id });
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
        rebuildViewGraph(dataGraph, viewGraph, noHidden);
        assert.ok(viewGraph.hasNode('org:A'));
    });

    it('removes orphan person node with only hidden-type edges', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Employment');
        viewGraph.addNode('person:b', { x: 0, y: 0, size: 8, entityType: 'PersonEntity' });
        viewGraph.addNode('org:A', { x: 0, y: 0, size: 8, entityType: 'OrganizationEntity', expanded: true });

        rebuildViewGraph(dataGraph, viewGraph, new Set(['Employment']));
        assert.ok(!viewGraph.hasNode('person:b'), 'orphan person removed');
        assert.ok(viewGraph.hasNode('org:A'), 'anchor stays');
    });

    it('keeps anchor node even when ALL its edges are hidden', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Employment');

        rebuildViewGraph(dataGraph, viewGraph, new Set(['Employment']));
        assert.ok(viewGraph.hasNode('org:A'), 'anchor survives with all edges hidden');
        assert.ok(!viewGraph.hasNode('person:b'), 'orphan person absent');
    });

    it('ContractEntity is NOT an anchor (expanded=true does not protect it)', () => {
        addOrg(dataGraph, 'org:A', true);
        addContract(dataGraph, 'contract:x');
        addEdge(dataGraph, 'org:A', 'contract:x', 'Order');

        rebuildViewGraph(dataGraph, viewGraph, new Set(['Order', 'Delivery']));
        assert.ok(!viewGraph.hasNode('contract:x'), 'contract removed when Order/Delivery hidden');
    });

    it('includes nodes touching visible edges', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B');
        addEdge(dataGraph, 'org:A', 'org:B', 'Director');

        rebuildViewGraph(dataGraph, viewGraph, noHidden);
        assert.ok(viewGraph.hasNode('org:B'), 'node with visible edge included');
    });

    it('returns IDs of newly added nodes', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B');
        addEdge(dataGraph, 'org:A', 'org:B', 'Director');
        viewGraph.addNode('org:A', { x: 0, y: 0, size: 8, entityType: 'OrganizationEntity', expanded: true });

        const newNodes = rebuildViewGraph(dataGraph, viewGraph, noHidden);
        assert.ok(newNodes.includes('org:B'), 'org:B is a new node');
        assert.ok(!newNodes.includes('org:A'), 'org:A was pre-existing');
    });

    it('restores x,y from dataGraph for re-appearing nodes', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Director');
        dataGraph.setNodeAttribute('person:b', 'x', 42);
        dataGraph.setNodeAttribute('person:b', 'y', 99);

        rebuildViewGraph(dataGraph, viewGraph, noHidden);
        assert.equal(viewGraph.getNodeAttribute('person:b', 'x'), 42);
        assert.equal(viewGraph.getNodeAttribute('person:b', 'y'), 99);
    });

    it('adds visible edges to viewGraph', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B');
        addEdge(dataGraph, 'org:A', 'org:B', 'Director');

        rebuildViewGraph(dataGraph, viewGraph, noHidden);
        assert.ok(viewGraph.hasEdge('e:org:A:org:B:Director'));
    });

    it('does not add hidden-type edges to viewGraph', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:b');
        addEdge(dataGraph, 'person:b', 'org:A', 'Employment');
        addEdge(dataGraph, 'person:b', 'org:A', 'Director'); // person has a visible edge too

        rebuildViewGraph(dataGraph, viewGraph, new Set(['Employment']));
        assert.ok(!viewGraph.hasEdge('e:person:b:org:A:Employment'), 'hidden edge absent');
        assert.ok(viewGraph.hasEdge('e:person:b:org:A:Director'), 'visible edge present');
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

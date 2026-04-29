import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';

import { mergeGraphElements, runLayout } from '../../src/voratinklis/graph-utils.js';
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
        const hidden = new Set();
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:100', 'UAB Test')] }, null, hidden);
        assert.ok(graph.hasNode('org:100'));
    });

    it('assigns random x,y when no fromNodeId', () => {
        const hidden = new Set();
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:100', 'UAB Test')] }, null, hidden);
        const attrs = graph.getNodeAttributes('org:100');
        assert.equal(typeof attrs.x, 'number');
        assert.equal(typeof attrs.y, 'number');
    });

    it('scatters new nodes around fromNodeId position', () => {
        graph.addNode('org:000', { x: 100, y: 200, size: 8, color: '#000', label: 'Root' });
        const getPos = (id) => graph.hasNode(id) ? graph.getNodeAttributes(id) : null;
        const hidden = new Set();
        mergeGraphElements(graph, getPos, { nodes: [orgNodeData('org:111', 'Child')] }, 'org:000', hidden);
        const child = graph.getNodeAttributes('org:111');
        const dist = Math.hypot(child.x - 100, child.y - 200);
        // Should be within scatter range (150-250 units from origin)
        assert.ok(dist >= 100 && dist <= 300, `Expected dist 100-300, got ${dist.toFixed(1)}`);
    });

    it('does not add duplicate nodes', () => {
        graph.addNode('org:100', { x: 0, y: 0, size: 8, color: '#000', label: 'Existing' });
        const hidden = new Set();
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:100', 'Duplicate')] }, null, hidden);
        assert.equal(graph.order, 1);
    });

    it('adds edges between existing nodes', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        const hidden = new Set();
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:B', 'Director', 'CEO')],
        }, null, hidden);
        assert.equal(graph.size, 1);
    });

    it('renames type → edgeType on edges', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        const hidden = new Set();
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:B', 'Director', '')],
        }, null, hidden);
        const edgeId = 'edge:org:A:org:B:Director';
        const attrs = graph.getEdgeAttributes(edgeId);
        assert.equal(attrs.edgeType, 'Director');
        assert.ok(!('type' in attrs), 'raw type key should be removed');
    });

    it('assigns edge color from EDGE_COLOR map', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        const hidden = new Set();
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:B', 'Shareholder', '')],
        }, null, hidden);
        const attrs = graph.getEdgeAttributes('edge:org:A:org:B:Shareholder');
        assert.equal(attrs.color, '#7c3aed');
    });

    it('sets hidden=true for types in hiddenEdgeTypes', () => {
        graph.addNode('p:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        const hidden = new Set(['Official', 'Employment']);
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('p:A', 'org:B', 'Employment', 'Buhalteris')],
        }, null, hidden);
        const attrs = graph.getEdgeAttributes('edge:p:A:org:B:Employment');
        assert.equal(attrs.hidden, true);
    });

    it('sets hidden=false for types not in hiddenEdgeTypes', () => {
        graph.addNode('p:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('org:B', { x: 10, y: 0, size: 8, color: '#000', label: 'B' });
        const hidden = new Set(['Official', 'Employment']);
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('p:A', 'org:B', 'Director', 'CEO')],
        }, null, hidden);
        const attrs = graph.getEdgeAttributes('edge:p:A:org:B:Director');
        assert.equal(attrs.hidden, false);
    });

    it('does not add edge when a node is missing', () => {
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        const hidden = new Set();
        mergeGraphElements(graph, noPos, {
            nodes: [],
            edges: [edgeData('org:A', 'org:MISSING', 'Director', '')],
        }, null, hidden);
        assert.equal(graph.size, 0);
    });

    it('returns only newly added node IDs', () => {
        graph.addNode('org:existing', { x: 0, y: 0, size: 8, color: '#000', label: 'Existing' });
        const hidden = new Set();
        const newIds = mergeGraphElements(graph, noPos, {
            nodes: [
                orgNodeData('org:existing', 'Existing'),
                orgNodeData('org:new', 'New'),
            ],
        }, null, hidden);
        assert.deepEqual(newIds, ['org:new']);
    });

    it('gives ContractEntity green color', () => {
        const hidden = new Set();
        mergeGraphElements(graph, noPos, { nodes: [contractNodeData('contract:x', '3 sut.')] }, null, hidden);
        const attrs = graph.getNodeAttributes('contract:x');
        assert.equal(attrs.color, '#10b981');
    });

    it('gives PersonEntity orange color', () => {
        const hidden = new Set();
        mergeGraphElements(graph, noPos, { nodes: [personNodeData('person:jonas jonaitis', 'Jonas Jonaitis')] }, null, hidden);
        const attrs = graph.getNodeAttributes('person:jonas jonaitis');
        assert.equal(attrs.color, '#f97316');
    });

    it('preserves node label from server data', () => {
        const hidden = new Set();
        mergeGraphElements(graph, noPos, { nodes: [contractNodeData('contract:x', '5 sut.')] }, null, hidden);
        assert.equal(graph.getNodeAttribute('contract:x', 'label'), '5 sut.');
    });

    it('does not override label with node ID', () => {
        const hidden = new Set();
        const node = orgNodeData('org:123', 'UAB Regitra');
        mergeGraphElements(graph, noPos, { nodes: [node] }, null, hidden);
        assert.equal(graph.getNodeAttribute('org:123', 'label'), 'UAB Regitra');
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

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Graph from 'graphology';

import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout, collapseGraphData, computeEdgeCounts } from '../../src/rysiai/graph-utils.ts';
import { LegendState } from '../../src/rysiai/legend-state.ts';
import { ENTITY_TYPE } from '../../src/rysiai/entity-types.ts';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

// ── Fixtures ──────────────────────────────────────────────────────────────────

type NodeData = { id: string; attributes: Record<string, unknown> };
type EdgeData = { id: string; source: string; target: string; attributes: Record<string, unknown> };

function orgNodeData(id: string, label: string): NodeData {
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

function personNodeData(id: string, label: string): NodeData {
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

function contractNodeData(id: string, label: string): NodeData {
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

function edgeData(source: string, target: string, type: string, label: string): EdgeData {
    return { id: `edge:${source}:${target}:${type}`, source, target, attributes: { type, label: label || '' } };
}

// ── mergeGraphElements ────────────────────────────────────────────────────────

describe('mergeGraphElements', () => {
    let graph: Graph;
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
        const getPos = (id: string) => graph.hasNode(id) ? graph.getNodeAttributes(id) : null;
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
    let dataGraph: Graph, viewGraph: Graph;

    // isEdgeHidden predicate that hides a fixed set of types (global, no per-node config)
    const mkHidden = (types: string[]) => { const s = new Set(types); return (src: string, tgt: string, type: string) => s.has(type); };
    const noneHidden = () => false;

    function addOrg(g: Graph, id: string, expanded = false) {
        g.addNode(id, { entityType: ENTITY_TYPE.Org, expanded, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addPerson(g: Graph, id: string, expanded = false) {
        g.addNode(id, { entityType: ENTITY_TYPE.Person, expanded, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addContract(g: Graph, id: string) {
        g.addNode(id, { entityType: ENTITY_TYPE.Contract, expanded: true, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addEdge(g: Graph, src: string, tgt: string, type: string) {
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

    // ── Hanging node / path reachability ──────────────────────────────────────
    // Nodes are only shown when reachable from an expanded anchor via visible edges.
    // A visible edge between two non-anchor nodes does NOT make them visible if neither
    // has a visible path back to an anchor (the "hanging node" bug fixed by BFS).

    it('HANGING: node whose only anchor-link is hidden is excluded even with other visible edges', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:x');
        addOrg(dataGraph, 'org:B');
        // person:x connects to anchor via Employment (hidden) only
        addEdge(dataGraph, 'person:x', 'org:A', 'Employment');
        // person:x has a visible edge to a stub org — old code would show both; new code should not
        addEdge(dataGraph, 'person:x', 'org:B', 'Director');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Employment']));

        assert.ok(!viewGraph.hasNode('person:x'), 'person:x not reachable from anchor via visible edges');
        assert.ok(!viewGraph.hasNode('org:B'), 'org:B only reachable through the hanging person:x');
        assert.ok(viewGraph.hasNode('org:A'), 'anchor stays');
    });

    it('HANGING: multi-hop chain cut at first hop excludes all downstream nodes', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:x');
        addOrg(dataGraph, 'org:B');
        addContract(dataGraph, 'contract:c');
        addEdge(dataGraph, 'person:x', 'org:A', 'Employment');    // cut — hidden
        addEdge(dataGraph, 'person:x', 'org:B', 'Director');       // visible but unreachable
        addEdge(dataGraph, 'org:B', 'contract:c', 'ContractSmall'); // visible but unreachable

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Employment']));

        assert.ok(!viewGraph.hasNode('person:x'), 'person:x cut off');
        assert.ok(!viewGraph.hasNode('org:B'), 'org:B only reachable through person:x');
        assert.ok(!viewGraph.hasNode('contract:c'), 'contract:c only reachable through org:B');
        assert.ok(viewGraph.hasNode('org:A'), 'anchor stays');
    });

    it('HANGING: node reachable via two paths — hiding one keeps node visible via the other', () => {
        addOrg(dataGraph, 'org:A', true);
        addPerson(dataGraph, 'person:x');
        // Two edges from person:x to anchor: one visible, one hidden
        addEdge(dataGraph, 'person:x', 'org:A', 'Director');    // visible
        addEdge(dataGraph, 'person:x', 'org:A', 'Employment');  // hidden

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Employment']));

        assert.ok(viewGraph.hasNode('person:x'), 'person:x visible via the Director path');
        assert.ok(viewGraph.hasEdge('e:person:x:org:A:Director'), 'Director edge present');
        assert.ok(!viewGraph.hasEdge('e:person:x:org:A:Employment'), 'Employment edge absent');
    });

    it('HANGING: hiding contract edges removes both contract and supplier stub', () => {
        addOrg(dataGraph, 'org:A', true);
        addContract(dataGraph, 'contract:x');
        addOrg(dataGraph, 'org:B');
        addEdge(dataGraph, 'org:A', 'contract:x', 'ContractSmall');
        addEdge(dataGraph, 'contract:x', 'org:B', 'ContractSmall');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['ContractSmall']));

        assert.ok(!viewGraph.hasNode('contract:x'), 'contract hidden — no visible path from anchor');
        assert.ok(!viewGraph.hasNode('org:B'), 'supplier stub hidden — only reachable via contract');
        assert.ok(viewGraph.hasNode('org:A'), 'buyer anchor stays');
    });

    it('HANGING: procurement node shown only when its Procurement edge is visible', () => {
        addOrg(dataGraph, 'org:A', true);
        const procId = 'procurement:1';
        dataGraph.addNode(procId, { entityType: ENTITY_TYPE.Procurement, expanded: false, x: 0, y: 0, size: 8, color: '#8b5cf6', label: 'Proc' });
        addEdge(dataGraph, 'org:A', procId, 'Procurement');

        rebuildViewGraph(dataGraph, viewGraph, mkHidden(['Procurement']));
        assert.ok(!viewGraph.hasNode(procId), 'procurement node hidden when Procurement edge is hidden');

        const viewGraph2 = new Graph({ type: 'directed', multi: true });
        rebuildViewGraph(dataGraph, viewGraph2, () => false);
        assert.ok(viewGraph2.hasNode(procId), 'procurement node visible when Procurement edge is visible');
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

// ── computeNodeSize ───────────────────────────────────────────────────────────

import { computeNodeSize } from '../../src/rysiai/graph-utils.ts';

describe('computeNodeSize', function () {
    it('returns 8 for a person node regardless of other attrs', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Person }), 8);
    });

    it('returns 8 for org with no sodra data (draustieji + draustieji2 = 0 → count = 1)', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Org }), 8);
    });

    it('returns 8 for org with fewer than 10 employees', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Org, draustieji: 5, draustieji2: 3 }), 8);
    });

    it('returns 13 for org at the 10-employee boundary', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Org, draustieji: 7, draustieji2: 3 }), 13);
    });

    it('returns 15 for org at the 50-employee boundary', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Org, draustieji: 30, draustieji2: 20 }), 15);
    });

    it('returns 20 for org at the 200-employee boundary', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Org, draustieji: 120, draustieji2: 80 }), 20);
    });

    it('returns 8 for a small contract (< 100k)', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Contract, verte: 50_000 }), 8);
    });

    it('returns 13 for a medium contract (100k–1M)', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Contract, verte: 500_000 }), 13);
    });

    it('returns 19 for a large contract (>= 1M)', function () {
        assert.equal(computeNodeSize({ entityType: ENTITY_TYPE.Contract, verte: 2_000_000 }), 19);
    });
});

// ── mergeGraphElements — contract edge type remapping ────────────────────────

describe('mergeGraphElements — contract edge type remapping', () => {
    let graph: Graph;
    const noPos = () => null;

    beforeEach(() => {
        graph = new Graph({ type: 'directed', multi: true });
        graph.addNode('org:A', { x: 0, y: 0, size: 8, color: '#000', label: 'A' });
        graph.addNode('contract:x', { x: 10, y: 0, size: 8, color: '#000', label: 'x' });
    });

    function contractEdge(type: string, size: number): EdgeData {
        return { id: `edge:org:A:contract:x:${type}`, source: 'org:A', target: 'contract:x', attributes: { type, label: '', size } };
    }

    it('Order edge with size 1 becomes ContractSmall', () => {
        mergeGraphElements(graph, noPos, { nodes: [], edges: [contractEdge('Order', 1)] }, null);
        assert.equal(graph.getEdgeAttribute('edge:org:A:contract:x:Order', 'edgeType'), 'ContractSmall');
    });

    it('Order edge with size 3 becomes ContractMedium', () => {
        mergeGraphElements(graph, noPos, { nodes: [], edges: [contractEdge('Order', 3)] }, null);
        assert.equal(graph.getEdgeAttribute('edge:org:A:contract:x:Order', 'edgeType'), 'ContractMedium');
    });

    it('Order edge with size 6 becomes ContractLarge', () => {
        mergeGraphElements(graph, noPos, { nodes: [], edges: [contractEdge('Order', 6)] }, null);
        assert.equal(graph.getEdgeAttribute('edge:org:A:contract:x:Order', 'edgeType'), 'ContractLarge');
    });

    it('Delivery edge with size 3 becomes ContractMedium', () => {
        mergeGraphElements(graph, noPos, { nodes: [], edges: [contractEdge('Delivery', 3)] }, null);
        assert.equal(graph.getEdgeAttribute('edge:org:A:contract:x:Delivery', 'edgeType'), 'ContractMedium');
    });

    it('Director edge keeps its original edgeType', () => {
        mergeGraphElements(graph, noPos, { nodes: [], edges: [edgeData('org:A', 'contract:x', 'Director', '')] }, null);
        assert.equal(graph.getEdgeAttribute('edge:org:A:contract:x:Director', 'edgeType'), 'Director');
    });

    it('Order edge with no size keeps edgeType Order', () => {
        mergeGraphElements(graph, noPos, { nodes: [], edges: [edgeData('org:A', 'contract:x', 'Order', '')] }, null);
        assert.equal(graph.getEdgeAttribute('edge:org:A:contract:x:Order', 'edgeType'), 'Order');
    });
});

// ── rebuildViewGraph — contract size edge type filtering ──────────────────────

describe('rebuildViewGraph — contract size edge type filtering', () => {
    let dataGraph: Graph, viewGraph: Graph;

    beforeEach(() => {
        dataGraph = new Graph({ type: 'directed', multi: true });
        viewGraph = new Graph({ type: 'directed', multi: true });
    });

    function addOrg(g: Graph, id: string, expanded = false) {
        g.addNode(id, { entityType: ENTITY_TYPE.Org, expanded, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addContract(g: Graph, id: string) {
        g.addNode(id, { entityType: ENTITY_TYPE.Contract, expanded: true, x: 1, y: 2, size: 8, color: '#000', label: id });
    }
    function addContractEdge(g: Graph, src: string, tgt: string, edgeType: string) {
        g.addEdgeWithKey(`e:${src}:${tgt}:${edgeType}`, src, tgt, { edgeType, color: '#ccc' });
    }

    it('hiding ContractMedium hides medium contract edges', () => {
        addOrg(dataGraph, 'org:A', true);
        addContract(dataGraph, 'contract:x');
        addContractEdge(dataGraph, 'org:A', 'contract:x', 'ContractMedium');

        const ls = new LegendState();
        ls.setGlobalTypeVisible('ContractMedium', false);

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));
        assert.ok(!viewGraph.hasEdge('e:org:A:contract:x:ContractMedium'), 'medium edge hidden');
        assert.ok(!viewGraph.hasNode('contract:x'), 'contract removed when its only edge is hidden');
    });

    it('hiding ContractMedium does not affect ContractLarge or ContractSmall', () => {
        addOrg(dataGraph, 'org:A', true);
        addContract(dataGraph, 'contract:small');
        addContract(dataGraph, 'contract:large');
        addContractEdge(dataGraph, 'org:A', 'contract:small', 'ContractSmall');
        addContractEdge(dataGraph, 'org:A', 'contract:large', 'ContractLarge');

        const ls = new LegendState();
        ls.setGlobalTypeVisible('ContractMedium', false);

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));
        assert.ok(viewGraph.hasNode('contract:small'), 'small contract unaffected');
        assert.ok(viewGraph.hasNode('contract:large'), 'large contract unaffected');
    });

    it('per-node filter: hiding ContractLarge for OrgA does not affect OrgB', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', true);
        addContract(dataGraph, 'contract:x');
        addContract(dataGraph, 'contract:y');
        addContractEdge(dataGraph, 'org:A', 'contract:x', 'ContractLarge');
        addContractEdge(dataGraph, 'org:B', 'contract:y', 'ContractLarge');

        const ls = new LegendState();
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'ContractLarge', false);

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));
        assert.ok(!viewGraph.hasNode('contract:x'), 'OrgA large contract hidden');
        assert.ok(viewGraph.hasNode('contract:y'), 'OrgB large contract visible');
    });

    it('bridge contract remains visible even when its edge type is hidden globally', () => {
        addOrg(dataGraph, 'org:A', true);
        addOrg(dataGraph, 'org:B', true);
        addContract(dataGraph, 'contract:x');
        addContractEdge(dataGraph, 'org:A', 'contract:x', 'ContractLarge');
        addContractEdge(dataGraph, 'contract:x', 'org:B', 'ContractLarge');

        const ls = new LegendState();
        ls.setGlobalTypeVisible('ContractLarge', false);

        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => ls.isEdgeHidden(s, t, type));
        assert.ok(viewGraph.hasNode('contract:x'), 'bridge contract visible despite type hidden');
        assert.ok(viewGraph.hasEdge('e:org:A:contract:x:ContractLarge'), 'bridge edge visible');
        assert.ok(viewGraph.hasEdge('e:contract:x:org:B:ContractLarge'), 'bridge edge visible');
    });
});

// ── mergeGraphElements — org node enrichment ──────────────────────────────────

describe('mergeGraphElements — org node sodra enrichment', function () {
    it('enriches an existing stub org node with sodra data when first available', function () {
        const dg = new Graph({ type: 'directed', multi: true });
        // Stub org already in the graph (came from an earlier expansion) — no sodra fields
        dg.addNode('org:100', { entityType: ENTITY_TYPE.Org, size: 8, draustieji: undefined, draustieji2: undefined });

        // New data includes sodra fields for the same org
        const data = {
            nodes: [{
                id: 'org:100',
                attributes: {
                    entityType: ENTITY_TYPE.Org,
                    draustieji: 60,
                    draustieji2: 0,
                    size: 8,
                    label: 'UAB Test',
                    pavadinimas: 'UAB Test',
                },
            }],
            edges: [],
        };

        mergeGraphElements(dg, () => null, data, null);

        // After enrichment, size should reflect personelSize(60) = 15
        assert.equal(dg.getNodeAttribute('org:100', 'draustieji'), 60);
        assert.equal(dg.getNodeAttribute('org:100', 'draustieji2'), 0);
        assert.equal(dg.getNodeAttribute('org:100', 'size'), 15);
    });

    it('does NOT overwrite an org node that already has sodra data', function () {
        const dg = new Graph({ type: 'directed', multi: true });
        dg.addNode('org:200', {
            entityType: ENTITY_TYPE.Org,
            draustieji: 100,
            draustieji2: 10,
            size: 19,
        });

        const data = {
            nodes: [{
                id: 'org:200',
                attributes: {
                    entityType: ENTITY_TYPE.Org,
                    draustieji: 5,
                    draustieji2: 0,
                    size: 8,
                },
            }],
            edges: [],
        };

        mergeGraphElements(dg, () => null, data, null);

        // Original sodra data preserved
        assert.equal(dg.getNodeAttribute('org:200', 'draustieji'), 100);
        assert.equal(dg.getNodeAttribute('org:200', 'size'), 19);
    });

    it('does not enrich a stub org that has no sodra data in the incoming payload', function () {
        const dg = new Graph({ type: 'directed', multi: true });
        dg.addNode('org:300', { entityType: ENTITY_TYPE.Org, size: 8 });

        const data = {
            nodes: [{
                id: 'org:300',
                attributes: { entityType: ENTITY_TYPE.Org, size: 8 },
            }],
            edges: [],
        };

        mergeGraphElements(dg, () => null, data, null);

        assert.equal(dg.getNodeAttribute('org:300', 'size'), 8);
    });
});

// ── rebuildViewGraph — size sync ──────────────────────────────────────────────

describe('rebuildViewGraph — size sync for already-visible nodes', function () {
    it('updates size in viewGraph when dataGraph size was enriched', function () {
        const dg = new Graph({ type: 'directed', multi: true });
        const vg = new Graph({ type: 'directed', multi: true });

        // Both graphs have the same org node, but dataGraph has been enriched
        const attrs = {
            entityType: ENTITY_TYPE.Org,
            expanded: true,
            size: 19,
            x: 0, y: 0,
            color: '#3b82f6',
            label: 'UAB',
        };
        dg.addNode('org:A', attrs);
        vg.addNode('org:A', Object.assign({}, attrs, { size: 8 })); // stale size

        // No edges — never-hide predicate
        rebuildViewGraph(dg, vg, () => false);

        assert.equal(vg.getNodeAttribute('org:A', 'size'), 19);
    });
});

// ── mergeGraphElements — rootNodeId parameter ─────────────────────────────────

describe('mergeGraphElements — rootNodeId', () => {
    let graph: Graph;
    const noPos = () => null;

    beforeEach(() => {
        graph = new Graph({ type: 'directed', multi: true });
    });

    it('root node gets isRoot=true and empty expandedBy when rootNodeId provided', () => {
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:root', 'Root')] }, 'org:root', 'org:root');
        assert.equal(graph.getNodeAttribute('org:root', 'isRoot'), true);
        assert.deepEqual([...graph.getNodeAttribute('org:root', 'expandedBy')], []);
    });

    it('non-root nodes get isRoot=false and expandedBy=[fromNodeId] when rootNodeId provided', () => {
        mergeGraphElements(graph, noPos, {
            nodes: [orgNodeData('org:root', 'Root'), orgNodeData('org:partner', 'Partner')],
            edges: [],
        }, 'org:root', 'org:root');
        assert.equal(graph.getNodeAttribute('org:partner', 'isRoot'), false);
        assert.deepEqual([...graph.getNodeAttribute('org:partner', 'expandedBy')], ['org:root']);
    });

    it('edges get expandedBy=[fromNodeId] when rootNodeId provided', () => {
        mergeGraphElements(graph, noPos, {
            nodes: [orgNodeData('org:root', 'Root'), orgNodeData('org:partner', 'Partner')],
            edges: [edgeData('org:root', 'org:partner', 'Order', '')],
        }, 'org:root', 'org:root');
        const edgeId = 'edge:org:root:org:partner:Order';
        assert.deepEqual([...graph.getEdgeAttribute(edgeId, 'expandedBy')], ['org:root']);
    });

    it('without rootNodeId, fromNodeId=null makes all nodes isRoot=true (backward compat)', () => {
        mergeGraphElements(graph, noPos, { nodes: [orgNodeData('org:A', 'A')] }, null);
        assert.equal(graph.getNodeAttribute('org:A', 'isRoot'), true);
    });
});

// ── collapseGraphData ─────────────────────────────────────────────────────────

describe('collapseGraphData', () => {
    let dataGraph: Graph;
    const noPos = () => null;

    beforeEach(() => {
        dataGraph = new Graph({ type: 'directed', multi: true });
    });

    it('sets expanded=false on the collapsed node', () => {
        mergeGraphElements(dataGraph, noPos, { nodes: [orgNodeData('org:root', 'Root')] }, 'org:root', 'org:root');
        dataGraph.setNodeAttribute('org:root', 'expanded', true);
        collapseGraphData(dataGraph, 'org:root');
        assert.equal(dataGraph.getNodeAttribute('org:root', 'expanded'), false);
    });

    it('removes nodes exclusively owned by the collapsed node', () => {
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:root', 'Root'), orgNodeData('org:p', 'Partner')],
            edges: [edgeData('org:root', 'org:p', 'Order', '')],
        }, 'org:root', 'org:root');
        dataGraph.setNodeAttribute('org:root', 'expanded', true);

        collapseGraphData(dataGraph, 'org:root');

        assert.ok(!dataGraph.hasNode('org:p'), 'exclusively owned partner should be removed');
        assert.ok(dataGraph.hasNode('org:root'), 'collapsed node itself stays in dataGraph');
        assert.equal(dataGraph.edges().length, 0, 'owned edge should be removed');
    });

    it('preserves nodes shared with another expansion (diamond dependency)', () => {
        // Root expansion: root + shared partner
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:root', 'Root'), orgNodeData('org:shared', 'Shared')],
            edges: [edgeData('org:root', 'org:shared', 'Order', '')],
        }, 'org:root', 'org:root');
        dataGraph.setNodeAttribute('org:root', 'expanded', true);

        // Expanding org:other also claims org:shared (server returns both in its response)
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:other', 'Other'), orgNodeData('org:shared', 'Shared')],
            edges: [edgeData('org:other', 'org:shared', 'Order', '')],
        }, 'org:other');
        dataGraph.setNodeAttribute('org:other', 'expanded', true);

        collapseGraphData(dataGraph, 'org:root');

        assert.ok(dataGraph.hasNode('org:shared'), 'shared node must survive (also owned by org:other)');
        assert.ok(dataGraph.hasNode('org:other'), 'other expanded node must survive');
    });

    it('does nothing when nodeId is not in dataGraph', () => {
        collapseGraphData(dataGraph, 'org:nonexistent'); // must not throw
    });
});

// ── collapse + rebuildViewGraph integration ───────────────────────────────────

describe('collapse + rebuildViewGraph integration', () => {
    let dataGraph: Graph, viewGraph: Graph;
    const noPos = () => null;
    const neverHide = () => false;

    beforeEach(() => {
        dataGraph = new Graph({ type: 'directed', multi: true });
        viewGraph = new Graph({ type: 'directed', multi: true });
    });

    it('collapsing the root node when it is the only expanded node empties viewGraph', () => {
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:root', 'Root'), orgNodeData('org:p1', 'Partner')],
            edges: [edgeData('org:root', 'org:p1', 'Order', '')],
        }, 'org:root', 'org:root');
        dataGraph.setNodeAttribute('org:root', 'expanded', true);

        rebuildViewGraph(dataGraph, viewGraph, neverHide);
        assert.equal(viewGraph.order, 2, 'both nodes visible before collapse');

        collapseGraphData(dataGraph, 'org:root');
        rebuildViewGraph(dataGraph, viewGraph, neverHide);

        assert.equal(viewGraph.order, 0, 'graph must be empty after root collapse');
    });

    it('collapsing root leaves another independently expanded node visible', () => {
        // Root expansion: root + partner (server returns root itself + all connected nodes)
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:root', 'Root'), orgNodeData('org:p1', 'Partner')],
            edges: [edgeData('org:root', 'org:p1', 'Order', '')],
        }, 'org:root', 'org:root');
        dataGraph.setNodeAttribute('org:root', 'expanded', true);

        // Partner expansion: server returns org:p1 itself (already in graph → gets expandedBy updated)
        // plus any new nodes. This is the real server behaviour: expandOrg includes the target org.
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:p1', 'Partner'), orgNodeData('org:p2', 'Sub-partner')],
            edges: [edgeData('org:p1', 'org:p2', 'Order', '')],
        }, 'org:p1');
        dataGraph.setNodeAttribute('org:p1', 'expanded', true);

        rebuildViewGraph(dataGraph, viewGraph, neverHide);
        assert.equal(viewGraph.order, 3, 'all three nodes visible before collapse');

        collapseGraphData(dataGraph, 'org:root');
        rebuildViewGraph(dataGraph, viewGraph, neverHide);

        assert.ok(!viewGraph.hasNode('org:root'), 'root should disappear');
        assert.ok(viewGraph.hasNode('org:p1'), 'partner stays (still expanded anchor)');
        assert.ok(viewGraph.hasNode('org:p2'), 'sub-partner stays (has edge to anchor)');
    });

    it('root node is isRoot=true and survives another node collapsing it', () => {
        // Root expansion (root itself + partner)
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:root', 'Root'), orgNodeData('org:p1', 'Partner')],
            edges: [edgeData('org:root', 'org:p1', 'Order', '')],
        }, 'org:root', 'org:root');
        dataGraph.setNodeAttribute('org:root', 'expanded', true);

        // Partner expansion: partner claims root as one of its connections;
        // root already exists → gets org:p1 added to expandedBy (but isRoot stays true)
        mergeGraphElements(dataGraph, noPos, {
            nodes: [orgNodeData('org:p1', 'Partner'), orgNodeData('org:root', 'Root')],
            edges: [edgeData('org:p1', 'org:root', 'Order', '')],
        }, 'org:p1');
        dataGraph.setNodeAttribute('org:p1', 'expanded', true);

        // Collapse partner — root must survive because isRoot=true
        collapseGraphData(dataGraph, 'org:p1');

        assert.ok(dataGraph.hasNode('org:root'), 'root must not be removed when partner collapses');
    });
});

// ── computeEdgeCounts ─────────────────────────────────────────────────────────

describe('computeEdgeCounts', () => {
    let g: Graph;
    beforeEach(() => { g = new Graph({ type: 'directed', multi: true }); });

    it('returns empty map for a missing node', () => {
        const byType = computeEdgeCounts(g, 'org:x');
        assert.equal(byType.size, 0);
    });

    it('returns empty map for a node with no edges', () => {
        g.addNode('org:x', {});
        const byType = computeEdgeCounts(g, 'org:x');
        assert.equal(byType.size, 0);
    });

    it('counts Director edges correctly', () => {
        g.addNode('org:a', {}); g.addNode('person:1', {}); g.addNode('person:2', {});
        g.addEdgeWithKey('e1', 'person:1', 'org:a', { edgeType: 'Director' });
        g.addEdgeWithKey('e2', 'person:2', 'org:a', { edgeType: 'Director' });
        const byType = computeEdgeCounts(g, 'org:a');
        assert.equal(byType.get('Director'), 2);
        assert.equal(byType.get('Shareholder'), undefined);
    });

    it('counts multiple edge types independently', () => {
        g.addNode('org:a', {}); g.addNode('person:1', {}); g.addNode('person:2', {});
        g.addEdgeWithKey('e1', 'person:1', 'org:a', { edgeType: 'Director' });
        g.addEdgeWithKey('e2', 'person:2', 'org:a', { edgeType: 'Shareholder' });
        const byType = computeEdgeCounts(g, 'org:a');
        assert.equal(byType.get('Director'), 1);
        assert.equal(byType.get('Shareholder'), 1);
    });

    it('counts contract size edge types independently', () => {
        g.addNode('org:a', {}); g.addNode('contract:1', {}); g.addNode('contract:2', {}); g.addNode('contract:3', {});
        g.addEdgeWithKey('e1', 'org:a', 'contract:1', { edgeType: 'ContractSmall' });
        g.addEdgeWithKey('e2', 'org:a', 'contract:2', { edgeType: 'ContractMedium' });
        g.addEdgeWithKey('e3', 'org:a', 'contract:3', { edgeType: 'ContractLarge' });
        const byType = computeEdgeCounts(g, 'org:a');
        assert.equal(byType.get('ContractSmall'), 1);
        assert.equal(byType.get('ContractMedium'), 1);
        assert.equal(byType.get('ContractLarge'), 1);
    });

    it('ContractMedium count does not affect ContractSmall or ContractLarge', () => {
        g.addNode('org:a', {}); g.addNode('contract:1', {}); g.addNode('contract:2', {});
        g.addEdgeWithKey('e1', 'org:a', 'contract:1', { edgeType: 'ContractMedium' });
        g.addEdgeWithKey('e2', 'org:a', 'contract:2', { edgeType: 'ContractMedium' });
        const byType = computeEdgeCounts(g, 'org:a');
        assert.equal(byType.get('ContractMedium'), 2);
        assert.equal(byType.get('ContractSmall'), undefined);
        assert.equal(byType.get('ContractLarge'), undefined);
    });

    it('does not count edges not incident to the queried node', () => {
        g.addNode('org:a', {}); g.addNode('org:b', {}); g.addNode('org:c', {});
        g.addEdgeWithKey('e1', 'org:b', 'org:c', { edgeType: 'Director' });
        const byType = computeEdgeCounts(g, 'org:a');
        assert.equal(byType.size, 0);
    });

    it('counts both outgoing and incoming edges', () => {
        g.addNode('org:a', {}); g.addNode('org:b', {}); g.addNode('org:c', {});
        g.addEdgeWithKey('e1', 'org:a', 'org:b', { edgeType: 'ContractSmall' });
        g.addEdgeWithKey('e2', 'org:c', 'org:a', { edgeType: 'ContractLarge' });
        const byType = computeEdgeCounts(g, 'org:a');
        assert.equal(byType.get('ContractSmall'), 1);
        assert.equal(byType.get('ContractLarge'), 1);
    });
});

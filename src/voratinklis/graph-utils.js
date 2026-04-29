import { makeIconDataUri, getIconKey } from './icons.js';
import { EDGE_COLOR, nodeColor } from './colors.js';

/**
 * Merges API graph data into the permanent data graph (unconditionally — no filtering).
 * hiddenEdgeTypes filtering is applied later by rebuildViewGraph.
 *
 * @param {Graph}    graph          - graphology Graph instance (the data graph)
 * @param {Function} getNodePos     - (id: string) => {x, y} | null — returns graph-space coords
 * @param {{ nodes: Array, edges: Array }} data
 * @param {string|null} fromNodeId  - ID of the node that triggered the expansion (scatter origin)
 * @returns {string[]} IDs of newly added nodes
 */
export function mergeGraphElements(graph, getNodePos, data, fromNodeId) {
    var newNodeIds = [];

    (data.nodes || []).forEach(function (n) {
        if (graph.hasNode(n.id)) return;

        var x = 0, y = 0;
        if (fromNodeId) {
            var pos = getNodePos(fromNodeId);
            if (pos) {
                var angle = Math.random() * Math.PI * 2;
                var dist = 150 + Math.random() * 100;
                x = pos.x + Math.cos(angle) * dist;
                y = pos.y + Math.sin(angle) * dist;
            } else {
                x = (Math.random() - 0.5) * 400;
                y = (Math.random() - 0.5) * 400;
            }
        } else {
            x = (Math.random() - 0.5) * 400;
            y = (Math.random() - 0.5) * 400;
        }

        var iconKey = getIconKey(n.attributes);
        var imgUri = iconKey ? makeIconDataUri(iconKey) : '';
        var nodeAttrs = Object.assign({}, n.attributes, {
            x: x,
            y: y,
            size: n.attributes.size || 8,
            color: nodeColor(n.attributes),
            label: n.attributes.label || n.id,
        });
        if (imgUri) nodeAttrs.image = imgUri;

        graph.addNode(n.id, nodeAttrs);
        newNodeIds.push(n.id);
    });

    (data.edges || []).forEach(function (e) {
        if (graph.hasEdge(e.id)) return;
        if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) return;

        var attrs = Object.assign({}, e.attributes || {});
        // Rename semantic 'type' → 'edgeType' so Sigma doesn't treat it as a renderer program key.
        if (attrs.type) { attrs.edgeType = attrs.type; delete attrs.type; }
        attrs.color = EDGE_COLOR[attrs.edgeType] || '#d1d5db';
        graph.addEdgeWithKey(e.id, e.source, e.target, attrs);
    });

    return newNodeIds;
}

/**
 * Rebuilds viewGraph (Sigma's graph) from dataGraph applying hiddenEdgeTypes filter.
 * Nodes with no visible edges (and not anchors) are removed; newly visible nodes are added.
 *
 * Anchor = expanded node whose entityType is NOT ContractEntity.
 * ContractEntity nodes are never anchors — they vanish when Order/Delivery edges are hidden.
 *
 * @param {Graph}    dataGraph       - permanent store of all fetched nodes+edges
 * @param {Graph}    viewGraph       - Sigma's graph (mutated in-place)
 * @param {Set}      hiddenEdgeTypes - edge types currently hidden
 * @returns {string[]} IDs of nodes newly added to viewGraph (for animation)
 */
export function rebuildViewGraph(dataGraph, viewGraph, hiddenEdgeTypes) {
    var prevNodes = new Set(viewGraph.nodes());

    // Compute the set of nodes that should be visible
    var visible = new Set();
    dataGraph.forEachNode(function (id, attrs) {
        if (attrs.expanded && attrs.entityType !== 'ContractEntity') visible.add(id);
    });
    dataGraph.forEachEdge(function (edgeId, attrs, source, target) {
        if (!hiddenEdgeTypes.has(attrs.edgeType)) {
            visible.add(source);
            visible.add(target);
        }
    });

    // Drop invisible nodes (graphology auto-drops their incident edges)
    var toRemove = [];
    viewGraph.forEachNode(function (id) { if (!visible.has(id)) toRemove.push(id); });
    toRemove.forEach(function (id) { viewGraph.dropNode(id); });

    // Add newly visible nodes, restoring last-known x/y from dataGraph
    visible.forEach(function (id) {
        if (!viewGraph.hasNode(id) && dataGraph.hasNode(id)) {
            viewGraph.addNode(id, Object.assign({}, dataGraph.getNodeAttributes(id)));
        }
    });

    // Remove any surviving hidden-type edges from viewGraph
    var edgesToRemove = [];
    viewGraph.forEachEdge(function (edgeId, attrs) {
        if (hiddenEdgeTypes.has(attrs.edgeType)) edgesToRemove.push(edgeId);
    });
    edgesToRemove.forEach(function (id) { viewGraph.dropEdge(id); });

    // Add visible edges from dataGraph that are not yet in viewGraph
    dataGraph.forEachEdge(function (edgeId, attrs, source, target) {
        if (hiddenEdgeTypes.has(attrs.edgeType)) return;
        if (!viewGraph.hasNode(source) || !viewGraph.hasNode(target)) return;
        if (viewGraph.hasEdge(edgeId)) return;
        viewGraph.addEdgeWithKey(edgeId, source, target, Object.assign({}, attrs));
    });

    return viewGraph.nodes().filter(function (id) { return !prevNodes.has(id); });
}

/**
 * Copies layout positions (x, y) from viewGraph back to dataGraph so that
 * re-appearing nodes restore to their last known position after a rebuild.
 * Must be called after every layout pass.
 *
 * @param {Graph} dataGraph
 * @param {Graph} viewGraph
 */
export function syncPositionsToData(dataGraph, viewGraph) {
    viewGraph.forEachNode(function (id, attrs) {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'x', attrs.x);
            dataGraph.setNodeAttribute(id, 'y', attrs.y);
        }
    });
}

/**
 * Runs force-directed layout on the graph (mutates node x/y attributes).
 *
 * @param {Graph}    graph
 * @param {Function} forceAtlas2
 * @param {Function} noverlap
 */
export function runLayout(graph, forceAtlas2, noverlap) {
    if (graph.order < 2) return;
    var positions = forceAtlas2(graph, {
        iterations: 150,
        settings: forceAtlas2.inferSettings(graph),
    });
    graph.forEachNode(function (id) {
        if (positions[id]) {
            graph.setNodeAttribute(id, 'x', positions[id].x);
            graph.setNodeAttribute(id, 'y', positions[id].y);
        }
    });
    noverlap(graph, { maxIterations: 50 });
}

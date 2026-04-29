import { makeIconDataUri, getIconKey } from './icons.js';
import { EDGE_COLOR, nodeColor } from './colors.js';

/**
 * Merges API graph data into a graphology graph instance.
 *
 * @param {Graph}    graph          - graphology Graph instance
 * @param {Function} getNodePos     - (id: string) => {x, y} | null — returns graph-space coords
 * @param {{ nodes: Array, edges: Array }} data
 * @param {string|null} fromNodeId  - ID of the node that triggered the expansion (scatter origin)
 * @param {Set<string>} hiddenEdgeTypes - edge types to hide on add
 * @returns {string[]} IDs of newly added nodes
 */
export function mergeGraphElements(graph, getNodePos, data, fromNodeId, hiddenEdgeTypes) {
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
        attrs.hidden = hiddenEdgeTypes.has(attrs.edgeType);
        graph.addEdgeWithKey(e.id, e.source, e.target, attrs);
    });

    return newNodeIds;
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

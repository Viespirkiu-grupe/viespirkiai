// Graph data operations — merges API data, filters, lays out, and collapses graphology Graph instances.
// No DOM, no canvas, no Sigma API. Consumed by expand-ui.js.

import { makeIconDataUri, getIconKey, EDGE_COLOR, nodeColor, personelSize, contractSize } from './graph-theme.js';
import { isAnchorNode, isBridgeCandidate, isOrgNode, isContractNode, isProcurementNode } from './entity-types.js';

/**
 * Computes the visual node size from a node's attributes.
 *   - Org nodes: employee count derived from sodra fields → personelSize
 *   - Contract nodes: contract value → contractSize
 *   - Person nodes: fixed 8
 *
 * @param {object} attrs  node attributes (must include entityType)
 * @returns {number}
 */
export function computeNodeSize(attrs) {
    if (isOrgNode(attrs)) {
        const count = Math.max((attrs.draustieji || 0) + (attrs.draustieji2 || 0), 1);
        return personelSize(count);
    }
    if (isContractNode(attrs)) {
        return contractSize(attrs.verte || 0);
    }
    if (isProcurementNode(attrs)) {
        return contractSize(attrs.numatomaVerteEUR || 0);
    }
    return 8;
}

/**
 * Merges API graph data into the permanent data graph (unconditionally — no filtering).
 * hiddenEdgeTypes filtering is applied later by rebuildViewGraph.
 *
 * @param {Graph}    graph          - graphology Graph instance (the data graph)
 * @param {Function} getNodePos     - (id: string) => {x, y} | null — returns graph-space coords
 * @param {{ nodes: Array, edges: Array }} data
 * @param {string|null} fromNodeId  - ID of the node that triggered the expansion (scatter origin)
 * @param {string|null} rootNodeId  - ID of the node that is the permanent root (gets isRoot=true,
 *                                    expandedBy stays empty even though fromNodeId == rootNodeId)
 * @returns {string[]} IDs of newly added nodes
 */
export function mergeGraphElements(graph, getNodePos, data, fromNodeId, rootNodeId = null) {
    const newNodeIds = [];

    (data.nodes || []).forEach((n) => {
        if (graph.hasNode(n.id)) {
            // Track new owner on an already-existing node (diamond dependency support)
            if (fromNodeId) {
                const owners = graph.getNodeAttribute(n.id, 'expandedBy') || new Set();
                owners.add(fromNodeId);
                graph.setNodeAttribute(n.id, 'expandedBy', owners);
            }
            // Enrich existing org node with sodra fields when we have them for the first time
            if (isOrgNode(n.attributes) && n.attributes.draustieji !== undefined) {
                const existing = graph.getNodeAttributes(n.id);
                if (existing.draustieji === undefined) {
                    graph.setNodeAttribute(n.id, 'draustieji', n.attributes.draustieji);
                    graph.setNodeAttribute(n.id, 'draustieji2', n.attributes.draustieji2);
                    graph.setNodeAttribute(n.id, 'size', computeNodeSize(Object.assign({}, existing, n.attributes)));
                }
            }
            return;
        }

        let x = 0, y = 0;
        if (fromNodeId) {
            const pos = getNodePos(fromNodeId);
            if (pos) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 150 + Math.random() * 100;
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

        const iconKey = getIconKey(n.attributes);
        const imgUri = iconKey ? makeIconDataUri(iconKey) : '';
        const isThisRoot = rootNodeId ? n.id === rootNodeId : !fromNodeId;
        const nodeAttrs = Object.assign({}, n.attributes, {
            x: x,
            y: y,
            size: computeNodeSize(n.attributes),
            color: nodeColor(n.attributes),
            label: n.attributes.label || n.id,
            expandedBy: isThisRoot ? new Set() : (fromNodeId ? new Set([fromNodeId]) : new Set()),
            isRoot: isThisRoot,
        });
        if (imgUri) nodeAttrs.image = imgUri;

        graph.addNode(n.id, nodeAttrs);
        newNodeIds.push(n.id);
    });

    (data.edges || []).forEach((e) => {
        if (graph.hasEdge(e.id)) {
            // Track new owner on an already-existing edge
            if (fromNodeId) {
                const owners = graph.getEdgeAttribute(e.id, 'expandedBy') || new Set();
                owners.add(fromNodeId);
                graph.setEdgeAttribute(e.id, 'expandedBy', owners);
            }
            return;
        }
        if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) return;

        const attrs = Object.assign({}, e.attributes || {});
        // Rename semantic 'type' → 'edgeType' so Sigma doesn't treat it as a renderer program key.
        if (attrs.type) { attrs.edgeType = attrs.type; delete attrs.type; }
        if ((attrs.edgeType === 'Order' || attrs.edgeType === 'Delivery') && attrs.size != null) {
            attrs.edgeType = attrs.size >= 6 ? 'ContractLarge' : attrs.size >= 3 ? 'ContractMedium' : 'ContractSmall';
        }
        attrs.color = EDGE_COLOR[attrs.edgeType] || '#d1d5db';
        attrs.expandedBy = fromNodeId ? new Set([fromNodeId]) : new Set();
        graph.addEdgeWithKey(e.id, e.source, e.target, attrs);
    });

    return newNodeIds;
}

/**
 * Rebuilds viewGraph (Sigma's graph) from dataGraph using an edge-visibility predicate.
 * Nodes with no visible edges (and not anchors) are removed; newly visible nodes are added.
 *
 * Anchor = expanded org/person node (entityType !== ContractEntity).
 * ContractEntity nodes are never anchors — they normally vanish when their edges are hidden.
 *
 * Bridge rule (overrides isEdgeHidden):
 *   A node that has edges to 2+ distinct expanded anchors is a "bridge node". Its bridge
 *   edges (the edges connecting it to those anchors) are always visible regardless of legend
 *   settings. This ensures intermediate nodes between two expanded nodes (e.g. a contract
 *   shared by two expanded orgs) are never hidden by filtering.
 *   Note: only direct (one-hop) bridges are handled; deep multi-hop chains are not.
 *
 * @param {Graph}    dataGraph     - permanent store of all fetched nodes+edges
 * @param {Graph}    viewGraph     - Sigma's graph (mutated in-place)
 * @param {Function} isEdgeHidden  - (source: string, target: string, edgeType: string) => boolean
 * @returns {string[]} IDs of nodes newly added to viewGraph (for animation)
 */
export function rebuildViewGraph(dataGraph, viewGraph, isEdgeHidden) {
    const prevNodes = new Set(viewGraph.nodes());

    // Expanded anchor nodes — always visible regardless of edge visibility
    const expandedAnchors = new Set();
    dataGraph.forEachNode((id, attrs) => {
        if (isAnchorNode(attrs)) expandedAnchors.add(id);
    });

    // Bridge nodes: ContractEntity nodes connected to 2+ distinct expanded anchors → always visible.
    // Bridge edges: edges from a bridge contract to its expanded anchor neighbors → always visible.
    // Only ContractEntity nodes are bridges — person/org nodes connecting two expanded anchors
    // are "shared relationship nodes" and remain under legend/filter control.
    const bridgeNodes = new Set();
    const bridgeEdges = new Set();
    dataGraph.forEachNode((nodeId, nodeAttrs) => {
        if (expandedAnchors.has(nodeId)) return;
        if (!isBridgeCandidate(nodeAttrs)) return;
        const anchorNeighbors = new Set();
        const edgesToAnchors = [];
        dataGraph.forEachEdge(nodeId, (edgeId, edgeAttrs, src, tgt) => {
            const neighbor = src === nodeId ? tgt : src;
            if (expandedAnchors.has(neighbor)) {
                anchorNeighbors.add(neighbor);
                edgesToAnchors.push(edgeId);
            }
        });
        if (anchorNeighbors.size >= 2) {
            bridgeNodes.add(nodeId);
            edgesToAnchors.forEach((id) => { bridgeEdges.add(id); });
        }
    });

    // BFS from expanded anchors (and bridge nodes) through visible edges.
    // A node is only shown when reachable from an anchor or bridge via at least one visible path.
    // Bridge edges bypass isEdgeHidden so bridge contracts remain traversable even when their
    // edge type is filtered out.
    const visible = new Set(expandedAnchors);
    bridgeNodes.forEach((id) => visible.add(id));

    const queue = [...expandedAnchors, ...bridgeNodes];
    const queued = new Set(queue);
    while (queue.length > 0) {
        const nodeId = queue.shift();
        if (!dataGraph.hasNode(nodeId)) continue;
        dataGraph.forEachEdge(nodeId, (edgeId, attrs, source, target) => {
            if (!bridgeEdges.has(edgeId) && isEdgeHidden(source, target, attrs.edgeType)) return;
            const neighbor = source === nodeId ? target : source;
            if (!queued.has(neighbor)) {
                queued.add(neighbor);
                visible.add(neighbor);
                queue.push(neighbor);
            }
        });
    }

    // Drop invisible nodes (graphology auto-drops their incident edges)
    const toRemove = [];
    viewGraph.forEachNode((id) => { if (!visible.has(id)) toRemove.push(id); });
    toRemove.forEach((id) => { viewGraph.dropNode(id); });

    // Add newly visible nodes, restoring last-known x/y from dataGraph
    visible.forEach((id) => {
        if (!viewGraph.hasNode(id) && dataGraph.hasNode(id)) {
            viewGraph.addNode(id, Object.assign({}, dataGraph.getNodeAttributes(id)));
        }
    });

    // Sync size from dataGraph to viewGraph (handles enrichment of already-visible nodes)
    viewGraph.forEachNode((id) => {
        if (dataGraph.hasNode(id)) {
            const newSize = dataGraph.getNodeAttribute(id, 'size');
            if (newSize != null && viewGraph.getNodeAttribute(id, 'size') !== newSize) {
                viewGraph.setNodeAttribute(id, 'size', newSize);
            }
        }
    });

    // Remove edges from viewGraph that were pruned from dataGraph (e.g. after a collapse)
    const staleEdges = [];
    viewGraph.forEachEdge((edgeId) => { if (!dataGraph.hasEdge(edgeId)) staleEdges.push(edgeId); });
    staleEdges.forEach((id) => { viewGraph.dropEdge(id); });

    // Remove hidden-type edges from viewGraph (bridge edges are exempt)
    const edgesToRemove = [];
    viewGraph.forEachEdge((edgeId, attrs, source, target) => {
        if (!bridgeEdges.has(edgeId) && isEdgeHidden(source, target, attrs.edgeType)) edgesToRemove.push(edgeId);
    });
    edgesToRemove.forEach((id) => { viewGraph.dropEdge(id); });

    // Add visible edges from dataGraph that are not yet in viewGraph (bridge edges always pass)
    dataGraph.forEachEdge((edgeId, attrs, source, target) => {
        if (!bridgeEdges.has(edgeId) && isEdgeHidden(source, target, attrs.edgeType)) return;
        if (!viewGraph.hasNode(source) || !viewGraph.hasNode(target)) return;
        if (viewGraph.hasEdge(edgeId)) return;
        viewGraph.addEdgeWithKey(edgeId, source, target, Object.assign({}, attrs));
    });

    return viewGraph.nodes().filter((id) => !prevNodes.has(id));
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
    viewGraph.forEachNode((id, attrs) => {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'x', attrs.x);
            dataGraph.setNodeAttribute(id, 'y', attrs.y);
        }
    });
}

/**
 * Pure collapse: sets expanded=false on nodeId, then removes all nodes and edges
 * that were exclusively owned by this node's expansion (expandedBy tracking).
 * Does NOT touch viewGraph or trigger any UI updates — call rebuildViewGraph after.
 *
 * @param {Graph}  dataGraph
 * @param {string} nodeId
 */
export function collapseGraphData(dataGraph, nodeId) {
    if (!dataGraph.hasNode(nodeId)) return;

    dataGraph.setNodeAttribute(nodeId, 'expanded', false);

    const nodesToRemove = [];
    dataGraph.forEachNode((id, attrs) => {
        if (id === nodeId) return;
        const owners = attrs.expandedBy;
        if (owners && owners.has(nodeId)) {
            owners.delete(nodeId);
            if (owners.size === 0 && !attrs.isRoot) nodesToRemove.push(id);
        }
    });

    const edgesToRemove = [];
    dataGraph.forEachEdge((edgeId, attrs) => {
        const owners = attrs.expandedBy;
        if (owners && owners.has(nodeId)) {
            owners.delete(nodeId);
            if (owners.size === 0) edgesToRemove.push(edgeId);
        }
    });

    edgesToRemove.forEach((eid) => { if (dataGraph.hasEdge(eid)) dataGraph.dropEdge(eid); });
    nodesToRemove.forEach((nid) => { if (dataGraph.hasNode(nid)) dataGraph.dropNode(nid); });
}

/**
 * Counts edges incident to nodeId grouped by edgeType.
 * Used by the legend to show relationship counts and hide zero-count rows.
 * Always pass dataGraph (not viewGraph) so counts reflect unfiltered data.
 *
 * @param {Graph}  graph
 * @param {string} nodeId
 * @returns {Map<string, number>}
 */
export function computeEdgeCounts(graph, nodeId) {
    const byType = new Map();
    if (!graph.hasNode(nodeId)) return byType;
    graph.forEachEdge(nodeId, (_edgeId, attrs) => {
        if (attrs.edgeType) byType.set(attrs.edgeType, (byType.get(attrs.edgeType) || 0) + 1);
    });
    return byType;
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
    const inferred = forceAtlas2.inferSettings(graph);
    const fa2Iterations = Math.min(600, Math.max(200, graph.order * 8));
    const positions = forceAtlas2(graph, {
        iterations: fa2Iterations,
        settings: Object.assign({}, inferred, {
            scalingRatio: Math.max(inferred.scalingRatio || 1, 10),
            gravity: 0.5,
        }),
    });
    graph.forEachNode((id) => {
        if (positions[id]) {
            graph.setNodeAttribute(id, 'x', positions[id].x);
            graph.setNodeAttribute(id, 'y', positions[id].y);
        }
    });
    noverlap(graph, { maxIterations: 200, settings: { ratio: 1.5 } });
}

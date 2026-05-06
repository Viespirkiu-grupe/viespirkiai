// Graph data operations — merges API data, filters, lays out, and collapses graphology Graph instances.
// No DOM, no canvas, no Sigma API. Consumed by expand-ui.js.

import { makeIconDataUri, getIconKey, EDGE_COLOR, nodeColor, personelSize, contractSize } from './graph-theme.ts';
import { isAnchorNode, isBridgeCandidate, isOrgNode, isContractNode, isProcurementNode } from './entity-types.ts';
import type Graph from 'graphology';

type NodePos = { x: number; y: number } | null;
type GetNodePos = (id: string) => NodePos;
type IsEdgeHidden = (source: string, target: string, edgeType: string) => boolean;

interface ApiNode {
    id: string;
    attributes: Record<string, unknown>;
}

interface ApiEdge {
    id: string;
    source: string;
    target: string;
    attributes?: Record<string, unknown>;
}

interface ApiData {
    nodes?: ApiNode[];
    edges?: ApiEdge[];
}

export function computeNodeSize(attrs: Record<string, unknown>): number {
    if (isOrgNode(attrs)) {
        const count = Math.max(((attrs.draustieji as number) || 0) + ((attrs.draustieji2 as number) || 0), 1);
        return personelSize(count);
    }
    if (isContractNode(attrs)) {
        return contractSize((attrs.verte as number) || 0);
    }
    if (isProcurementNode(attrs)) {
        return contractSize((attrs.numatomaVerteEUR as number) || 0);
    }
    return 8;
}

export function mergeGraphElements(graph: Graph, getNodePos: GetNodePos, data: ApiData, fromNodeId: string | null, rootNodeId: string | null = null): string[] {
    const newNodeIds: string[] = [];

    (data.nodes || []).forEach((n) => {
        if (graph.hasNode(n.id)) {
            if (fromNodeId) {
                const owners = (graph.getNodeAttribute(n.id, 'expandedBy') as Set<string>) || new Set<string>();
                owners.add(fromNodeId);
                graph.setNodeAttribute(n.id, 'expandedBy', owners);
            }
            if (isOrgNode(n.attributes) && n.attributes.draustieji !== undefined) {
                const existing = graph.getNodeAttributes(n.id) as Record<string, unknown>;
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
        const nodeAttrs: Record<string, unknown> = Object.assign({}, n.attributes, {
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
            if (fromNodeId) {
                const owners = (graph.getEdgeAttribute(e.id, 'expandedBy') as Set<string>) || new Set<string>();
                owners.add(fromNodeId);
                graph.setEdgeAttribute(e.id, 'expandedBy', owners);
            }
            return;
        }
        if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) return;

        const attrs: Record<string, unknown> = Object.assign({}, e.attributes || {});
        // Rename semantic 'type' → 'edgeType' so Sigma doesn't treat it as a renderer program key.
        if (attrs.type) { attrs.edgeType = attrs.type; delete attrs.type; }
        if ((attrs.edgeType === 'Order' || attrs.edgeType === 'Delivery') && attrs.size != null) {
            attrs.edgeType = (attrs.size as number) >= 6 ? 'ContractLarge' : (attrs.size as number) >= 3 ? 'ContractMedium' : 'ContractSmall';
        }
        attrs.color = EDGE_COLOR[attrs.edgeType as string] || '#d1d5db';
        attrs.expandedBy = fromNodeId ? new Set([fromNodeId]) : new Set();
        graph.addEdgeWithKey(e.id, e.source, e.target, attrs);
    });

    return newNodeIds;
}

export function rebuildViewGraph(dataGraph: Graph, viewGraph: Graph, isEdgeHidden: IsEdgeHidden): string[] {
    const prevNodes = new Set(viewGraph.nodes());

    const expandedAnchors = new Set<string>();
    dataGraph.forEachNode((id, attrs) => {
        if (isAnchorNode(attrs)) expandedAnchors.add(id);
    });

    const bridgeNodes = new Set<string>();
    const bridgeEdges = new Set<string>();
    dataGraph.forEachNode((nodeId, nodeAttrs) => {
        if (expandedAnchors.has(nodeId)) return;
        if (!isBridgeCandidate(nodeAttrs)) return;
        const anchorNeighbors = new Set<string>();
        const edgesToAnchors: string[] = [];
        dataGraph.forEachEdge(nodeId, (edgeId, _edgeAttrs, src, tgt) => {
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

    const visible = new Set<string>(expandedAnchors);
    bridgeNodes.forEach((id) => visible.add(id));

    const queue = [...expandedAnchors, ...bridgeNodes];
    const queued = new Set<string>(queue);
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (!dataGraph.hasNode(nodeId)) continue;
        dataGraph.forEachEdge(nodeId, (edgeId, attrs, source, target) => {
            if (!bridgeEdges.has(edgeId) && isEdgeHidden(source, target, attrs.edgeType as string)) return;
            const neighbor = source === nodeId ? target : source;
            if (!queued.has(neighbor)) {
                queued.add(neighbor);
                visible.add(neighbor);
                queue.push(neighbor);
            }
        });
    }

    const toRemove: string[] = [];
    viewGraph.forEachNode((id) => { if (!visible.has(id)) toRemove.push(id); });
    toRemove.forEach((id) => { viewGraph.dropNode(id); });

    visible.forEach((id) => {
        if (!viewGraph.hasNode(id) && dataGraph.hasNode(id)) {
            viewGraph.addNode(id, Object.assign({}, dataGraph.getNodeAttributes(id)));
        }
    });

    viewGraph.forEachNode((id) => {
        if (dataGraph.hasNode(id)) {
            const newSize = dataGraph.getNodeAttribute(id, 'size') as number | undefined;
            if (newSize != null && viewGraph.getNodeAttribute(id, 'size') !== newSize) {
                viewGraph.setNodeAttribute(id, 'size', newSize);
            }
        }
    });

    const staleEdges: string[] = [];
    viewGraph.forEachEdge((edgeId) => { if (!dataGraph.hasEdge(edgeId)) staleEdges.push(edgeId); });
    staleEdges.forEach((id) => { viewGraph.dropEdge(id); });

    const edgesToRemove: string[] = [];
    viewGraph.forEachEdge((edgeId, attrs, source, target) => {
        if (!bridgeEdges.has(edgeId) && isEdgeHidden(source, target, attrs.edgeType as string)) edgesToRemove.push(edgeId);
    });
    edgesToRemove.forEach((id) => { viewGraph.dropEdge(id); });

    dataGraph.forEachEdge((edgeId, attrs, source, target) => {
        if (!bridgeEdges.has(edgeId) && isEdgeHidden(source, target, attrs.edgeType as string)) return;
        if (!viewGraph.hasNode(source) || !viewGraph.hasNode(target)) return;
        if (viewGraph.hasEdge(edgeId)) return;
        viewGraph.addEdgeWithKey(edgeId, source, target, Object.assign({}, attrs));
    });

    return viewGraph.nodes().filter((id) => !prevNodes.has(id));
}

export function syncPositionsToData(dataGraph: Graph, viewGraph: Graph): void {
    viewGraph.forEachNode((id, attrs) => {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'x', attrs.x);
            dataGraph.setNodeAttribute(id, 'y', attrs.y);
        }
    });
}

export function collapseGraphData(dataGraph: Graph, nodeId: string): void {
    if (!dataGraph.hasNode(nodeId)) return;

    dataGraph.setNodeAttribute(nodeId, 'expanded', false);

    const nodesToRemove: string[] = [];
    dataGraph.forEachNode((id, attrs) => {
        if (id === nodeId) return;
        const owners = attrs.expandedBy as Set<string> | undefined;
        if (owners && owners.has(nodeId)) {
            owners.delete(nodeId);
            if (owners.size === 0 && !attrs.isRoot) nodesToRemove.push(id);
        }
    });

    const edgesToRemove: string[] = [];
    dataGraph.forEachEdge((edgeId, attrs) => {
        const owners = attrs.expandedBy as Set<string> | undefined;
        if (owners && owners.has(nodeId)) {
            owners.delete(nodeId);
            if (owners.size === 0) edgesToRemove.push(edgeId);
        }
    });

    edgesToRemove.forEach((eid) => { if (dataGraph.hasEdge(eid)) dataGraph.dropEdge(eid); });
    nodesToRemove.forEach((nid) => { if (dataGraph.hasNode(nid)) dataGraph.dropNode(nid); });
}

export function computeEdgeCounts(graph: Graph, nodeId: string): Map<string, number> {
    const byType = new Map<string, number>();
    if (!graph.hasNode(nodeId)) return byType;
    graph.forEachEdge(nodeId, (_edgeId, attrs) => {
        if (attrs.edgeType) byType.set(attrs.edgeType as string, (byType.get(attrs.edgeType as string) || 0) + 1);
    });
    return byType;
}

export function runLayout(graph: Graph, forceAtlas2: Function, noverlap: Function): void {
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

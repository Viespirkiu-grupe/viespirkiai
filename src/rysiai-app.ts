import { drawNodeLabel, drawNodeHover } from './rysiai/renderers.js';
import { createExpandUI } from './rysiai/expand-ui.js';
import { NodePanel } from './rysiai/details-panel.js';
import { LegendState } from './rysiai/legend-state.js';
import { applyFilterChars, applyFilterFromHash, updateHashFromFilter } from './rysiai/hash-state.js';
import {
    Graph,
    forceAtlas2,
    noverlap,
    createNodeImageProgram,
    animateNodes,
    createSigma,
    DEFAULT_EDGE_CURVATURE,
    indexParallelEdgesIndex,
} from './graph-bundle.ts';

const NodeImageProgram = createNodeImageProgram({ padding: 0.2 });

// dataGraph: permanent store of all fetched nodes+edges (never given to Sigma)
// viewGraph: Sigma's filtered view, rebuilt by rebuildViewGraph on each expand/legend toggle
const dataGraph = new Graph({ type: 'directed', multi: true });
const viewGraph = new Graph({ type: 'directed', multi: true });
const container = document.getElementById('rysiai-canvas') as HTMLElement;
const statusEl = document.getElementById('rysiai-status');
const loadingEl = document.getElementById('rysiai-loading');

// Per-node and global edge-type visibility state
const legendState = new LegendState();
const nodeDetails = new NodePanel({ legendState });

const renderer = createSigma(viewGraph, container, {
    nodeProgramClasses: { image: NodeImageProgram },
    defaultNodeType: 'image',
    defaultDrawNodeLabel: drawNodeLabel,
    defaultDrawNodeHover: drawNodeHover,
    renderEdgeLabels: true,
    labelFont: 'Arial',
    labelSize: 11,
    labelColor: { color: '#374151' },
    edgeLabelFont: 'Arial',
    edgeLabelSize: 10,
    edgeLabelColor: { color: '#6b7280' },
    defaultNodeColor: '#9ca3af',
    defaultEdgeColor: '#d1d5db',
    defaultEdgeType: 'line',
    minCameraRatio: 0.05,
    maxCameraRatio: 5,
});

function syncHash() { updateHashFromFilter(legendState, dataGraph); }

function getCurvature(index: number, maxIndex: number): number {
    if (maxIndex <= 0) throw new Error('Invalid maxIndex');
    if (index < 0) return -getCurvature(-index, maxIndex);
    const amplitude = 3.5;
    const maxCurvature = amplitude * (1 - Math.exp(-maxIndex / amplitude)) * DEFAULT_EDGE_CURVATURE;
    return (maxCurvature * index) / maxIndex;
}

function applyParallelEdgeTypes(graph: InstanceType<typeof Graph>): void {
    indexParallelEdgesIndex(graph);
    graph.forEachEdge(function (_edge: string, attrs: Record<string, unknown>) {
        const parallelIndex = attrs.parallelIndex;
        const parallelMinIndex = attrs.parallelMinIndex;
        const parallelMaxIndex = attrs.parallelMaxIndex;
        if (typeof parallelMinIndex === 'number') {
            graph.mergeEdgeAttributes(_edge, {
                type: parallelIndex ? 'curved' : 'line',
                curvature: getCurvature(parallelIndex as number, parallelMaxIndex as number),
            });
        } else if (typeof parallelIndex === 'number') {
            graph.mergeEdgeAttributes(_edge, {
                type: 'curved',
                curvature: getCurvature(parallelIndex, parallelMaxIndex as number),
            });
        } else {
            graph.setEdgeAttribute(_edge, 'type', 'line');
        }
    });
}

const ui = createExpandUI({
    dataGraph, viewGraph, renderer, statusEl, loadingEl,
    forceAtlas2, noverlap, animateNodes, legendState, nodeDetails,
    onStateChange: syncHash,
    postRebuild: () => { applyParallelEdgeTypes(viewGraph); },
});

// Canvas overlay for dashed edges (ContractProcurementLink, Award, Bidder)
const dashedOverlay = document.createElement('canvas');
dashedOverlay.style.position = 'absolute';
dashedOverlay.style.top = '0';
dashedOverlay.style.left = '0';
dashedOverlay.style.zIndex = '5';
dashedOverlay.style.pointerEvents = 'none';
container.appendChild(dashedOverlay);

const dashedCtx = dashedOverlay.getContext('2d')!;

function resizeDashedOverlay() {
    dashedOverlay.width = container.clientWidth;
    dashedOverlay.height = container.clientHeight;
}
resizeDashedOverlay();
window.addEventListener('resize', resizeDashedOverlay);

const dashedEdgeTypes: Record<string, boolean> = { ContractProcurementLink: true, Award: true, Bidder: true };

// Redraw dashed edges on every Sigma render
renderer.on('afterRender', function () {
    dashedCtx.clearRect(0, 0, dashedOverlay.width, dashedOverlay.height);

    viewGraph.forEachEdge(function (_edgeId: string, attrs: Record<string, unknown>, _source: string, _target: string, sourceAttrs: Record<string, unknown>, targetAttrs: Record<string, unknown>) {
        if (!dashedEdgeTypes[attrs.edgeType as string]) return;

        const p1 = renderer.graphToViewport({ x: sourceAttrs.x as number, y: sourceAttrs.y as number });
        const p2 = renderer.graphToViewport({ x: targetAttrs.x as number, y: targetAttrs.y as number });

        dashedCtx.strokeStyle = (attrs.color as string) || '#d1d5db';
        dashedCtx.lineWidth = 1.5;
        dashedCtx.setLineDash([5, 4]);
        dashedCtx.beginPath();
        dashedCtx.moveTo(p1.x, p1.y);

        const curvature = attrs.curvature as number | undefined;
        if (curvature) {
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            // Control point: midpoint offset perpendicularly (quadratic bezier arc height = 0.5 * perpendicular offset)
            const cx = mx - dy / len * curvature * len;
            const cy = my + dx / len * curvature * len;
            dashedCtx.quadraticCurveTo(cx, cy, p2.x, p2.y);
        } else {
            dashedCtx.lineTo(p2.x, p2.y);
        }

        dashedCtx.stroke();
        dashedCtx.setLineDash([]);
    });
});

nodeDetails.bindCheckboxes(
    () => ui.getSelectedNodeId(),
    () => { ui.rebuildAndRefresh(); syncHash(); },
);

const RYSIAI_ENTITY_TYPE = window.RYSIAI_CONFIG.entityType;
const RYSIAI_ENTITY_ID   = window.RYSIAI_CONFIG.entityId;

document.addEventListener('DOMContentLoaded', async function () {
    // Save incoming hash before any async operations that may overwrite it.
    const initialHash = window.location.hash;

    let primaryNodeId: string;
    if (RYSIAI_ENTITY_TYPE === 'sutartis') {
        await ui.loadSutartis(RYSIAI_ENTITY_ID);
        primaryNodeId = 'contract:' + RYSIAI_ENTITY_ID;
    } else if (RYSIAI_ENTITY_TYPE === 'viesiejiPirkimai') {
        await ui.loadPirkimas(RYSIAI_ENTITY_ID);
        primaryNodeId = 'procurement:' + RYSIAI_ENTITY_ID;
    } else {
        await ui.loadOrg(RYSIAI_ENTITY_ID, null);
        primaryNodeId = 'org:' + RYSIAI_ENTITY_ID;
    }

    ui.selectNode(primaryNodeId);
    legendState.initNode(primaryNodeId);

    const { additionalEntities } = applyFilterFromHash(legendState, primaryNodeId, initialHash);
    ui.rebuildAndRefresh();

    for (let i = 0; i < additionalEntities.length; i++) {
        const extra = additionalEntities[i];
        let extraNodeId: string | undefined;
        if (extra.entityType === 'o') {
            await ui.loadOrg(extra.entityId, null);
            extraNodeId = 'org:' + extra.entityId;
        } else if (extra.entityType === 'c') {
            await ui.loadSutartis(extra.entityId);
            extraNodeId = 'contract:' + extra.entityId;
            // Mirror _triggerExpand: also load procurement if the contract has one
            if (dataGraph.hasNode(extraNodeId)) {
                const pirkimoNumeris = dataGraph.getNodeAttribute(extraNodeId, 'pirkimoNumeris') as string | undefined;
                if (pirkimoNumeris) await ui.loadContract(pirkimoNumeris, extraNodeId);
            }
        } else if (extra.entityType === 'r') {
            await ui.loadPirkimas(extra.entityId);
            extraNodeId = 'procurement:' + extra.entityId;
        } else if (extra.entityType === 'p') {
            await ui.loadPerson(extra.entityId);
            extraNodeId = 'person:' + extra.entityId.toLowerCase().trim();
        }
        if (extraNodeId) {
            applyFilterChars(legendState, extraNodeId, extra.filterChars);
        }
    }

    // One final consolidated layout pass after all hash-restored entities are loaded.
    // Without this, each entity's nodes are placed by an intermediate layout that doesn't
    // yet know about the full graph — causing procurement nodes from different orgs to overlap.
    if (additionalEntities.length > 0) {
        ui.rebuildAndRefresh();
    }

    syncHash();
});

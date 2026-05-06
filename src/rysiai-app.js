import { drawNodeLabel, drawNodeHover } from './rysiai/renderers.js';
import { createExpandUI } from './rysiai/expand-ui.js';
import { NodeLegend } from './rysiai/legend.js';
import { NodeDetails } from './rysiai/details-panel.js';
import { LegendState } from './rysiai/legend-state.js';
import { applyFilterChars, applyFilterFromHash, updateHashFromFilter } from './rysiai/hash-state.js';

var _v = window.Rysiai;
var Sigma = _v.Sigma;
var Graph = _v.Graph;
var forceAtlas2 = _v.forceAtlas2;
var noverlap = _v.noverlap;
var NodeImageProgram = _v.createNodeImageProgram({ padding: 0.2 });
var animateNodes = _v.animateNodes;
var createSigma = _v.createSigma;
var DEFAULT_EDGE_CURVATURE = _v.DEFAULT_EDGE_CURVATURE;
var indexParallelEdgesIndex = _v.indexParallelEdgesIndex;

// dataGraph: permanent store of all fetched nodes+edges (never given to Sigma)
// viewGraph: Sigma's filtered view, rebuilt by rebuildViewGraph on each expand/legend toggle
var dataGraph = new Graph({ type: 'directed', multi: true });
var viewGraph = new Graph({ type: 'directed', multi: true });
var container = document.getElementById('rysiai-canvas');
var statusEl = document.getElementById('rysiai-status');
var loadingEl = document.getElementById('rysiai-loading');

// Per-node and global edge-type visibility state
var legendState = new LegendState();
var legend = new NodeLegend({ legendState });
var nodeDetails = new NodeDetails({ legend });

var renderer = createSigma(viewGraph, container, {
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

function getCurvature(index, maxIndex) {
    if (maxIndex <= 0) throw new Error('Invalid maxIndex');
    if (index < 0) return -getCurvature(-index, maxIndex);
    var amplitude = 3.5;
    var maxCurvature = amplitude * (1 - Math.exp(-maxIndex / amplitude)) * DEFAULT_EDGE_CURVATURE;
    return (maxCurvature * index) / maxIndex;
}

function applyParallelEdgeTypes(graph) {
    indexParallelEdgesIndex(graph);
    graph.forEachEdge(function (edge, attrs) {
        var parallelIndex = attrs.parallelIndex;
        var parallelMinIndex = attrs.parallelMinIndex;
        var parallelMaxIndex = attrs.parallelMaxIndex;
        if (typeof parallelMinIndex === 'number') {
            graph.mergeEdgeAttributes(edge, {
                type: parallelIndex ? 'curved' : 'line',
                curvature: getCurvature(parallelIndex, parallelMaxIndex),
            });
        } else if (typeof parallelIndex === 'number') {
            graph.mergeEdgeAttributes(edge, {
                type: 'curved',
                curvature: getCurvature(parallelIndex, parallelMaxIndex),
            });
        } else {
            graph.setEdgeAttribute(edge, 'type', 'line');
        }
    });
}

var ui = createExpandUI({ dataGraph, viewGraph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes, legendState, nodeDetails, onStateChange: syncHash, postRebuild: function () { applyParallelEdgeTypes(viewGraph); } });

// Canvas overlay for dashed edges (ContractProcurementLink, Award, Bidder)
var dashedOverlay = document.createElement('canvas');
dashedOverlay.style.position = 'absolute';
dashedOverlay.style.top = '0';
dashedOverlay.style.left = '0';
dashedOverlay.style.zIndex = '5';
dashedOverlay.style.pointerEvents = 'none';
container.appendChild(dashedOverlay);

var dashedCtx = dashedOverlay.getContext('2d');

function resizeDashedOverlay() {
    dashedOverlay.width = container.clientWidth;
    dashedOverlay.height = container.clientHeight;
}
resizeDashedOverlay();
window.addEventListener('resize', resizeDashedOverlay);

// Redraw dashed edges on every Sigma render
renderer.on('afterRender', function () {
    dashedCtx.clearRect(0, 0, dashedOverlay.width, dashedOverlay.height);

    var dashedEdgeTypes = { 'ContractProcurementLink': true, 'Award': true, 'Bidder': true };

    viewGraph.forEachEdge(function (_edgeId, attrs, _source, _target, sourceAttrs, targetAttrs) {
        if (!dashedEdgeTypes[attrs.edgeType]) return;

        var p1 = renderer.graphToViewport({ x: sourceAttrs.x, y: sourceAttrs.y });
        var p2 = renderer.graphToViewport({ x: targetAttrs.x, y: targetAttrs.y });

        dashedCtx.strokeStyle = attrs.color || '#d1d5db';
        dashedCtx.lineWidth = 1.5;
        dashedCtx.setLineDash([5, 4]);
        dashedCtx.beginPath();
        dashedCtx.moveTo(p1.x, p1.y);

        var curvature = attrs.curvature;
        if (curvature) {
            var mx = (p1.x + p2.x) / 2;
            var my = (p1.y + p2.y) / 2;
            var dx = p2.x - p1.x;
            var dy = p2.y - p1.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            // Control point: midpoint offset perpendicularly (quadratic bezier arc height = 0.5 * perpendicular offset)
            var cx = mx - dy / len * curvature * len;
            var cy = my + dx / len * curvature * len;
            dashedCtx.quadraticCurveTo(cx, cy, p2.x, p2.y);
        } else {
            dashedCtx.lineTo(p2.x, p2.y);
        }

        dashedCtx.stroke();
        dashedCtx.setLineDash([]);
    });
});

legend.bindCheckboxes(function () { return ui.getSelectedNodeId(); }, function () {
    ui.rebuildAndRefresh();
    syncHash();
});

var RYSIAI_ENTITY_TYPE = window.RYSIAI_CONFIG.entityType;
var RYSIAI_ENTITY_ID   = window.RYSIAI_CONFIG.entityId;

document.addEventListener('DOMContentLoaded', async function () {
    // Save incoming hash before any async operations that may overwrite it.
    var initialHash = window.location.hash;

    var primaryNodeId;
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

    var { additionalEntities } = applyFilterFromHash(legendState, primaryNodeId, initialHash);
    ui.rebuildAndRefresh();

    for (var i = 0; i < additionalEntities.length; i++) {
        var extra = additionalEntities[i];
        var extraNodeId;
        if (extra.entityType === 'o') {
            await ui.loadOrg(extra.entityId, null);
            extraNodeId = 'org:' + extra.entityId;
        } else if (extra.entityType === 'c') {
            await ui.loadSutartis(extra.entityId);
            extraNodeId = 'contract:' + extra.entityId;
            // Mirror _triggerExpand: also load procurement if the contract has one
            if (dataGraph.hasNode(extraNodeId)) {
                var pirkimoNumeris = dataGraph.getNodeAttribute(extraNodeId, 'pirkimoNumeris');
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

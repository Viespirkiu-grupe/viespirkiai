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

var renderer = new Sigma(viewGraph, container, {
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
    minCameraRatio: 0.05,
    maxCameraRatio: 5,
});

function syncHash() { updateHashFromFilter(legendState, dataGraph); }

var ui = createExpandUI({ dataGraph, viewGraph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes, legendState, nodeDetails, onStateChange: syncHash });

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
        dashedCtx.lineTo(p2.x, p2.y);
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
        if (extra.entityType === 'asmuo') {
            await ui.loadOrg(extra.entityId, null);
            extraNodeId = 'org:' + extra.entityId;
        } else if (extra.entityType === 'sutartis') {
            await ui.loadSutartis(extra.entityId);
            extraNodeId = 'contract:' + extra.entityId;
            // Mirror _triggerExpand: also load procurement if the contract has one
            if (dataGraph.hasNode(extraNodeId)) {
                var pirkimoNumeris = dataGraph.getNodeAttribute(extraNodeId, 'pirkimoNumeris');
                if (pirkimoNumeris) await ui.loadContract(pirkimoNumeris, extraNodeId);
            }
        } else if (extra.entityType === 'viesiejiPirkimai') {
            await ui.loadPirkimas(extra.entityId);
            extraNodeId = 'procurement:' + extra.entityId;
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

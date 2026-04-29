import { drawNodeLabel, drawNodeHover } from './voratinklis/renderers.js';
import { createExpandUI } from './voratinklis/expand-ui.js';
import { bindLegendCheckboxes } from './voratinklis/legend.js';
import { LegendState } from './voratinklis/legend-state.js';

var _v = window.Voratinklis;
var Sigma = _v.Sigma;
var Graph = _v.Graph;
var forceAtlas2 = _v.forceAtlas2;
var noverlap = _v.noverlap;
var NodeImageProgram = _v.NodeImageProgram;
var animateNodes = _v.animateNodes;

// dataGraph: permanent store of all fetched nodes+edges (never given to Sigma)
// viewGraph: Sigma's filtered view, rebuilt by rebuildViewGraph on each expand/legend toggle
var dataGraph = new Graph({ type: 'directed', multi: true });
var viewGraph = new Graph({ type: 'directed', multi: true });
var container = document.getElementById('voratinklis-canvas');
var statusEl = document.getElementById('voratinklis-status');
var loadingEl = document.getElementById('voratinklis-loading');

// Per-node and global edge-type visibility state
var legendState = new LegendState();

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

var ui = createExpandUI({ dataGraph, viewGraph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes, legendState });

bindLegendCheckboxes(function () { return ui.getSelectedNodeId(); }, legendState, ui.rebuildAndRefresh);

var INITIAL_JAR_KODAS = window.VORATINKLIS_CONFIG.jarKodas;
document.addEventListener('DOMContentLoaded', function () {
    ui.loadOrg(INITIAL_JAR_KODAS, null);
});

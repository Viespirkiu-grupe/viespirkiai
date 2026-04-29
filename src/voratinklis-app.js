import { drawNodeLabel, drawNodeHover } from './voratinklis/renderers.js';
import { createExpandUI } from './voratinklis/expand-ui.js';
import { bindLegendCheckboxes } from './voratinklis/legend.js';

var _v = window.Voratinklis;
var Sigma = _v.Sigma;
var Graph = _v.Graph;
var forceAtlas2 = _v.forceAtlas2;
var noverlap = _v.noverlap;
var NodeImageProgram = _v.NodeImageProgram;
var animateNodes = _v.animateNodes;

var graph = new Graph({ type: 'directed', multi: true });
var container = document.getElementById('voratinklis-canvas');
var statusEl = document.getElementById('voratinklis-status');
var loadingEl = document.getElementById('voratinklis-loading');

var renderer = new Sigma(graph, container, {
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

var ui = createExpandUI({ graph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes });

bindLegendCheckboxes(graph, renderer);

var INITIAL_JAR_KODAS = window.VORATINKLIS_CONFIG.jarKodas;
document.addEventListener('DOMContentLoaded', function () {
    ui.loadOrg(INITIAL_JAR_KODAS, null);
});

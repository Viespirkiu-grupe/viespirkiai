'use strict';

// ── Icons ─────────────────────────────────────────────────────────────────────

var MUI_ICON_PATHS = {
    // Business icon — PrivateCompany
    PrivateCompany: 'M12 7V3H2v18h20V7zM6 19H4v-2h2zm0-4H4v-2h2zm0-4H4V9h2zm0-4H4V5h2zm4 12H8v-2h2zm0-4H8v-2h2zm0-4H8V9h2zm0-4H8V5h2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8zm-2-8h-2v2h2zm0 4h-2v2h2z',
    // DomainAdd icon — PublicCompany
    PublicCompany: 'M12 7V3H2v18h14v-2h-4v-2h2v-2h-2v-2h2v-2h-2V9h8v6h2V7zM6 19H4v-2h2zm0-4H4v-2h2zm0-4H4V9h2zm0-4H4V5h2zm4 12H8v-2h2zm0-4H8v-2h2zm0-4H8V9h2zm0-4H8V5h2zm14 12v2h-2v2h-2v-2h-2v-2h2v-2h2v2zm-6-8h-2v2h2zm0 4h-2v2h2z',
    // AccountBalance icon — Institution
    Institution: 'M4 10h3v7H4zm6.5 0h3v7h-3zM2 19h20v3H2zm15-9h3v7h-3zm-5-9L2 6v2h20V6z',
    // Person icon — Person
    Person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
    // HistoryEdu icon — Contract
    Contract: 'M9 4v1.38c-.83-.33-1.72-.5-2.61-.5-1.79 0-3.58.68-4.95 2.05l3.33 3.33h1.11v1.11c.86.86 1.98 1.31 3.11 1.36V15H6v3c0 1.1.9 2 2 2h10c1.66 0 3-1.34 3-3V4zm-1.11 6.41V8.26H5.61L4.57 7.22a5.07 5.07 0 0 1 1.82-.34c1.34 0 2.59.52 3.54 1.46l1.41 1.41-.2.2c-.51.51-1.19.8-1.92.8-.47 0-.93-.12-1.33-.34M19 17c0 .55-.45 1-1 1s-1-.45-1-1v-2h-6v-2.59c.57-.23 1.1-.57 1.56-1.03l.2-.2L15.59 14H17v-1.41l-6-5.97V6h8z',
};

function makeIconDataUri(nodeType) {
    var path = MUI_ICON_PATHS[nodeType];
    if (!path) return '';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><path fill="#1e293b" d="' + path + '"/></svg>';
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

function getIconKey(attrs) {
    if (attrs.entityType === 'OrganizationEntity') return attrs.orgType || 'PrivateCompany';
    if (attrs.entityType === 'PersonEntity') return 'Person';
    if (attrs.entityType === 'ContractEntity') return 'Contract';
    return '';
}

// ── Runtime deps ──────────────────────────────────────────────────────────────

var _v = window.Voratinklis;
var Sigma = _v.Sigma;
var Graph = _v.Graph;
var forceAtlas2 = _v.forceAtlas2;
var noverlap = _v.noverlap;
var NodeImageProgram = _v.NodeImageProgram;

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapLabel(name, n) {
    n = n || 3;
    var words = (name || '').split(' ');
    var lines = [];
    for (var i = 0; i < words.length; i += n) lines.push(words.slice(i, i + n).join(' '));
    return lines.join('\n');
}

function formatContractValue(verte) {
    if (verte == null || verte === 0) return '';
    var v = Math.round(verte);
    if (v >= 1000000) return '\u20AC' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return '\u20AC' + Math.round(v / 1000) + 'K';
    return '\u20AC' + v;
}

// Draws node label centred below the node
function drawNodeLabel(context, data, settings) {
    var label = data.label;
    if (!label) return;

    var size = settings.labelSize || 12;
    var font = settings.labelFont || 'Arial';
    var color = settings.labelColor && settings.labelColor.attribute
        ? (data[settings.labelColor.attribute] || settings.labelColor.color || '#000')
        : (settings.labelColor && settings.labelColor.color || '#000');

    context.font = size + 'px ' + font;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'top';

    var lines = label.split('\n');
    var lineHeight = size + 3;
    var nodeSize = data.size || 8;
    var startY = data.y + nodeSize + 4;

    for (var i = 0; i < lines.length; i++) {
        context.fillText(lines[i], data.x, startY + i * lineHeight);
    }
}

// ── Graph setup ───────────────────────────────────────────────────────────────

var graph = new Graph({ type: 'directed', multi: true });
var container = document.getElementById('voratinklis-canvas');
var statusEl = document.getElementById('voratinklis-status');

var renderer = new Sigma(graph, container, {
    nodeProgramClasses: { image: NodeImageProgram },
    defaultNodeType: 'image',
    defaultDrawNodeLabel: drawNodeLabel,
    defaultDrawEdgeLabel: null,
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

// ── Node colours ──────────────────────────────────────────────────────────────

var NODE_COLOR = {
    org: '#3b82f6',
    orgStub: '#9ca3af',
    person: '#f97316',
    contract: '#10b981',
};

function nodeColor(attrs) {
    if (attrs.entityType === 'ContractEntity') return NODE_COLOR.contract;
    if (attrs.entityType === 'PersonEntity') return NODE_COLOR.person;
    if (attrs.expanded) return NODE_COLOR.org;
    return NODE_COLOR.orgStub;
}

// ── Graph merge ───────────────────────────────────────────────────────────────

function mergeGraphElements(data, fromNodeId) {
    var newNodeIds = [];

    (data.nodes || []).forEach(function (n) {
        if (!graph.hasNode(n.id)) {
            var x = 0, y = 0;
            if (fromNodeId && graph.hasNode(fromNodeId)) {
                var pos = renderer.getNodeDisplayData(fromNodeId) || {};
                var angle = Math.random() * Math.PI * 2;
                var dist = 150 + Math.random() * 100;
                x = (pos.x || 0) + Math.cos(angle) * dist;
                y = (pos.y || 0) + Math.sin(angle) * dist;
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
        }
    });

    (data.edges || []).forEach(function (e) {
        if (!graph.hasEdge(e.id)) {
            if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
                var attrs = Object.assign({}, e.attributes || {});
                // Rename semantic 'type' to 'edgeType' so Sigma doesn't try to find a renderer program for it.
                if (attrs.type) { attrs.edgeType = attrs.type; delete attrs.type; }
                graph.addEdgeWithKey(e.id, e.source, e.target, attrs);
            }
        }
    });

    return newNodeIds;
}

function runLayout() {
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

// ── Expand logic ──────────────────────────────────────────────────────────────

var expandingNodes = new Set();

function setStatus(msg) {
    statusEl.textContent = msg || '';
}

async function loadOrg(jarKodas, fromNodeId) {
    var id = 'org:' + jarKodas;
    if (expandingNodes.has(id)) return;
    expandingNodes.add(id);
    setStatus('Kraunama...');
    try {
        var data = await fetch('/voratinklis/expand/' + encodeURIComponent(jarKodas)).then(function (r) { return r.json(); });
        mergeGraphElements(data, fromNodeId || id);
        runLayout();
        if (graph.hasNode(id)) graph.setNodeAttribute(id, 'expanded', true);
        renderer.refresh();
    } catch (err) {
        setStatus('Klaida kraunant duomenis.');
        console.error(err);
    } finally {
        expandingNodes.delete(id);
        setStatus('');
    }
}

async function loadPerson(vardas, pavarde, fromNodeId) {
    var fullName = (vardas + ' ' + pavarde).trim();
    var id = 'person:' + fullName.toLowerCase();
    if (expandingNodes.has(id)) return;
    expandingNodes.add(id);
    setStatus('Kraunama...');
    try {
        var data = await fetch('/voratinklis/expand-person?vardas=' + encodeURIComponent(fullName)).then(function (r) { return r.json(); });
        mergeGraphElements(data, fromNodeId || id);
        runLayout();
        if (graph.hasNode(id)) graph.setNodeAttribute(id, 'expanded', true);
        renderer.refresh();
    } catch (err) {
        setStatus('Klaida kraunant duomenis.');
        console.error(err);
    } finally {
        expandingNodes.delete(id);
        setStatus('');
    }
}

// ── Node click ────────────────────────────────────────────────────────────────

renderer.on('clickNode', function (event) {
    var nodeId = event.node;
    var attrs = graph.getNodeAttributes(nodeId);
    if (attrs.expanded) return;

    if (attrs.entityType === 'OrganizationEntity' && attrs.jarKodas) {
        graph.setNodeAttribute(nodeId, 'expanded', true);
        graph.setNodeAttribute(nodeId, 'color', NODE_COLOR.org);
        loadOrg(attrs.jarKodas, nodeId);
    } else if (attrs.entityType === 'PersonEntity' && attrs.vardas && attrs.pavarde) {
        graph.setNodeAttribute(nodeId, 'expanded', true);
        loadPerson(attrs.vardas, attrs.pavarde, nodeId);
    }
});

// ── Auto-initialise ───────────────────────────────────────────────────────────

var INITIAL_JAR_KODAS = window.VORATINKLIS_CONFIG.jarKodas;
document.addEventListener('DOMContentLoaded', function () {
    loadOrg(INITIAL_JAR_KODAS, null);
});

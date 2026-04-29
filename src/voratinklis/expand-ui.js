import { mergeGraphElements, runLayout } from './graph-utils.js';
import { hiddenEdgeTypes, NODE_COLOR } from './colors.js';

/**
 * Creates the expand UI controller: wires click handler and exposes loadOrg/loadPerson.
 *
 * @param {{
 *   graph: Graph,
 *   renderer: Sigma,
 *   statusEl: HTMLElement|null,
 *   loadingEl: HTMLElement|null,
 *   forceAtlas2: Function,
 *   noverlap: Function,
 *   animateNodes: Function,
 * }} deps
 * @returns {{ loadOrg: Function, loadPerson: Function }}
 */
export function createExpandUI({ graph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes }) {
    var expandingNodes = new Set();

    function showLoading() { if (loadingEl) loadingEl.hidden = false; }
    function hideLoading() { if (loadingEl) loadingEl.hidden = true; }
    function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

    function getNodePos(id) {
        return graph.hasNode(id) ? graph.getNodeAttributes(id) : null;
    }

    async function _expand(id, fetchUrl, afterMerge) {
        if (expandingNodes.has(id)) return;
        expandingNodes.add(id);
        if (expandingNodes.size === 1) showLoading();
        setStatus('Kraunama...');
        try {
            var data = await fetch(fetchUrl).then(function (r) { return r.json(); });
            var fromNodeId = graph.hasNode(id) ? id : null;
            var startPos = fromNodeId ? getNodePos(fromNodeId) : null;

            var newNodeIds = mergeGraphElements(graph, getNodePos, data, fromNodeId, hiddenEdgeTypes);
            afterMerge(id, data);

            if (startPos && newNodeIds.length > 0) {
                // Pre-position new nodes at start point for animation
                newNodeIds.forEach(function (nid) {
                    graph.setNodeAttribute(nid, 'x', startPos.x);
                    graph.setNodeAttribute(nid, 'y', startPos.y);
                });
                runLayout(graph, forceAtlas2, noverlap);
                // Capture final positions before resetting for animation
                var targets = {};
                newNodeIds.forEach(function (nid) {
                    if (graph.hasNode(nid)) {
                        targets[nid] = {
                            x: graph.getNodeAttribute(nid, 'x'),
                            y: graph.getNodeAttribute(nid, 'y'),
                        };
                    }
                });
                // Reset to start so animateNodes reads the correct start coords
                newNodeIds.forEach(function (nid) {
                    graph.setNodeAttribute(nid, 'x', startPos.x);
                    graph.setNodeAttribute(nid, 'y', startPos.y);
                });
                animateNodes(graph, targets, { duration: 600, easing: 'quadraticInOut' });
            } else {
                runLayout(graph, forceAtlas2, noverlap);
                renderer.refresh();
            }
        } catch (err) {
            setStatus('Klaida kraunant duomenis.');
            console.error(err);
        } finally {
            expandingNodes.delete(id);
            if (expandingNodes.size === 0) hideLoading();
            setStatus('');
        }
    }

    function loadOrg(jarKodas, fromNodeId) {
        var id = 'org:' + jarKodas;
        // If the expansion was triggered by clicking a different node, pre-mark origin
        if (fromNodeId && graph.hasNode(fromNodeId)) {
            graph.setNodeAttribute(fromNodeId, 'color', NODE_COLOR.org);
        }
        return _expand(id, '/voratinklis/expand/' + encodeURIComponent(jarKodas), function (nodeId) {
            if (graph.hasNode(nodeId)) graph.setNodeAttribute(nodeId, 'expanded', true);
        });
    }

    function loadPerson(vardas, pavarde, fromNodeId) {
        var fullName = (vardas + ' ' + pavarde).trim();
        var id = 'person:' + fullName.toLowerCase();
        return _expand(id, '/voratinklis/expand-person?vardas=' + encodeURIComponent(fullName), function (nodeId) {
            if (graph.hasNode(nodeId)) graph.setNodeAttribute(nodeId, 'expanded', true);
        });
    }

    renderer.on('clickNode', function (event) {
        var nodeId = event.node;
        var attrs = graph.getNodeAttributes(nodeId);
        if (attrs.expanded) return;

        if (attrs.entityType === 'OrganizationEntity' && attrs.jarKodas) {
            graph.setNodeAttribute(nodeId, 'expanded', true);
            loadOrg(attrs.jarKodas, nodeId);
        } else if (attrs.entityType === 'PersonEntity' && attrs.vardas && attrs.pavarde) {
            graph.setNodeAttribute(nodeId, 'expanded', true);
            loadPerson(attrs.vardas, attrs.pavarde, nodeId);
        }
    });

    return { loadOrg, loadPerson };
}

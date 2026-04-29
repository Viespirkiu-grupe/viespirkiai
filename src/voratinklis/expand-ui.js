import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout } from './graph-utils.js';
import { hiddenEdgeTypes, NODE_COLOR } from './colors.js';

/**
 * Creates the expand UI controller.
 * Uses a two-graph design: dataGraph holds all fetched data; viewGraph is Sigma's filtered view.
 *
 * @param {{
 *   dataGraph: Graph,
 *   viewGraph: Graph,
 *   renderer: Sigma,
 *   statusEl: HTMLElement|null,
 *   loadingEl: HTMLElement|null,
 *   forceAtlas2: Function,
 *   noverlap: Function,
 *   animateNodes: Function,
 * }} deps
 * @returns {{ loadOrg: Function, loadPerson: Function, rebuildAndRefresh: Function }}
 */
export function createExpandUI({ dataGraph, viewGraph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes }) {
    var expandingNodes = new Set();
    var cancelAnimation = null;

    function showLoading() { if (loadingEl) loadingEl.hidden = false; }
    function hideLoading() { if (loadingEl) loadingEl.hidden = true; }
    function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

    function getNodePos(id) {
        return viewGraph.hasNode(id) ? viewGraph.getNodeAttributes(id) : null;
    }

    /**
     * Rebuilds viewGraph from dataGraph, runs layout, syncs positions, refreshes.
     * Called by legend checkboxes and after every expand.
     */
    function rebuildAndRefresh() {
        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }
        rebuildViewGraph(dataGraph, viewGraph, hiddenEdgeTypes);
        runLayout(viewGraph, forceAtlas2, noverlap);
        syncPositionsToData(dataGraph, viewGraph);
        renderer.refresh();
    }

    async function _expand(id, fetchUrl, afterMerge) {
        if (expandingNodes.has(id)) return;
        expandingNodes.add(id);
        if (expandingNodes.size === 1) showLoading();
        setStatus('Kraunama...');
        try {
            var data = await fetch(fetchUrl).then(function (r) { return r.json(); });
            var fromNodeId = viewGraph.hasNode(id) ? id : null;
            var startPos = fromNodeId ? getNodePos(fromNodeId) : null;

            if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }

            mergeGraphElements(dataGraph, getNodePos, data, fromNodeId);
            afterMerge(id);

            var newNodeIds = rebuildViewGraph(dataGraph, viewGraph, hiddenEdgeTypes);

            if (startPos && newNodeIds.length > 0) {
                // Run layout with natural scattered positions from mergeGraphElements —
                // NOT from startPos. Starting many nodes at the same coordinate causes
                // ForceAtlas2 to produce a degenerate layout (forces cancel out).
                runLayout(viewGraph, forceAtlas2, noverlap);
                syncPositionsToData(dataGraph, viewGraph);
                // Capture final layout positions
                var targets = {};
                newNodeIds.forEach(function (nid) {
                    if (viewGraph.hasNode(nid)) {
                        targets[nid] = {
                            x: viewGraph.getNodeAttribute(nid, 'x'),
                            y: viewGraph.getNodeAttribute(nid, 'y'),
                        };
                    }
                });
                // Reset to startPos so animateNodes animates from the clicked node outward
                newNodeIds.forEach(function (nid) {
                    if (viewGraph.hasNode(nid)) {
                        viewGraph.setNodeAttribute(nid, 'x', startPos.x);
                        viewGraph.setNodeAttribute(nid, 'y', startPos.y);
                    }
                });
                cancelAnimation = animateNodes(viewGraph, targets, { duration: 600, easing: 'quadraticInOut' });
            } else {
                runLayout(viewGraph, forceAtlas2, noverlap);
                syncPositionsToData(dataGraph, viewGraph);
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
        if (fromNodeId && viewGraph.hasNode(fromNodeId)) {
            viewGraph.setNodeAttribute(fromNodeId, 'color', NODE_COLOR.org);
        }
        return _expand(id, '/voratinklis/expand/' + encodeURIComponent(jarKodas), function (nodeId) {
            if (dataGraph.hasNode(nodeId)) dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            if (viewGraph.hasNode(nodeId)) viewGraph.setNodeAttribute(nodeId, 'expanded', true);
        });
    }

    function loadPerson(vardas, pavarde) {
        var fullName = (vardas + ' ' + pavarde).trim();
        var id = 'person:' + fullName.toLowerCase();
        return _expand(id, '/voratinklis/expand-person?vardas=' + encodeURIComponent(fullName), function (nodeId) {
            if (dataGraph.hasNode(nodeId)) dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            if (viewGraph.hasNode(nodeId)) viewGraph.setNodeAttribute(nodeId, 'expanded', true);
        });
    }

    renderer.on('clickNode', function (event) {
        var nodeId = event.node;
        var attrs = viewGraph.getNodeAttributes(nodeId);
        if (attrs.expanded) return;

        if (attrs.entityType === 'OrganizationEntity' && attrs.jarKodas) {
            viewGraph.setNodeAttribute(nodeId, 'expanded', true);
            dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            loadOrg(attrs.jarKodas, nodeId);
        } else if (attrs.entityType === 'PersonEntity' && attrs.vardas && attrs.pavarde) {
            viewGraph.setNodeAttribute(nodeId, 'expanded', true);
            dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            loadPerson(attrs.vardas, attrs.pavarde);
        }
    });

    return { loadOrg, loadPerson, rebuildAndRefresh };
}

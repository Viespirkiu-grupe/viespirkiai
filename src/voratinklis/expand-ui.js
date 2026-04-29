import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout } from './graph-utils.js';
import { NODE_COLOR } from './colors.js';
import { updateLegendForNode } from './legend.js';

/**
 * Creates the expand UI controller.
 * Uses a two-graph design: dataGraph holds all fetched data; viewGraph is Sigma's filtered view.
 *
 * @param {{
 *   dataGraph:    Graph,
 *   viewGraph:    Graph,
 *   renderer:     Sigma,
 *   statusEl:     HTMLElement|null,
 *   loadingEl:    HTMLElement|null,
 *   forceAtlas2:  Function,
 *   noverlap:     Function,
 *   animateNodes: Function,
 *   legendState:  LegendState,
 * }} deps
 * @returns {{ loadOrg, loadPerson, rebuildAndRefresh, getSelectedNodeId }}
 */
export function createExpandUI({ dataGraph, viewGraph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes, legendState }) {
    var expandingNodes = new Set();
    var cancelAnimation = null;
    var selectedNodeId = null;

    function showLoading() { if (loadingEl) loadingEl.hidden = false; }
    function hideLoading() { if (loadingEl) loadingEl.hidden = true; }
    function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

    function getNodePos(id) {
        return viewGraph.hasNode(id) ? viewGraph.getNodeAttributes(id) : null;
    }

    function _isConfigurableNode(attrs) {
        return attrs.entityType === 'OrganizationEntity' || attrs.entityType === 'PersonEntity';
    }

    function _clearSelectionAttrs(id) {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'highlighted', false);
            dataGraph.setNodeAttribute(id, 'selected', false);
        }
        if (viewGraph.hasNode(id)) {
            viewGraph.setNodeAttribute(id, 'highlighted', false);
            viewGraph.setNodeAttribute(id, 'selected', false);
        }
    }

    function _setSelectionAttrs(id) {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'highlighted', true);
            dataGraph.setNodeAttribute(id, 'selected', true);
        }
        if (viewGraph.hasNode(id)) {
            viewGraph.setNodeAttribute(id, 'highlighted', true);
            viewGraph.setNodeAttribute(id, 'selected', true);
        }
    }

    function selectNode(id) {
        if (selectedNodeId && selectedNodeId !== id) {
            _clearSelectionAttrs(selectedNodeId);
        }
        selectedNodeId = id;
        _setSelectionAttrs(id);

        var attrs = viewGraph.hasNode(id) ? viewGraph.getNodeAttributes(id) : {};
        if (_isConfigurableNode(attrs)) {
            legendState.initNode(id);
            updateLegendForNode(id, attrs.label || id, legendState);
        }
        renderer.refresh();
    }

    function deselectAll() {
        if (selectedNodeId) {
            _clearSelectionAttrs(selectedNodeId);
            selectedNodeId = null;
        }
        updateLegendForNode(null, null, legendState);
        renderer.refresh();
    }

    /**
     * Rebuilds viewGraph from dataGraph, runs layout, syncs positions, refreshes Sigma.
     * Called by legend checkboxes and after every expand.
     */
    function rebuildAndRefresh() {
        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }
        rebuildViewGraph(dataGraph, viewGraph, function (s, t, type) { return legendState.isEdgeHidden(s, t, type); });
        runLayout(viewGraph, forceAtlas2, noverlap);
        syncPositionsToData(dataGraph, viewGraph);
        if (selectedNodeId) _setSelectionAttrs(selectedNodeId);
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

            var newNodeIds = rebuildViewGraph(dataGraph, viewGraph, function (s, t, type) { return legendState.isEdgeHidden(s, t, type); });

            // Re-apply selection attrs after rebuild (node may have been re-added)
            if (selectedNodeId && viewGraph.hasNode(selectedNodeId)) {
                _setSelectionAttrs(selectedNodeId);
            }

            if (startPos && newNodeIds.length > 0) {
                runLayout(viewGraph, forceAtlas2, noverlap);
                syncPositionsToData(dataGraph, viewGraph);
                var targets = {};
                newNodeIds.forEach(function (nid) {
                    if (viewGraph.hasNode(nid)) {
                        targets[nid] = {
                            x: viewGraph.getNodeAttribute(nid, 'x'),
                            y: viewGraph.getNodeAttribute(nid, 'y'),
                        };
                    }
                });
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

        if (selectedNodeId === nodeId) {
            deselectAll();
            return;
        }

        selectNode(nodeId);

        var attrs = viewGraph.hasNode(nodeId) ? viewGraph.getNodeAttributes(nodeId) : {};
        if (!attrs.expanded) {
            if (attrs.entityType === 'OrganizationEntity' && attrs.jarKodas) {
                viewGraph.setNodeAttribute(nodeId, 'expanded', true);
                dataGraph.setNodeAttribute(nodeId, 'expanded', true);
                loadOrg(attrs.jarKodas, nodeId);
            } else if (attrs.entityType === 'PersonEntity' && attrs.vardas && attrs.pavarde) {
                viewGraph.setNodeAttribute(nodeId, 'expanded', true);
                dataGraph.setNodeAttribute(nodeId, 'expanded', true);
                loadPerson(attrs.vardas, attrs.pavarde);
            }
        }
    });

    renderer.on('clickStage', deselectAll);

    return { loadOrg, loadPerson, rebuildAndRefresh, getSelectedNodeId: function () { return selectedNodeId; } };
}

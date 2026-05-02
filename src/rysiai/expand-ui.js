import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout } from './graph-utils.js';
import { NODE_COLOR, EDGE_COLOR } from './colors.js';
import { updateLegendForNode } from './legend.js';
import { isConfigurableNode, isOrgNode, isPersonNode, isContractNode, isProcurementNode } from './entity-types.js';
import { showNodeDetails, hideDetails } from './details-panel.js';

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
    const expandingNodes = new Set();
    let cancelAnimation = null;
    let selectedNodeId = null;

    function showLoading() { if (loadingEl) loadingEl.hidden = false; }
    function hideLoading() { if (loadingEl) loadingEl.hidden = true; }
    function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

    function getNodePos(id) {
        return viewGraph.hasNode(id) ? viewGraph.getNodeAttributes(id) : null;
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

        const attrs = viewGraph.hasNode(id) ? viewGraph.getNodeAttributes(id) : {};
        if (isConfigurableNode(attrs)) {
            legendState.initNode(id);
            updateLegendForNode(id, attrs.label || id, legendState);
        }
        showNodeDetails(id, attrs);
        renderer.refresh();
    }

    function deselectAll() {
        if (selectedNodeId) {
            _clearSelectionAttrs(selectedNodeId);
            selectedNodeId = null;
        }
        updateLegendForNode(null, null, legendState);
        hideDetails();
        renderer.refresh();
    }

    /**
     * Rebuilds viewGraph from dataGraph, runs layout, syncs positions, refreshes Sigma.
     * Called by legend checkboxes and after every expand.
     */
    function rebuildAndRefresh() {
        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }
        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => legendState.isEdgeHidden(s, t, type));
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
            const data = await fetch(fetchUrl).then((r) => r.json());
            const fromNodeId = viewGraph.hasNode(id) ? id : null;
            const startPos = fromNodeId ? getNodePos(fromNodeId) : null;

            if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }

            mergeGraphElements(dataGraph, getNodePos, data, fromNodeId);
            afterMerge(id);

            const newNodeIds = rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => legendState.isEdgeHidden(s, t, type));

            // Re-apply selection attrs after rebuild (node may have been re-added)
            if (selectedNodeId && viewGraph.hasNode(selectedNodeId)) {
                _setSelectionAttrs(selectedNodeId);
            }

            if (startPos && newNodeIds.length > 0) {
                runLayout(viewGraph, forceAtlas2, noverlap);
                syncPositionsToData(dataGraph, viewGraph);
                const targets = {};
                newNodeIds.forEach((nid) => {
                    if (viewGraph.hasNode(nid)) {
                        targets[nid] = {
                            x: viewGraph.getNodeAttribute(nid, 'x'),
                            y: viewGraph.getNodeAttribute(nid, 'y'),
                        };
                    }
                });
                newNodeIds.forEach((nid) => {
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
        const id = 'org:' + jarKodas;
        if (fromNodeId && viewGraph.hasNode(fromNodeId)) {
            viewGraph.setNodeAttribute(fromNodeId, 'color', NODE_COLOR.org);
        }
        return _expand(id, '/rysiai/expand/' + encodeURIComponent(jarKodas), (nodeId) => {
            if (dataGraph.hasNode(nodeId)) dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            if (viewGraph.hasNode(nodeId)) viewGraph.setNodeAttribute(nodeId, 'expanded', true);
        });
    }

    function loadPerson(vardas, pavarde) {
        const fullName = (vardas + ' ' + pavarde).trim();
        const id = 'person:' + fullName.toLowerCase();
        return _expand(id, '/rysiai/expand-person?vardas=' + encodeURIComponent(fullName), (nodeId) => {
            if (dataGraph.hasNode(nodeId)) dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            if (viewGraph.hasNode(nodeId)) viewGraph.setNodeAttribute(nodeId, 'expanded', true);
        });
    }

    function loadProcurement(pirkimoId) {
        const id = 'procurement:' + pirkimoId;
        return _expand(id, '/rysiai/expand-procurement/' + encodeURIComponent(pirkimoId), (nodeId) => {
            if (dataGraph.hasNode(nodeId)) dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            if (viewGraph.hasNode(nodeId)) viewGraph.setNodeAttribute(nodeId, 'expanded', true);
        });
    }

    function loadContract(pirkimoNumeris, contractNodeId) {
        const procId = 'procurement:' + pirkimoNumeris;

        const createContractLink = () => {
            const linkEdgeId = 'edge:' + contractNodeId + ':' + procId + ':ContractLink';
            if (dataGraph.hasNode(contractNodeId) && dataGraph.hasNode(procId) && !dataGraph.hasEdge(linkEdgeId)) {
                dataGraph.addEdgeWithKey(linkEdgeId, contractNodeId, procId, {
                    edgeType: 'ContractLink',
                    label: '',
                    color: EDGE_COLOR['ContractLink'] || '#94a3b8',
                    size: 1,
                    forceLabel: false,
                });
            }
        };

        // If procurement already expanded, just add the link and redraw
        if (dataGraph.hasNode(procId) && dataGraph.getNodeAttribute(procId, 'expanded')) {
            createContractLink();
            rebuildAndRefresh();
            return;
        }

        return _expand(procId, '/rysiai/expand-contract/' + encodeURIComponent(pirkimoNumeris), (nodeId) => {
            if (dataGraph.hasNode(nodeId)) dataGraph.setNodeAttribute(nodeId, 'expanded', true);
            if (viewGraph.hasNode(nodeId)) viewGraph.setNodeAttribute(nodeId, 'expanded', true);
            createContractLink();
        });
    }

    renderer.on('clickNode', (event) => {
        const nodeId = event.node;
        const attrs = viewGraph.hasNode(nodeId) ? viewGraph.getNodeAttributes(nodeId) : {};
        console.log('[Ryšiai] click:', nodeId, attrs.entityType || '?', 'expanded:', attrs.expanded);

        if (selectedNodeId === nodeId) {
            deselectAll();
            return;
        }

        selectNode(nodeId);

        if (!attrs.expanded) {
            if (isOrgNode(attrs) && attrs.jarKodas) {
                viewGraph.setNodeAttribute(nodeId, 'expanded', true);
                dataGraph.setNodeAttribute(nodeId, 'expanded', true);
                loadOrg(attrs.jarKodas, nodeId);
            } else if (isPersonNode(attrs) && attrs.vardas && attrs.pavarde) {
                viewGraph.setNodeAttribute(nodeId, 'expanded', true);
                dataGraph.setNodeAttribute(nodeId, 'expanded', true);
                loadPerson(attrs.vardas, attrs.pavarde);
            } else if (isProcurementNode(attrs) && attrs.pirkimoId) {
                viewGraph.setNodeAttribute(nodeId, 'expanded', true);
                dataGraph.setNodeAttribute(nodeId, 'expanded', true);
                loadProcurement(attrs.pirkimoId);
            } else if (isContractNode(attrs)) {
                // Mark expanded for visual ring regardless of whether expansion fires
                viewGraph.setNodeAttribute(nodeId, 'expanded', true);
                dataGraph.setNodeAttribute(nodeId, 'expanded', true);
                if (attrs.pirkimoNumeris) {
                    loadContract(attrs.pirkimoNumeris, nodeId);
                } else {
                    renderer.refresh();
                }
            }
        }
    });

    renderer.on('clickStage', deselectAll);

    return { loadOrg, loadPerson, loadProcurement, loadContract, rebuildAndRefresh, getSelectedNodeId: () => selectedNodeId, selectNode };
}

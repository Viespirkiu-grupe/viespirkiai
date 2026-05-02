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
 * @returns {{ loadOrg, rebuildAndRefresh, getSelectedNodeId, selectNode }}
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

    function setSelection(id, on) {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'highlighted', on);
            dataGraph.setNodeAttribute(id, 'selected', on);
        }
        if (viewGraph.hasNode(id)) {
            viewGraph.setNodeAttribute(id, 'highlighted', on);
            viewGraph.setNodeAttribute(id, 'selected', on);
        }
    }

    function markExpanded(id) {
        if (dataGraph.hasNode(id)) dataGraph.setNodeAttribute(id, 'expanded', true);
        if (viewGraph.hasNode(id)) viewGraph.setNodeAttribute(id, 'expanded', true);
    }

    function isExpandableNode(attrs) {
        return (isOrgNode(attrs) && attrs.jarKodas) ||
               (isPersonNode(attrs) && attrs.vardas && attrs.pavarde) ||
               (isProcurementNode(attrs) && attrs.pirkimoId) ||
               (isContractNode(attrs) && attrs.pirkimoNumeris);
    }

    // Re-renders the details panel for the currently selected node with fresh handlers.
    // Called after expand/collapse to switch Išskleisti ↔ Suskleisti button.
    function refreshSelectedNodePanel() {
        if (!selectedNodeId || !viewGraph.hasNode(selectedNodeId)) return;
        const id = selectedNodeId;
        const attrs = viewGraph.getNodeAttributes(id);
        const handlers = {};
        if (attrs.expanded) {
            handlers.onCollapse = () => collapseNode(id);
        } else if (isExpandableNode(attrs)) {
            handlers.onExpand = () => _triggerExpand(id, attrs);
        }
        showNodeDetails(id, attrs, handlers);
    }

    function selectNode(id) {
        if (selectedNodeId && selectedNodeId !== id) setSelection(selectedNodeId, false);
        selectedNodeId = id;
        setSelection(id, true);

        const attrs = viewGraph.hasNode(id) ? viewGraph.getNodeAttributes(id) : {};
        if (isConfigurableNode(attrs)) {
            legendState.initNode(id);
            updateLegendForNode(id, attrs.label || id, legendState);
        }

        const handlers = {};
        if (attrs.expanded) {
            handlers.onCollapse = () => collapseNode(id);
        } else if (isExpandableNode(attrs)) {
            handlers.onExpand = () => _triggerExpand(id, attrs);
        }
        showNodeDetails(id, attrs, handlers);
        renderer.refresh();
    }

    function deselectAll() {
        if (selectedNodeId) {
            setSelection(selectedNodeId, false);
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
        if (selectedNodeId) setSelection(selectedNodeId, true);
        renderer.refresh();
    }

    // ownerId overrides the derived fromNodeId for ownership tracking — used when the expand
    // target doesn't yet exist in viewGraph (e.g. loadContract expanding a new procurement node).
    async function _expand(id, fetchUrl, afterMerge, ownerId = null) {
        if (expandingNodes.has(id)) return;
        expandingNodes.add(id);
        if (expandingNodes.size === 1) showLoading();
        setStatus('Kraunama...');
        try {
            const data = await fetch(fetchUrl).then((r) => r.json());
            const fromNodeId = ownerId || (viewGraph.hasNode(id) ? id : null);
            const startPos = fromNodeId ? getNodePos(fromNodeId) : null;

            if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }

            mergeGraphElements(dataGraph, getNodePos, data, fromNodeId);
            afterMerge(id);

            const newNodeIds = rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => legendState.isEdgeHidden(s, t, type));

            // Re-apply selection attrs after rebuild (node may have been re-added)
            if (selectedNodeId && viewGraph.hasNode(selectedNodeId)) {
                setSelection(selectedNodeId, true);
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

            // Refresh panel so button switches from Išskleisti → Suskleisti
            refreshSelectedNodePanel();
        } catch (err) {
            setStatus('Klaida kraunant duomenis.');
            console.error(err);
        } finally {
            expandingNodes.delete(id);
            if (expandingNodes.size === 0) hideLoading();
            setStatus('');
        }
    }

    // Config-driven expand kinds for org / person / procurement.
    // Each entry: test(attrs) → should this kind handle the node?
    //             id(attrs)   → the expand-target node ID
    //             url(attrs)  → the fetch URL
    // Adding a new expandable entity type = one new entry here.
    const EXPAND_KINDS = [
        {
            test: (a) => isOrgNode(a) && a.jarKodas,
            id:   (a) => 'org:' + a.jarKodas,
            url:  (a) => '/rysiai/expand/' + encodeURIComponent(a.jarKodas),
        },
        {
            test: (a) => isPersonNode(a) && a.vardas && a.pavarde,
            id:   (a) => { const full = (a.vardas + ' ' + a.pavarde).trim(); return 'person:' + full.toLowerCase(); },
            url:  (a) => '/rysiai/expand-person?vardas=' + encodeURIComponent((a.vardas + ' ' + a.pavarde).trim()),
        },
        {
            test: (a) => isProcurementNode(a) && a.pirkimoId,
            id:   (a) => 'procurement:' + a.pirkimoId,
            url:  (a) => '/rysiai/expand-procurement/' + encodeURIComponent(a.pirkimoId),
        },
    ];

    function _triggerExpand(nodeId, attrs) {
        if (attrs.expanded) return;
        const kind = EXPAND_KINDS.find((k) => k.test(attrs));
        if (kind) {
            if (isOrgNode(attrs)) viewGraph.setNodeAttribute(nodeId, 'color', NODE_COLOR.org);
            markExpanded(nodeId);
            _expand(kind.id(attrs), kind.url(attrs), markExpanded);
        } else if (isContractNode(attrs)) {
            markExpanded(nodeId);
            if (attrs.pirkimoNumeris) {
                loadContract(attrs.pirkimoNumeris, nodeId);
            } else {
                renderer.refresh();
            }
        }
    }

    /**
     * Collapses a node: sets expanded=false, prunes exclusively-owned nodes+edges from
     * dataGraph using expandedBy reference tracking, then rebuilds the view.
     *
     * Nodes shared with other expansions (diamond dependencies) are preserved — only
     * this node's ownership claim is removed from their expandedBy sets.
     */
    function collapseNode(nodeId) {
        if (!dataGraph.hasNode(nodeId)) return;

        dataGraph.setNodeAttribute(nodeId, 'expanded', false);
        if (viewGraph.hasNode(nodeId)) viewGraph.setNodeAttribute(nodeId, 'expanded', false);

        // Collect nodes exclusively owned by this expansion
        const nodesToRemove = [];
        dataGraph.forEachNode((id, attrs) => {
            if (id === nodeId) return;
            const owners = attrs.expandedBy;
            if (owners && owners.has(nodeId)) {
                owners.delete(nodeId);
                if (owners.size === 0 && !attrs.isRoot) nodesToRemove.push(id);
            }
        });

        // Collect edges exclusively owned by this expansion
        const edgesToRemove = [];
        dataGraph.forEachEdge((edgeId, attrs) => {
            const owners = attrs.expandedBy;
            if (owners && owners.has(nodeId)) {
                owners.delete(nodeId);
                if (owners.size === 0) edgesToRemove.push(edgeId);
            }
        });

        edgesToRemove.forEach((eid) => { if (dataGraph.hasEdge(eid)) dataGraph.dropEdge(eid); });
        nodesToRemove.forEach((nid) => { if (dataGraph.hasNode(nid)) dataGraph.dropNode(nid); });

        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }
        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => legendState.isEdgeHidden(s, t, type));
        runLayout(viewGraph, forceAtlas2, noverlap);
        syncPositionsToData(dataGraph, viewGraph);

        if (viewGraph.hasNode(nodeId)) {
            // Node still visible (has edges from other expansions) — update panel to Išskleisti
            setSelection(nodeId, true);
            const updatedAttrs = viewGraph.getNodeAttributes(nodeId);
            showNodeDetails(nodeId, updatedAttrs, { onExpand: () => _triggerExpand(nodeId, updatedAttrs) });
        } else {
            // Node disappeared — clear selection
            if (dataGraph.hasNode(nodeId)) {
                dataGraph.setNodeAttribute(nodeId, 'selected', false);
                dataGraph.setNodeAttribute(nodeId, 'highlighted', false);
            }
            selectedNodeId = null;
            updateLegendForNode(null, null, legendState);
            hideDetails();
        }
        renderer.refresh();
    }

    // loadOrg is part of the public API (called by rysiai-app.js on initial load).
    function loadOrg(jarKodas, fromNodeId) {
        const id = 'org:' + jarKodas;
        if (fromNodeId && viewGraph.hasNode(fromNodeId)) {
            viewGraph.setNodeAttribute(fromNodeId, 'color', NODE_COLOR.org);
        }
        return _expand(id, '/rysiai/expand/' + encodeURIComponent(jarKodas), markExpanded);
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
                    expandedBy: new Set([contractNodeId]),
                });
            }
        };

        // If procurement already expanded, just add the link and redraw
        if (dataGraph.hasNode(procId) && dataGraph.getNodeAttribute(procId, 'expanded')) {
            createContractLink();
            rebuildAndRefresh();
            return;
        }

        // Pass contractNodeId as ownerId so all procurement data is owned by the contract,
        // enabling full cleanup when the contract is collapsed.
        return _expand(procId, '/rysiai/expand-contract/' + encodeURIComponent(pirkimoNumeris), (nodeId) => {
            markExpanded(nodeId);
            createContractLink();
        }, contractNodeId);
    }

    renderer.on('clickNode', (event) => {
        const nodeId = event.node;
        const attrs = viewGraph.hasNode(nodeId) ? viewGraph.getNodeAttributes(nodeId) : {};
        console.log('[Ryšiai] click:', nodeId, attrs.entityType || '?', 'expanded:', attrs.expanded);
        // No-op on re-click: Sigma fires clickNode twice before doubleClickNode.
        // Deselecting on re-click would cause a visible flicker (select → deselect → expand).
        if (selectedNodeId === nodeId) return;
        selectNode(nodeId);
    });

    renderer.on('doubleClickNode', (event) => {
        const nodeId = event.node;
        const attrs = viewGraph.hasNode(nodeId) ? viewGraph.getNodeAttributes(nodeId) : {};
        _triggerExpand(nodeId, attrs);
    });

    renderer.on('clickStage', deselectAll);

    return { loadOrg, loadContract, rebuildAndRefresh, getSelectedNodeId: () => selectedNodeId, selectNode };
}

import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout, collapseGraphData, computeEdgeCounts } from './graph-utils.js';
import { NODE_COLOR, EDGE_COLOR, nodeColor } from './graph-theme.js';
import { isConfigurableNode, isOrgNode, isPersonNode, isContractNode, isProcurementNode } from './entity-types.js';

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
 *   nodeDetails:  NodeDetails,
 * }} deps
 * @returns {{ loadOrg, loadSutartis, loadPirkimas, loadContract, rebuildAndRefresh, getSelectedNodeId, selectNode }}
 */
export function createExpandUI({ dataGraph, viewGraph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes, legendState, nodeDetails, onStateChange = null }) {
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
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'expanded', true);
            if (isOrgNode(dataGraph.getNodeAttributes(id))) {
                dataGraph.setNodeAttribute(id, 'color', NODE_COLOR.org);
            }
        }
        if (viewGraph.hasNode(id)) {
            viewGraph.setNodeAttribute(id, 'expanded', true);
            if (isOrgNode(viewGraph.getNodeAttributes(id))) {
                viewGraph.setNodeAttribute(id, 'color', NODE_COLOR.org);
            }
        }
    }

    function isExpandableNode(attrs) {
        return EXPAND_KINDS.some((k) => k.test(attrs)) || (isContractNode(attrs) && attrs.pirkimoNumeris);
    }

    function buildHandlers(id, attrs) {
        if (attrs.isRoot) return {};
        if (attrs.expanded) return { onCollapse: () => collapseNode(id) };
        if (isExpandableNode(attrs)) return { onExpand: () => _triggerExpand(id, attrs) };
        return {};
    }

    function _showNodePanel(id, attrs, handlers) {
        const counts = isConfigurableNode(attrs) ? computeEdgeCounts(dataGraph, id) : null;
        nodeDetails.showForNode(id, attrs, handlers, counts);
    }

    // Re-renders the details panel for the currently selected node with fresh handlers.
    // Called after expand/collapse to switch Rodyti ↔ Slėpti ryšius and update legend.
    function refreshSelectedNodePanel() {
        if (!selectedNodeId || !viewGraph.hasNode(selectedNodeId)) return;
        const id = selectedNodeId;
        const attrs = dataGraph.getNodeAttributes(id);
        _showNodePanel(id, attrs, buildHandlers(id, attrs));
    }

    function selectNode(id) {
        if (selectedNodeId && selectedNodeId !== id) setSelection(selectedNodeId, false);
        selectedNodeId = id;
        setSelection(id, true);

        const attrs = dataGraph.hasNode(id) ? dataGraph.getNodeAttributes(id) : {};
        const handlers = buildHandlers(id, attrs);
        if (isConfigurableNode(attrs)) legendState.initNode(id);
        _showNodePanel(id, attrs, handlers);
        renderer.refresh();
    }

    function deselectAll() {
        if (selectedNodeId) {
            setSelection(selectedNodeId, false);
            selectedNodeId = null;
        }
        nodeDetails.hide();
        renderer.refresh();
    }

    /**
     * Rebuilds viewGraph from dataGraph, runs layout, syncs positions, refreshes Sigma.
     * Called by legend checkboxes and after every expand.
     */
    function rebuildAndRefresh() {
        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }
        rebuildViewGraph(dataGraph, viewGraph, (s, t, type, sz) => legendState.isEdgeHidden(s, t, type, sz));
        // After a cancelled animation, viewGraph positions may be stale — nodes stacked at the
        // animation origin. Restore last-known positions from dataGraph (saved after each layout
        // pass) so runLayout starts from the correct resting state, not mid-animation positions.
        viewGraph.forEachNode((id) => {
            if (dataGraph.hasNode(id)) {
                viewGraph.setNodeAttribute(id, 'x', dataGraph.getNodeAttribute(id, 'x'));
                viewGraph.setNodeAttribute(id, 'y', dataGraph.getNodeAttribute(id, 'y'));
            }
        });
        runLayout(viewGraph, forceAtlas2, noverlap);
        syncPositionsToData(dataGraph, viewGraph);
        if (selectedNodeId) setSelection(selectedNodeId, true);
        renderer.refresh();
    }

    // ownerId overrides the derived fromNodeId for ownership tracking — used when the expand
    // target doesn't yet exist in viewGraph (e.g. loadContract expanding a new procurement node).
    // rootNodeId marks which single node in the response is the permanent root (isRoot=true,
    // expandedBy stays empty); used by loadOrg for the initial graph load.
    async function _expand(id, fetchUrl, afterMerge, ownerId = null, rootNodeId = null) {
        if (expandingNodes.has(id)) return;
        expandingNodes.add(id);
        if (expandingNodes.size === 1) showLoading();
        setStatus('Kraunama...');
        try {
            const data = await fetch(fetchUrl).then((r) => r.json());
            const fromNodeId = ownerId || (viewGraph.hasNode(id) ? id : null);
            const startPos = fromNodeId ? getNodePos(fromNodeId) : null;

            if (cancelAnimation) {
                cancelAnimation();
                cancelAnimation = null;
                // Restore last-known positions from dataGraph so subsequent layout doesn't start
                // from mid-animation / stacked positions left by the cancelled animation.
                viewGraph.forEachNode((nodeId) => {
                    if (dataGraph.hasNode(nodeId)) {
                        viewGraph.setNodeAttribute(nodeId, 'x', dataGraph.getNodeAttribute(nodeId, 'x'));
                        viewGraph.setNodeAttribute(nodeId, 'y', dataGraph.getNodeAttribute(nodeId, 'y'));
                    }
                });
            }

            mergeGraphElements(dataGraph, getNodePos, data, fromNodeId, rootNodeId);
            afterMerge(id);

            const newNodeIds = rebuildViewGraph(dataGraph, viewGraph, (s, t, type, sz) => legendState.isEdgeHidden(s, t, type, sz));

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

            onStateChange?.();
            // Refresh panel so button switches from Rodyti → Slėpti ryšius
            refreshSelectedNodePanel();
        } catch (err) {
            setStatus('Klaida kraunant duomenis.');
            console.error(err);
            onStateChange?.();
            refreshSelectedNodePanel();
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
            markExpanded(nodeId);
            _expand(kind.id(attrs), kind.url(attrs), markExpanded);
        } else if (isContractNode(attrs)) {
            markExpanded(nodeId);
            legendState.initNode(nodeId);
            if (attrs.pirkimoNumeris) {
                loadContract(attrs.pirkimoNumeris, nodeId);
            } else {
                rebuildAndRefresh();
                onStateChange?.();
                refreshSelectedNodePanel();
            }
        }
    }

    /**
     * Collapses a node: prunes exclusively-owned nodes+edges from dataGraph using expandedBy
     * reference tracking, resets the node's color, then rebuilds the view.
     *
     * Nodes shared with other expansions (diamond dependencies) are preserved — only
     * this node's ownership claim is removed from their expandedBy sets.
     */
    function collapseNode(nodeId) {
        if (!dataGraph.hasNode(nodeId)) return;

        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }

        // Find nodes currently in viewGraph that will be exclusively removed by this collapse
        const collapsePos = getNodePos(nodeId);
        const animationTargets = {};
        if (collapsePos) {
            dataGraph.forEachNode((id, attrs) => {
                if (id === nodeId) return;
                const owners = attrs.expandedBy;
                if (owners && owners.has(nodeId) && owners.size === 1 && !attrs.isRoot && viewGraph.hasNode(id)) {
                    animationTargets[id] = { x: collapsePos.x, y: collapsePos.y };
                }
            });
        }

        const doCollapse = () => {
            cancelAnimation = null;

            // Pure data cleanup (sets expanded=false, removes exclusively-owned nodes+edges)
            collapseGraphData(dataGraph, nodeId);

            // Sync expanded=false and reset color to non-expanded state in viewGraph
            if (viewGraph.hasNode(nodeId)) {
                viewGraph.setNodeAttribute(nodeId, 'expanded', false);
                viewGraph.setNodeAttribute(nodeId, 'color', nodeColor(dataGraph.getNodeAttributes(nodeId)));
            }
            // dataGraph color was already updated by collapseGraphData setting expanded=false;
            // nodeColor reads expanded, so we update the stored color attribute explicitly.
            dataGraph.setNodeAttribute(nodeId, 'color', nodeColor(dataGraph.getNodeAttributes(nodeId)));

            rebuildViewGraph(dataGraph, viewGraph, (s, t, type, sz) => legendState.isEdgeHidden(s, t, type, sz));
            runLayout(viewGraph, forceAtlas2, noverlap);
            syncPositionsToData(dataGraph, viewGraph);

            if (viewGraph.hasNode(nodeId)) {
                // Node still visible (has edges from other expansions) — update panel to Rodyti ryšius
                setSelection(nodeId, true);
                const updatedAttrs = dataGraph.getNodeAttributes(nodeId);
                _showNodePanel(nodeId, updatedAttrs, { onExpand: () => _triggerExpand(nodeId, updatedAttrs) });
            } else {
                // Node disappeared — clear selection
                if (dataGraph.hasNode(nodeId)) {
                    dataGraph.setNodeAttribute(nodeId, 'selected', false);
                    dataGraph.setNodeAttribute(nodeId, 'highlighted', false);
                }
                selectedNodeId = null;
                nodeDetails.hide();
            }
            onStateChange?.();
            renderer.refresh();
        };

        if (Object.keys(animationTargets).length > 0) {
            cancelAnimation = animateNodes(viewGraph, animationTargets, { duration: 400, easing: 'quadraticIn' }, doCollapse);
        } else {
            doCollapse();
        }
    }

    // loadOrg is part of the public API (called by rysiai-app.js on initial load).
    // The root org's own ID is passed as both ownerId and rootNodeId so that:
    //   - All expansion nodes get expandedBy = Set([id]) (enabling collapse cleanup)
    //   - The root org node itself gets isRoot=true and expandedBy=Set() (permanent root)
    function loadOrg(jarKodas, fromNodeId) {
        const id = 'org:' + jarKodas;
        if (fromNodeId && viewGraph.hasNode(fromNodeId)) {
            viewGraph.setNodeAttribute(fromNodeId, 'color', NODE_COLOR.org);
        }
        return _expand(id, '/rysiai/expand/' + encodeURIComponent(jarKodas), markExpanded, id, id);
    }

    function loadContract(pirkimoNumeris, contractNodeId) {
        const procId = 'procurement:' + pirkimoNumeris;

        const createContractProcurementLink = () => {
            const linkEdgeId = 'edge:' + contractNodeId + ':' + procId + ':ContractProcurementLink';
            if (dataGraph.hasNode(contractNodeId) && dataGraph.hasNode(procId) && !dataGraph.hasEdge(linkEdgeId)) {
                dataGraph.addEdgeWithKey(linkEdgeId, contractNodeId, procId, {
                    edgeType: 'ContractProcurementLink',
                    label: '',
                    color: EDGE_COLOR['ContractProcurementLink'] || '#94a3b8',
                    size: 1,
                    forceLabel: false,
                    expandedBy: new Set([contractNodeId]),
                });
            }
        };

        // If procurement already expanded, just add the link and redraw
        if (dataGraph.hasNode(procId) && dataGraph.getNodeAttribute(procId, 'expanded')) {
            createContractProcurementLink();
            rebuildAndRefresh();
            return;
        }

        // Pass contractNodeId as ownerId so all procurement data is owned by the contract,
        // enabling full cleanup when the contract is collapsed.
        return _expand(procId, '/rysiai/expand-contract/' + encodeURIComponent(pirkimoNumeris), (nodeId) => {
            markExpanded(nodeId);
            createContractProcurementLink();
        }, contractNodeId);
    }

    function loadSutartis(sutartiesUnikalusId) {
        const id = 'contract:' + sutartiesUnikalusId;
        return _expand(id, '/rysiai/expand-sutartis/' + encodeURIComponent(sutartiesUnikalusId), markExpanded, id, id);
    }

    function loadPirkimas(pirkimoId) {
        const id = 'procurement:' + pirkimoId;
        return _expand(id, '/rysiai/expand-pirkimas/' + encodeURIComponent(pirkimoId), markExpanded, id, id);
    }

    renderer.on('clickNode', (event) => {
        const nodeId = event.node;
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

    return { loadOrg, loadSutartis, loadPirkimas, loadContract, rebuildAndRefresh, getSelectedNodeId: () => selectedNodeId, selectNode };
}

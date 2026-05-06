import { mergeGraphElements, rebuildViewGraph, syncPositionsToData, runLayout, collapseGraphData, computeEdgeCounts } from './graph-utils.ts';
import { NODE_COLOR, EDGE_COLOR, nodeColor } from './graph-theme.ts';
import { isConfigurableNode, isOrgNode, isPersonNode, isContractNode, isProcurementNode } from './entity-types.ts';
import type { LegendState } from './legend-state.ts';
import type { NodeDetails } from './details-panel.ts';
import type Graph from 'graphology';
import type forceAtlas2 from 'graphology-layout-forceatlas2';
import type noverlap from 'graphology-layout-noverlap';
type IForceAtlas2Layout = typeof forceAtlas2;
type INoverlapLayout = typeof noverlap;

interface ExpandUIDeps {
    dataGraph: Graph;
    viewGraph: Graph;
    renderer: {
        on: (event: string, handler: (event: { node: string }) => void) => void;
        refresh: () => void;
        graphToViewport: (pos: { x: number; y: number }) => { x: number; y: number };
    };
    statusEl: HTMLElement | null;
    loadingEl: HTMLElement | null;
    forceAtlas2: IForceAtlas2Layout;
    noverlap: INoverlapLayout;
    animateNodes: (graph: Graph, targets: Record<string, { x: number; y: number }>, opts: { duration: number; easing: string }, callback?: () => void) => () => void;
    legendState: LegendState;
    nodeDetails: NodeDetails;
    onStateChange?: (() => void) | null;
}

interface NodeAttrsLocal {
    expanded?: boolean;
    isRoot?: boolean;
    jarKodas?: string;
    vardas?: string;
    pavarde?: string;
    pirkimoId?: string;
    pirkimoNumeris?: string;
    entityType?: string;
    [key: string]: unknown;
}

interface ExpandKind {
    test: (a: NodeAttrsLocal) => boolean;
    id: (a: NodeAttrsLocal) => string;
    url: (a: NodeAttrsLocal) => string;
}

export function createExpandUI({ dataGraph, viewGraph, renderer, statusEl, loadingEl, forceAtlas2, noverlap, animateNodes, legendState, nodeDetails, onStateChange = null }: ExpandUIDeps) {
    const expandingNodes = new Set<string>();
    let cancelAnimation: (() => void) | null = null;
    let selectedNodeId: string | null = null;

    function showLoading() { if (loadingEl) loadingEl.hidden = false; }
    function hideLoading() { if (loadingEl) loadingEl.hidden = true; }
    function setStatus(msg: string) { if (statusEl) statusEl.textContent = msg || ''; }

    function getNodePos(id: string): { x: number; y: number } | null {
        return viewGraph.hasNode(id) ? viewGraph.getNodeAttributes(id) as { x: number; y: number } : null;
    }

    function setSelection(id: string, on: boolean) {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'highlighted', on);
            dataGraph.setNodeAttribute(id, 'selected', on);
        }
        if (viewGraph.hasNode(id)) {
            viewGraph.setNodeAttribute(id, 'highlighted', on);
            viewGraph.setNodeAttribute(id, 'selected', on);
        }
    }

    function markExpanded(id: string) {
        if (dataGraph.hasNode(id)) {
            dataGraph.setNodeAttribute(id, 'expanded', true);
            if (isOrgNode(dataGraph.getNodeAttributes(id) as NodeAttrsLocal)) {
                dataGraph.setNodeAttribute(id, 'color', NODE_COLOR.org);
            }
        }
        if (viewGraph.hasNode(id)) {
            viewGraph.setNodeAttribute(id, 'expanded', true);
            if (isOrgNode(viewGraph.getNodeAttributes(id) as NodeAttrsLocal)) {
                viewGraph.setNodeAttribute(id, 'color', NODE_COLOR.org);
            }
        }
    }

    function isExpandableNode(attrs: NodeAttrsLocal): boolean {
        return EXPAND_KINDS.some((k) => k.test(attrs)) || (isContractNode(attrs) && !!attrs.pirkimoNumeris);
    }

    function buildHandlers(id: string, attrs: NodeAttrsLocal) {
        if (attrs.isRoot) return {};
        if (attrs.expanded) return { onCollapse: () => collapseNode(id) };
        if (isExpandableNode(attrs)) return { onExpand: () => _triggerExpand(id, attrs) };
        return {};
    }

    function _showNodePanel(id: string, attrs: NodeAttrsLocal, handlers: ReturnType<typeof buildHandlers>) {
        const counts = isConfigurableNode(attrs) ? computeEdgeCounts(dataGraph, id) : null;
        nodeDetails.showForNode(id, attrs as Record<string, unknown>, handlers, counts);
    }

    function refreshSelectedNodePanel() {
        if (!selectedNodeId || !viewGraph.hasNode(selectedNodeId)) return;
        const id = selectedNodeId;
        const attrs = dataGraph.getNodeAttributes(id) as NodeAttrsLocal;
        _showNodePanel(id, attrs, buildHandlers(id, attrs));
    }

    function selectNode(id: string) {
        if (selectedNodeId && selectedNodeId !== id) setSelection(selectedNodeId, false);
        selectedNodeId = id;
        setSelection(id, true);

        const attrs = dataGraph.hasNode(id) ? dataGraph.getNodeAttributes(id) as NodeAttrsLocal : {};
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

    function rebuildAndRefresh() {
        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }
        rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => legendState.isEdgeHidden(s, t, type));
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

    async function _expand(id: string, fetchUrl: string, afterMerge: (id: string) => void, ownerId: string | null = null, rootNodeId: string | null = null) {
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
                viewGraph.forEachNode((nodeId) => {
                    if (dataGraph.hasNode(nodeId)) {
                        viewGraph.setNodeAttribute(nodeId, 'x', dataGraph.getNodeAttribute(nodeId, 'x'));
                        viewGraph.setNodeAttribute(nodeId, 'y', dataGraph.getNodeAttribute(nodeId, 'y'));
                    }
                });
            }

            console.warn('Fetched data for', id, data);
            mergeGraphElements(dataGraph, getNodePos, data, fromNodeId, rootNodeId);
            afterMerge(id);

            const newNodeIds = rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => legendState.isEdgeHidden(s, t, type));

            if (selectedNodeId && viewGraph.hasNode(selectedNodeId)) {
                setSelection(selectedNodeId, true);
            }

            if (startPos && newNodeIds.length > 0) {
                runLayout(viewGraph, forceAtlas2, noverlap);
                syncPositionsToData(dataGraph, viewGraph);
                const targets: Record<string, { x: number; y: number }> = {};
                newNodeIds.forEach((nid) => {
                    if (viewGraph.hasNode(nid)) {
                        targets[nid] = {
                            x: viewGraph.getNodeAttribute(nid, 'x') as number,
                            y: viewGraph.getNodeAttribute(nid, 'y') as number,
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

    const EXPAND_KINDS: ExpandKind[] = [
        {
            test: (a) => isOrgNode(a) && !!a.jarKodas,
            id:   (a) => 'org:' + a.jarKodas,
            url:  (a) => '/rysiai/expand/' + encodeURIComponent(a.jarKodas!),
        },
        {
            test: (a) => isPersonNode(a) && !!a.vardas && !!a.pavarde,
            id:   (a) => { const full = (a.vardas + ' ' + a.pavarde).trim(); return 'person:' + full.toLowerCase(); },
            url:  (a) => '/rysiai/expand-person?vardas=' + encodeURIComponent((a.vardas + ' ' + a.pavarde).trim()),
        },
        {
            test: (a) => isProcurementNode(a) && !!a.pirkimoId,
            id:   (a) => 'procurement:' + a.pirkimoId,
            url:  (a) => '/rysiai/expand-procurement/' + encodeURIComponent(a.pirkimoId!),
        },
    ];

    function _triggerExpand(nodeId: string, attrs: NodeAttrsLocal) {
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

    function collapseNode(nodeId: string) {
        if (!dataGraph.hasNode(nodeId)) return;

        if (cancelAnimation) { cancelAnimation(); cancelAnimation = null; }

        const collapsePos = getNodePos(nodeId);
        const animationTargets: Record<string, { x: number; y: number }> = {};
        if (collapsePos) {
            dataGraph.forEachNode((id, attrs) => {
                const a = attrs as NodeAttrsLocal & { expandedBy?: Set<string>; isRoot?: boolean };
                if (id === nodeId) return;
                const owners = a.expandedBy;
                if (owners && owners.has(nodeId) && owners.size === 1 && !a.isRoot && viewGraph.hasNode(id)) {
                    animationTargets[id] = { x: collapsePos.x, y: collapsePos.y };
                }
            });
        }

        const doCollapse = () => {
            cancelAnimation = null;

            collapseGraphData(dataGraph, nodeId);

            if (viewGraph.hasNode(nodeId)) {
                viewGraph.setNodeAttribute(nodeId, 'expanded', false);
                viewGraph.setNodeAttribute(nodeId, 'color', nodeColor(dataGraph.getNodeAttributes(nodeId) as NodeAttrsLocal));
            }
            dataGraph.setNodeAttribute(nodeId, 'color', nodeColor(dataGraph.getNodeAttributes(nodeId) as NodeAttrsLocal));

            rebuildViewGraph(dataGraph, viewGraph, (s, t, type) => legendState.isEdgeHidden(s, t, type));
            runLayout(viewGraph, forceAtlas2, noverlap);
            syncPositionsToData(dataGraph, viewGraph);

            if (viewGraph.hasNode(nodeId)) {
                setSelection(nodeId, true);
                const updatedAttrs = dataGraph.getNodeAttributes(nodeId) as NodeAttrsLocal;
                _showNodePanel(nodeId, updatedAttrs, { onExpand: () => _triggerExpand(nodeId, updatedAttrs) });
            } else {
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

    function loadOrg(jarKodas: string, fromNodeId: string | null) {
        const id = 'org:' + jarKodas;
        if (fromNodeId && viewGraph.hasNode(fromNodeId)) {
            viewGraph.setNodeAttribute(fromNodeId, 'color', NODE_COLOR.org);
        }
        return _expand(id, '/rysiai/expand/' + encodeURIComponent(jarKodas), markExpanded, id, id);
    }

    function loadContract(pirkimoNumeris: string, contractNodeId: string) {
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

        if (dataGraph.hasNode(procId) && dataGraph.getNodeAttribute(procId, 'expanded')) {
            createContractProcurementLink();
            rebuildAndRefresh();
            return;
        }

        return _expand(procId, '/rysiai/expand-contract/' + encodeURIComponent(pirkimoNumeris), (nodeId) => {
            markExpanded(nodeId);
            createContractProcurementLink();
        }, contractNodeId);
    }

    function loadPerson(fullName: string) {
        const id = 'person:' + fullName.toLowerCase().trim();
        return _expand(id, '/rysiai/expand-person?vardas=' + encodeURIComponent(fullName.trim()), markExpanded, id, id);
    }

    function loadSutartis(sutartiesUnikalusId: string) {
        const id = 'contract:' + sutartiesUnikalusId;
        return _expand(id, '/rysiai/expand-sutartis/' + encodeURIComponent(sutartiesUnikalusId), markExpanded, id, id);
    }

    function loadPirkimas(pirkimoId: string) {
        const id = 'procurement:' + pirkimoId;
        return _expand(id, '/rysiai/expand-pirkimas/' + encodeURIComponent(pirkimoId), markExpanded, id, id);
    }

    renderer.on('clickNode', (event) => {
        const nodeId = event.node;
        if (selectedNodeId === nodeId) return;
        selectNode(nodeId);
    });

    renderer.on('doubleClickNode', (event) => {
        const nodeId = event.node;
        const attrs = viewGraph.hasNode(nodeId) ? viewGraph.getNodeAttributes(nodeId) as NodeAttrsLocal : {};
        _triggerExpand(nodeId, attrs);
    });

    renderer.on('clickStage', deselectAll as unknown as (event: { node: string }) => void);

    return { loadOrg, loadPerson, loadSutartis, loadPirkimas, loadContract, rebuildAndRefresh, getSelectedNodeId: () => selectedNodeId, selectNode };
}

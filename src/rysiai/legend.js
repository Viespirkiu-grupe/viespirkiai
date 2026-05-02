/**
 * Updates the legend visibility and checkbox state for the selected node.
 * Legend is only shown when nodeId is non-null AND expanded is true.
 *
 * @param {string|null}   nodeId      - selected node's ID, or null to hide legend
 * @param {string|null}   label       - selected node's display label
 * @param {LegendState}   legendState - the LegendState instance
 * @param {boolean}       [expanded]  - whether the selected node is expanded; legend hidden when false
 */
export function updateLegendForNode(nodeId, label, legendState, expanded) {
    const legendEl = document.getElementById('rysiai-legend');
    const titleEl = document.getElementById('rysiai-legend-title');

    if (nodeId == null || !expanded) {
        if (legendEl) legendEl.hidden = true;
        return;
    }

    if (legendEl) legendEl.hidden = false;
    if (titleEl) titleEl.textContent = label != null ? label : nodeId;

    document.querySelectorAll('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
        const types = cb.dataset.edgeTypes.split(',');
        cb.checked = types.every((t) => legendState.isTypeVisible(nodeId, t.trim()));
    });
}

/**
 * Wires legend checkboxes to mutate LegendState and trigger a graph rebuild.
 *
 * When a node is selected (getSelectedNodeId returns non-null), the checkbox mutation
 * is applied to that node's per-node configuration via setTypeVisible.
 * When no node is selected, setGlobalTypeVisible is used instead.
 *
 * @param {() => string|null} getSelectedNodeId  - returns the currently selected node ID or null
 * @param {LegendState}        legendState        - the LegendState instance
 * @param {Function}           rebuildAndRefresh  - callback from createExpandUI
 */
export function bindLegendCheckboxes(getSelectedNodeId, legendState, rebuildAndRefresh) {
    document.querySelectorAll('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
        cb.addEventListener('change', () => {
            const nodeId = getSelectedNodeId();
            const types = cb.dataset.edgeTypes.split(',');
            types.forEach((t) => {
                const type = t.trim();
                if (nodeId != null) {
                    legendState.setTypeVisible(nodeId, type, cb.checked);
                } else {
                    legendState.setGlobalTypeVisible(type, cb.checked);
                }
            });
            rebuildAndRefresh();
        });
    });
}


/**
 * Updates the legend title and syncs checkbox state for the selected node (or global state).
 *
 * @param {string|null}   nodeId      - selected node's ID, or null to show global state
 * @param {string|null}   label       - selected node's display label, or null for 'Filtrai'
 * @param {LegendState}   legendState - the LegendState instance
 */
export function updateLegendForNode(nodeId, label, legendState) {
    const legendEl = document.getElementById('rysiai-legend');
    const titleEl = document.getElementById('rysiai-legend-title');

    if (nodeId == null) {
        if (legendEl) legendEl.hidden = true;
        return;
    }

    if (legendEl) legendEl.hidden = false;
    if (titleEl) titleEl.textContent = label != null ? label : nodeId;

    document.querySelectorAll('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
        const types = cb.dataset.edgeTypes.split(',');
        if (nodeId != null) {
            cb.checked = types.every((t) => legendState.isTypeVisible(nodeId, t.trim()));
        } else {
            cb.checked = types.every((t) => legendState.isGlobalTypeVisible(t.trim()));
        }
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


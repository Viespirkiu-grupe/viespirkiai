/**
 * Updates the legend title and syncs checkbox state for the selected node (or global state).
 *
 * @param {string|null}   nodeId      - selected node's ID, or null to show global state
 * @param {string|null}   label       - selected node's display label, or null for 'Filtrai'
 * @param {LegendState}   legendState - the LegendState instance
 */
export function updateLegendForNode(nodeId, label, legendState) {
    var titleEl = document.getElementById('voratinklis-legend-title');
    if (titleEl) titleEl.textContent = label != null ? label : 'Filtrai';

    document.querySelectorAll('#voratinklis-legend input[type=checkbox][data-edge-types]').forEach(function (cb) {
        var types = cb.dataset.edgeTypes.split(',');
        if (nodeId != null) {
            cb.checked = types.every(function (t) { return legendState.isTypeVisible(nodeId, t.trim()); });
        } else {
            cb.checked = types.every(function (t) { return legendState.isGlobalTypeVisible(t.trim()); });
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
    document.querySelectorAll('#voratinklis-legend input[type=checkbox][data-edge-types]').forEach(function (cb) {
        cb.addEventListener('change', function () {
            var nodeId = getSelectedNodeId();
            var types = cb.dataset.edgeTypes.split(',');
            types.forEach(function (t) {
                var type = t.trim();
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


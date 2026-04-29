/**
 * Wires legend checkboxes to control node/edge visibility via rebuildAndRefresh.
 * On toggle: updates hiddenEdgeTypes Set, then calls rebuildAndRefresh() which
 * removes orphan nodes (no visible edges) and rearranges the graph.
 *
 * @param {Set<string>} hiddenEdgeTypes  - shared mutable Set from colors.js
 * @param {Function}    rebuildAndRefresh - callback from createExpandUI
 */
export function bindLegendCheckboxes(hiddenEdgeTypes, rebuildAndRefresh) {
    document.querySelectorAll('#voratinklis-legend input[type=checkbox][data-edge-types]').forEach(function (cb) {
        cb.addEventListener('change', function () {
            var types = cb.dataset.edgeTypes.split(',');
            types.forEach(function (t) {
                var type = t.trim();
                if (cb.checked) {
                    hiddenEdgeTypes.delete(type);
                } else {
                    hiddenEdgeTypes.add(type);
                }
            });
            rebuildAndRefresh();
        });
    });
}

import { hiddenEdgeTypes } from './colors.js';

/**
 * Toggles visibility of all edges of a given type in the graph.
 *
 * @param {Graph}   graph
 * @param {string}  edgeType
 * @param {boolean} visible
 */
export function toggleEdgeTypeVisibility(graph, edgeType, visible) {
    graph.forEachEdge(function (id, attrs) {
        if (attrs.edgeType === edgeType) {
            graph.setEdgeAttribute(id, 'hidden', !visible);
        }
    });
}

/**
 * Wires legend checkboxes to show/hide edge types.
 * Expects checkboxes with attribute data-edge-types="Type1,Type2" (comma-separated).
 * Mutates the shared hiddenEdgeTypes Set so that new edges added later respect the state.
 *
 * @param {Graph}    graph
 * @param {Renderer} renderer  - Sigma renderer instance
 */
export function bindLegendCheckboxes(graph, renderer) {
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
                toggleEdgeTypeVisibility(graph, type, cb.checked);
            });
            renderer.refresh();
        });
    });
}

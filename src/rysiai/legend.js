import { svgIcon } from './icons.js';

/**
 * Updates the legend visibility, checkbox state, and action button for the selected node.
 * Legend is shown when nodeId is non-null AND expanded is true.
 * The collapse button for configurable nodes is rendered at the bottom of the legend.
 *
 * @param {string|null}   nodeId      - selected node's ID, or null to hide legend
 * @param {LegendState}   legendState - the LegendState instance
 * @param {boolean}       expanded    - whether the selected node is expanded
 * @param {object}        [handlers]  - { onExpand?, onCollapse? }
 */
export function updateLegendForNode(nodeId, legendState, expanded, handlers = {}) {
    const legendEl = document.getElementById('rysiai-legend');
    const btnEl = document.getElementById('rysiai-legend-btn');

    if (nodeId == null || !expanded) {
        if (legendEl) legendEl.hidden = true;
        return;
    }

    if (legendEl) legendEl.hidden = false;

    document.querySelectorAll('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
        const types = cb.dataset.edgeTypes.split(',');
        cb.checked = types.every((t) => legendState.isTypeVisible(nodeId, t.trim()));
    });
    document.querySelectorAll('#rysiai-legend input[type=checkbox][data-contract-size]').forEach((cb) => {
        cb.checked = legendState.isSizeCategoryVisible(nodeId, cb.dataset.contractSize);
    });

    if (btnEl) {
        if (handlers.onExpand || handlers.onCollapse) {
            const isExpanded = !!handlers.onCollapse;
            const iconKey = isExpanded ? 'Adjust' : 'Hub';
            const btnLabel = isExpanded ? 'Suskleisti' : 'Išskleisti';
            const action = isExpanded ? 'collapse' : 'expand';
            btnEl.innerHTML = '<button class="btn btn-ghost btn-sm vd-btn" data-action="' + action + '">' + svgIcon(iconKey) + '<span>' + btnLabel + '</span></button>';
            const btn = btnEl.querySelector('[data-action]');
            if (btn) {
                btn.addEventListener('click', () => {
                    if (btn.dataset.action === 'expand') handlers.onExpand?.();
                    else handlers.onCollapse?.();
                });
            }
        } else {
            btnEl.innerHTML = '';
        }
    }
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
    document.querySelectorAll('#rysiai-legend input[type=checkbox][data-contract-size]').forEach((cb) => {
        cb.addEventListener('change', () => {
            const nodeId = getSelectedNodeId();
            const category = cb.dataset.contractSize;
            if (nodeId != null) {
                legendState.setSizeCategoryVisible(nodeId, category, cb.checked);
            } else {
                legendState.setGlobalSizeCategoryVisible(category, cb.checked);
            }
            rebuildAndRefresh();
        });
    });
}


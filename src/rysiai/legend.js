import { buildExpandButtonHtml } from './details-panel.js';

// ── NodeLegend component ──────────────────────────────────────────────────────

/**
 * Manages the legend panel: edge-type checkboxes, contract-size checkboxes,
 * counts, and the expand/collapse action button.
 *
 * Composed inside NodeDetails — shown when a configurable node (org/person) is
 * selected and expanded; hidden otherwise.
 */
export class NodeLegend {
    constructor({ legendState }) {
        this._state = legendState;
    }

    /**
     * Updates legend visibility, checkbox state, counts, and action button.
     * Legend is shown when nodeId is non-null AND expanded is true.
     *
     * @param {string|null}   nodeId
     * @param {boolean}       expanded
     * @param {object}        [handlers]  { onExpand?, onCollapse? }
     * @param {{ byType: Map<string,number>, bySize: Map<string,number> }|null} [counts]
     */
    updateForNode(nodeId, expanded, handlers = {}, counts = null) {
        const legendEl = document.getElementById('rysiai-legend');
        const btnEl = document.getElementById('rysiai-legend-btn');

        if (nodeId == null || !expanded) {
            if (legendEl) legendEl.hidden = true;
            return;
        }

        if (legendEl) legendEl.hidden = false;

        document.querySelectorAll('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
            const types = cb.dataset.edgeTypes.split(',');
            cb.checked = types.every((t) => this._state.isTypeVisible(nodeId, t.trim()));
            const labelEl = cb.closest('label');
            if (counts) {
                const count = types.reduce((sum, t) => sum + (counts.byType.get(t.trim()) || 0), 0);
                if (labelEl) labelEl.hidden = count === 0;
                const countEl = labelEl ? labelEl.querySelector('.vl-count') : null;
                if (countEl) countEl.textContent = count > 0 ? '(' + count + ')' : '';
            } else if (labelEl) {
                labelEl.hidden = false;
            }
        });

        document.querySelectorAll('#rysiai-legend input[type=checkbox][data-contract-size]').forEach((cb) => {
            cb.checked = this._state.isSizeCategoryVisible(nodeId, cb.dataset.contractSize);
            const labelEl = cb.closest('label');
            if (counts) {
                const count = counts.bySize.get(cb.dataset.contractSize) || 0;
                if (labelEl) labelEl.hidden = count === 0;
                const countEl = labelEl ? labelEl.querySelector('.vl-count') : null;
                if (countEl) countEl.textContent = count > 0 ? '(' + count + ')' : '';
            } else if (labelEl) {
                labelEl.hidden = false;
            }
        });

        if (btnEl) {
            const btnHtml = buildExpandButtonHtml(handlers);
            if (btnHtml) {
                btnEl.innerHTML = btnHtml;
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

    hide() {
        const legendEl = document.getElementById('rysiai-legend');
        if (legendEl) legendEl.hidden = true;
    }

    /**
     * Wires legend checkboxes to mutate LegendState and trigger a graph rebuild.
     * Call once after the expand UI is ready.
     *
     * @param {() => string|null} getSelectedNodeId
     * @param {Function}          rebuildAndRefresh
     */
    bindCheckboxes(getSelectedNodeId, rebuildAndRefresh) {
        document.querySelectorAll('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const nodeId = getSelectedNodeId();
                const types = cb.dataset.edgeTypes.split(',');
                types.forEach((t) => {
                    const type = t.trim();
                    if (nodeId != null) {
                        this._state.setTypeVisible(nodeId, type, cb.checked);
                    } else {
                        this._state.setGlobalTypeVisible(type, cb.checked);
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
                    this._state.setSizeCategoryVisible(nodeId, category, cb.checked);
                } else {
                    this._state.setGlobalSizeCategoryVisible(category, cb.checked);
                }
                rebuildAndRefresh();
            });
        });
    }
}

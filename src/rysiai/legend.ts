import { buildExpandButtonHtml } from './details-panel.ts';
import type { LegendState } from './legend-state.ts';

interface LegendHandlers {
    onExpand?: () => void;
    onCollapse?: () => void;
}

// ── NodeLegend component ──────────────────────────────────────────────────────

export class NodeLegend {
    private _state: LegendState;

    constructor({ legendState }: { legendState: LegendState }) {
        this._state = legendState;
    }

    updateForNode(nodeId: string | null, expanded: boolean, handlers: LegendHandlers = {}, counts: Map<string, number> | null = null): void {
        const legendEl = document.getElementById('rysiai-legend');
        const btnEl = document.getElementById('rysiai-legend-btn');

        if (nodeId == null || !expanded) {
            if (legendEl) legendEl.hidden = true;
            return;
        }

        if (legendEl) legendEl.hidden = false;

        document.querySelectorAll<HTMLInputElement>('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
            const types = cb.dataset.edgeTypes!.split(',');
            cb.checked = types.every((t) => this._state.isTypeVisible(nodeId, t.trim()));
            const labelEl = cb.closest('label');
            if (counts) {
                const count = types.reduce((sum, t) => sum + (counts.get(t.trim()) || 0), 0);
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
                const btn = btnEl.querySelector<HTMLElement>('[data-action]');
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

    hide(): void {
        const legendEl = document.getElementById('rysiai-legend');
        if (legendEl) legendEl.hidden = true;
    }

    bindCheckboxes(getSelectedNodeId: () => string | null, rebuildAndRefresh: () => void): void {
        document.querySelectorAll<HTMLInputElement>('#rysiai-legend input[type=checkbox][data-edge-types]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const nodeId = getSelectedNodeId();
                const types = cb.dataset.edgeTypes!.split(',');
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
    }
}

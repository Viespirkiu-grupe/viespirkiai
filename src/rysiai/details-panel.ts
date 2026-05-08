import { isOrgNode, isPersonNode, isContractNode, isProcurementNode, isConfigurableNode } from './entity-types.ts';
import type { LegendState } from './legend-state.ts';

export interface NodeHandlers {
    onExpand?: () => void;
    onCollapse?: () => void;
}

// ── Shared expand/collapse button ─────────────────────────────────────────────

export function buildExpandButtonHtml(handlers: NodeHandlers): string {
    if (!handlers.onExpand && !handlers.onCollapse) return '';
    const isExpanded = !!handlers.onCollapse;
    const icon = isExpanded ? '▲' : '▼';
    const label = isExpanded ? 'Slėpti ryšius' : 'Rodyti ryšius';
    const action = isExpanded ? 'collapse' : 'expand';
    return '<button class="btn btn-ghost btn-sm vd-btn" data-action="' + action + '">' + icon + ' <span>' + label + '</span></button>';
}

// ── Private helpers ───────────────────────────────────────────────────────────

function formatContractValue(verte: number | null | undefined): string {
    if (verte == null || verte === 0) return '';
    const v = Math.round(verte);
    if (v >= 1000000) return '€' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return '€' + Math.round(v / 1000) + 'K';
    return '€' + v;
}

function link(href: string, label: string): string {
    return '<a href="' + href + '" target="_blank" rel="noopener" class="vd-link">' + label + ' ↗</a>';
}

function esc(s: unknown): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(attrs: Record<string, unknown>, handlers: NodeHandlers = {}): string {
    let html = '';

    if (isOrgNode(attrs)) {
        let employees = '';
        const d1 = (attrs.draustieji as number) || 0;
        const d2 = (attrs.draustieji2 as number) || 0;
        const count = d1 + d2;
        if (count > 0) employees = '<div class="vd-sub">Darbuotojų: ' + count + '</div>';
        html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>'
            + '<div class="vd-sub">' + esc(attrs.jarKodas) + '</div>'
            + employees
            + link('/asmuo/' + encodeURIComponent(attrs.jarKodas as string), 'Peržiūrėti įmonę');
    } else if (isContractNode(attrs)) {
        const valueStr = formatContractValue(attrs.verte as number);
        const sutId = attrs.sutartiesUnikalusId || (attrs.id as string).replace('contract:', '');
        html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>';
        if (valueStr) html += '<div class="vd-sub">' + valueStr + '</div>';
        html += link('/sutartis/' + encodeURIComponent(sutId as string), 'Peržiūrėti sutartį');
        if (attrs.pirkimoNumeris) {
            html += link('/viesiejiPirkimai/' + encodeURIComponent(attrs.pirkimoNumeris as string), 'Peržiūrėti pirkimą');
        }
    } else if (isProcurementNode(attrs)) {
        const procValue = formatContractValue(attrs.numatomaVerteEUR as number);
        html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>';
        if (procValue) html += '<div class="vd-sub">' + procValue + '</div>';
        if (attrs.statusas) html += '<div class="vd-sub">' + esc(attrs.statusas) + '</div>';
        html += link('/viesiejiPirkimai/' + encodeURIComponent(attrs.pirkimoId as string), 'Peržiūrėti pirkimą');
    } else if (isPersonNode(attrs)) {
        const name = (((attrs.vardas as string) || '') + ' ' + ((attrs.pavarde as string) || '')).trim();
        html = '<div class="vd-title">' + esc(name) + '</div>';
    }

    // Configurable nodes (org/person) get their expand/collapse button in the legend panel.
    const showButton = handlers.onExpand || (handlers.onCollapse && !isConfigurableNode(attrs));
    if (html && showButton) {
        html += buildExpandButtonHtml(handlers);
    }

    return html;
}

// ── NodePanel — unified controller for the #node-details overlay ──────────────
// Controls both #rysiai-details (node info) and #rysiai-legend (edge-type filter)
// as a single panel, backed by LegendState for visibility logic.

export class NodePanel {
    private _state: LegendState;
    private _panel: HTMLElement | null = null;
    private _wrapper: HTMLElement | null = null;

    constructor({ legendState }: { legendState: LegendState }) {
        this._state = legendState;
    }

    private _getPanel(): HTMLElement | null {
        if (!this._panel) this._panel = document.getElementById('rysiai-details');
        return this._panel;
    }

    private _getWrapper(): HTMLElement | null {
        if (!this._wrapper) this._wrapper = document.getElementById('node-details');
        return this._wrapper;
    }

    showForNode(nodeId: string, attrs: Record<string, unknown>, handlers: NodeHandlers = {}, counts: Map<string, number> | null = null): void {
        const el = this._getPanel();
        const wrapper = this._getWrapper();
        if (!el) return;

        const html = buildHtml(attrs, handlers);
        if (!html) {
            if (wrapper) wrapper.hidden = true;
            this._hideLegend();
            return;
        }

        el.innerHTML = html;
        if (wrapper) wrapper.hidden = false;

        const btn = el.querySelector<HTMLElement>('[data-action]');
        if (btn) {
            btn.addEventListener('click', () => {
                if (btn.dataset.action === 'expand') handlers.onExpand?.();
                else handlers.onCollapse?.();
            });
        }

        if (isConfigurableNode(attrs)) {
            this._updateLegend(nodeId, !!attrs.expanded, handlers, counts);
        } else {
            this._hideLegend();
        }
    }

    hide(): void {
        const wrapper = this._getWrapper();
        if (wrapper) wrapper.hidden = true;
        this._hideLegend();
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

    private _hideLegend(): void {
        const legendEl = document.getElementById('rysiai-legend');
        if (legendEl) legendEl.hidden = true;
    }

    private _updateLegend(nodeId: string, expanded: boolean, handlers: NodeHandlers, counts: Map<string, number> | null): void {
        const legendEl = document.getElementById('rysiai-legend');
        const btnEl = document.getElementById('rysiai-legend-btn');

        if (!expanded) {
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
}

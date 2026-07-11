import type {NodeAttrs} from './entity-types.ts';
import {isConfigurableNode, isContractNode, isOrgNode, isPersonNode, isProcurementNode} from './entity-types.ts';
import type {LegendState} from './legend-state.ts';
import {escapeHtml as esc} from '@design-system/lib/html.ts';

export interface NodeHandlers {
    onExpand?: () => void;
    onCollapse?: () => void;
}

// ── Typed node attribute interfaces ──────────────────────────────────────────

interface DateableAttrs {
    fromDate?: string | null;
    toDate?: string | null;
}

interface OrgNodeAttrs extends NodeAttrs, DateableAttrs {
    pavadinimas: string;
    jarKodas: string;
    draustieji?: number;
    draustieji2?: number;
}

interface ContractNodeAttrs extends NodeAttrs, DateableAttrs {
    pavadinimas: string;
    id: string;
    verte?: number | null;
    sutartiesUnikalusId?: string;
    pirkimoNumeris?: string;
}

interface ProcurementNodeAttrs extends NodeAttrs, DateableAttrs {
    pavadinimas: string;
    pirkimoId: string;
    numatomaVerteEUR?: number | null;
    statusas?: string;
}

interface PersonNodeAttrs extends NodeAttrs, DateableAttrs {
    vardas?: string;
    pavarde?: string;
}

// ── Shared expand/collapse button ─────────────────────────────────────────────

export function buildExpandButtonHtml(handlers: NodeHandlers): string {
    if (!handlers.onExpand && !handlers.onCollapse) return '';
    const isExpanded = !!handlers.onCollapse;
    const icon = isExpanded ? '▲' : '▼';
    const label = isExpanded ? 'Slėpti ryšius' : 'Rodyti ryšius';
    const action = isExpanded ? 'collapse' : 'expand';
    return `<button class="btn btn-ghost btn-sm vd-btn" data-action="${action}">${icon} <span>${label}</span></button>`;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function formatContractValue(verte: number | null | undefined): string {
    if (verte == null || verte === 0) return '';
    const v = Math.round(verte);
    if (v >= 1000000) return `€${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `€${Math.round(v / 1000)}K`;
    return `€${v}`;
}

function link(href: string, label: string): string {
    return `<a href="${href}" target="_blank" rel="noopener" class="vd-link">${label} ↗</a>`;
}

function formatDate(d: string | null | undefined): string {
    if (!d) return '';
    const parsed = new Date(d);
    if (isNaN(parsed.getTime())) return esc(d);
    return parsed.toLocaleDateString('lt-LT');
}

function renderDateRange(attrs: DateableAttrs, label: string = "Ryšiai nuo", endLabel = "Iki"): string {
    const from = formatDate(attrs.fromDate);
    const to = formatDate(attrs.toDate);
    if (!from && !to) return '';
    return [
        from ? `<div class="vd-sub">${label}: ${from}</div>` : '',
        to ? `<div class="vd-sub">${endLabel}: ${to}</div>` : '',
    ].join('');
}

// ── Per-type renderers ────────────────────────────────────────────────────────

function renderOrgNode(attrs: OrgNodeAttrs): string {
    const count = (attrs.draustieji ?? 0) + (attrs.draustieji2 ?? 0);
    const employees = count > 0 ? `<div class="vd-sub">Darbuotojų: ${count}</div>` : '';
    return [
        `<div class="vd-title">${esc(attrs.pavadinimas)}</div>`,
        `<div class="vd-sub">${esc(attrs.jarKodas)}</div>`,
        employees,
        renderDateRange(attrs, "Registruota"),
        link(`/asmuo/${encodeURIComponent(attrs.jarKodas)}`, 'Peržiūrėti įmonę'),
    ].filter(Boolean).join('');
}

function renderContractNode(attrs: ContractNodeAttrs): string {
    const valueStr = formatContractValue(attrs.verte);
    const sutId = attrs.sutartiesUnikalusId ?? attrs.id.replace('contract:', '');
    return [
        `<div class="vd-title">${esc(attrs.pavadinimas)}</div>`,
        valueStr ? `<div class="vd-sub">${valueStr}</div>` : '',
        renderDateRange(attrs, "Nuo"),
        link(`/sutartis/${encodeURIComponent(sutId)}`, 'Peržiūrėti sutartį'),
        attrs.pirkimoNumeris
            ? link(`/viesiejiPirkimai/${encodeURIComponent(attrs.pirkimoNumeris)}`, 'Peržiūrėti pirkimą')
            : '',
    ].filter(Boolean).join('');
}

function renderProcurementNode(attrs: ProcurementNodeAttrs): string {
    const procValue = formatContractValue(attrs.numatomaVerteEUR);
    return [
        `<div class="vd-title">${esc(attrs.pavadinimas)}</div>`,
        procValue ? `<div class="vd-sub">${procValue}</div>` : '',
        attrs.statusas ? `<div class="vd-sub">${esc(attrs.statusas)}</div>` : '',
        renderDateRange(attrs, "Paskelbta"),
        link(`/viesiejiPirkimai/${encodeURIComponent(attrs.pirkimoId)}`, 'Peržiūrėti pirkimą'),
    ].filter(Boolean).join('');
}

function renderPersonNode(attrs: PersonNodeAttrs): string {
    const name = `${attrs.vardas ?? ''} ${attrs.pavarde ?? ''}`.trim();
    return [
        `<div class="vd-title">${esc(name)}</div>`,
        renderDateRange(attrs, "Ryšiai nuo", "Ryšiai iki"),
    ].filter(Boolean).join('');
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

function renderNodeContent(attrs: NodeAttrs): string {
    if (isOrgNode(attrs)) return renderOrgNode(attrs as OrgNodeAttrs);
    if (isContractNode(attrs)) return renderContractNode(attrs as ContractNodeAttrs);
    if (isProcurementNode(attrs)) return renderProcurementNode(attrs as ProcurementNodeAttrs);
    if (isPersonNode(attrs)) return renderPersonNode(attrs as PersonNodeAttrs);
    return '';
}

// ── Assembler ─────────────────────────────────────────────────────────────────

function buildHtml(attrs: NodeAttrs, handlers: NodeHandlers = {}): string {
    const content = renderNodeContent(attrs);
    if (!content) return '';

    // Configurable nodes (org/person) get their expand/collapse button in the legend panel.
    const showButton = handlers.onExpand || (handlers.onCollapse && !isConfigurableNode(attrs));
    return content + (showButton ? buildExpandButtonHtml(handlers) : '');
}

// ── NodePanel — unified controller for the #node-details overlay ──────────────
// Controls both #rysiai-details (node info) and #rysiai-legend (edge-type filter)
// as a single panel, backed by LegendState for visibility logic.

export class NodePanel {
    private _state: LegendState;
    private _panel: HTMLElement | null = null;
    private _wrapper: HTMLElement | null = null;

    constructor({legendState}: { legendState: LegendState }) {
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

    showForNode(nodeId: string, attrs: NodeAttrs, handlers: NodeHandlers = {}, counts: Map<string, number> | null = null): void {
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

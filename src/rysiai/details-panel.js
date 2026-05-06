import { isOrgNode, isPersonNode, isContractNode, isProcurementNode, isConfigurableNode } from './entity-types.js';

// ── Shared expand/collapse button ─────────────────────────────────────────────

export function buildExpandButtonHtml(handlers) {
    if (!handlers.onExpand && !handlers.onCollapse) return '';
    const isExpanded = !!handlers.onCollapse;
    const icon = isExpanded ? '▲' : '▼';
    const label = isExpanded ? 'Slėpti ryšius' : 'Rodyti ryšius';
    const action = isExpanded ? 'collapse' : 'expand';
    return '<button class="btn btn-ghost btn-sm vd-btn" data-action="' + action + '">' + icon + ' <span>' + label + '</span></button>';
}

// ── Private helpers ───────────────────────────────────────────────────────────

function formatContractValue(verte) {
    if (verte == null || verte === 0) return '';
    const v = Math.round(verte);
    if (v >= 1000000) return '€' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return '€' + Math.round(v / 1000) + 'K';
    return '€' + v;
}

function link(href, label) {
    return '<a href="' + href + '" target="_blank" rel="noopener" class="vd-link">' + label + ' ↗</a>';
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(attrs, handlers = {}) {
    let html = '';

    if (isOrgNode(attrs)) {
        let employees = '';
        const d1 = attrs.draustieji || 0;
        const d2 = attrs.draustieji2 || 0;
        const count = d1 + d2;
        if (count > 0) employees = '<div class="vd-sub">Darbuotojų: ' + count + '</div>';
        html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>'
            + '<div class="vd-sub">' + esc(attrs.jarKodas) + '</div>'
            + employees
            + link('/asmuo/' + encodeURIComponent(attrs.jarKodas), 'Peržiūrėti įmonę');
    } else if (isContractNode(attrs)) {
        const valueStr = formatContractValue(attrs.verte);
        const sutId = attrs.sutartiesUnikalusId || attrs.id.replace('contract:', '');
        html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>';
        if (valueStr) html += '<div class="vd-sub">' + valueStr + '</div>';
        html += link('/sutartis/' + encodeURIComponent(sutId), 'Peržiūrėti sutartį');
        if (attrs.pirkimoNumeris) {
            html += link('/viesiejiPirkimai/' + encodeURIComponent(attrs.pirkimoNumeris), 'Peržiūrėti pirkimą');
        }
    } else if (isProcurementNode(attrs)) {
        const procValue = formatContractValue(attrs.numatomaVerteEUR);
        html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>';
        if (procValue) html += '<div class="vd-sub">' + procValue + '</div>';
        if (attrs.statusas) html += '<div class="vd-sub">' + esc(attrs.statusas) + '</div>';
        html += link('/viesiejiPirkimai/' + encodeURIComponent(attrs.pirkimoId), 'Peržiūrėti pirkimą');
    } else if (isPersonNode(attrs)) {
        const name = ((attrs.vardas || '') + ' ' + (attrs.pavarde || '')).trim();
        html = '<div class="vd-title">' + esc(name) + '</div>';
    }

    // Configurable nodes (org/person) get their expand/collapse button in the legend panel.
    const showButton = handlers.onExpand || (handlers.onCollapse && !isConfigurableNode(attrs));
    if (html && showButton) {
        html += buildExpandButtonHtml(handlers);
    }

    return html;
}

// ── NodeDetails component ─────────────────────────────────────────────────────

/**
 * Manages the node details panel and delegates legend updates to the composed NodeLegend.
 * Call showForNode() on selection; call hide() on deselect or collapse.
 */
export class NodeDetails {
    constructor({ legend = null } = {}) {
        this.legend = legend;
        this._panel = null;
        this._wrapper = null;
    }

    _getPanel() {
        if (!this._panel) this._panel = document.getElementById('rysiai-details');
        return this._panel;
    }

    _getWrapper() {
        if (!this._wrapper) this._wrapper = document.getElementById('node-details');
        return this._wrapper;
    }

    /**
     * Renders the details panel for the selected node and updates the legend.
     * @param {string} nodeId
     * @param {object} attrs  Node attributes from dataGraph
     * @param {object} handlers  { onExpand?: () => void, onCollapse?: () => void }
     * @param {Map<string,number>|null} counts  edge counts from dataGraph, or null for non-configurable nodes
     */
    showForNode(nodeId, attrs, handlers = {}, counts = null) {
        const el = this._getPanel();
        const wrapper = this._getWrapper();
        if (!el) return;

        const html = buildHtml(attrs, handlers);
        if (!html) {
            if (wrapper) wrapper.hidden = true;
            this.legend?.hide();
            return;
        }

        el.innerHTML = html;
        if (wrapper) wrapper.hidden = false;

        const btn = el.querySelector('[data-action]');
        if (btn) {
            btn.addEventListener('click', () => {
                if (btn.dataset.action === 'expand') handlers.onExpand?.();
                else handlers.onCollapse?.();
            });
        }

        if (isConfigurableNode(attrs)) {
            this.legend?.updateForNode(nodeId, attrs.expanded, handlers, counts);
        } else {
            this.legend?.hide();
        }
    }

    /**
     * Hides the details panel wrapper and the legend.
     */
    hide() {
        const wrapper = this._getWrapper();
        if (wrapper) wrapper.hidden = true;
        this.legend?.hide();
    }
}

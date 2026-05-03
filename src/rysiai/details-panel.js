import { isOrgNode, isPersonNode, isContractNode, isProcurementNode, isConfigurableNode } from './entity-types.js';

// ── Details panel ─────────────────────────────────────────────────────────────

let panelEl = null;
let wrapperEl = null;

function getPanel() {
    if (!panelEl) panelEl = document.getElementById('rysiai-details');
    return panelEl;
}

function getWrapper() {
    if (!wrapperEl) wrapperEl = document.getElementById('node-details');
    return wrapperEl;
}

/**
 * Formats a contract/procurement value as €XM / €XK / €X.
 * @param {number|null} verte
 * @returns {string}
 */
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

    // Add expand/collapse button — but the collapse button for configurable (org/person) nodes
    // lives at the bottom of the legend panel instead of here.
    const showButton = handlers.onExpand || (handlers.onCollapse && !isConfigurableNode(attrs));
    if (html && showButton) {
        const isExpanded = !!handlers.onCollapse;
        const icon = isExpanded ? '▲' : '▼';
        const label = isExpanded ? 'Slėpti ryšius' : 'Rodyti ryšius';
        const action = isExpanded ? 'collapse' : 'expand';
        html += '<button class="btn btn-ghost btn-sm vd-btn" data-action="' + action + '">' + icon + ' <span>' + label + '</span></button>';
    }
    
    return html;
}

/**
 * Shows the details panel for the selected node.
 * @param {string} nodeId
 * @param {object} attrs  Node attributes from viewGraph
 * @param {object} handlers  { onExpand?: () => void, onCollapse?: () => void }
 */
export function showNodeDetails(nodeId, attrs, handlers = {}) {
    const el = getPanel();
    const wrapper = getWrapper();
    if (!el) return;
    const html = buildHtml(attrs, handlers);
    if (!html) { if (wrapper) wrapper.hidden = true; return; }
    el.innerHTML = html;
    if (wrapper) wrapper.hidden = false;

    // Bind button event listener
    const btn = el.querySelector('[data-action]');
    if (btn) {
        btn.addEventListener('click', () => {
            if (btn.dataset.action === 'expand') handlers.onExpand?.();
            else handlers.onCollapse?.();
        });
    }
}

/**
 * Hides the details panel wrapper (collapses the entire node-details panel including legend).
 */
export function hideDetails() {
    const wrapper = getWrapper();
    if (wrapper) wrapper.hidden = true;
}

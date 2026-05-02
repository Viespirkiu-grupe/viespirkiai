import { isOrgNode, isPersonNode, isContractNode, ENTITY_TYPE } from './entity-types.js';

// ── Details panel ─────────────────────────────────────────────────────────────

let panelEl = null;

function getPanel() {
    if (!panelEl) panelEl = document.getElementById('rysiai-details');
    return panelEl;
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

function buildHtml(attrs) {
    if (isOrgNode(attrs)) {
        let employees = '';
        const d1 = attrs.draustieji || 0;
        const d2 = attrs.draustieji2 || 0;
        const count = d1 + d2;
        if (count > 0) employees = '<div class="vd-sub">Darbuotojų: ' + count + '</div>';
        return '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>'
            + '<div class="vd-sub">' + esc(attrs.jarKodas) + '</div>'
            + employees
            + link('/asmuo/' + encodeURIComponent(attrs.jarKodas), 'Peržiūrėti įmonę');
    }

    if (isContractNode(attrs)) {
        const valueStr = formatContractValue(attrs.verte);
        const sutId = attrs.sutartiesUnikalusId || attrs.id.replace('contract:', '');
        let html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>';
        if (valueStr) html += '<div class="vd-sub">' + valueStr + '</div>';
        html += link('/sutartis/' + encodeURIComponent(sutId), 'Peržiūrėti sutartį');
        if (attrs.pirkimoNumeris) {
            html += link('/viesiejiPirkimai/' + encodeURIComponent(attrs.pirkimoNumeris), 'Peržiūrėti pirkimą');
        }
        return html;
    }

    if (attrs.entityType === ENTITY_TYPE.Procurement) {
        const procValue = formatContractValue(attrs.numatomaVerteEUR);
        let html = '<div class="vd-title">' + esc(attrs.pavadinimas) + '</div>';
        if (procValue) html += '<div class="vd-sub">' + procValue + '</div>';
        if (attrs.statusas) html += '<div class="vd-sub">' + esc(attrs.statusas) + '</div>';
        html += link('/viesiejiPirkimai/' + encodeURIComponent(attrs.pirkimoId), 'Peržiūrėti pirkimą');
        return html;
    }

    if (isPersonNode(attrs)) {
        const name = ((attrs.vardas || '') + ' ' + (attrs.pavarde || '')).trim();
        return '<div class="vd-title">' + esc(name) + '</div>';
    }

    return '';
}

/**
 * Shows the details panel for the selected node.
 * @param {string} nodeId
 * @param {object} attrs  Node attributes from viewGraph
 */
export function showNodeDetails(nodeId, attrs) {
    const el = getPanel();
    if (!el) return;
    const html = buildHtml(attrs);
    if (!html) { el.hidden = true; return; }
    el.innerHTML = html;
    el.hidden = false;
}

/**
 * Hides the details panel.
 */
export function hideDetails() {
    const el = getPanel();
    if (el) el.hidden = true;
}

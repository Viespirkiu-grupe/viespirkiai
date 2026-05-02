// ── Custom Sigma node renderers ───────────────────────────────────────────────

/**
 * @typedef {object} NodeDisplayData
 * @property {number}  x         - graph-space X coordinate
 * @property {number}  y         - graph-space Y coordinate
 * @property {number}  [size]    - visual radius in px (default 8)
 * @property {string}  [color]   - fill colour (hex)
 * @property {string}  [label]   - display label, may contain \n for line breaks
 * @property {boolean} [expanded]  - true once the node's neighbours have been fetched
 * @property {boolean} [selected]  - true while the node is the active selection
 */

// Draws a dotted ring for expanded nodes (orgs, persons, contracts, procurement), then the label.
// Called by Sigma for every visible labelled node, and also by drawNodeHover.
/**
 * @param {CanvasRenderingContext2D} context
 * @param {NodeDisplayData} data
 * @param {object} settings  Sigma renderer settings
 */
export function drawNodeLabel(context, data, settings) {
    const nodeSize = data.size || 8;

    // Persistent expanded indicator: dotted ring outside the selection ring
    if (data.expanded) {
        context.beginPath();
        context.arc(data.x, data.y, nodeSize + 9, 0, Math.PI * 2);
        context.strokeStyle = data.color || '#9ca3af';
        context.lineWidth = 2.5;
        context.setLineDash([5, 4]);
        context.stroke();
        context.setLineDash([]);
    }

    const label = data.label;
    if (!label) return;

    const size = settings.labelSize || 12;
    const font = settings.labelFont || 'Arial';
    const color = settings.labelColor && settings.labelColor.attribute
        ? (data[settings.labelColor.attribute] || settings.labelColor.color || '#000')
        : (settings.labelColor && settings.labelColor.color || '#000');

    context.font = size + 'px ' + font;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'top';

    const lines = label.split('\n');
    const lineHeight = size + 3;
    const startY = data.y + nodeSize + 4;

    for (let i = 0; i < lines.length; i++) {
        context.fillText(lines[i], data.x, startY + i * lineHeight);
    }
}

// Draws hover/selection highlight ring + label below.
// Selected node: bold solid ring (nodeSize+6, lineWidth 5).
// Hover only:    soft ring (nodeSize+4, lineWidth 2).
// Expanded ring is drawn by drawNodeLabel (called at end) — always outermost.
/**
 * @param {CanvasRenderingContext2D} context
 * @param {NodeDisplayData} data
 * @param {object} settings  Sigma renderer settings
 */
export function drawNodeHover(context, data, settings) {
    const nodeSize = data.size || 8;
    context.beginPath();
    if (data.selected) {
        context.arc(data.x, data.y, nodeSize + 6, 0, Math.PI * 2);
        context.fillStyle = 'rgba(255,255,255,0.15)';
        context.fill();
        context.strokeStyle = data.color || '#9ca3af';
        context.lineWidth = 5;
        context.stroke();
    } else {
        context.arc(data.x, data.y, nodeSize + 4, 0, Math.PI * 2);
        context.fillStyle = 'rgba(255,255,255,0.6)';
        context.fill();
        context.strokeStyle = data.color || '#9ca3af';
        context.lineWidth = 2;
        context.stroke();
    }
    drawNodeLabel(context, data, settings);
}


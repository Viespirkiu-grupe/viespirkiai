// ── Custom Sigma node renderers ───────────────────────────────────────────────

// Draws node label centred below the node
export function drawNodeLabel(context, data, settings) {
    var label = data.label;
    if (!label) return;

    var size = settings.labelSize || 12;
    var font = settings.labelFont || 'Arial';
    var color = settings.labelColor && settings.labelColor.attribute
        ? (data[settings.labelColor.attribute] || settings.labelColor.color || '#000')
        : (settings.labelColor && settings.labelColor.color || '#000');

    context.font = size + 'px ' + font;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'top';

    var lines = label.split('\n');
    var lineHeight = size + 3;
    var nodeSize = data.size || 8;
    var startY = data.y + nodeSize + 4;

    for (var i = 0; i < lines.length; i++) {
        context.fillText(lines[i], data.x, startY + i * lineHeight);
    }
}

// Draws hover/selection highlight ring + label below.
// Selected node: bold ring (nodeSize+6, lineWidth 5).
// Hover only: soft ring (nodeSize+4, lineWidth 2).
export function drawNodeHover(context, data, settings) {
    var nodeSize = data.size || 8;
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

// ── Custom Sigma node renderers ───────────────────────────────────────────────
// Pure canvas drawing functions — converts NodeDisplayData to pixels.
// No graph state, no DOM queries, no business logic.
// graph-utils.js handles graph data operations; this file handles how nodes look on screen.

interface NodeDisplayData {
    x: number;
    y: number;
    size?: number;
    color?: string;
    label?: string;
    expanded?: boolean;
    selected?: boolean;
}

interface SigmaSettings {
    labelSize?: number;
    labelFont?: string;
    labelColor?: { attribute?: string; color?: string } | null;
    [key: string]: unknown;
}

// Draws a dotted ring for expanded nodes (orgs, persons, contracts, procurement), then the label.
// Called by Sigma for every visible labelled node, and also by drawNodeHover.
export function drawNodeLabel(context: CanvasRenderingContext2D, data: NodeDisplayData, settings: SigmaSettings): void {
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
        ? ((data as unknown as Record<string, unknown>)[settings.labelColor.attribute] as string || settings.labelColor.color || '#000')
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
export function drawNodeHover(context: CanvasRenderingContext2D, data: NodeDisplayData, settings: SigmaSettings): void {
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

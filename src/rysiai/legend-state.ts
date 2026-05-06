import { HIDDEN_BY_DEFAULT } from './graph-theme.ts';

/**
 * Manages per-node and global edge-type visibility.
 *
 * Visibility model
 * ─────────────────
 *  • Nodes initialised via initNode() own an explicit hidden-type Set (configured nodes).
 *  • Nodes never initialised are "transparent" — they do not contribute to edge filtering.
 *  • isEdgeHidden(src, tgt, type):
 *      – Neither configured → use global hidden set (pre-selection behaviour).
 *      – One configured, one transparent → follow the configured endpoint.
 *      – Both configured → hidden only if BOTH hide the type (any-visible-wins).
 *        If either shows the type, the edge is drawn.
 */
export class LegendState {
    private _nodeHidden: Map<string, Set<string>>;
    private _globalHidden: Set<string>;

    constructor() {
        this._nodeHidden = new Map();
        this._globalHidden = new Set(HIDDEN_BY_DEFAULT);
    }

    initNode(nodeId: string): void {
        if (!this._nodeHidden.has(nodeId)) {
            this._nodeHidden.set(nodeId, new Set(this._globalHidden));
        }
    }

    hasNodeConfig(nodeId: string): boolean {
        return this._nodeHidden.has(nodeId);
    }

    setTypeVisible(nodeId: string, type: string, visible: boolean): void {
        this.initNode(nodeId);
        if (visible) {
            this._nodeHidden.get(nodeId)!.delete(type);
        } else {
            this._nodeHidden.get(nodeId)!.add(type);
        }
    }

    isTypeVisible(nodeId: string, type: string): boolean {
        const hidden = this._nodeHidden.get(nodeId) ?? this._globalHidden;
        return !hidden.has(type);
    }

    setGlobalTypeVisible(type: string, visible: boolean): void {
        if (visible) {
            this._globalHidden.delete(type);
        } else {
            this._globalHidden.add(type);
        }
    }

    isGlobalTypeVisible(type: string): boolean {
        return !this._globalHidden.has(type);
    }

    isEdgeHidden(source: string, target: string, type: string): boolean {
        const sourceHidden = this._nodeHidden.get(source);
        const targetHidden = this._nodeHidden.get(target);

        if (sourceHidden === undefined && targetHidden === undefined) {
            return this._globalHidden.has(type);
        }
        // Both configured: hide only if BOTH hide (any-visible-wins)
        if (sourceHidden !== undefined && targetHidden !== undefined) {
            return sourceHidden.has(type) && targetHidden.has(type);
        }
        // One configured, one transparent: follow the configured endpoint
        if (sourceHidden !== undefined) return sourceHidden.has(type);
        return targetHidden!.has(type);
    }
}

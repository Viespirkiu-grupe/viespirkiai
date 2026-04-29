import { HIDDEN_BY_DEFAULT } from './colors.js';

/**
 * Manages per-node and global edge-type visibility for the Voratinklis graph.
 *
 * Visibility model
 * ─────────────────
 *  • Nodes initialised via initNode() own an explicit hidden-type Set (configured nodes).
 *  • Nodes never initialised are "transparent" — they do not contribute to edge filtering.
 *  • isEdgeHidden(src, tgt, type):
 *      – If neither endpoint is configured → use global hidden set (pre-selection behaviour).
 *      – Otherwise → hidden if ANY configured endpoint hides the type.
 *        A transparent endpoint is treated as "don't care".
 *
 * This ensures:
 *  • Global-only state (no node selected) behaves identically to the old single-Set approach.
 *  • Configuring OrgA to hide Employment only affects edges touching OrgA.
 *  • Configuring OrgB to show Employment does NOT un-hide OrgA's edges.
 *  • Unconfigured person nodes never override a configured org node's settings.
 */
export class LegendState {
    constructor() {
        /** @type {Map<string, Set<string>>} per-node hidden-type Sets */
        this._nodeHidden = new Map();
        /** @type {Set<string>} global fallback when neither edge endpoint is configured */
        this._globalHidden = new Set(HIDDEN_BY_DEFAULT);
    }

    /**
     * Initialises a node's hidden-type Set, copying the current global defaults.
     * No-op when the node has already been configured.
     * Call this only for nodes that should be legend-configurable (org / person nodes).
     *
     * @param {string} nodeId
     */
    initNode(nodeId) {
        if (!this._nodeHidden.has(nodeId)) {
            this._nodeHidden.set(nodeId, new Set(this._globalHidden));
        }
    }

    /**
     * Returns true when the node has an explicit per-node configuration.
     * @param {string} nodeId
     * @returns {boolean}
     */
    hasNodeConfig(nodeId) {
        return this._nodeHidden.has(nodeId);
    }

    /**
     * Sets an edge type's visibility for the given configured node.
     * Auto-initialises the node if it is not yet configured.
     *
     * @param {string}  nodeId
     * @param {string}  type
     * @param {boolean} visible  true = show (remove from hidden set), false = hide (add to hidden set)
     */
    setTypeVisible(nodeId, type, visible) {
        this.initNode(nodeId);
        if (visible) {
            this._nodeHidden.get(nodeId).delete(type);
        } else {
            this._nodeHidden.get(nodeId).add(type);
        }
    }

    /**
     * Returns true when the type is currently visible for the given node.
     * Falls back to the global hidden set for unconfigured nodes.
     *
     * @param {string} nodeId
     * @param {string} type
     * @returns {boolean}
     */
    isTypeVisible(nodeId, type) {
        const hidden = this._nodeHidden.get(nodeId) ?? this._globalHidden;
        return !hidden.has(type);
    }

    /**
     * Sets an edge type's global visibility (used when no node is selected).
     * @param {string}  type
     * @param {boolean} visible
     */
    setGlobalTypeVisible(type, visible) {
        if (visible) {
            this._globalHidden.delete(type);
        } else {
            this._globalHidden.add(type);
        }
    }

    /**
     * Returns true when the type is visible in the global (no-selection) state.
     * @param {string} type
     * @returns {boolean}
     */
    isGlobalTypeVisible(type) {
        return !this._globalHidden.has(type);
    }

    /**
     * The main visibility predicate consumed by rebuildViewGraph.
     *
     * Edge hidden when:
     *   (a) Neither endpoint is configured → falls back to global hidden set, OR
     *   (b) At least one configured endpoint has the type in its hidden set.
     *
     * @param {string} source
     * @param {string} target
     * @param {string} type
     * @returns {boolean}
     */
    isEdgeHidden(source, target, type) {
        const sourceHidden = this._nodeHidden.get(source);
        const targetHidden = this._nodeHidden.get(target);

        if (sourceHidden === undefined && targetHidden === undefined) {
            return this._globalHidden.has(type);
        }
        if (sourceHidden !== undefined && sourceHidden.has(type)) return true;
        if (targetHidden !== undefined && targetHidden.has(type)) return true;
        return false;
    }
}

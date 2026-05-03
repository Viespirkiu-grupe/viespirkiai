import { HIDDEN_BY_DEFAULT } from './graph-theme.js';

/**
 * Manages per-node and global edge-type and contract-size-category visibility.
 *
 * Visibility model
 * ─────────────────
 *  • Nodes initialised via initNode() own an explicit hidden-type Set (configured nodes).
 *  • Nodes never initialised are "transparent" — they do not contribute to edge filtering.
 *  • isEdgeHidden(src, tgt, type, sizeCategory):
 *      – If neither endpoint is configured → use global hidden set (pre-selection behaviour).
 *      – Otherwise → hidden if ANY configured endpoint hides the type or size category.
 *        A transparent endpoint is treated as "don't care".
 *
 * Size categories ('small', 'medium', 'large') apply only to Order/Delivery contract edges.
 * All size categories are visible by default.
 */
export class LegendState {
    constructor() {
        /** @type {Map<string, Set<string>>} per-node hidden-type Sets */
        this._nodeHidden = new Map();
        /** @type {Set<string>} global fallback when neither edge endpoint is configured */
        this._globalHidden = new Set(HIDDEN_BY_DEFAULT);
        /** @type {Map<string, Set<string>>} per-node hidden contract-size-category Sets */
        this._nodeHiddenSizes = new Map();
        /** @type {Set<string>} global fallback for size categories */
        this._globalHiddenSizes = new Set();
    }

    /**
     * Initialises a node's hidden-type and hidden-size-category Sets from current global defaults.
     * No-op when the node has already been configured.
     *
     * @param {string} nodeId
     */
    initNode(nodeId) {
        if (!this._nodeHidden.has(nodeId)) {
            this._nodeHidden.set(nodeId, new Set(this._globalHidden));
            this._nodeHiddenSizes.set(nodeId, new Set(this._globalHiddenSizes));
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
     * Sets the visibility of a contract size category for a specific node.
     * Auto-initialises the node if not yet configured.
     *
     * @param {string}  nodeId
     * @param {string}  category  'small' | 'medium' | 'large'
     * @param {boolean} visible
     */
    setSizeCategoryVisible(nodeId, category, visible) {
        this.initNode(nodeId);
        if (visible) this._nodeHiddenSizes.get(nodeId).delete(category);
        else this._nodeHiddenSizes.get(nodeId).add(category);
    }

    /**
     * Returns true when the size category is currently visible for the given node.
     * Falls back to the global hidden-sizes set for unconfigured nodes.
     *
     * @param {string} nodeId
     * @param {string} category
     * @returns {boolean}
     */
    isSizeCategoryVisible(nodeId, category) {
        const hidden = this._nodeHiddenSizes.get(nodeId) ?? this._globalHiddenSizes;
        return !hidden.has(category);
    }

    /**
     * Sets a contract size category's global visibility (used when no node is selected).
     *
     * @param {string}  category
     * @param {boolean} visible
     */
    setGlobalSizeCategoryVisible(category, visible) {
        if (visible) this._globalHiddenSizes.delete(category);
        else this._globalHiddenSizes.add(category);
    }

    /**
     * Returns true when the size category is visible in the global (no-selection) state.
     *
     * @param {string} category
     * @returns {boolean}
     */
    isGlobalSizeCategoryVisible(category) {
        return !this._globalHiddenSizes.has(category);
    }

    /**
     * The main visibility predicate consumed by rebuildViewGraph.
     *
     * Edge hidden when:
     *   (a) Neither endpoint is configured → falls back to global hidden set, OR
     *   (b) At least one configured endpoint has the type (or size category) in its hidden set.
     *
     * @param {string}      source
     * @param {string}      target
     * @param {string}      type
     * @param {string|null} [sizeCategory]  contract size category — only checked when non-null
     * @returns {boolean}
     */
    isEdgeHidden(source, target, type, sizeCategory = null) {
        const sourceHidden = this._nodeHidden.get(source);
        const targetHidden = this._nodeHidden.get(target);

        if (sourceHidden === undefined && targetHidden === undefined) {
            if (this._globalHidden.has(type)) return true;
        } else {
            if (sourceHidden !== undefined && sourceHidden.has(type)) return true;
            if (targetHidden !== undefined && targetHidden.has(type)) return true;
        }

        if (sizeCategory !== null) {
            const sourceSizes = this._nodeHiddenSizes.get(source);
            const targetSizes = this._nodeHiddenSizes.get(target);

            if (sourceSizes === undefined && targetSizes === undefined) {
                if (this._globalHiddenSizes.has(sizeCategory)) return true;
            } else {
                if (sourceSizes !== undefined && sourceSizes.has(sizeCategory)) return true;
                if (targetSizes !== undefined && targetSizes.has(sizeCategory)) return true;
            }
        }

        return false;
    }
}

/**
 * Pure helper for per-node hidden-edge-type state management.
 * Keeps Map manipulation testable without DOM or Sigma.
 *
 * @param {string}         nodeId        - node identifier
 * @param {Map<string,Set>} nodeHiddenMap - per-node hidden Sets
 * @param {Set<string>}    defaults      - initial hidden types (copied, not shared)
 * @returns {Set<string>}
 */
export function getOrInitNodeHidden(nodeId, nodeHiddenMap, defaults) {
    if (!nodeHiddenMap.has(nodeId)) {
        nodeHiddenMap.set(nodeId, new Set(defaults));
    }
    return nodeHiddenMap.get(nodeId);
}

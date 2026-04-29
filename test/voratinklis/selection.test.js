import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getOrInitNodeHidden } from '../../src/voratinklis/selection.js';

describe('getOrInitNodeHidden', () => {
    it('returns the existing Set when nodeId is already in the Map', () => {
        var map = new Map();
        var existing = new Set(['Director', 'Shareholder']);
        map.set('org:123', existing);
        var result = getOrInitNodeHidden('org:123', map, new Set());
        assert.strictEqual(result, existing);
    });

    it('creates a new Set when nodeId is absent', () => {
        var map = new Map();
        var defaults = new Set(['Official', 'Employment']);
        var result = getOrInitNodeHidden('org:456', map, defaults);
        assert.ok(map.has('org:456'));
        assert.deepEqual([...result].sort(), ['Employment', 'Official']);
    });

    it('modifying the returned Set does not affect the original defaults Set', () => {
        var map = new Map();
        var defaults = new Set(['Official', 'Employment']);
        var result = getOrInitNodeHidden('org:789', map, defaults);
        result.add('Director');
        assert.ok(!defaults.has('Director'), 'defaults should not be mutated');
    });

    it('multiple nodes get independent Sets', () => {
        var map = new Map();
        var defaults = new Set(['Official']);
        var a = getOrInitNodeHidden('org:A', map, defaults);
        var b = getOrInitNodeHidden('org:B', map, defaults);
        a.add('Director');
        assert.ok(!b.has('Director'), 'Set for B should not be affected by changes to Set for A');
    });

    it('returns the same Set on repeated calls for the same node', () => {
        var map = new Map();
        var defaults = new Set(['Official']);
        var first = getOrInitNodeHidden('org:X', map, defaults);
        var second = getOrInitNodeHidden('org:X', map, defaults);
        assert.strictEqual(first, second);
    });

    it('works with an empty defaults Set', () => {
        var map = new Map();
        var result = getOrInitNodeHidden('org:empty', map, new Set());
        assert.equal(result.size, 0);
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { personelSize, contractSize, edgeWeight } from '@/src/rysiai/graph-theme.ts';

// ── personelSize ──────────────────────────────────────────────────────────────

describe('personelSize', function () {
    it('returns 8 for count = 1 (minimum)', function () {
        assert.equal(personelSize(1), 8);
    });

    it('returns 8 for count = 9 (just below 10 boundary)', function () {
        assert.equal(personelSize(9), 8);
    });

    it('returns 13 for count = 10 (lower boundary of medium)', function () {
        assert.equal(personelSize(10), 13);
    });

    it('returns 13 for count = 49', function () {
        assert.equal(personelSize(49), 13);
    });

    it('returns 15 for count = 50 (lower boundary of large)', function () {
        assert.equal(personelSize(50), 15);
    });

    it('returns 15 for count = 199', function () {
        assert.equal(personelSize(199), 15);
    });

    it('returns 20 for count = 200 (lower boundary of extra-large)', function () {
        assert.equal(personelSize(200), 20);
    });

    it('returns 20 for count = 1000', function () {
        assert.equal(personelSize(1000), 20);
    });
});

// ── contractSize ──────────────────────────────────────────────────────────────

describe('contractSize', function () {
    it('returns 8 for verte = 0', function () {
        assert.equal(contractSize(0), 8);
    });

    it('returns 8 for verte = 99999 (just below 100k)', function () {
        assert.equal(contractSize(99999), 8);
    });

    it('returns 13 for verte = 100000 (lower boundary of medium)', function () {
        assert.equal(contractSize(100_000), 13);
    });

    it('returns 13 for verte = 999999 (just below 1M)', function () {
        assert.equal(contractSize(999_999), 13);
    });

    it('returns 19 for verte = 1000000 (lower boundary of large)', function () {
        assert.equal(contractSize(1_000_000), 19);
    });

    it('returns 19 for large values', function () {
        assert.equal(contractSize(5_000_000), 19);
    });
});

// ── edgeWeight ────────────────────────────────────────────────────────────────

describe('edgeWeight', function () {
    it('returns 1 for verte = 0 (minimum — never 0)', function () {
        assert.equal(edgeWeight(0), 1);
    });

    it('returns 1 for verte = 99999', function () {
        assert.equal(edgeWeight(99_999), 1);
    });

    it('returns 3 for verte = 100000', function () {
        assert.equal(edgeWeight(100_000), 3);
    });

    it('returns 3 for verte = 999999', function () {
        assert.equal(edgeWeight(999_999), 3);
    });

    it('returns 6 for verte = 1000000', function () {
        assert.equal(edgeWeight(1_000_000), 6);
    });

    it('returns 6 for very large values', function () {
        assert.equal(edgeWeight(10_000_000), 6);
    });

    it('contractSize and edgeWeight share the same thresholds (100k, 1M)', function () {
        assert.equal(contractSize(100_000), 13);
        assert.equal(edgeWeight(100_000), 3);
        assert.equal(contractSize(1_000_000), 19);
        assert.equal(edgeWeight(1_000_000), 6);
    });
});

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LegendState } from '../../src/rysiai/legend-state.js';

// ── LegendState ───────────────────────────────────────────────────────────────

describe('LegendState — global state', () => {
    let ls;
    beforeEach(() => { ls = new LegendState(); });

    it('Official is hidden by default', () => {
        assert.equal(ls.isGlobalTypeVisible('Official'), false);
    });

    it('Employment is hidden by default', () => {
        assert.equal(ls.isGlobalTypeVisible('Employment'), false);
    });

    it('Director is visible by default', () => {
        assert.equal(ls.isGlobalTypeVisible('Director'), true);
    });

    it('setGlobalTypeVisible(true) makes type visible', () => {
        ls.setGlobalTypeVisible('Official', true);
        assert.equal(ls.isGlobalTypeVisible('Official'), true);
    });

    it('setGlobalTypeVisible(false) hides type', () => {
        ls.setGlobalTypeVisible('Director', false);
        assert.equal(ls.isGlobalTypeVisible('Director'), false);
    });
});

// ── initNode ──────────────────────────────────────────────────────────────────

describe('LegendState — initNode', () => {
    let ls;
    beforeEach(() => { ls = new LegendState(); });

    it('node has no config before initNode', () => {
        assert.equal(ls.hasNodeConfig('org:A'), false);
    });

    it('node has config after initNode', () => {
        ls.initNode('org:A');
        assert.equal(ls.hasNodeConfig('org:A'), true);
    });

    it('initNode copies current global defaults', () => {
        // Global has Official and Employment hidden by default
        ls.initNode('org:A');
        assert.equal(ls.isTypeVisible('org:A', 'Official'), false);
        assert.equal(ls.isTypeVisible('org:A', 'Employment'), false);
        assert.equal(ls.isTypeVisible('org:A', 'Director'), true);
    });

    it('initNode is idempotent — calling twice preserves mutations', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false); // hide Director
        ls.initNode('org:A');                           // call again
        // Should not reset Director back to visible
        assert.equal(ls.isTypeVisible('org:A', 'Director'), false);
    });

    it('initNode snapshot is independent of later global changes', () => {
        ls.initNode('org:A');
        ls.setGlobalTypeVisible('Director', false); // hide Director globally after init
        // org:A was initialised before this change — it should still show Director
        assert.equal(ls.isTypeVisible('org:A', 'Director'), true);
    });

    it('initNode snapshot reflects global state at call time', () => {
        ls.setGlobalTypeVisible('Director', false); // hide Director globally first
        ls.initNode('org:A');                        // init after change
        assert.equal(ls.isTypeVisible('org:A', 'Director'), false);
    });
});

// ── setTypeVisible / isTypeVisible ────────────────────────────────────────────

describe('LegendState — setTypeVisible / isTypeVisible', () => {
    let ls;
    beforeEach(() => { ls = new LegendState(); });

    it('setTypeVisible(false) hides type for node', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false);
        assert.equal(ls.isTypeVisible('org:A', 'Director'), false);
    });

    it('setTypeVisible(true) shows type for node', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Employment', true);
        assert.equal(ls.isTypeVisible('org:A', 'Employment'), true);
    });

    it('isTypeVisible falls back to global for unconfigured node', () => {
        // Official is hidden globally; org:A has no config
        assert.equal(ls.isTypeVisible('org:A', 'Official'), false);
        assert.equal(ls.isTypeVisible('org:A', 'Director'), true);
    });

    it('per-node and global states are independent', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Employment', true);  // show for org:A
        // Global still has Employment hidden
        assert.equal(ls.isGlobalTypeVisible('Employment'), false);
    });

    it('setTypeVisible auto-initialises unconfigured node', () => {
        ls.setTypeVisible('org:NEW', 'Director', false);
        assert.equal(ls.hasNodeConfig('org:NEW'), true);
        assert.equal(ls.isTypeVisible('org:NEW', 'Director'), false);
    });
});

// ── isEdgeHidden ──────────────────────────────────────────────────────────────

describe('LegendState — isEdgeHidden', () => {
    let ls;
    beforeEach(() => { ls = new LegendState(); });

    it('both unconfigured → uses global (Official hidden)', () => {
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Official'), true);
    });

    it('both unconfigured → uses global (Director visible)', () => {
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), false);
    });

    it('source configured and hides → edge hidden (target transparent)', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false);
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), true);
    });

    it('target configured and hides → edge hidden (source transparent)', () => {
        ls.initNode('person:b');
        ls.setTypeVisible('person:b', 'Director', false);
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), true);
    });

    it('source configured and shows → edge visible (target transparent)', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Employment', true); // show Employment for org:A
        // person:b is unconfigured → transparent → only org:A matters → shows Employment
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Employment'), false);
    });

    it('both configured, both show → edge visible', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Employment', true);
        ls.initNode('person:b');
        ls.setTypeVisible('person:b', 'Employment', true);
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Employment'), false);
    });

    it('both configured, both hide → edge hidden', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false);
        ls.initNode('person:b');
        ls.setTypeVisible('person:b', 'Director', false);
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), true);
    });

    it('both configured: source hides, target shows → edge hidden (hide takes priority)', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false); // org:A hides Director
        ls.initNode('person:b');
        // person:b has Director visible (default after initNode)
        assert.equal(ls.isTypeVisible('person:b', 'Director'), true);
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), true);
    });

    it('both configured: source shows, target hides → edge hidden', () => {
        ls.initNode('org:A');
        // org:A has Director visible (default)
        ls.initNode('person:b');
        ls.setTypeVisible('person:b', 'Director', false); // person:b hides Director
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), true);
    });

    // ── Critical scenario: the original per-node bug ──────────────────────────

    it('CRITICAL: OrgA hides Employment, OrgB shows — edges to each behave independently', () => {
        // Simulate: user selects OrgA and unchecks Employment, then selects OrgB and checks Employment
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Employment', false); // OrgA: Employment hidden

        ls.initNode('org:B');
        ls.setTypeVisible('org:B', 'Employment', true);  // OrgB: Employment visible

        // person:x is unconfigured (transparent)

        // Edge from person:x to OrgA: OrgA is configured and hides Employment → HIDDEN
        assert.equal(
            ls.isEdgeHidden('person:x', 'org:A', 'Employment'),
            true,
            'Employment edge to OrgA must be hidden'
        );

        // Edge from person:x to OrgB: OrgB is configured and shows Employment; person:x transparent → VISIBLE
        assert.equal(
            ls.isEdgeHidden('person:x', 'org:B', 'Employment'),
            false,
            'Employment edge to OrgB must be visible'
        );
    });

    it('CRITICAL: switching selection must not retroactively change previous node settings', () => {
        // Select OrgA, hide Director
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false);

        // Now select OrgB, show Director (OrgB starts with global defaults via initNode)
        ls.initNode('org:B');
        ls.setTypeVisible('org:B', 'Director', true);

        // OrgA's Director setting must still be hidden
        assert.equal(ls.isTypeVisible('org:A', 'Director'), false, 'OrgA Director still hidden');
        // OrgB's Director setting must be visible
        assert.equal(ls.isTypeVisible('org:B', 'Director'), true, 'OrgB Director visible');

        // isEdgeHidden from a shared person (unconfigured) to each org
        assert.equal(ls.isEdgeHidden('person:x', 'org:A', 'Director'), true, 'Edge to OrgA hidden');
        assert.equal(ls.isEdgeHidden('person:x', 'org:B', 'Director'), false, 'Edge to OrgB visible');
    });

    it('unchecking all checkboxes for OrgA hides all its edges', () => {
        ls.initNode('org:A');
        // Uncheck everything (hide all types)
        ['Director', 'Shareholder', 'Official', 'Employment', 'Order', 'Delivery', 'Spouse'].forEach(function (t) {
            ls.setTypeVisible('org:A', t, false);
        });
        assert.equal(ls.isEdgeHidden('person:x', 'org:A', 'Director'), true);
        assert.equal(ls.isEdgeHidden('person:x', 'org:A', 'Shareholder'), true);
        assert.equal(ls.isEdgeHidden('person:x', 'org:A', 'Order'), true);
    });
});

// ── Size category filtering ───────────────────────────────────────────────────

describe('LegendState — size category global state', () => {
    let ls;
    beforeEach(() => { ls = new LegendState(); });

    it('all size categories visible by default (globally)', () => {
        assert.equal(ls.isGlobalSizeCategoryVisible('small'), true);
        assert.equal(ls.isGlobalSizeCategoryVisible('medium'), true);
        assert.equal(ls.isGlobalSizeCategoryVisible('large'), true);
    });

    it('setGlobalSizeCategoryVisible(false) hides the category', () => {
        ls.setGlobalSizeCategoryVisible('large', false);
        assert.equal(ls.isGlobalSizeCategoryVisible('large'), false);
    });

    it('setGlobalSizeCategoryVisible(true) shows the category', () => {
        ls.setGlobalSizeCategoryVisible('medium', false);
        ls.setGlobalSizeCategoryVisible('medium', true);
        assert.equal(ls.isGlobalSizeCategoryVisible('medium'), true);
    });
});

describe('LegendState — size category per-node state', () => {
    let ls;
    beforeEach(() => { ls = new LegendState(); });

    it('all size categories visible after initNode (global default is all visible)', () => {
        ls.initNode('org:A');
        assert.equal(ls.isSizeCategoryVisible('org:A', 'small'), true);
        assert.equal(ls.isSizeCategoryVisible('org:A', 'medium'), true);
        assert.equal(ls.isSizeCategoryVisible('org:A', 'large'), true);
    });

    it('setSizeCategoryVisible(false) hides for node', () => {
        ls.initNode('org:A');
        ls.setSizeCategoryVisible('org:A', 'large', false);
        assert.equal(ls.isSizeCategoryVisible('org:A', 'large'), false);
    });

    it('setSizeCategoryVisible(true) shows for node', () => {
        ls.initNode('org:A');
        ls.setSizeCategoryVisible('org:A', 'large', false);
        ls.setSizeCategoryVisible('org:A', 'large', true);
        assert.equal(ls.isSizeCategoryVisible('org:A', 'large'), true);
    });

    it('isSizeCategoryVisible falls back to global for unconfigured node', () => {
        ls.setGlobalSizeCategoryVisible('large', false);
        assert.equal(ls.isSizeCategoryVisible('org:unconfigured', 'large'), false);
        assert.equal(ls.isSizeCategoryVisible('org:unconfigured', 'small'), true);
    });

    it('setSizeCategoryVisible auto-initialises unconfigured node', () => {
        ls.setSizeCategoryVisible('org:NEW', 'large', false);
        assert.equal(ls.hasNodeConfig('org:NEW'), true);
        assert.equal(ls.isSizeCategoryVisible('org:NEW', 'large'), false);
    });

    it('initNode copies global hidden size categories at call time', () => {
        ls.setGlobalSizeCategoryVisible('large', false);
        ls.initNode('org:A');
        assert.equal(ls.isSizeCategoryVisible('org:A', 'large'), false);
    });

    it('initNode snapshot is independent of later global size changes', () => {
        ls.initNode('org:A');
        ls.setGlobalSizeCategoryVisible('large', false); // change after init
        assert.equal(ls.isSizeCategoryVisible('org:A', 'large'), true, 'node was initialised before global change');
    });

    it('per-node and global size states are independent', () => {
        ls.initNode('org:A');
        ls.setSizeCategoryVisible('org:A', 'large', false);
        assert.equal(ls.isGlobalSizeCategoryVisible('large'), true, 'global unaffected');
    });
});

describe('LegendState — isEdgeHidden with sizeCategory', () => {
    let ls;
    beforeEach(() => { ls = new LegendState(); });

    it('no sizeCategory arg → size check is skipped (edge visible)', () => {
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order'), false);
    });

    it('null sizeCategory → size check is skipped', () => {
        ls.setGlobalSizeCategoryVisible('large', false);
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', null), false,
            'null sizeCategory skips size check even if globally hidden');
    });

    it('both endpoints unconfigured, size hidden globally → edge hidden', () => {
        ls.setGlobalSizeCategoryVisible('large', false);
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', 'large'), true);
    });

    it('both endpoints unconfigured, size visible globally → edge not hidden by size', () => {
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', 'large'), false);
    });

    it('source configured and hides size → edge hidden', () => {
        ls.initNode('org:A');
        ls.setSizeCategoryVisible('org:A', 'medium', false);
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', 'medium'), true);
    });

    it('target configured and hides size → edge hidden (source transparent)', () => {
        ls.initNode('contract:x');
        ls.setSizeCategoryVisible('contract:x', 'medium', false);
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', 'medium'), true);
    });

    it('source configured and shows size, target transparent → edge not hidden by size', () => {
        ls.initNode('org:A');
        // org:A has large visible by default — no explicit action needed
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', 'large'), false);
    });

    it('type hidden → edge hidden regardless of size', () => {
        // Order type is visible globally but let's set per-node
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Order', false);
        // Size visible — but type is hidden, so edge is hidden
        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', 'small'), true);
    });

    it('CRITICAL: OrgA hides large, OrgB shows large — edges behave independently', () => {
        ls.initNode('org:A');
        ls.setSizeCategoryVisible('org:A', 'large', false);

        ls.initNode('org:B');
        // org:B has large visible (default)

        assert.equal(ls.isEdgeHidden('org:A', 'contract:x', 'Order', 'large'), true, 'OrgA large hidden');
        assert.equal(ls.isEdgeHidden('org:B', 'contract:y', 'Order', 'large'), false, 'OrgB large visible');
    });
});

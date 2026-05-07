import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LegendState } from '@/src/rysiai/legend-state.ts';

// ── LegendState ───────────────────────────────────────────────────────────────

describe('LegendState — global state', () => {
    let ls: LegendState;
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
    let ls: LegendState;
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
    let ls: LegendState;
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
    let ls: LegendState;
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

    it('both configured: source hides, target shows → edge visible (any-visible-wins)', () => {
        ls.initNode('org:A');
        ls.setTypeVisible('org:A', 'Director', false); // org:A hides Director
        ls.initNode('person:b');
        // person:b has Director visible (default after initNode)
        assert.equal(ls.isTypeVisible('person:b', 'Director'), true);
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), false);
    });

    it('both configured: source shows, target hides → edge visible (any-visible-wins)', () => {
        ls.initNode('org:A');
        // org:A has Director visible (default)
        ls.initNode('person:b');
        ls.setTypeVisible('person:b', 'Director', false); // person:b hides Director
        assert.equal(ls.isEdgeHidden('org:A', 'person:b', 'Director'), false);
    });

    it('SPOUSE REGRESSION: Alenas shows Spouse, Toma hides Spouse → edge must be visible', () => {
        // Exact real-world scenario: both persons expanded; Toma's legend has Spouse unchecked
        ls.initNode('person:alenas bulauskis');
        ls.setTypeVisible('person:alenas bulauskis', 'Spouse', true);
        ls.initNode('person:toma bulauskiene');
        ls.setTypeVisible('person:toma bulauskiene', 'Spouse', false);
        assert.equal(ls.isEdgeHidden('person:alenas bulauskis', 'person:toma bulauskiene', 'Spouse'), false);
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
        ['Director', 'Shareholder', 'Official', 'Employment', 'ContractSmall', 'ContractMedium', 'ContractLarge', 'Spouse'].forEach(function (t: string) {
            ls.setTypeVisible('org:A', t, false);
        });
        assert.equal(ls.isEdgeHidden('person:x', 'org:A', 'Director'), true);
        assert.equal(ls.isEdgeHidden('person:x', 'org:A', 'Shareholder'), true);
        assert.equal(ls.isEdgeHidden('person:x', 'org:A', 'ContractSmall'), true);
    });
});

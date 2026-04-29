import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    formatContractValue,
    wrapLabel,
    personId,
    mapDarbovietesTipas,
    mapRysioPobudis,
    mapFormosKodas,
    orgNode,
    personNode,
    contractNode,
    edge,
    addNode,
    addEdge,
} from '../../modules/voratinklis/expand.js';

describe('formatContractValue', () => {
    it('returns empty string for null', () => assert.equal(formatContractValue(null), ''));
    it('returns empty string for 0', () => assert.equal(formatContractValue(0), ''));
    it('formats values below 1 000 as plain euros', () => assert.equal(formatContractValue(500), '€500'));
    it('formats values in thousands as K', () => assert.equal(formatContractValue(2500), '€3K'));
    it('formats values in millions as M with one decimal', () => assert.equal(formatContractValue(2500000), '€2.5M'));
    it('rounds to nearest K', () => assert.equal(formatContractValue(1499), '€1K'));
});

describe('wrapLabel', () => {
    it('returns empty string for null input', () => assert.equal(wrapLabel(null), ''));
    it('leaves short names on one line', () => assert.equal(wrapLabel('UAB Regitra'), 'UAB Regitra'));
    it('wraps every 3 words by default', () => assert.equal(wrapLabel('A B C D E F'), 'A B C\nD E F'));
    it('respects custom word-per-line count', () => assert.equal(wrapLabel('A B C D', 2), 'A B\nC D'));
});

describe('personId', () => {
    it('lowercases both parts', () => assert.equal(personId('Jonas', 'Jonaitis'), 'person:jonas jonaitis'));
    it('trims surrounding whitespace', () => assert.equal(personId(' Jonas ', ' Jonaitis '), 'person:jonas jonaitis'));
    it('handles empty strings', () => assert.equal(personId('', ''), 'person:'));
});

describe('mapDarbovietesTipas', () => {
    it('returns Employment for null', () => assert.equal(mapDarbovietesTipas(null), 'Employment'));
    it('returns Director for vadovas role', () => assert.equal(mapDarbovietesTipas('Vadovas'), 'Director'));
    it('returns Official for pirkimo iniciatorius', () => assert.equal(mapDarbovietesTipas('Pirkimo iniciatorius'), 'Official'));
    it('returns Official for ekspertas', () => assert.equal(mapDarbovietesTipas('Ekspertas'), 'Official'));
    it('returns Employment for unrecognised role', () => assert.equal(mapDarbovietesTipas('Buhalteris'), 'Employment'));
});

describe('mapRysioPobudis', () => {
    it('returns Official for null', () => assert.equal(mapRysioPobudis(null), 'Official'));
    it('returns Director for valdybos narys', () => assert.equal(mapRysioPobudis('Valdybos narys'), 'Director'));
    it('returns Director for stebėtojų tarybos narys', () => assert.equal(mapRysioPobudis('Stebėtojų tarybos narys'), 'Director'));
    it('returns Shareholder for akcininkas', () => assert.equal(mapRysioPobudis('Akcininkas'), 'Shareholder'));
    it('returns Official for unrecognised relationship', () => assert.equal(mapRysioPobudis('Kita'), 'Official'));
});

describe('mapFormosKodas', () => {
    it('returns PrivateCompany for null', () => assert.equal(mapFormosKodas(null), 'PrivateCompany'));
    it('returns Institution for codes starting with 4–9', () => {
        for (const k of ['4', '5', '6', '7', '8', '9']) assert.equal(mapFormosKodas(`${k}00`), 'Institution');
    });
    it('returns PublicCompany for codes starting with 2 or 3', () => {
        assert.equal(mapFormosKodas('200'), 'PublicCompany');
        assert.equal(mapFormosKodas('300'), 'PublicCompany');
    });
    it('returns PrivateCompany for codes starting with 1', () => assert.equal(mapFormosKodas('100'), 'PrivateCompany'));
});

describe('orgNode', () => {
    it('produces id in org:<jarKodas> format', () => {
        const n = orgNode('110078991', 'Regitra', null);
        assert.equal(n.id, 'org:110078991');
    });
    it('sets entityType to OrganizationEntity', () => {
        assert.equal(orgNode('1', 'X', null).attributes.entityType, 'OrganizationEntity');
    });
    it('falls back to jarKodas when pavadinimas is missing', () => {
        const n = orgNode('123', null, null);
        assert.equal(n.attributes.pavadinimas, '123');
    });
    it('defaults expanded to false', () => assert.equal(orgNode('1', 'X', null).attributes.expanded, false));
    it('sets expanded when opts.expanded is true', () => assert.equal(orgNode('1', 'X', null, { expanded: true }).attributes.expanded, true));
    it('maps formosKodas to orgType', () => assert.equal(orgNode('1', 'X', '400').attributes.orgType, 'Institution'));
});

describe('personNode', () => {
    it('produces stable id via personId()', () => {
        const n = personNode('Jonas', 'Jonaitis', null, null);
        assert.equal(n.id, 'person:jonas jonaitis');
    });
    it('sets entityType to PersonEntity', () => {
        assert.equal(personNode('J', 'P', null, null).attributes.entityType, 'PersonEntity');
    });
    it('trims vardas and pavarde', () => {
        const n = personNode(' Jonas ', ' Jonaitis ', null, null);
        assert.equal(n.attributes.vardas, 'Jonas');
        assert.equal(n.attributes.pavarde, 'Jonaitis');
    });
    it('stores deklaracija in an array', () => {
        assert.deepEqual(personNode('J', 'P', 'D1', null).attributes.deklaracijos, ['D1']);
    });
    it('stores empty deklaracijos array when null', () => {
        assert.deepEqual(personNode('J', 'P', null, null).attributes.deklaracijos, []);
    });
});

describe('contractNode', () => {
    it('sets entityType to ContractEntity', () => {
        assert.equal(contractNode('c:1', 'Partner', 1000, 5).attributes.entityType, 'ContractEntity');
    });
    it('label is "N sut." when count > 0', () => {
        assert.equal(contractNode('c:1', 'Partner', 1000, 17).attributes.label, '17 sut.');
    });
    it('label is "Sutartis" when count is 0', () => {
        assert.equal(contractNode('c:1', 'Partner', 0, 0).attributes.label, 'Sutartis');
    });
    it('stores pavadinimas as reference attribute (not label)', () => {
        const n = contractNode('c:1', 'UAB Partneris', 1000, 5);
        assert.equal(n.attributes.pavadinimas, 'UAB Partneris');
        assert.notEqual(n.attributes.label, 'UAB Partneris');
    });
    it('preserves the given id', () => {
        assert.equal(contractNode('contract:buyer1:seller2', 'X', 0, 1).id, 'contract:buyer1:seller2');
    });
});

describe('edge', () => {
    it('produces id in edge:<source>:<target>:<type> format', () => {
        const e = edge('org:1', 'org:2', 'Order', '€5K', null);
        assert.equal(e.id, 'edge:org:1:org:2:Order');
    });
    it('defaults forceLabel to false', () => {
        assert.equal(edge('a', 'b', 'T', '', null).attributes.forceLabel, false);
    });
    it('passes forceLabel through when set to true', () => {
        assert.equal(edge('a', 'b', 'T', '', null, true).attributes.forceLabel, true);
    });
    it('stores label in attributes', () => {
        assert.equal(edge('a', 'b', 'Order', '€1M', null).attributes.label, '€1M');
    });
    it('normalises null label to empty string', () => {
        assert.equal(edge('a', 'b', 'T', null, null).attributes.label, '');
    });
});

describe('addNode / addEdge deduplication', () => {
    it('addNode ignores duplicate ids', () => {
        const nodes = [];
        const map = new Map();
        const n = { id: 'org:1', attributes: {} };
        addNode(nodes, map, n);
        addNode(nodes, map, n);
        assert.equal(nodes.length, 1);
    });

    it('addEdge ignores duplicate ids', () => {
        const edges = [];
        const map = new Map();
        const e = { id: 'edge:a:b:T', source: 'a', target: 'b', attributes: {} };
        addEdge(edges, map, e);
        addEdge(edges, map, e);
        assert.equal(edges.length, 1);
    });

    it('addNode accepts nodes with different ids', () => {
        const nodes = [];
        const map = new Map();
        addNode(nodes, map, { id: 'org:1', attributes: {} });
        addNode(nodes, map, { id: 'org:2', attributes: {} });
        assert.equal(nodes.length, 2);
    });
});

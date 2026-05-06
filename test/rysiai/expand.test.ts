import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    formatContractValue,
    wrapLabel,
    personId,
    mapPareigos,
    mapRysioPobudis,
    mapFormosKodas,
    orgNode,
    personNode,
    contractNode,
    procurementNode,
    edge,
    addNode,
    addEdge,
} from '../../modules/rysiai/expand.js';

type NodeLike = { id: string; attributes: Record<string, unknown> };
type EdgeLike = { id: string; source: string; target: string; attributes: Record<string, unknown> };

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

describe('mapPareigos', () => {
    it('returns Employment for null', () => assert.equal(mapPareigos(null), 'Employment'));
    it('returns Employment for empty string', () => assert.equal(mapPareigos(''), 'Employment'));
    it('returns Director for Direktorius', () => assert.equal(mapPareigos('Direktorius'), 'Director'));
    it('returns Director for Direktorė', () => assert.equal(mapPareigos('Direktorė'), 'Director'));
    it('returns Director for Generalinis direktorius', () => assert.equal(mapPareigos('Generalinis direktorius'), 'Director'));
    it('returns Director for Vadovas', () => assert.equal(mapPareigos('Vadovas'), 'Director'));
    it('returns Director for Pirmininkas', () => assert.equal(mapPareigos('Pirmininkas'), 'Director'));
    it('returns Director for Prezidentas', () => assert.equal(mapPareigos('Prezidentas'), 'Director'));
    it('returns Official for Pirkimo iniciatorius', () => assert.equal(mapPareigos('Pirkimo iniciatorius'), 'Official'));
    it('returns Official for Ekspertas', () => assert.equal(mapPareigos('Ekspertas'), 'Official'));
    it('returns Official for Prokuristas', () => assert.equal(mapPareigos('Prokuristas'), 'Official'));
    it('returns Official for Kontrolierius', () => assert.equal(mapPareigos('Kontrolierius'), 'Official'));
    it('returns Employment for Buhalterė', () => assert.equal(mapPareigos('Buhalterė'), 'Employment'));
    it('returns Employment for unrecognised role', () => assert.equal(mapPareigos('Gydytojas'), 'Employment'));
    it('is case-insensitive', () => assert.equal(mapPareigos('DIREKTORIUS'), 'Director'));
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
        assert.equal(contractNode('abc123', 'Sutarties pavadinimas', 1000).attributes.entityType, 'ContractEntity');
    });
    it('id is contract:<sutartiesUnikalusId>', () => {
        assert.equal(contractNode('abc123', 'Pavadinimas', 5000).id, 'contract:abc123');
    });
    it('label is wrapped first 9 words of pavadinimas', () => {
        const title = 'Vienas Du Trys Keturi Penki Šeši Septyni Aštuoni Devyni Dešimt';
        const n = contractNode('x1', title, 1000);
        const expected = wrapLabel('Vienas Du Trys Keturi Penki Šeši Septyni Aštuoni Devyni');
        assert.equal(n.attributes.label, expected);
    });
    it('label falls back to "Sutartis" when pavadinimas is null', () => {
        assert.equal(contractNode('x1', null, 0).attributes.label, 'Sutartis');
    });
    it('label falls back to "Sutartis" when pavadinimas is empty string', () => {
        assert.equal(contractNode('x1', '', 0).attributes.label, 'Sutartis');
    });
    it('stores full pavadinimas in attributes (not just 9 words)', () => {
        const long = 'A B C D E F G H I J K L';
        const n = contractNode('x2', long, 500);
        assert.equal(n.attributes.pavadinimas, long);
    });
    it('stores verte in attributes', () => {
        assert.equal(contractNode('x3', 'Test', 99000).attributes.verte, 99000);
    });
    it('expanded is false by default', () => {
        assert.equal(contractNode('x4', 'Test', 0).attributes.expanded, false);
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
        const nodes: NodeLike[] = [];
        const map: Map<string, boolean> = new Map();
        const n: NodeLike = { id: 'org:1', attributes: {} };
        addNode(nodes, map, n);
        addNode(nodes, map, n);
        assert.equal(nodes.length, 1);
    });

    it('addEdge ignores duplicate ids', () => {
        const edges: EdgeLike[] = [];
        const map: Map<string, boolean> = new Map();
        const e: EdgeLike = { id: 'edge:a:b:T', source: 'a', target: 'b', attributes: {} };
        addEdge(edges, map, e);
        addEdge(edges, map, e);
        assert.equal(edges.length, 1);
    });

    it('addNode accepts nodes with different ids', () => {
        const nodes: NodeLike[] = [];
        const map: Map<string, boolean> = new Map();
        addNode(nodes, map, { id: 'org:1', attributes: {} });
        addNode(nodes, map, { id: 'org:2', attributes: {} });
        assert.equal(nodes.length, 2);
    });
});

describe('procurementNode', () => {
    it('produces id in procurement:<pirkimoId> format', () => {
        assert.equal(procurementNode('7676505', 'Pirkimas', 500000, 'SKELBTAS', 'Atviras').id, 'procurement:7676505');
    });
    it('sets entityType to ProcurementEntity', () => {
        assert.equal(procurementNode('1', null, null, null, null).attributes.entityType, 'ProcurementEntity');
    });
    it('stores pirkimoId as string', () => {
        assert.equal(procurementNode(12345, null, null, null, null).attributes.pirkimoId, '12345');
    });
    it('defaults expanded to false', () => {
        assert.equal(procurementNode('1', null, null, null, null).attributes.expanded, false);
    });
    it('stores statusas and pirkimoBudas in attributes', () => {
        const n = procurementNode('1', 'P', 100, 'SKELBTAS', 'Atviras');
        assert.equal(n.attributes.statusas, 'SKELBTAS');
        assert.equal(n.attributes.pirkimoBudas, 'Atviras');
    });
    it('uses contractSize for node size based on numatomaVerteEUR', () => {
        assert.equal(procurementNode('1', null, 2000000, null, null).attributes.size, 19);
        assert.equal(procurementNode('2', null, 200000, null, null).attributes.size, 13);
        assert.equal(procurementNode('3', null, 0, null, null).attributes.size, 8);
    });
    it('label is wrapped first 6 words of pavadinimas', () => {
        const n = procurementNode('1', 'A B C D E F G H', 0, null, null);
        assert.equal(n.attributes.label, wrapLabel('A B C D E F'));
    });
    it('falls back to "Pirkimas" label when pavadinimas is null', () => {
        assert.equal(procurementNode('1', null, 0, null, null).attributes.label, 'Pirkimas');
    });
});

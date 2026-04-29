import { postgres } from '../../postgres/postgres.js';
import { gautiSutarciuDuomenisPagalJarKoda } from '../sutartys/pagalJarKoda.js';

/**
 * Formats a contract value as €XM / €XK / €X.
 * @param {number|null} verte
 * @returns {string}
 */
function formatContractValue(verte) {
    if (verte == null || verte === 0) return '';
    const v = Math.round(verte);
    if (v >= 1000000) return `€${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `€${Math.round(v / 1000)}K`;
    return `€${v}`;
}

/**
 * Wraps a name to at most n words per line.
 * @param {string} name
 * @param {number} n
 * @returns {string}
 */
function wrapLabel(name, n = 3) {
    const words = (name ?? '').split(' ');
    const lines = [];
    for (let i = 0; i < words.length; i += n) lines.push(words.slice(i, i + n).join(' '));
    return lines.join('\n');
}

/**
 * Normalises a person full-name to a stable node ID fragment.
 * @param {string} vardas
 * @param {string} pavarde
 * @returns {string}
 */
function personId(vardas, pavarde) {
    return `person:${(vardas || '').trim().toLowerCase()} ${(pavarde || '').trim().toLowerCase()}`.trimEnd();
}

/**
 * Maps darbovietesTipas to an edge relationship type.
 * @param {string|null} tipas
 * @returns {'Director'|'Employment'|'Official'}
 */
function mapDarbovietesTipas(tipas) {
    if (!tipas) return 'Employment';
    const t = tipas.toLowerCase();
    if (t.includes('vadovas')) return 'Director';
    if (t.includes('pirkimo iniciatorius') || t.includes('ekspertas')) return 'Official';
    return 'Employment';
}

/**
 * Maps rysioPobudzioPavadinimas to an edge relationship type.
 * @param {string|null} pobud
 * @returns {'Director'|'Shareholder'|'Official'}
 */
function mapRysioPobudis(pobud) {
    if (!pobud) return 'Official';
    const p = pobud.toLowerCase();
    if (p.includes('valdybos narys') || p.includes('stebėtojų tarybos narys')) return 'Director';
    if (p.includes('akcininkas')) return 'Shareholder';
    return 'Official';
}

/**
 * Maps formosKodas to an organisation entity sub-type.
 * @param {string|null} formosKodas
 * @returns {'PrivateCompany'|'PublicCompany'|'Institution'}
 */
function mapFormosKodas(formosKodas) {
    if (!formosKodas) return 'PrivateCompany';
    const k = String(formosKodas);
    if (k.startsWith('4') || k.startsWith('5') || k.startsWith('6') || k.startsWith('7') || k.startsWith('8') || k.startsWith('9')) return 'Institution';
    if (k.startsWith('2') || k.startsWith('3')) return 'PublicCompany';
    return 'PrivateCompany';
}

/**
 * Builds an OrganizationEntity node object.
 */
function orgNode(jarKodas, pavadinimas, formosKodas, opts = {}) {
    const jk = String(jarKodas);
    const id = `org:${jk}`;
    const size = 8;
    return {
        id,
        attributes: {
            entityType: 'OrganizationEntity',
            orgType: mapFormosKodas(formosKodas),
            jarKodas: jk,
            pavadinimas: pavadinimas || jk,
            label: wrapLabel(pavadinimas || jk),
            expanded: opts.expanded ?? false,
            size,
        },
    };
}

/**
 * Builds a PersonEntity node object.
 */
function personNode(vardas, pavarde, deklaracija, fromDate) {
    const id = personId(vardas, pavarde);
    return {
        id,
        attributes: {
            entityType: 'PersonEntity',
            vardas: (vardas || '').trim(),
            pavarde: (pavarde || '').trim(),
            label: wrapLabel(`${vardas || ''} ${pavarde || ''}`.trim()),
            expanded: false,
            deklaracijos: deklaracija ? [deklaracija] : [],
            fromDate: fromDate || null,
            size: 8,
        },
    };
}

/**
 * Builds a ContractEntity node object.
 * @param {string} id
 * @param {string} pavadinimas  Partner company name (used as node label)
 * @param {number} verte
 */
function contractNode(id, pavadinimas, verte) {
    return {
        id,
        attributes: {
            entityType: 'ContractEntity',
            pavadinimas: pavadinimas || '',
            label: wrapLabel(pavadinimas || ''),
            verte: verte || 0,
            expanded: true,
            size: 8,
        },
    };
}

/**
 * Builds an edge object.
 */
function edge(source, target, type, label, fromDate) {
    const id = `edge:${source}:${target}:${type}`;
    return {
        id,
        source,
        target,
        attributes: { type, label: label || '', fromDate: fromDate || null },
    };
}

// ── Deduplication helpers ─────────────────────────────────────────────────────

function addNode(nodes, nodeMap, node) {
    if (nodeMap.has(node.id)) return;
    nodeMap.set(node.id, true);
    nodes.push(node);
}

function addEdge(edges, edgeMap, e) {
    if (edgeMap.has(e.id)) return;
    edgeMap.set(e.id, true);
    edges.push(e);
}

// ── expandOrg ─────────────────────────────────────────────────────────────────

/**
 * Expands an organisation node: returns all people declared at this org
 * plus top contract partners from sutartys.
 *
 * @param {string|number} jarKodas
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
export async function expandOrg(jarKodas) {
    const jk = String(jarKodas);

    const [jarRes, pinregRes, sutartysRes] = await Promise.all([
        // Org metadata from jarCsv
        postgres.query(
            `SELECT "pavadinimas", "formosKodas" FROM public."jarCsv" WHERE "jarKodas" = $1 LIMIT 1`,
            [jk],
        ),
        // All pinreg declarations for this org
        postgres.query(
            `SELECT * FROM public."pinregJuridiniaiRysiai" WHERE "jarKodas" = $1 ORDER BY "pateikimoData" DESC LIMIT 500`,
            [jk],
        ),
        // Top contract partners
        gautiSutarciuDuomenisPagalJarKoda(jk, { limit: 20 }),
    ]);

    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    const edgeMap = new Map();

    // Root org node
    const jarRow = jarRes.rows[0];
    const rootOrg = orgNode(jk, jarRow?.pavadinimas, jarRow?.formosKodas, { expanded: true });
    addNode(nodes, nodeMap, rootOrg);

    for (const row of pinregRes.rows) {
        const tipas = row.irasoTipas;

        if (tipas === 'DEKLARUOJANCIO_DARBOVIETE') {
            if (!row.vardas || !row.pavarde) continue;
            const pNode = personNode(row.vardas, row.pavarde, row.deklaracija, row.rysioPradzia);
            addNode(nodes, nodeMap, pNode);

            const relType = mapDarbovietesTipas(row.darbovietesTipas);
            const label = row.darbovietesTipas || row.pareigos || '';
            addEdge(edges, edgeMap, edge(pNode.id, rootOrg.id, relType, label, row.rysioPradzia));

        } else if (tipas === 'KITI_RYSIAI_SU_JA') {
            if (!row.vardas || !row.pavarde) continue;
            const pNode = personNode(row.vardas, row.pavarde, row.deklaracija, row.rysioPradzia);
            addNode(nodes, nodeMap, pNode);

            const relType = mapRysioPobudis(row.rysioPobudzioPavadinimas);
            const label = row.rysioPobudzioPavadinimas || '';
            addEdge(edges, edgeMap, edge(pNode.id, rootOrg.id, relType, label, row.rysioPradzia));

        } else if (tipas === 'SUTUOKTINIO_DARBOVIETE') {
            // vardas/pavarde = spouse; susijusioAsmensVardas/Pavarde = declarant
            const spouseVardas = row.vardas || '';
            const spousePavarde = row.pavarde || '';
            const declVardas = row.susijusioAsmensVardas || '';
            const declPavarde = row.susijusioAsmensPavarde || '';

            if (!spouseVardas || !spousePavarde) continue;

            const spouseNode = personNode(spouseVardas, spousePavarde, row.deklaracija, row.rysioPradzia);
            addNode(nodes, nodeMap, spouseNode);

            // Spouse works at this org
            const relType = mapDarbovietesTipas(row.darbovietesTipas);
            const label = row.darbovietesTipas || row.pareigos || '';
            addEdge(edges, edgeMap, edge(spouseNode.id, rootOrg.id, relType, label, row.rysioPradzia));

            // Declarant → spouse (Spouse edge)
            if (declVardas && declPavarde) {
                const declNode = personNode(declVardas, declPavarde, null, null);
                addNode(nodes, nodeMap, declNode);
                addEdge(edges, edgeMap, edge(declNode.id, spouseNode.id, 'Spouse', 'Sutuoktinis', null));
            }
        }
    }

    // Top suppliers (root org is buyer → ContractEntity → supplier)
    for (const row of sutartysRes.topTiekejai) {
        if (!row.jarKodas) continue;
        const supplierOrg = orgNode(row.jarKodas, row.pavadinimas, null);
        addNode(nodes, nodeMap, supplierOrg);
        const valueLabel = formatContractValue(row.total);
        const cNode = contractNode(`contract:buyer${jk}:seller${row.jarKodas}`, row.pavadinimas, row.total);
        addNode(nodes, nodeMap, cNode);
        addEdge(edges, edgeMap, edge(rootOrg.id, cNode.id, 'Order', valueLabel, null));
        addEdge(edges, edgeMap, edge(cNode.id, supplierOrg.id, 'Delivery', '', null));
    }

    // Top buyers (buyer → ContractEntity → root org)
    for (const row of sutartysRes.topPirkejai) {
        if (!row.jarKodas) continue;
        const buyerOrg = orgNode(row.jarKodas, row.pavadinimas, null);
        addNode(nodes, nodeMap, buyerOrg);
        const valueLabel = formatContractValue(row.total);
        const cNode = contractNode(`contract:buyer${row.jarKodas}:seller${jk}`, row.pavadinimas, row.total);
        addNode(nodes, nodeMap, cNode);
        addEdge(edges, edgeMap, edge(buyerOrg.id, cNode.id, 'Order', valueLabel, null));
        addEdge(edges, edgeMap, edge(cNode.id, rootOrg.id, 'Delivery', '', null));
    }

    return { nodes, edges };
}

// ── expandPerson ──────────────────────────────────────────────────────────────

/**
 * Expands a person node: returns all workplaces, governance roles,
 * and spouse relationships for the given full name.
 *
 * @param {string} fullName  e.g. "Jonas Jonaitis"
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
export async function expandPerson(fullName) {
    const name = fullName.trim();
    const parts = name.split(' ');
    const vardas = parts[0] || '';
    const pavarde = parts.slice(1).join(' ') || '';

    const personNodeId = personId(vardas, pavarde);

    const pinregRes = await postgres.query(
        `SELECT * FROM public."pinregJuridiniaiRysiai"
         WHERE (lower(trim(vardas)) || ' ' || lower(trim(pavarde)) = lower($1)
                OR lower(trim("susijusioAsmensVardas")) || ' ' || lower(trim("susijusioAsmensPavarde")) = lower($1))
         ORDER BY "pateikimoData" DESC LIMIT 500`,
        [name.toLowerCase()],
    );

    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    const edgeMap = new Map();

    // Root person node (may or may not already exist in client graph)
    const rootPerson = personNode(vardas, pavarde, null, null);
    rootPerson.attributes.expanded = true;
    addNode(nodes, nodeMap, rootPerson);

    for (const row of pinregRes.rows) {
        const tipas = row.irasoTipas;

        if (tipas === 'DEKLARUOJANCIO_DARBOVIETE') {
            // Person works at jarKodas org
            if (!row.jarKodas || !row.pavadinimas) continue;
            const stub = orgNode(row.jarKodas, row.pavadinimas, row.jaTeisinesFormosKodas);
            addNode(nodes, nodeMap, stub);

            const relType = mapDarbovietesTipas(row.darbovietesTipas);
            const label = row.darbovietesTipas || row.pareigos || '';
            addEdge(edges, edgeMap, edge(personNodeId, stub.id, relType, label, row.rysioPradzia));

        } else if (tipas === 'KITI_RYSIAI_SU_JA') {
            // Person has governance role at jarKodas org
            if (!row.jarKodas || !row.pavadinimas) continue;
            const stub = orgNode(row.jarKodas, row.pavadinimas, row.jaTeisinesFormosKodas);
            addNode(nodes, nodeMap, stub);

            const relType = mapRysioPobudis(row.rysioPobudzioPavadinimas);
            const label = row.rysioPobudzioPavadinimas || '';
            addEdge(edges, edgeMap, edge(personNodeId, stub.id, relType, label, row.rysioPradzia));

        } else if (tipas === 'SUTUOKTINIO_DARBOVIETE') {
            // The searched person is the declarant; the spouse (vardas/pavarde) works at this org
            const spouseVardas = row.vardas || '';
            const spousePavarde = row.pavarde || '';
            if (!spouseVardas || !spousePavarde) continue;

            const spouseN = personNode(spouseVardas, spousePavarde, row.deklaracija, null);
            addNode(nodes, nodeMap, spouseN);

            // Declarant → spouse
            addEdge(edges, edgeMap, edge(personNodeId, spouseN.id, 'Spouse', 'Sutuoktinis', null));

            // Spouse works at org
            if (row.jarKodas && row.pavadinimas) {
                const stub = orgNode(row.jarKodas, row.pavadinimas, row.jaTeisinesFormosKodas);
                addNode(nodes, nodeMap, stub);
                const relType = mapDarbovietesTipas(row.darbovietesTipas);
                const label = row.darbovietesTipas || row.pareigos || '';
                addEdge(edges, edgeMap, edge(spouseN.id, stub.id, relType, label, null));
            }
        }
    }

    return { nodes, edges };
}

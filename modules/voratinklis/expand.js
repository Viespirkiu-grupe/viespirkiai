import { postgres } from '../../postgres/postgres.js';

const ENTITY_TYPE = {
    Org:      'OrganizationEntity',
    Person:   'PersonEntity',
    Contract: 'ContractEntity',
};

/**
 * Returns the visual node size for a contract based on its value (EUR).
 * @param {number} verte
 * @returns {8|13|19}
 */
export function contractSize(verte) {
    if (verte >= 1_000_000) return 19;
    if (verte >= 100_000)   return 13;
    return 8;
}

/**
 * Returns the visual edge stroke width for a contract edge based on its value (EUR).
 * Minimum is 1 (never 0).
 * @param {number} verte
 * @returns {1|3|6}
 */
export function edgeWeight(verte) {
    if (verte >= 1_000_000) return 6;
    if (verte >= 100_000)   return 3;
    return 1;
}

/**
 * Formats a contract value as €XM / €XK / €X.
 * @param {number|null} verte
 * @returns {string}
 */
export function formatContractValue(verte) {
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
export function wrapLabel(name, n = 3) {
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
export function personId(vardas, pavarde) {
    return `person:${(vardas || '').trim().toLowerCase()} ${(pavarde || '').trim().toLowerCase()}`.trimEnd();
}

/**
 * Maps a free-text pareigos (job title) to an edge relationship type.
 * @param {string|null} pareigos  e.g. "Direktorius", "Generalinis direktorius", "Buhalterė"
 * @returns {'Director'|'Employment'|'Official'}
 */
export function mapPareigos(pareigos) {
    if (!pareigos) return 'Employment';
    const p = pareigos.toLowerCase();
    if (
        p.includes('direktorius') || p.includes('direktorė') ||
        p.includes('vadovas') || p.includes('vadovė') ||
        p.includes('prezidentas') || p.includes('prezidentė') ||
        p.includes('pirmininkas') || p.includes('pirmininkė') ||
        p.includes('generalinis')
    ) return 'Director';
    if (
        p.includes('pirkimo iniciatorius') ||
        p.includes('ekspertas') || p.includes('ekspertė') ||
        p.includes('prokuristas') ||
        p.includes('kontrolierius') || p.includes('kontrolierė')
    ) return 'Official';
    return 'Employment';
}

/**
 * Maps rysioPobudzioPavadinimas to an edge relationship type.
 * @param {string|null} pobud
 * @returns {'Director'|'Shareholder'|'Official'}
 */
export function mapRysioPobudis(pobud) {
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
export function mapFormosKodas(formosKodas) {
    if (!formosKodas) return 'PrivateCompany';
    const k = String(formosKodas);
    if (k.startsWith('4') || k.startsWith('5') || k.startsWith('6') || k.startsWith('7') || k.startsWith('8') || k.startsWith('9')) return 'Institution';
    if (k.startsWith('2') || k.startsWith('3')) return 'PublicCompany';
    return 'PrivateCompany';
}

/**
 * Builds an OrganizationEntity node object.
 */
export function orgNode(jarKodas, pavadinimas, formosKodas, opts = {}) {
    const jk = String(jarKodas);
    const id = `org:${jk}`;
    return {
        id,
        attributes: {
            entityType: ENTITY_TYPE.Org,
            orgType: mapFormosKodas(formosKodas),
            jarKodas: jk,
            pavadinimas: pavadinimas || jk,
            label: wrapLabel(pavadinimas || jk),
            expanded: opts.expanded ?? false,
            draustieji: opts.draustieji ?? undefined,
            draustieji2: opts.draustieji2 ?? undefined,
            size: 8,
        },
    };
}

/**
 * Builds a PersonEntity node object.
 */
export function personNode(vardas, pavarde, deklaracija, fromDate) {
    const id = personId(vardas, pavarde);
    return {
        id,
        attributes: {
            entityType: ENTITY_TYPE.Person,
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
 * @param {string} sutartiesUnikalusId  Unique contract identifier (used as node ID)
 * @param {string|null} pavadinimas     Contract title
 * @param {number|null} verte           Contract value
 */
export function contractNode(sutartiesUnikalusId, pavadinimas, verte) {
    const id = `contract:${sutartiesUnikalusId}`;
    const title = pavadinimas || 'Sutartis';
    const shortName = title.split(' ').slice(0, 9).join(' ');
    const v = verte || 0;
    return {
        id,
        attributes: {
            entityType: ENTITY_TYPE.Contract,
            pavadinimas: pavadinimas || '',
            label: wrapLabel(shortName),
            verte: v,
            expanded: true,
            size: contractSize(v),
        },
    };
}

/**
 * Builds an edge object.
 */
export function edge(source, target, type, label, fromDate, forceLabel = false, opts = {}) {
    const id = `edge:${source}:${target}:${type}`;
    const attrs = { type, label: label || '', fromDate: fromDate || null, forceLabel };
    if (opts.size != null) attrs.size = opts.size;
    return { id, source, target, attributes: attrs };
}

// ── Deduplication helpers ─────────────────────────────────────────────────────

export function addNode(nodes, nodeMap, node) {
    if (nodeMap.has(node.id)) return;
    nodeMap.set(node.id, true);
    nodes.push(node);
}

export function addEdge(edges, edgeMap, e) {
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

    const [jarRes, pinregRes, asBuyerRes, asSellerRes] = await Promise.all([
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
        // Top contracts where this org is the buyer
        postgres.query(
            `SELECT s."sutartiesUnikalusId",
                    s."pavadinimas",
                    s."verte",
                    s."tiekejoKodas",
                    seller."pavadinimas"  AS "tiekejoPavadinimas",
                    seller."formosKodas" AS "tiekejoFormosKodas"
             FROM   public."sutartys" s
             LEFT JOIN public."jarCsv" seller ON seller."jarKodas"::text = s."tiekejoKodas"
             WHERE  s."perkanciosiosOrganizacijosKodas" = $1
               AND  s."tipas" <> 'SP'
               AND  s."verte" IS NOT NULL
             ORDER BY s."verte" DESC NULLS LAST
             LIMIT 20`,
            [jk],
        ),
        // Top contracts where this org is the seller
        postgres.query(
            `SELECT s."sutartiesUnikalusId",
                    s."pavadinimas",
                    s."verte",
                    s."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
                    buyer."pavadinimas"  AS "pirkejoPavadinimas",
                    buyer."formosKodas" AS "pirkejoFormosKodas"
             FROM   public."sutartys" s
             LEFT JOIN public."jarCsv" buyer ON buyer."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
             WHERE  s."tiekejoKodas" = $1
               AND  s."tipas" <> 'SP'
               AND  s."verte" IS NOT NULL
             ORDER BY s."verte" DESC NULLS LAST
             LIMIT 20`,
            [jk],
        ),
    ]);

    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    const edgeMap = new Map();

    // Collect all org jarKodas appearing in contracts for a single sodra query
    const contractOrgCodes = new Set([jk]);
    for (const row of asBuyerRes.rows)  { if (row.tiekejoKodas)  contractOrgCodes.add(row.tiekejoKodas); }
    for (const row of asSellerRes.rows) { if (row.pirkejoKodas)  contractOrgCodes.add(row.pirkejoKodas); }

    const sodraRes = await postgres.query(
        `SELECT DISTINCT ON ("jarKodas") "jarKodas", "draustieji", "draustieji2"
         FROM sodra
         WHERE "jarKodas" = ANY($1)
         ORDER BY "jarKodas", "data" DESC NULLS LAST`,
        [Array.from(contractOrgCodes)],
    );
    const sodraMap = new Map(sodraRes.rows.map(r => [r.jarKodas, r]));

    // Root org node
    const jarRow = jarRes.rows[0];
    const sodraSelf = sodraMap.get(jk) || {};
    const rootOrg = orgNode(jk, jarRow?.pavadinimas, jarRow?.formosKodas, {
        expanded: true,
        draustieji: sodraSelf.draustieji,
        draustieji2: sodraSelf.draustieji2,
    });
    addNode(nodes, nodeMap, rootOrg);

    for (const row of pinregRes.rows) {
        const tipas = row.irasoTipas;

        if (tipas === 'DEKLARUOJANCIO_DARBOVIETE') {
            if (!row.vardas || !row.pavarde) continue;
            const pNode = personNode(row.vardas, row.pavarde, row.deklaracija, row.rysioPradzia);
            addNode(nodes, nodeMap, pNode);

            const relType = mapPareigos(row.pareigos);
            const label = row.pareigos || '';
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
            const relType = mapPareigos(row.pareigos);
            const label = row.pareigos || '';
            addEdge(edges, edgeMap, edge(spouseNode.id, rootOrg.id, relType, label, row.rysioPradzia));

            // Declarant → spouse (Spouse edge)
            if (declVardas && declPavarde) {
                const declNode = personNode(declVardas, declPavarde, null, null);
                addNode(nodes, nodeMap, declNode);
                addEdge(edges, edgeMap, edge(declNode.id, spouseNode.id, 'Spouse', 'Sutuoktinis', null));
            }
        }
    }

    // Top contracts where root org is buyer → ContractEntity → supplier
    for (const row of asBuyerRes.rows) {
        if (!row.sutartiesUnikalusId || !row.tiekejoKodas) continue;
        const cNode = contractNode(row.sutartiesUnikalusId, row.pavadinimas, row.verte);
        addNode(nodes, nodeMap, cNode);
        const sodraSupplier = sodraMap.get(row.tiekejoKodas) || {};
        const supplierOrg = orgNode(row.tiekejoKodas, row.tiekejoPavadinimas, row.tiekejoFormosKodas, {
            draustieji: sodraSupplier.draustieji,
            draustieji2: sodraSupplier.draustieji2,
        });
        addNode(nodes, nodeMap, supplierOrg);
        const valueLabel = formatContractValue(row.verte);
        const w = edgeWeight(row.verte || 0);
        addEdge(edges, edgeMap, edge(rootOrg.id, cNode.id, 'Order', valueLabel, null, true, { size: w }));
        addEdge(edges, edgeMap, edge(cNode.id, supplierOrg.id, 'Delivery', '', null, false, { size: w }));
    }

    // Top contracts where root org is seller: buyer → ContractEntity → root org
    for (const row of asSellerRes.rows) {
        if (!row.sutartiesUnikalusId || !row.pirkejoKodas) continue;
        const cNode = contractNode(row.sutartiesUnikalusId, row.pavadinimas, row.verte);
        addNode(nodes, nodeMap, cNode);
        const sodraBuyer = sodraMap.get(row.pirkejoKodas) || {};
        const buyerOrg = orgNode(row.pirkejoKodas, row.pirkejoPavadinimas, row.pirkejoFormosKodas, {
            draustieji: sodraBuyer.draustieji,
            draustieji2: sodraBuyer.draustieji2,
        });
        addNode(nodes, nodeMap, buyerOrg);
        const valueLabel = formatContractValue(row.verte);
        const w = edgeWeight(row.verte || 0);
        addEdge(edges, edgeMap, edge(buyerOrg.id, cNode.id, 'Order', valueLabel, null, true, { size: w }));
        addEdge(edges, edgeMap, edge(cNode.id, rootOrg.id, 'Delivery', '', null, false, { size: w }));
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

            const relType = mapPareigos(row.pareigos);
            const label = row.pareigos || '';
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
                const relType = mapPareigos(row.pareigos);
                const label = row.pareigos || '';
                addEdge(edges, edgeMap, edge(spouseN.id, stub.id, relType, label, null));
            }
        }
    }

    return { nodes, edges };
}

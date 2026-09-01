// Serverinis /teisesAktas/[id] kontroleris: surenka VISKĄ, ką turim apie vieną
// teisės aktą, ir supakuoja į puslapiui paruoštą formą.
//
// Duomenys iš dviejų vietų:
//   Postgres  — normalizuota struktūra (metaduomenys, ryšiai, priedai, redakcijos)
//   sidecar   — oficialus tekstas (indekse ir Postgres'e jo nėra, tik md5)
//
// Vienas aktas turi kelis DOKUMENTUS: originalą, galiojančią suvestinę ir po
// vieną kiekvienai istorinei redakcijai. Puslapis rodo vieną iš jų (kelio
// segmentas po akto id), o likusius — perjungikliu.
import { postgres } from '@/postgres/postgres.js';
import { readETarSidecar } from '@/modules/eTar/eTarSidecar.js';

/**
 * Aktualią suvestinę redakciją adrese žymim `asr` — taip ją vadina ir pats
 * e-TAR API. Originalas segmento neturi (`/teisesAktas/:id`), istorinės
 * redakcijos adrese eina savo tokenu (`/teisesAktas/:id/:tokenas`).
 */
export const ASR_SEGMENTAS = 'asr';

/** Redakcijos raktas (`editionToken` arba varianto kodas) → adreso segmentas. */
export function versijosSegmentas(key: string | null | undefined): string {
  if (!key || key === 'original') return '';
  if (key === 'consolidated_edition') return ASR_SEGMENTAS;
  return key;
}

/** Akto adresas: `/teisesAktas/:id` arba `/teisesAktas/:id/:versija`. */
export function teisesAktoKelias(legalActId: string, key?: string | null): string {
  const segmentas = versijosSegmentas(key);
  return `/teisesAktas/${encodeURIComponent(legalActId)}`
    + (segmentas ? `/${encodeURIComponent(segmentas)}` : '');
}

/** To paties akto teksto skaitytuvas per visą langą. */
export function teisesAktoTekstoKelias(legalActId: string, key?: string | null): string {
  return `${teisesAktoKelias(legalActId, key)}/tekstas`;
}

export interface TeisesAktasDocument {
  documentId: number;
  variantas: string;
  editionToken: string | null;
  sourceUrl: string;
  title: string;
  turinioBusena: string;
  contentMessage: string | null;
  md5: string | null;
  fetchedAt: string | null;
}

export interface TurinioIrasas {
  partId: string;
  label: string;
  depth: number;
  /** Kiek gilesnių dalių po šiuo įrašu liko nerodoma. */
  hidden: number;
}

/**
 * `official_text.structure` medis → plokščia turinio rodyklė.
 *
 * Rodom tik iki `maxDepth` (skyrius → straipsnis): pilnas medis vienam
 * įstatymui siekia 318 mazgų, o „Straipsnio dalis (2 str. 5 d.)" lygio
 * navigacijai per daug smulku. `part_id` sutampa su HTML elementų id, tad
 * kiekvienas įrašas yra veikianti nuoroda į teksto vietą.
 */
export function flattenStructure(nodes: any[], maxDepth = 2): TurinioIrasas[] {
  const out: TurinioIrasas[] = [];
  const countAll = (list: any[]): number =>
    list.reduce((sum, node) => sum + 1 + countAll(node.children ?? []), 0);

  const walk = (list: any[], depth: number) => {
    for (const node of list ?? []) {
      const children = node.children ?? [];
      if (depth > maxDepth) continue;
      out.push({
        partId: node.part_id,
        label: String(node.label ?? '').trim(),
        depth,
        hidden: depth === maxDepth ? countAll(children) : 0,
      });
      if (depth < maxDepth) walk(children, depth + 1);
    }
  };
  walk(nodes, 0);
  // Vienintelė šakninė „Pagrindinė dalis" nieko neduoda — praleidžiam ją, o
  // vaikus pakeliam per lygį.
  if (out.length > 1 && out[0].depth === 0 && nodes.length === 1) {
    return out.slice(1).map(item => ({ ...item, depth: item.depth - 1 }));
  }
  return out;
}

/**
 * Viena akto redakcija taip, kaip ją mato naudotojas: ne „tokenas", o
 * laikotarpis, nuo kada iki kada tas tekstas galiojo.
 */
export interface Redakcija {
  /** Redakcijos tokenas arba varianto kodas; į adresą verčiam `teisesAktoKelias`. */
  key: string;
  /**
   * Kas ši redakcija yra ŠIANDIEN: originalas, šiuo metu galiojanti, jau
   * pasibaigusi ar dar tik įsigaliosianti.
   */
  kind: 'original' | 'consolidated' | 'historical' | 'future';
  from: string | null;
  to: string | null;
  /** Ją nulėmę pakeitimai (kokie aktai šitą redakciją padarė). */
  changes: any[];
  /** Ar turim patį tekstą — jei ne, lieka tik nuoroda į e-TAR. */
  hasText: boolean;
  /**
   * Ar tekstas tikrai perskaitomas (`contentPresence = provided`). `hasText`
   * sako tik tiek, kad dokumento eilutė yra: e-TAR dalies suvestinių turinio
   * neatiduoda, ir tokios redakcijos palyginti nėra su kuo.
   */
  turiTeksta: boolean;
  /** e-TAR adresas (kai savo teksto neturim). */
  sourceUrl: string | null;
  isCurrent: boolean;
}

/** Šiandiena Lietuvos laiku „YYYY-MM-DD" — redakcijų datos yra be laiko zonos. */
function siandien(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vilnius' });
}

/**
 * Ar redakcija galioja, jau baigėsi, ar dar tik įsigalios — sprendžiam PAGAL
 * DATAS, ne pagal e-TAR variantą.
 *
 * e-TAR „suvestine redakcija" vadina ir tą, kuri įsigalios po metų, o visas
 * turinčias pabaigos datą — „istorinėmis". Tai reiškia, kad pagal variantą
 * dabar galiojanti redakcija (ji turi pabaigos datą, nes jau žinom, kada ją
 * pakeis) atrodytų istorinė, o būsimoji — kaip galiojanti. Datos tokios
 * painiavos nekelia.
 */
function redakcijosBusena(
  from: string | null,
  to: string | null,
  variantas: string | undefined,
  now: string,
): Redakcija['kind'] {
  if (from && from > now) return 'future';
  if (to && to < now) return 'historical';
  if (from || to) return 'consolidated';
  // Be datų telieka e-TAR variantas (pvz., redakcijų sąrašas dar nenuskaitytas).
  return variantas === 'consolidated_edition' ? 'consolidated' : 'historical';
}

/**
 * Sulieja dokumentus (turim tekstą) su redakcijų sąrašu (turim datas) į vieną
 * eilę perjungikliui.
 *
 * Dvi lentelės apie tą patį dalyką: "eTar"."legalActDocument" žino, kurių
 * redakcijų tekstą esam nuskaitę, o "eTar"."edition" — nuo kada iki kada kiekviena
 * galiojo. Naudotojui rūpi tik laikotarpis, tad rikiuojam iš datų pusės, o
 * dokumentus prikabinam pagal `editionToken`.
 */
export function buildRedakcijos(
  documents: TeisesAktasDocument[],
  editions: any[],
  currentDocumentId: number | null,
): Redakcija[] {
  const docByToken = new Map<string, TeisesAktasDocument>();
  for (const doc of documents) {
    if (doc.editionToken) docByToken.set(doc.editionToken, doc);
  }
  const used = new Set<string>();
  // Datuotų redakcijų eilė; aktuali suvestinė prie jos prikabinama tik pabaigoje,
  // nes ji turi stovėti pačiame sąrašo viršuje.
  const out: Redakcija[] = [];
  const aktuali: Redakcija[] = [];
  const now = siandien();

  const original = documents.find(d => d.variantas === 'original');
  if (original) {
    out.push({
      key: 'original',
      kind: 'original',
      from: null,
      to: null,
      changes: [],
      hasText: true,
      turiTeksta: original.turinioBusena === 'provided',
      sourceUrl: original.sourceUrl ?? null,
      isCurrent: original.documentId === currentDocumentId,
    });
  }

  for (const edition of editions) {
    const doc = edition.editionToken ? docByToken.get(edition.editionToken) : undefined;
    if (doc?.editionToken) used.add(doc.editionToken);
    out.push({
      key: edition.editionToken,
      kind: redakcijosBusena(
        edition.effectiveFrom ?? null,
        edition.effectiveTo ?? null,
        doc?.variantas,
        now,
      ),
      from: edition.effectiveFrom ?? null,
      to: edition.effectiveTo ?? null,
      changes: edition.changes ?? [],
      hasText: Boolean(doc),
      turiTeksta: doc?.turinioBusena === 'provided',
      sourceUrl: doc?.sourceUrl ?? edition.url ?? null,
      isCurrent: doc != null && doc.documentId === currentDocumentId,
    });
  }

  // Suvestinė, kurios redakcijų sąraše nėra — e-TAR ją laiko atskiru dokumentu
  // („aktuali suvestinė redakcija"), be savo laikotarpio. Naudotojui tai
  // dažniausiai ir yra ieškomas tekstas, tad ji eina į patį viršų.
  for (const doc of documents) {
    if (doc.variantas === 'original') continue;
    if (doc.editionToken && used.has(doc.editionToken)) continue;
    aktuali.push({
      key: doc.editionToken || doc.variantas,
      kind: redakcijosBusena(null, null, doc.variantas, now),
      from: null,
      to: null,
      changes: [],
      hasText: true,
      turiTeksta: doc.turinioBusena === 'provided',
      sourceUrl: doc.sourceUrl ?? null,
      isCurrent: doc.documentId === currentDocumentId,
    });
  }

  return [...aktuali, ...out];
}

/** Grupuoja eilutes pagal raktą į Map. */
function groupBy<T>(rows: T[], key: (row: T) => string | number): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = String(key(row));
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/**
 * @param versija adreso segmentas po akto id: tuščias — originalas, `asr` —
 *   aktuali suvestinė redakcija, kitkas — istorinės redakcijos tokenas.
 */
export async function loadTeisesAktasPage(legalActId: string, versija = '') {
  const { rows: actRows } = await postgres.query(
    `SELECT "legalActId", "title", "firstSeenAt", "fetchedAt" FROM "eTar"."legalAct" WHERE "legalActId" = $1`,
    [legalActId],
  );
  const act = actRows[0];
  if (!act) return null;

  const { rows: docRows } = await postgres.query(
    `SELECT d."documentId", v."code" AS "variantas", d."editionToken", d."sourceUrl", d."title",
            p."code" AS "turinioBusena", d."contentMessage", d."md5", d."fetchedAt"
       FROM "eTar"."legalActDocument" d
       JOIN "eTar"."documentVariant" v USING ("documentVariantId")
       JOIN "eTar"."presenceState" p ON p."presenceStateId" = d."contentPresenceId"
      WHERE d."legalActId" = $1
      ORDER BY v."documentVariantId", d."editionToken"`,
    [legalActId],
  );
  const documents: TeisesAktasDocument[] = docRows.map((r: any) => ({
    ...r,
    documentId: Number(r.documentId),
  }));

  // Pasirinktas dokumentas. Be segmento rodom originalą; su segmentu — tik tai,
  // ko prašyta: jei tokios redakcijos neturim, puslapis ne tyliai parodo kitą
  // tekstą, o nusiunčia į akto pradžią (žr. `versijaNerasta`).
  const wanted = versija === ASR_SEGMENTAS ? 'consolidated_edition' : versija;
  const prašoma = wanted
    ? documents.find(d => d.editionToken === wanted)
      ?? documents.find(d => d.variantas === wanted)
      ?? null
    : null;
  const current = wanted
    ? prašoma
    : documents.find(d => d.variantas === 'original') ?? documents[0] ?? null;
  const versijaNerasta = Boolean(wanted) && prašoma == null;

  // Aktas gali būti stub'as (paminėtas nuorodose, bet dar nenuskaitytas) — tada
  // dokumentų nėra, bet puslapį vis tiek rodom su tuo, ką turim.
  const documentId = current?.documentId ?? null;

  const [metaRes, sectionRes, editionRes, textResourceRes, anomalyRes, scrapeRes] = await Promise.all([
    documentId == null ? { rows: [] } : postgres.query(
      `SELECT m."metadataId", s."name" AS "statusas", ps."code" AS "statusPresence",
              m."effectiveFrom", m."effectiveTo", m."effectiveNote", m."effectiveUntilNote",
              m."registrationText", m."registrationDate", m."registrationNumber"
         FROM "eTar"."documentMetadata" m
         JOIN "eTar"."presenceState" ps ON ps."presenceStateId" = m."statusPresenceId"
         LEFT JOIN "eTar"."actStatus" s USING ("actStatusId")
        WHERE m."documentId" = $1`,
      [documentId],
    ),
    documentId == null ? { rows: [] } : postgres.query(
      `SELECT s."relatedSectionId", t."code", t."payloadKind", s."sourceLabel"
         FROM "eTar"."relatedSection" s
         JOIN "eTar"."relatedSectionType" t USING ("relatedSectionTypeId")
        WHERE s."documentId" = $1
        ORDER BY t."relatedSectionTypeId"`,
      [documentId],
    ),
    postgres.query(
      `SELECT e."editionId", e."editionToken", e."effectiveFrom", e."effectiveTo", e."url", e."scrapedAt"
         FROM "eTar"."edition" e WHERE e."legalActId" = $1 ORDER BY e."ordinal"`,
      [legalActId],
    ),
    documentId == null ? { rows: [] } : postgres.query(
      `SELECT f."name" AS "formatas", r."url"
         FROM "eTar"."officialTextResource" r
         JOIN "eTar"."resourceFormat" f USING ("resourceFormatId")
        WHERE r."documentId" = $1 ORDER BY r."ordinal"`,
      [documentId],
    ),
    postgres.query(
      `SELECT "kind", "ilgis", "pavyzdys" FROM "eTar"."sourceAnomaly" WHERE "legalActId" = $1 ORDER BY "ilgis" DESC`,
      [legalActId],
    ).catch(() => ({ rows: [] })),   // lentelės gali dar nebūti
    postgres.query(
      `SELECT "documentScrapedAt", "editionsScrapedAt", "asrScrapedAt", "failureCount", "lastError", "retryAfter"
         FROM "eTar"."legalActScrape" WHERE "legalActId" = $1`,
      [legalActId],
    ),
  ]);

  const metadata = metaRes.rows[0] ?? null;

  // ── informacinės lentelės laukai + jų nuorodos ir EUROVOC terminai
  let fields: any[] = [];
  let eurovoc: string[] = [];
  let chronology: any[] = [];
  if (metadata) {
    const { rows: fieldRows } = await postgres.query(
      `SELECT f."metadataFieldId", k."code", k."valueKind", f."valueText"
         FROM "eTar"."metadataField" f
         JOIN "eTar"."metadataFieldKey" k USING ("metadataFieldKeyId")
        WHERE f."metadataId" = $1
        ORDER BY k."metadataFieldKeyId"`,
      [metadata.metadataId],
    );
    const fieldIds = fieldRows.map((r: any) => r.metadataFieldId);

    const [linkRes, termRes, chronoRes] = await Promise.all([
      fieldIds.length ? postgres.query(
        `SELECT "metadataFieldId", "linkText", "url" FROM "eTar"."metadataFieldLink"
          WHERE "metadataFieldId" = ANY($1) ORDER BY "ordinal"`,
        [fieldIds],
      ) : { rows: [] },
      fieldIds.length ? postgres.query(
        `SELECT e."metadataFieldId", t."term"
           FROM "eTar"."metadataFieldEurovocTerm" e
           JOIN "eTar"."eurovocTerm" t USING ("eurovocTermId")
          WHERE e."metadataFieldId" = ANY($1) ORDER BY e."ordinal"`,
        [fieldIds],
      ) : { rows: [] },
      postgres.query(
        `SELECT "eventDate", "event" FROM "eTar"."chronologyEvent"
          WHERE "metadataId" = $1 ORDER BY "ordinal"`,
        [metadata.metadataId],
      ),
    ]);

    const linksByField = groupBy(linkRes.rows as any[], r => r.metadataFieldId);
    fields = fieldRows.map((r: any) => {
      const value = r.valueText;
      const links = linksByField.get(String(r.metadataFieldId)) ?? [];
      // Dažnas atvejis (ELI, publikacijos): lauko reikšmė YRA nuorodos adresas,
      // tad rodydami abu tą patį URL parodytume du kartus. Paliekam tik tas
      // nuorodas, kurios prideda ką nors naujo.
      const uniqueLinks = links.filter((l: any) =>
        l.url !== value && l.linkText !== value);
      return { code: r.code, valueKind: r.valueKind, value, links: uniqueLinks };
    });
    eurovoc = (termRes.rows as any[]).map(r => r.term);
    chronology = chronoRes.rows;
  }

  // ── susijusi informacija: priedai ir ryšiai
  const sections = sectionRes.rows as any[];
  const sectionIds = sections.map(s => s.relatedSectionId);
  const attachmentSections: any[] = [];
  const relationSections: any[] = [];

  if (sectionIds.length) {
    const [attRes, relRes] = await Promise.all([
      postgres.query(
        `SELECT a."attachmentId", a."relatedSectionId", a."filename", a."attachmentName"
           FROM "eTar"."attachment" a WHERE a."relatedSectionId" = ANY($1) ORDER BY a."ordinal"`,
        [sectionIds],
      ),
      postgres.query(
        `SELECT r."relationId", r."relatedSectionId", rt."name" AS "rysioTipas",
                r."targetLegalActId", at."name" AS "aktoRusis", r."documentNumber",
                r."adoptedAt", r."title", r."url"
           FROM "eTar"."legalActRelation" r
           JOIN "eTar"."relationType" rt USING ("relationTypeId")
           LEFT JOIN "eTar"."actType" at USING ("actTypeId")
          WHERE r."relatedSectionId" = ANY($1) ORDER BY r."ordinal"`,
        [sectionIds],
      ),
    ]);

    const attachments = attRes.rows as any[];
    const relations = relRes.rows as any[];

    const [attResourceRes, relInstRes] = await Promise.all([
      attachments.length ? postgres.query(
        `SELECT r."attachmentId", f."name" AS "formatas", r."url"
           FROM "eTar"."attachmentResource" r
           JOIN "eTar"."resourceFormat" f USING ("resourceFormatId")
          WHERE r."attachmentId" = ANY($1) ORDER BY r."ordinal"`,
        [attachments.map(a => a.attachmentId)],
      ) : { rows: [] },
      relations.length ? postgres.query(
        `SELECT ri."relationId", i."name"
           FROM "eTar"."legalActRelationInstitution" ri
           JOIN "eTar"."institution" i USING ("institutionId")
          WHERE ri."relationId" = ANY($1) ORDER BY ri."ordinal"`,
        [relations.map(r => r.relationId)],
      ) : { rows: [] },
    ]);

    const resourcesByAttachment = groupBy(attResourceRes.rows as any[], r => r.attachmentId);
    const institutionsByRelation = groupBy(relInstRes.rows as any[], r => r.relationId);
    const attachmentsBySection = groupBy(attachments, a => a.relatedSectionId);
    const relationsBySection = groupBy(relations, r => r.relatedSectionId);

    // Skilčių eiliškumas puslapyje: pirma tai, kas keičia patį aktą, tada
    // platesnis kontekstas, ir tik gale atgalinės nuorodos („Pakeistas
    // dokumentas" reiškia, kad ŠIS aktas ką nors pakeitė — antraeilis faktas).
    const SECTION_ORDER = [
      'legal_act_amendments', 'invalid_de_jure', 'suspended_by_court',
      'temporarily_suspended', 'suspension_restored', 'related_documents',
      'ex_post_evaluation', 'ex_post_evaluated_legal_acts', 'changed_document',
    ];
    const sectionRank = (code: string) => {
      const index = SECTION_ORDER.indexOf(code);
      return index === -1 ? SECTION_ORDER.length : index;
    };

    for (const section of sections) {
      if (section.payloadKind === 'attachment') {
        const items = (attachmentsBySection.get(String(section.relatedSectionId)) ?? []).map(a => ({
          ...a,
          resources: resourcesByAttachment.get(String(a.attachmentId)) ?? [],
        }));
        if (items.length) attachmentSections.push({ ...section, items });
      } else {
        const items = (relationsBySection.get(String(section.relatedSectionId)) ?? []).map(r => ({
          ...r,
          institutions: (institutionsByRelation.get(String(r.relationId)) ?? []).map((i: any) => i.name),
        }));
        if (items.length) relationSections.push({ ...section, items });
      }
    }
    relationSections.sort((a, b) => sectionRank(a.code) - sectionRank(b.code));
  }

  // ── redakcijos ir jas nulėmę pakeitimai
  const editions = editionRes.rows as any[];
  if (editions.length) {
    const { rows: changeRows } = await postgres.query(
      `SELECT c."editionId", c."amendingActId", c."adoptedAt", c."linkText", c."url"
         FROM "eTar"."editionChange" c WHERE c."editionId" = ANY($1) ORDER BY c."ordinal"`,
      [editions.map(e => e.editionId)],
    );
    const byEdition = groupBy(changeRows as any[], c => c.editionId);
    for (const edition of editions) {
      edition.changes = byEdition.get(String(edition.editionId)) ?? [];
    }
  }

  // ── oficialus tekstas iš sidecar'o
  let tekstas: string | null = null;
  let turiHtml = false;
  let struktura: any[] = [];
  if (current?.md5) {
    try {
      const payload: any = await readETarSidecar(current.md5);
      const html = payload?.official_text?.html;
      // HTML rodom <iframe> per vidinį akto teksto endpointą, tekstas lieka kaip
      // atsarginis variantas, kai HTML nėra.
      turiHtml = typeof html === 'string' && html.trim().length > 0;
      const raw = payload?.official_text?.text;
      if (typeof raw === 'string' && raw.trim()) {
        // Nuvalom kaip ir nuosprendžių puslapyje: eilučių pradžios tarpai,
        // >1 tuščia eilutė → viena.
        tekstas = raw
          .replace(/^[ \t]+/gm, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
      struktura = payload?.official_text?.structure ?? [];
    } catch { /* sidecar'o pralaimėjimas puslapio negriauna */ }
  }

  return {
    act,
    documents,
    current,
    versijaNerasta,
    metadata,
    fields,
    eurovoc,
    chronology,
    attachmentSections,
    relationSections,
    editions,
    redakcijos: buildRedakcijos(documents, editions, current?.documentId ?? null),
    textResources: textResourceRes.rows as any[],
    tekstas,
    turiHtml,
    struktura,
    turinys: flattenStructure(struktura),
    anomalies: anomalyRes.rows as any[],
    scrape: scrapeRes.rows[0] ?? null,
  };
}

/*
Vienas teismo sprendimas pagal LITEKO identifikatorių (UUID). Bendras šaltinis
`/teismoNuosprendis/[uuid]` puslapiui ir MCP įrankiui `get_teismo_nuosprendis`,
kad abu matytų tuos pačius laukus.

Identifikatorius gali būti dviejų kartų: senojo LITEKO UUID
(`df247241-d5d5-409c-b085-754cec5ac3f1`) arba LITEKO2 id (`09002711829c4977`).
Pirmiausia tikrinam senąjį — jo įrašų nepalyginamai daugiau.
*/

import { postgres } from "../../postgres/postgres.js";
import { readDocumentFs } from "../documents/documentsFs.js";
import { readLiteko2Sidecar } from "../liteko2/sidecar.js";

/** Kiek daugiausiai tos pačios bylos sprendimų rodom. */
const SUSIJUSIU_RIBA = 50;

/** Nuvalo sprendimo tekstą rodymui: eilučių pradžios tarpai, >1 tuščia eilutė. */
export function valytiNuosprendzioTeksta(text) {
    if (!text) return null;
    const cleaned = String(text)
        .replace(/^[ \t]+/gm, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return cleaned || null;
}

/** LITEKO adresas, iš kurio sprendimas paimtas. */
export function litekoUrl(saltinis, n) {
    return saltinis === "liteko2"
        ? `https://liteko-api-pub.teismas.lt/v1/decisions/${encodeURIComponent(n.litekoId)}`
        : `https://liteko.teismai.lt/viesasprendimupaieska/${n.fileHref}`;
}

async function rastiSprendima(uuid) {
    const { rows: litekoRows } = await postgres.query(
        `SELECT id, md5, "litekoId", "bylosNumeris", "teisminisProcesoNr", "bylosRusis",
                teismas, "teismoRumai", skyrius, instancija, data, "fileHref"
           FROM liteko."nuosprendziaiPilni" WHERE "litekoId" = $1`,
        [uuid],
    );
    if (litekoRows[0]) return { saltinis: "liteko", n: litekoRows[0] };

    const { rows: liteko2Rows } = await postgres.query(
        `SELECT s.id, s.md5, s."liteko2Id" AS "litekoId", s."bylosNumeris",
                s."teisminisProcesoNr", br.pavadinimas AS "bylosRusis",
                t.pavadinimas AS teismas, r.pavadinimas AS "teismoRumai",
                NULL::text AS skyrius, NULL::text AS instancija,
                s."sprendimoData" AS data, s."bylosAprasymas", s."bylaGauta",
                dt.pavadinimas AS "sprendimoTipas", s.busena
           FROM liteko2."sprendimai" s
           LEFT JOIN liteko2."teismai" t ON t."liteko2Id" = s."teismoId"
           LEFT JOIN liteko2."teismai" r ON r."liteko2Id" = s."rumuId"
           LEFT JOIN liteko2."byluRusys" br ON br."liteko2Id" = s."bylosRusiesId"
           LEFT JOIN liteko2."dokumentuTipai" dt ON dt."liteko2Id" = s."sprendimoTipoId"
          WHERE s."liteko2Id" = $1`,
        [uuid],
    );
    if (liteko2Rows[0]) return { saltinis: "liteko2", n: liteko2Rows[0] };

    return null;
}

async function gautiDalyvius(saltinis, sprendimoId) {
    const { rows } = saltinis === "liteko"
        ? await postgres.query(
              `SELECT pavadinimas, kodas, "bylojeKaip"
                 FROM liteko."dalyviaiPilni"
                WHERE "nuosprendzioId" = $1
                ORDER BY "bylojeKaip" NULLS LAST, pavadinimas`,
              [sprendimoId],
          )
        : await postgres.query(
              `SELECT d.pavadinimas, d.kodas, v.pavadinimas AS "bylojeKaip"
                 FROM liteko2."sprendimuDalyviai" d
                 LEFT JOIN liteko2."vaidmenys" v ON v.id = d."vaidmuoId"
                WHERE d."sprendimoId" = $1
                ORDER BY v.pavadinimas NULLS LAST, d.pavadinimas`,
              [sprendimoId],
          );

    // isJar — 9 skaitmenų kodas yra JAR kodas (juridinis asmuo) → nuoroda į /asmuo.
    const dalyviai = rows.map((d) => ({ ...d, isJar: /^\d{9}$/.test(d.kodas || "") }));

    // Trūkstamus dalyvių pavadinimus papildom iš JAR (pagal kodą).
    const trukstamiKodai = [...new Set(dalyviai.filter((d) => !d.pavadinimas && d.isJar).map((d) => d.kodas))];
    if (trukstamiKodai.length) {
        const { rows: jarRows } = await postgres.query(
            `SELECT "jarKodas", pavadinimas FROM "rcJar"."spintaAsmenys" WHERE "jarKodas" = ANY($1)`,
            [trukstamiKodai],
        );
        const jarVardai = Object.fromEntries(jarRows.map((r) => [r.jarKodas, r.pavadinimas]));
        for (const d of dalyviai) if (!d.pavadinimas && jarVardai[d.kodas]) d.pavadinimas = jarVardai[d.kodas];
    }
    return dalyviai;
}

async function gautiKategorijas(saltinis, sprendimoId) {
    const { rows } = saltinis === "liteko"
        ? await postgres.query(
              `SELECT k.kodas, p.pavadinimas
                 FROM liteko."nuosprendziuKategorijos" nk
                 JOIN liteko.kategorijos k ON k.id = nk."kategorijaId"
                 LEFT JOIN liteko."kategorijuPavadinimai" p ON p.id = k."pavadinimoId"
                WHERE nk."nuosprendzioId" = $1
                ORDER BY p.pavadinimas NULLS LAST`,
              [sprendimoId],
          )
        : await postgres.query(
              `SELECT k."kategorijosId" AS kodas, p.pavadinimas
                 FROM liteko2."sprendimuKategorijos" k
                 LEFT JOIN liteko2."kategorijos" p ON p."liteko2Id" = k."kategorijosId"
                WHERE k."sprendimoId" = $1
                ORDER BY p.pavadinimas NULLS LAST`,
              [sprendimoId],
          );
    // Rodom tik įvardintas kategorijas — be pavadinimo lieka tik kodas (pvz. „2.4.2.2“), jo neberodom.
    return rows.filter((k) => k.pavadinimas);
}

/** Grąžina reikšmę tik jei ji yra UUID – LITEKO2 id į `uuid` stulpelį nekastinasi. */
function uuidArba(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? "")
        ? value
        : null;
}

/** `YYYY-MM-DD` iš datos – dublikatų raktui ir palyginimams. */
function dienaISO(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Ar teisminio proceso nr. tikras, t. y. tinkamas bylos sprendimams surišti.
 *
 * Senajame LITEKO dalis įrašų turi vietoj numerio užpildą („-", „1-", „1-01-1-",
 * „0-00-0-00000-0000-0"). Pagal tokį „numerį" susirištų šimtai nesusijusių bylų,
 * tad jį prilyginam trūkstamam. Tikras numeris yra `2-70-3-15052-2026-5` formos.
 *
 * @param {string|null|undefined} nr
 */
export function tinkamasProcesoNr(nr) {
    const value = String(nr ?? "").trim();
    if (!/^\d-\d{2}-\d-\d{5}-\d{4}-\d$/.test(value)) return false;
    return /[1-9]/.test(value.replace(/[^\d]/g, ""));
}

/**
 * Kiti tos pačios bylos sprendimai – pagal teisminio proceso numerį.
 *
 * Teisminio proceso nr. byloje nekinta, kai byla keliauja per instancijas, tad
 * aukštesnės instancijos sprendimas (galėjęs šitą pakeisti ar panaikinti)
 * randamas būtent pagal jį. Ieškom abiejuose šaltiniuose – byla galėjo prasidėti
 * senajame LITEKO ir baigtis LITEKO2.
 *
 * @param {string|null} teisminisProcesoNr
 * @param {string} dabartinisId einamojo sprendimo id – jo sąraše nerodom.
 * @returns {Promise<Array<object>>} naujausi pirmi.
 */
export async function gautiSusijusiusSprendimus(teisminisProcesoNr, dabartinisId) {
    if (!tinkamasProcesoNr(teisminisProcesoNr)) return [];

    // Senojo LITEKO pusėje einam į bazinę lentelę, o ne į `nuosprendziaiPilni` –
    // taip garantuotai suveikia nuosprendziai_teisminisProcesoNr_idx
    // (migrations/liteko/001_teisminisProcesoNrIndeksas.sql).
    const [{ rows: litekoRows }, { rows: liteko2Rows }] = await Promise.all([
        postgres.query(
            `SELECT n."litekoId", n."bylosNumeris", n.data,
                    t.teismas, t.rumai AS "teismoRumai", t.instancija,
                    NULL::text AS "sprendimoTipas"
               FROM liteko.nuosprendziai n
               LEFT JOIN liteko.teismai t ON t.id = n."teismasId"
              WHERE n."teisminisProcesoNr" = $1
                AND n."litekoId" IS DISTINCT FROM $2::uuid
              ORDER BY n.data DESC NULLS LAST
              LIMIT $3`,
            [teisminisProcesoNr, uuidArba(dabartinisId), SUSIJUSIU_RIBA],
        ),
        postgres.query(
            `SELECT s."liteko2Id" AS "litekoId", s."bylosNumeris",
                    s."sprendimoData" AS data, t.pavadinimas AS teismas,
                    r.pavadinimas AS "teismoRumai", NULL::text AS instancija,
                    dt.pavadinimas AS "sprendimoTipas"
               FROM liteko2."sprendimai" s
               LEFT JOIN liteko2."teismai" t ON t."liteko2Id" = s."teismoId"
               LEFT JOIN liteko2."teismai" r ON r."liteko2Id" = s."rumuId"
               LEFT JOIN liteko2."dokumentuTipai" dt ON dt."liteko2Id" = s."sprendimoTipoId"
              WHERE s."teisminisProcesoNr" = $1
                AND s."liteko2Id" <> $2
                AND s.atsauktas = false
              ORDER BY s."sprendimoData" DESC NULLS LAST
              LIMIT $3`,
            [teisminisProcesoNr, dabartinisId, SUSIJUSIU_RIBA],
        ),
    ]);

    const visi = [
        ...litekoRows.map((r) => ({ ...r, saltinis: "liteko" })),
        ...liteko2Rows.map((r) => ({ ...r, saltinis: "liteko2" })),
    ];

    // Perėjimo laikotarpiu tas pats sprendimas gali gulėti abiejuose šaltiniuose
    // skirtingais id. Tas pats teismas toje pačioje byloje tą pačią dieną to
    // paties numerio sprendimo du kartus nepriima, tad dubliui atpažinti
    // (bylosNumeris, diena, teismas) pakanka. Paliekam LITEKO2 eilutę – tas
    // šaltinis tebeatnaujinamas ir turi sprendimo tipą.
    const pagalRakta = new Map();
    for (const s of visi) {
        const raktas = [s.bylosNumeris, dienaISO(s.data), s.teismas].join("|");
        const esamas = pagalRakta.get(raktas);
        if (!esamas || (esamas.saltinis === "liteko" && s.saltinis === "liteko2")) {
            pagalRakta.set(raktas, s);
        }
    }

    return [...pagalRakta.values()]
        .sort((a, b) => new Date(b.data ?? 0) - new Date(a.data ?? 0))
        .slice(0, SUSIJUSIU_RIBA);
}

/**
 * Iš susijusių bylos sprendimų atrenka vėlesnius už duotą datą – būtent jie
 * galėjo šitą sprendimą pakeisti ar panaikinti. Lyginam dienom: sprendimų
 * laikas nefiksuojamas, o tos pačios dienos sprendimas nėra „vėlesnis".
 *
 * @param {Array<{data?: any}>} susije
 * @param {any} data einamojo sprendimo data.
 * @returns {Array<object>} naujausi pirmi (tvarka paveldima iš `susije`).
 */
export function atrinktiVelesnius(susije, data) {
    const diena = dienaISO(data);
    if (!diena) return [];
    return susije.filter((s) => {
        const kito = dienaISO(s.data);
        return kito !== null && kito > diena;
    });
}

/**
 * Sprendimas pagal LITEKO/LITEKO2 identifikatorių.
 *
 * @param {string} uuid
 * @returns {Promise<null|{
 *   saltinis: 'liteko'|'liteko2', n: any, dalyviai: any[], kategorijos: any[],
 *   susijeSprendimai: any[], velesniSprendimai: any[],
 *   sidecar: any, tekstas: string|null, teisejai: string[], vieta: string|null,
 *   litekoUrl: string, dokumentoId: number|null,
 * }>} `null`, jei tokio sprendimo nėra.
 */
export async function gautiNuosprendiPagalUuid(uuid) {
    if (!uuid) return null;
    const rastas = await rastiSprendima(uuid);
    if (!rastas) return null;
    const { saltinis, n } = rastas;

    const [dalyviai, kategorijos, susijeSprendimai] = await Promise.all([
        gautiDalyvius(saltinis, n.id),
        gautiKategorijas(saltinis, n.id),
        gautiSusijusiusSprendimus(n.teisminisProcesoNr, n.litekoId),
    ]);

    // Pilnas tekstas ir papildomi metaduomenys — iš dokumento sidecar JSON (pagal md5).
    let sidecar = null;
    try {
        sidecar = n.md5
            ? await (saltinis === "liteko2" ? readLiteko2Sidecar(n.md5) : readDocumentFs(n.md5))
            : null;
    } catch {
        sidecar = null;
    }

    // documents.documents eilutė atsiranda tik suindeksavus — jos gali ir nebūti.
    // Ieškom per documents."sourceIds".id2 (ten guli LITEKO id) — tam yra indeksas
    // sourceIds_source_id2_unique; paieška per documentsFull.md5 indekso neturi.
    const { rows: dokRows } = await postgres.query(
        `SELECT "documentId" FROM documents."sourceIds"
          WHERE "sourceId" = documents.source_id($1) AND id2 = $2 LIMIT 1`,
        [saltinis, uuid],
    );
    const dokumentoId = dokRows[0]?.documentId ?? null;

    return {
        saltinis,
        n,
        dalyviai,
        kategorijos,
        susijeSprendimai,
        velesniSprendimai: atrinktiVelesnius(susijeSprendimai, n.data),
        sidecar,
        tekstas: valytiNuosprendzioTeksta(sidecar?.text),
        teisejai: sidecar?.metadata?.teisejai ?? [],
        vieta: sidecar?.metadata?.vieta ?? null,
        litekoUrl: litekoUrl(saltinis, n),
        dokumentoId,
    };
}

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
            `SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" = ANY($1)`,
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

/**
 * Sprendimas pagal LITEKO/LITEKO2 identifikatorių.
 *
 * @param {string} uuid
 * @returns {Promise<null|{
 *   saltinis: 'liteko'|'liteko2', n: any, dalyviai: any[], kategorijos: any[],
 *   sidecar: any, tekstas: string|null, teisejai: string[], vieta: string|null,
 *   litekoUrl: string, dokumentoId: number|null,
 * }>} `null`, jei tokio sprendimo nėra.
 */
export async function gautiNuosprendiPagalUuid(uuid) {
    if (!uuid) return null;
    const rastas = await rastiSprendima(uuid);
    if (!rastas) return null;
    const { saltinis, n } = rastas;

    const [dalyviai, kategorijos] = await Promise.all([
        gautiDalyvius(saltinis, n.id),
        gautiKategorijas(saltinis, n.id),
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
        sidecar,
        tekstas: valytiNuosprendzioTeksta(sidecar?.text),
        teisejai: sidecar?.metadata?.teisejai ?? [],
        vieta: sidecar?.metadata?.vieta ?? null,
        litekoUrl: litekoUrl(saltinis, n),
        dokumentoId,
    };
}

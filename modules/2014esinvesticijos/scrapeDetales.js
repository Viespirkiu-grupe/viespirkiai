/*
Projektų puslapių nuskaitymas: savivaldybė, priemonė, prioritetas, kvietimo
kodas, aprašymas, datos, apmokėtos išlaidos, stebėsenos rodikliai, pirkimų
skelbimai ir susiję projektai.

Eilė – projektai."detalesNuskaitytos" IS NULL. Ten patenka nauji projektai ir
tie, kurių sąrašo eilutė pasikeitė (žr. scrape.js).
*/

import pLimit from "p-limit";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { parsisiustiHtml, projektoUrl } from "./saltinis.js";
import { parseProjektoPuslapi } from "./parseProjekta.js";
import {
    priemoniuSlugai,
    rodiklioRaktas,
    upsertRodiklius,
    upsertZodyna,
    zodynoAtitikmenys,
} from "./zodynai.js";

const SCHEMA = `"2014esInvesticijos"`;
const PORCIJA = 200;
const LYGIAGRECIAI = 6;

/**
 * @typedef {import("./parseProjekta.js").ProjektoDetales} ProjektoDetales
 */

/**
 * Projektai, kurių puslapis dar nenuskaitytas.
 * @param {number} kiek
 * @returns {Promise<Array<{id: number, slug: string}>>}
 */
async function pasiimtiEile(kiek) {
    const { rows } = await postgres.query(
        `SELECT "id", "slug" FROM ${SCHEMA}."projektai"
         WHERE "detalesNuskaitytos" IS NULL
         ORDER BY "id"
         LIMIT $1`,
        [kiek],
    );
    return rows;
}

/**
 * Projekto eilutės papildymas detalėmis. Sąrašo laukų netriname – jei puslapyje
 * reikšmės nėra, paliekam tai, kas jau įrašyta.
 * @param {number} projektoId
 * @param {ProjektoDetales} d
 * @param {{savivaldybesId: number|null, priemonesId: number|null, prioritetoId: number|null}} nuorodos
 * @returns {Promise<void>}
 */
async function atnaujintiProjekta(projektoId, d, nuorodos) {
    await postgres.query(
        `UPDATE ${SCHEMA}."projektai" SET
             "savivaldybesId" = COALESCE($2, "savivaldybesId"),
             "priemonesId" = COALESCE($3, "priemonesId"),
             "prioritetoId" = COALESCE($4, "prioritetoId"),
             "kvietimoKodas" = COALESCE($5, "kvietimoKodas"),
             "aprasymas" = COALESCE($6, "aprasymas"),
             "verteParaiskoje" = COALESCE($7, "verteParaiskoje"),
             "prasomasFinansavimas" = COALESCE($8, "prasomasFinansavimas"),
             "projektoIslaidos" = COALESCE($9, "projektoIslaidos"),
             "finansavimas" = COALESCE($10, "finansavimas"),
             "apmoketosIslaidos" = COALESCE($11, "apmoketosIslaidos"),
             "ismoketasFinansavimas" = COALESCE($12, "ismoketasFinansavimas"),
             "paraiskosData" = COALESCE($13, "paraiskosData"),
             "sutartiesData" = COALESCE($14, "sutartiesData"),
             "sutartiesPabaiga" = COALESCE($15, "sutartiesPabaiga"),
             "veikluPradzia" = COALESCE($16, "veikluPradzia"),
             "veikluPabaiga" = COALESCE($17, "veikluPabaiga"),
             "detalesNuskaitytos" = now()
         WHERE "id" = $1`,
        [
            projektoId,
            nuorodos.savivaldybesId,
            nuorodos.priemonesId,
            nuorodos.prioritetoId,
            d.kvietimoKodas,
            d.aprasymas,
            d.verteParaiskoje,
            d.prasomasFinansavimas,
            d.projektoIslaidos,
            d.finansavimas,
            d.apmoketosIslaidos,
            d.ismoketasFinansavimas,
            d.paraiskosData,
            d.sutartiesData,
            d.sutartiesPabaiga,
            d.veikluPradzia,
            d.veikluPabaiga,
        ],
    );
}

/**
 * Vertinimai su balais (sąrašas balo neturi).
 * @param {number} projektoId
 * @param {ProjektoDetales["vertinimai"]} visiVertinimai
 * @returns {Promise<void>}
 */
async function irasytiVertinimus(projektoId, visiVertinimai) {
    // Vienas kriterijus – viena eilutė, net jei puslapyje jis pasikartotų.
    const vertinimai = [
        ...new Map(visiVertinimai.map((v) => [v.kriterijus, v])).values(),
    ];
    if (vertinimai.length === 0) return;

    const kriterijai = await upsertZodyna(
        "vertinimoKriterijai",
        vertinimai.map((v) => v.kriterijus),
    );

    await postgres.query(
        `INSERT INTO ${SCHEMA}."vertinimai"
         ("projektoId", "kriterijausId", "eilesNr", "rezultatas", "data", "balas")
         SELECT $1, * FROM unnest($2::int[], $3::smallint[], $4::bool[], $5::date[], $6::numeric[])
         ON CONFLICT ("projektoId", "kriterijausId") DO UPDATE SET
             "eilesNr" = COALESCE(EXCLUDED."eilesNr", "vertinimai"."eilesNr"),
             "rezultatas" = EXCLUDED."rezultatas",
             "data" = COALESCE(EXCLUDED."data", "vertinimai"."data"),
             "balas" = COALESCE(EXCLUDED."balas", "vertinimai"."balas")`,
        [
            projektoId,
            vertinimai.map((v) => kriterijai.get(v.kriterijus)),
            vertinimai.map((v) => v.eilesNr),
            vertinimai.map((v) => v.rezultatas),
            vertinimai.map((v) => v.data),
            vertinimai.map((v) => v.balas),
        ],
    );
}

/**
 * Stebėsenos rodikliai. Raktas – eilės numeris puslapyje: tas pats rodiklis
 * projekte kartojasi, o eilutės be numerio įrašyti nėra kur.
 * @param {number} projektoId
 * @param {ProjektoDetales["rodikliai"]} visiRodikliai
 * @returns {Promise<void>}
 */
async function irasytiRodiklius(projektoId, visiRodikliai) {
    const rodikliai = [
        ...new Map(
            visiRodikliai.filter((r) => r.eilesNr != null).map((r) => [r.eilesNr, r]),
        ).values(),
    ];
    if (rodikliai.length === 0) return;

    const zodynas = await upsertRodiklius(rodikliai);

    await postgres.query(
        `INSERT INTO ${SCHEMA}."projektuRodikliai"
         ("projektoId", "eilesNr", "rodiklioId", "siektinaReiksme", "pasiektaReiksme")
         SELECT $1, * FROM unnest($2::smallint[], $3::int[], $4::numeric[], $5::numeric[])
         ON CONFLICT ("projektoId", "eilesNr") DO UPDATE SET
             "rodiklioId" = EXCLUDED."rodiklioId",
             "siektinaReiksme" = EXCLUDED."siektinaReiksme",
             "pasiektaReiksme" = EXCLUDED."pasiektaReiksme"`,
        [
            projektoId,
            rodikliai.map((r) => r.eilesNr),
            rodikliai.map((r) => zodynas.get(rodiklioRaktas(r.pavadinimas, r.matavimoVienetas))),
            rodikliai.map((r) => r.siektinaReiksme),
            rodikliai.map((r) => r.pasiektaReiksme),
        ],
    );
}

/**
 * @param {number} projektoId
 * @param {ProjektoDetales["pirkimuSkelbimai"]} visiSkelbimai
 * @returns {Promise<void>}
 */
async function irasytiPirkimuSkelbimus(projektoId, visiSkelbimai) {
    const skelbimai = [...new Map(visiSkelbimai.map((s) => [s.slug, s])).values()];
    if (skelbimai.length === 0) return;

    await postgres.query(
        `INSERT INTO ${SCHEMA}."pirkimuSkelbimai"
         ("projektoId", "slug", "pavadinimas", "paskelbimoData", "terminas")
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::date[], $5::date[])
         ON CONFLICT ("projektoId", "slug") DO UPDATE SET
             "pavadinimas" = EXCLUDED."pavadinimas",
             "paskelbimoData" = EXCLUDED."paskelbimoData",
             "terminas" = EXCLUDED."terminas"`,
        [
            projektoId,
            skelbimai.map((s) => s.slug),
            skelbimai.map((s) => s.pavadinimas),
            skelbimai.map((s) => s.paskelbimoData),
            skelbimai.map((s) => s.terminas),
        ],
    );
}

/**
 * Susiję projektai. Ryšys rašomas tik tada, kai abu projektai jau yra sąraše.
 * @param {number} projektoId
 * @param {string[]} slugai
 * @returns {Promise<void>}
 */
async function irasytiRysius(projektoId, slugai) {
    if (slugai.length === 0) return;

    await postgres.query(
        `INSERT INTO ${SCHEMA}."rysiai" ("projektoId", "susijusioProjektoId")
         SELECT $1, s."id" FROM ${SCHEMA}."projektai" s
         WHERE s."slug" = ANY($2::text[]) AND s."id" <> $1
         ON CONFLICT DO NOTHING`,
        [projektoId, slugai],
    );
}

/**
 * Vieno projekto puslapis.
 * @param {{id: number, slug: string}} projektas
 * @param {{savivaldybes: Map<string, number>, prioritetai: Map<string, number>, priemones: Map<string, number>}} zodynai
 * @returns {Promise<void>}
 */
async function nuskaitytiProjekta(projektas, zodynai) {
    const html = await parsisiustiHtml(projektoUrl(projektas.slug));
    const detales = parseProjektoPuslapi(html);

    // Savivaldybių tėra 60 ir jos jau paimtos iš filtrų – į DB kreipiamės tik
    // tada, kai puslapyje pasitaiko nematytas pavadinimas.
    let savivaldybesId = null;
    if (detales.savivaldybe) {
        savivaldybesId = zodynai.savivaldybes.get(detales.savivaldybe) ?? null;
        if (!savivaldybesId) {
            const nauji = await upsertZodyna("savivaldybes", [detales.savivaldybe]);
            savivaldybesId = nauji.get(detales.savivaldybe) ?? null;
            if (savivaldybesId) zodynai.savivaldybes.set(detales.savivaldybe, savivaldybesId);
        }
    }

    await atnaujintiProjekta(projektas.id, detales, {
        savivaldybesId,
        // Priemonės pavadinimas nėra unikalus, tad siejam tik per slug'ą –
        // jį į DB įrašo scrapePriemones.js.
        priemonesId: detales.priemonesSlug
            ? (zodynai.priemones.get(detales.priemonesSlug) ?? null)
            : null,
        prioritetoId: detales.prioritetas
            ? (zodynai.prioritetai.get(detales.prioritetas) ?? null)
            : null,
    });

    await irasytiVertinimus(projektas.id, detales.vertinimai);
    await irasytiRodiklius(projektas.id, detales.rodikliai);
    await irasytiPirkimuSkelbimus(projektas.id, detales.pirkimuSkelbimai);
    await irasytiRysius(projektas.id, detales.susijeSlugai);
}

/**
 * Nuskaito porciją projektų puslapių.
 * @param {number} [kiek] Kiek projektų imti į vieną porciją
 * @returns {Promise<boolean>} true, jei eilėje dar liko darbo
 */
export async function nuskaitytiProjektuDetales(kiek = PORCIJA) {
    const eile = await pasiimtiEile(kiek);
    if (eile.length === 0) return false;

    const zodynai = {
        savivaldybes: await zodynoAtitikmenys("savivaldybes"),
        prioritetai: await zodynoAtitikmenys("prioritetai"),
        priemones: await priemoniuSlugai(),
    };

    const limit = pLimit(LYGIAGRECIAI);
    let klaidos = 0;

    await Promise.all(
        eile.map((projektas) =>
            limit(async () => {
                try {
                    await nuskaitytiProjekta(projektas, zodynai);
                } catch (err) {
                    klaidos += 1;
                    log(`Klaida nuskaitant ${projektas.slug}: ${err.message}`);
                }
            }),
        ),
    );

    log(`Nuskaityta detalių: ${eile.length - klaidos}/${eile.length}`);
    // Su klaidomis likę projektai lieka eilėje – kitą kartą bandom iš naujo.
    return klaidos < eile.length;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const kiek = Number(process.argv[2]) || PORCIJA;
    let liko = true;
    while (liko) liko = await nuskaitytiProjektuDetales(kiek);
    await postgres.end();
}

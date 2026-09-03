/*
2014.esinvesticijos.lt paraiškų ir projektų sąrašo nuskaitymas į
"2014esInvesticijos" schemą.

Sąraše yra visi 40 tūkst. įrašų su pagrindiniais laukais; projekto puslapiai
(savivaldybė, priemonė, aprašymas, rodikliai) nuskaitomi atskirai –
scrapeDetales.js. Pasikeitus sąrašo eilutei projektui nunulinamas
"detalesNuskaitytos", kad detalės būtų pasiimtos iš naujo.
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { gautiSesija, parsisiustiHtml, sarasoUrl } from "./saltinis.js";
import { parseSarasoPuslapi, parseFiltrus } from "./parseSarasa.js";
import {
    upsertSaltinioZodyna,
    upsertZodyna,
    upsertZodynaSuSaltinioId,
} from "./zodynai.js";

const SCHEMA = `"2014esInvesticijos"`;
const EILUCIU_PUSLAPYJE = 1000;

const PROJEKTO_STULPELIAI = [
    "kodas",
    "slug",
    "pavadinimas",
    "pareiskejoId",
    "busenosId",
    "verteParaiskoje",
    "prasomasFinansavimas",
    "projektoIslaidos",
    "finansavimas",
    "ismoketasFinansavimas",
    "sutartiesData",
];

/**
 * Žodynai iš filtrų – juos duoda bet kuris sąrašo puslapis.
 * @param {string} html Pirmo puslapio HTML
 * @returns {Promise<void>}
 */
async function irasytiFiltruZodynus(html) {
    const filtrai = parseFiltrus(html);

    await upsertSaltinioZodyna("prioritetai", filtrai.prioritetai);
    await upsertSaltinioZodyna("priemones", filtrai.priemones);
    await upsertZodynaSuSaltinioId("savivaldybes", filtrai.savivaldybes);
    await upsertZodynaSuSaltinioId("busenos", filtrai.busenos);

    log(
        `Žodynai: ${filtrai.prioritetai.length} prioritetų, ${filtrai.priemones.length} priemonių, ` +
            `${filtrai.savivaldybes.length} savivaldybių, ${filtrai.busenos.length} būsenų`,
    );
}

/**
 * Projektų eilutės į DB. Grąžina kodas -> id, kad būtų kur prikabinti vertinimus.
 * @param {import("./parseSarasa.js").SarasoEilute[]} eilutes
 * @param {Map<string, number>} pareiskejai
 * @param {Map<string, number>} busenos
 * @returns {Promise<Map<string, number>>}
 */
async function irasytiProjektus(eilutes, pareiskejai, busenos) {
    const reiksmes = [];
    const vietos = eilutes.map((e, i) => {
        reiksmes.push(
            e.kodas,
            e.slug,
            e.pavadinimas,
            pareiskejai.get(e.pareiskejas) ?? null,
            busenos.get(e.busena) ?? null,
            e.verteParaiskoje,
            e.prasomasFinansavimas,
            e.projektoIslaidos,
            e.finansavimas,
            e.ismoketasFinansavimas,
            e.sutartiesData,
        );
        const nuo = i * PROJEKTO_STULPELIAI.length;
        return `(${PROJEKTO_STULPELIAI.map((_, j) => `$${nuo + j + 1}`).join(",")})`;
    });

    // Pasikeitus bent vienam sąrašo laukui detalės tampa pasenusios – jos
    // pažymimos nenuskaitytomis ir eilė jas pasiima iš naujo.
    const pakito = [
        "slug",
        "pavadinimas",
        "busenosId",
        "verteParaiskoje",
        "prasomasFinansavimas",
        "projektoIslaidos",
        "finansavimas",
        "ismoketasFinansavimas",
        "sutartiesData",
    ]
        .map((c) => `p."${c}" IS DISTINCT FROM EXCLUDED."${c}"`)
        .join(" OR ");

    const { rows } = await postgres.query(
        `INSERT INTO ${SCHEMA}."projektai" AS p
         (${PROJEKTO_STULPELIAI.map((c) => `"${c}"`).join(",")})
         VALUES ${vietos.join(",")}
         ON CONFLICT ("kodas") DO UPDATE SET
             ${PROJEKTO_STULPELIAI.filter((c) => c !== "kodas")
                 .map((c) => `"${c}" = EXCLUDED."${c}"`)
                 .join(",\n             ")},
             "nuskaityta" = now(),
             "detalesNuskaitytos" = CASE WHEN ${pakito} THEN NULL ELSE p."detalesNuskaitytos" END
         RETURNING "id", "kodas"`,
        reiksmes,
    );

    return new Map(rows.map((r) => [r.kodas, r.id]));
}

/**
 * Sąrašo puslapio vertinimai (tinkamumas, nauda ir kokybė).
 * Projekto puslapis tuos pačius kriterijus papildo balu, todėl esamų reikšmių
 * nenutriname – rašom tik tai, ką turim.
 * @param {import("./parseSarasa.js").SarasoEilute[]} eilutes
 * @param {Map<string, number>} projektai kodas -> id
 * @returns {Promise<void>}
 */
async function irasytiVertinimus(eilutes, projektai) {
    const kriterijai = await upsertZodyna(
        "vertinimoKriterijai",
        eilutes.flatMap((e) => e.vertinimai.map((v) => v.kriterijus)),
    );

    const stulpeliai = { projektoId: [], kriterijausId: [], eilesNr: [], rezultatas: [], data: [] };
    for (const eilute of eilutes) {
        const projektoId = projektai.get(eilute.kodas);
        if (!projektoId) continue;
        for (const v of eilute.vertinimai) {
            const kriterijausId = kriterijai.get(v.kriterijus);
            if (!kriterijausId) continue;
            stulpeliai.projektoId.push(projektoId);
            stulpeliai.kriterijausId.push(kriterijausId);
            stulpeliai.eilesNr.push(v.eilesNr);
            stulpeliai.rezultatas.push(v.rezultatas);
            stulpeliai.data.push(v.data);
        }
    }
    if (stulpeliai.projektoId.length === 0) return;

    await postgres.query(
        `INSERT INTO ${SCHEMA}."vertinimai"
         ("projektoId", "kriterijausId", "eilesNr", "rezultatas", "data")
         SELECT * FROM unnest($1::int[], $2::int[], $3::smallint[], $4::bool[], $5::date[])
         ON CONFLICT ("projektoId", "kriterijausId") DO UPDATE SET
             "eilesNr" = COALESCE(EXCLUDED."eilesNr", "vertinimai"."eilesNr"),
             "rezultatas" = EXCLUDED."rezultatas",
             "data" = COALESCE(EXCLUDED."data", "vertinimai"."data")`,
        [
            stulpeliai.projektoId,
            stulpeliai.kriterijausId,
            stulpeliai.eilesNr,
            stulpeliai.rezultatas,
            stulpeliai.data,
        ],
    );
}

/**
 * Vieno sąrašo puslapio eilutės į DB.
 * @param {import("./parseSarasa.js").SarasoEilute[]} eilutes
 * @returns {Promise<void>}
 */
async function irasytiPuslapi(visosEilutes) {
    // Pareiškėjas yra privalomas (projektai."pareiskejoId" NOT NULL); tokių
    // eilučių šaltinyje nepasitaikė, bet dėl vienos praleistos eilutės
    // nenutraukiam viso nuskaitymo.
    const suPareiskeju = visosEilutes.filter((e) => e.pareiskejas);
    if (suPareiskeju.length < visosEilutes.length) {
        log(`Praleista eilučių be pareiškėjo: ${visosEilutes.length - suPareiskeju.length}`);
    }

    // Vienas INSERT ... ON CONFLICT tos pačios eilutės du kartus liesti negali,
    // o kodas ir slug abu unikalūs, tad pasikartojimus puslapyje atmetam.
    const kodai = new Set();
    const slugai = new Set();
    const eilutes = suPareiskeju.filter((e) => {
        if (kodai.has(e.kodas) || slugai.has(e.slug)) return false;
        kodai.add(e.kodas);
        slugai.add(e.slug);
        return true;
    });
    if (eilutes.length === 0) return;

    const pareiskejai = await upsertZodyna(
        "pareiskejai",
        eilutes.map((e) => e.pareiskejas),
    );
    // Būsenų su šaltinio id jau yra iš filtrų; čia pasigaunam tik naujas.
    const busenos = await upsertZodyna(
        "busenos",
        eilutes.map((e) => e.busena),
    );

    const projektai = await irasytiProjektus(eilutes, pareiskejai, busenos);
    await irasytiVertinimus(eilutes, projektai);
}

/**
 * Nuskaito visą paraiškų ir projektų sąrašą.
 * @param {number} [nuoPuslapio] Nuo kurio puslapio pradėti (1 – nuo pradžių)
 * @returns {Promise<number>} Kiek eilučių įrašyta
 */
export async function atnaujintiEsInvesticijosSarasa(nuoPuslapio = 1) {
    const cookie = await gautiSesija(EILUCIU_PUSLAPYJE);
    let puslapis = nuoPuslapio;
    let viso = 0;

    while (true) {
        const html = await parsisiustiHtml(sarasoUrl(puslapis), { cookie });
        const { eilutes, visoIrasu } = parseSarasoPuslapi(html);

        if (puslapis === nuoPuslapio) await irasytiFiltruZodynus(html);
        if (eilutes.length === 0) break;

        await irasytiPuslapi(eilutes);
        viso += eilutes.length;
        log(
            `Puslapis ${puslapis}: ${eilutes.length} eilučių, iš viso ${viso}` +
                (visoIrasu ? ` iš ${visoIrasu}` : ""),
        );

        if (eilutes.length < EILUCIU_PUSLAPYJE) break;
        puslapis += 1;
    }

    log(`Sąrašas nuskaitytas: ${viso} eilučių`);
    return viso;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    atnaujintiEsInvesticijosSarasa()
        .then(() => postgres.end())
        .catch(async (err) => {
            console.error("Klaida nuskaitant sąrašą:", err);
            await postgres.end();
            process.exitCode = 1;
        });
}

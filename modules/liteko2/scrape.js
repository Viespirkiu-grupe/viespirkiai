/*
LITEKO2 sprendimų inventorius: puslapiuoja /v1/decisions ir sudeda santraukas į
`liteko2Sprendimai`. Turinio (šalių, teisėjų, kategorijų, teksto) čia neimam —
tuo užsiima scrapeContent.js pagal `turinioNuskaitymas` eilę.

Papildomai pasiimam /v1/decisions/canceled ir pažymim atšauktus sprendimus.

    npm run liteko2:scrape                  # nuo paskutinės DB datos (-7 d.) iki šiandien
    node modules/liteko2/scrape.js --visi   # visa istorija nuo pat pradžių
    node modules/liteko2/scrape.js --nuo 2026-06-01 --iki 2026-06-30
*/

import { iterateDecisions, PUSLAPIO_DYDIS } from "./api.js";
import { liteko2Md5 } from "./sidecar.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { numArg, parseArgs } from "../../utils/cliArgs.js";
import { runPool } from "../../utils/workerPool.js";

// LITEKO2 pradėjo publikuoti sprendimus 2026-05, bet ribą imam su atsarga.
const PRADZIA = "2026-01-01";

// Kiek dienų persidengti su jau nuskaitytu intervalu (sprendimai gali būti
// paskelbiami atgaline data).
const PERSIDENGIMAS_DIENOS = 7;

const PAKETAS = 200;

// Kiek dienų imam lygiagrečiai (viena diena = vienas API kvietimas).
const DIENU_LYGIAGRETUMAS = 4;

function isoDate(value) {
    return new Date(value).toISOString().slice(0, 10);
}

/**
 * Įrašo santraukų paketą.
 *
 * Sąrašo endpoint'as duoda tik pavadinimus (teismo, rūmų, bylos rūšies,
 * sprendimo tipo), o lentelėje laikom tik žodynų `liteko2Id`, tad pavadinimus
 * čia pat išsprendžiam per klasifikatorių lenteles (patikrinta: sąrašo
 * pavadinimai su klasifikatoriais sutampa 100 %). Jei klasifikatorius dar
 * nesinchronizuotas, lieka NULL — teisingus id vis tiek įrašo turinio
 * nuskaitymas, kuris juos gauna tiesiogiai.
 *
 * Jei pasikeitė sprendimo data ar tipas, turinį persiskaitom iš naujo
 * (`turinioNuskaitymas` = 0).
 */
async function upsertSantraukas(rows) {
    // Tas pats sprendimas gali pasitaikyti pakete du kartus (žr. nuskaitytiSprendimus)
    // — tada ON CONFLICT DO UPDATE nulūžtų su „cannot affect row a second time".
    rows = [...new Map(rows.map((byla) => [byla.liteko2Id, byla])).values()];
    if (!rows.length) return;

    // Kiekvienai eilutei: liteko2Id, saltinioId, md5, teismas, rumai,
    // bylosRusis, bylosNumeris, sprendimoData, sprendimoTipas.
    const STULPELIU = 9;
    const values = rows
        .map((_, i) => {
            const p = (n) => `$${i * STULPELIU + n}`;
            return `(${p(1)}, ${p(2)}, ${p(3)},
                (SELECT "liteko2Id" FROM public."liteko2Teismai" WHERE "pavadinimas" = ${p(4)}),
                (SELECT "liteko2Id" FROM public."liteko2Teismai" WHERE "pavadinimas" = ${p(5)}),
                (SELECT "liteko2Id" FROM public."liteko2ByluRusys" WHERE "pavadinimas" = ${p(6)}),
                ${p(7)}, ${p(8)}::timestamptz,
                (SELECT "liteko2Id" FROM public."liteko2DokumentuTipai" WHERE "pavadinimas" = ${p(9)}))`;
        })
        .join(", ");

    await postgres.query(
        `INSERT INTO public."liteko2Sprendimai" (
            "liteko2Id", "saltinioId", "md5", "teismoId", "rumuId",
            "bylosRusiesId", "bylosNumeris", "sprendimoData", "sprendimoTipoId"
         )
         VALUES ${values}
         ON CONFLICT ("liteko2Id") DO UPDATE SET
            "saltinioId"      = EXCLUDED."saltinioId",
            -- COALESCE: nesinchronizuotas klasifikatorius neištrina jau žinomo id.
            "teismoId"        = COALESCE(EXCLUDED."teismoId", public."liteko2Sprendimai"."teismoId"),
            "rumuId"          = COALESCE(EXCLUDED."rumuId", public."liteko2Sprendimai"."rumuId"),
            "bylosRusiesId"   = COALESCE(EXCLUDED."bylosRusiesId", public."liteko2Sprendimai"."bylosRusiesId"),
            "sprendimoTipoId" = COALESCE(EXCLUDED."sprendimoTipoId", public."liteko2Sprendimai"."sprendimoTipoId"),
            "bylosNumeris"    = EXCLUDED."bylosNumeris",
            "sprendimoData"   = EXCLUDED."sprendimoData",
            "turinioNuskaitymas" = CASE
                WHEN public."liteko2Sprendimai"."sprendimoData"
                        IS DISTINCT FROM EXCLUDED."sprendimoData"
                  OR (EXCLUDED."sprendimoTipoId" IS NOT NULL
                      AND public."liteko2Sprendimai"."sprendimoTipoId"
                            IS DISTINCT FROM EXCLUDED."sprendimoTipoId")
                THEN 0
                ELSE public."liteko2Sprendimai"."turinioNuskaitymas"
            END`,
        rows.flatMap((byla) => [
            byla.liteko2Id,
            byla.id == null ? null : String(byla.id),
            liteko2Md5(byla.liteko2Id),
            byla.court ?? null,
            byla.chamber ?? null,
            byla.caseType ?? null,
            byla.caseNumber ?? null,
            byla.decisionDate ?? null,
            byla.decisionType ?? null,
        ]),
    );
}

/** Dienų sąrašas intervale imtinai. */
function dienuIntervalas(nuo, iki) {
    const dienos = [];
    const data = new Date(nuo);
    const pabaiga = new Date(iki);
    while (data <= pabaiga) {
        dienos.push(isoDate(data));
        data.setDate(data.getDate() + 1);
    }
    return dienos;
}

/**
 * Nuskaito sprendimų sąrašą pasirinktame datų intervale — po vieną dieną.
 *
 * Ištisai puslapiuoti negalima: API `sort` parametrą ignoruoja ir visada
 * rikiuoja pagal `decisionDate`, o datos kartojasi, tad per puslapių ribas
 * įrašai ir dubliuojasi, ir prasprūsta (matuota: ištisinis skenavimas rado
 * 1284 iš 1292). Po dieną kiekvienas intervalas telpa į vieną puslapį
 * (daugiausia matyta 72 sprendimai per dieną), tad rezultatas pilnas.
 *
 * @param {object} [options]
 * @param {string} [options.nuo] - „YYYY-MM-DD" (imtinai).
 * @param {string} [options.iki] - „YYYY-MM-DD" (imtinai).
 * @returns {Promise<number>} kiek unikalių santraukų įrašyta.
 */
export async function nuskaitytiSprendimus({ nuo = PRADZIA, iki = isoDate(new Date()) } = {}) {
    const startTime = Date.now();
    const dienos = dienuIntervalas(nuo, iki);
    let apdorota = 0;

    await runPool(
        dienos,
        async (diena) => {
            const dienosBylos = [];
            for await (const byla of iterateDecisions({ dateFrom: diena, dateTo: diena })) {
                if (byla?.liteko2Id) dienosBylos.push(byla);
            }
            if (!dienosBylos.length) return;

            // Jei kada nors viena diena nebetilptų į puslapį, grįžtų ta pati
            // nestabilaus puslapiavimo problema — apie tai reikia žinoti.
            if (dienosBylos.length >= PUSLAPIO_DYDIS) {
                log(
                    `LITEKO2 ĮSPĖJIMAS: ${diena} turi ${dienosBylos.length} sprendimų ` +
                    `(≥ puslapio dydžio) — galimi praleisti įrašai`,
                );
            }

            for (let i = 0; i < dienosBylos.length; i += PAKETAS) {
                await upsertSantraukas(dienosBylos.slice(i, i + PAKETAS));
            }
            apdorota += dienosBylos.length;
        },
        DIENU_LYGIAGRETUMAS,
    );

    log(
        `LITEKO2: ${apdorota} sprendimų santraukų per ${dienos.length} d. (${nuo}..${iki}) ` +
        `per ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    );
    return apdorota;
}

/**
 * Pažymi atšauktus sprendimus. Atšauktų sąraše gali būti ir tokių, kurių
 * pagrindiniame sąraše niekada nematėm — tokius įrašom su `atsauktas = true`,
 * bet turinio jiems neimam.
 * @returns {Promise<number>} kiek atšauktų sprendimų gauta.
 */
export async function pazymetiAtsauktus() {
    const liteko2Ids = [];
    const nauji = [];

    for await (const byla of iterateDecisions({ atsaukti: true })) {
        if (!byla?.liteko2Id) continue;
        liteko2Ids.push(byla.liteko2Id);
        nauji.push(byla);
    }

    if (!liteko2Ids.length) {
        log("LITEKO2: atšauktų sprendimų nėra");
        return 0;
    }

    // Pirma įsitikinam, kad eilutės egzistuoja (santraukos laukai tie patys).
    for (let i = 0; i < nauji.length; i += PAKETAS) {
        await upsertSantraukas(nauji.slice(i, i + PAKETAS));
    }

    const { rowCount } = await postgres.query(
        `UPDATE public."liteko2Sprendimai"
         SET "atsauktas" = true,
             "atsauktasAptiktas" = COALESCE("atsauktasAptiktas", now())
         WHERE "liteko2Id" = ANY($1::text[]) AND "atsauktas" = false`,
        [liteko2Ids],
    );

    // Atšauktas sprendimas nebeturi likti bendroje dokumentų paieškoje.
    // dokumentai DELETE trigeris pats suformuoja Quickwit ištrynimo eilę.
    await postgres.query(
        `DELETE FROM public.dokumentai
         WHERE source = 'liteko2' AND "saltinioId2" = ANY($1::text[])`,
        [liteko2Ids],
    );

    log(`LITEKO2: ${liteko2Ids.length} atšauktų sprendimų (${rowCount} nauji)`);
    return liteko2Ids.length;
}

/**
 * Įprastas periodinis nuskaitymas: nuo paskutinės DB datos su persidengimu.
 * @param {number} [persidengimasDienos]
 */
export async function nuskaitytiNaujausius(persidengimasDienos = PERSIDENGIMAS_DIENOS) {
    const { rows } = await postgres.query(
        `SELECT max("sprendimoData") AS "maxData" FROM public."liteko2Sprendimai"`,
    );

    let nuo = PRADZIA;
    if (rows[0]?.maxData) {
        const data = new Date(rows[0].maxData);
        data.setDate(data.getDate() - persidengimasDienos);
        nuo = isoDate(data);
    }

    const apdorota = await nuskaitytiSprendimus({ nuo, iki: isoDate(new Date()) });
    await pazymetiAtsauktus();
    return apdorota;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));

    if (args.visi) {
        await nuskaitytiSprendimus({ nuo: PRADZIA, iki: isoDate(new Date()) });
        await pazymetiAtsauktus();
    } else if (args.nuo || args.iki) {
        await nuskaitytiSprendimus({
            nuo: typeof args.nuo === "string" ? args.nuo : PRADZIA,
            iki: typeof args.iki === "string" ? args.iki : isoDate(new Date()),
        });
    } else {
        await nuskaitytiNaujausius(numArg(args.persidengimas, PERSIDENGIMAS_DIENOS));
    }

    await postgres.end();
    process.exit(0);
}

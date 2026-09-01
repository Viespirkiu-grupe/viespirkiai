import { log } from "../../utils/log.js";
import { parseArgs, numArg } from "../../utils/cliArgs.js";
import { postgres } from "../../postgres/postgres.js";
import { createETarApi } from "./eTarApi.js";
import { closeSqlite, openETarSidecar } from "./eTarSidecar.js";
import { createRunner } from "./eTarScrape.js";

// "eTar"."sourceAnomaly" perkratymas: kiekvienas ten užfiksuotas aktas nuskaitomas
// iš naujo ir žiūrima, ar šaltinio brokas dar yra.
//
//   node modules/eTar/eTarAnomalijos.js            — parodo, kas lentelėje
//   node modules/eTar/eTarAnomalijos.js --run      — perkrato
//
// Kaip atskiriam „pataisyta" nuo „vis dar sugadinta": anomalijos į lentelę
// rašomos normalizacijos metu (`vocabularyKey` → `recordAnomalies`), tad prieš
// akto perskaitymą įsimenam DB laiką, o po jo ištrinam tas akto eilutes, kurių
// `pastebeta` liko senesnė — vadinasi, šįkart tokio broko nebebuvo. Likusios
// eilutės turi šviežią `pastebeta` ir naują `ilgis`.
//
// Du dalykai, be kurių tai neveiktų teisingai:
//
//   1. `force: true` — privalomas. Nepakitęs md5 kitu atveju nukerta kelią dar
//      prieš `recordAnomalies`, ir NĖ VIENAS aktas nebūtų perskaitytas iš
//      naujo — visos eilutės atrodytų „pataisytos" ir būtų ištrintos.
//   2. Perskaitom VISAS akto redakcijas, ne tik neparsiųstas (kaip daro
//      `--act`): brokas gali tūnoti istorinės redakcijos dokumente, o jo
//      nepatikrinę irgi nuspręstume, kad pataisyta.

const DEFAULT_CONCURRENCY = 4;

/** Anomalijos, sugrupuotos pagal aktą. */
async function anomalijos() {
    const { rows } = await postgres.query(
        `SELECT a."legalActId",
                json_agg(json_build_object('kind', a."kind", 'ilgis', a."ilgis")
                         ORDER BY a."ilgis" DESC) AS "brokas",
                max(t."title") AS "title"
           FROM "eTar"."sourceAnomaly" a
           LEFT JOIN "eTar"."legalAct" t USING ("legalActId")
          GROUP BY a."legalActId"
          ORDER BY a."legalActId"`,
    );
    return rows;
}

const brokasToStr = brokas => brokas.map(b => `${b.kind} ${b.ilgis.toLocaleString("lt-LT")}`).join(", ");

/** Vienas aktas: visi jo dokumentai iš naujo, paskui — kas iš broko liko. */
async function perkratyti(runner, legalActId) {
    // Laiko riba iš DB, o ne iš proceso: `pastebeta` rašoma DB laikrodžiu.
    const { rows: [{ pradzia }] } = await postgres.query(`SELECT now() AS "pradzia"`);

    await runner.scrapeDocument(legalActId);
    await runner.scrapeEditionList(legalActId);
    await runner.scrapeConsolidated(legalActId);

    // Redakcijų sąrašas ką tik perrašytas, tad tokenai — švieži.
    const { rows: redakcijos } = await postgres.query(
        `SELECT "legalActId", "editionToken" FROM "eTar"."edition"
          WHERE "legalActId" = $1 ORDER BY "ordinal"`,
        [legalActId],
    );
    for (const redakcija of redakcijos) await runner.scrapeHistoricalEdition(redakcija);

    const { rows: istaisyta } = await postgres.query(
        `DELETE FROM "eTar"."sourceAnomaly"
          WHERE "legalActId" = $1 AND "pastebeta" < $2
          RETURNING "kind"`,
        [legalActId, pradzia],
    );
    const { rows: liko } = await postgres.query(
        `SELECT "kind", "ilgis" FROM "eTar"."sourceAnomaly"
          WHERE "legalActId" = $1 ORDER BY "ilgis" DESC`,
        [legalActId],
    );
    return { redakcijos: redakcijos.length, istaisyta: istaisyta.map(r => r.kind), liko };
}

export async function perkratytiAnomalijas({ concurrency = DEFAULT_CONCURRENCY } = {}) {
    const aktai = await anomalijos();
    if (!aktai.length) {
        log(`"eTar"."sourceAnomaly" tuščia — nėra ko perkratyti`);
        return { aktai: 0, istaisyta: 0, liko: 0, nepavyko: 0 };
    }

    const api = createETarApi({ maxInflight: Math.min(concurrency, 6) });
    const sidecar = openETarSidecar();
    const runner = createRunner({ api, sidecar, concurrency, force: true });

    const suma = { aktai: aktai.length, istaisyta: 0, liko: 0, nepavyko: 0 };
    let cursor = 0;

    // Aktai lygiagrečiai, bet VIENO akto etapai — griežtai iš eilės: redakcijų
    // sąrašo perrašymas trina ir įrašo "eTar"."edition" eilutes, tad tokenus imam
    // tik po jo.
    async function worker() {
        for (let i = cursor++; i < aktai.length; i = cursor++) {
            const { legalActId, brokas, title } = aktai[i];
            log(`\n[${i + 1}/${aktai.length}] ${legalActId} — ${brokasToStr(brokas)}`
                + `\n  ${(title ?? "").slice(0, 90)}`);
            try {
                const { redakcijos, istaisyta, liko } = await perkratyti(runner, legalActId);
                suma.istaisyta += istaisyta.length;
                suma.liko += liko.length;
                log(`  → ${redakcijos} red. perskaityta;`
                    + ` pataisyta: ${istaisyta.length ? istaisyta.join(", ") : "—"};`
                    + ` liko: ${liko.length ? brokasToStr(liko) : "—"}`);
            } catch (error) {
                // Nepavykus nieko netrinam: nežinom, ar broko nebėra, ar tiesiog
                // neprisiskambinom.
                suma.nepavyko += 1;
                suma.liko += brokas.length;
                log(`  ✗ ${legalActId} nepavyko: ${error.message} — anomalijos paliekamos`);
            }
        }
    }

    try {
        await Promise.all(Array.from({ length: Math.min(concurrency, aktai.length) }, worker));
    } finally {
        closeSqlite(sidecar);
    }

    log(`\nPerkratyta ${suma.aktai} aktų: pataisyta ${suma.istaisyta} anomalijų,`
        + ` liko ${suma.liko}${suma.nepavyko ? `, nepavyko ${suma.nepavyko} aktų` : ""}`);
    return suma;
}

const USAGE = `
"eTar"."sourceAnomaly" perkratymas — kiekvienas aktas nuskaitomas iš naujo (--force),
ir jei brokas nebepasikartoja, eilutė ištrinama.

  node modules/eTar/eTarAnomalijos.js             tik parodo lentelės turinį
  node modules/eTar/eTarAnomalijos.js --run       perkrato
  node modules/eTar/eTarAnomalijos.js --run --concurrency N   (numatyta ${DEFAULT_CONCURRENCY})

Dėmesio: perkratomas VISAS aktas — originalas, redakcijų sąrašas, galiojanti
suvestinė ir visos istorinės redakcijos. Aktui su 100 redakcijų tai 103 užklausos.
`;

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        console.log(USAGE.trim());
    } else if (args.run) {
        await perkratytiAnomalijas({ concurrency: numArg(args.concurrency, DEFAULT_CONCURRENCY) });
    } else {
        const aktai = await anomalijos();
        for (const { legalActId, brokas, title } of aktai) {
            log(`${legalActId}  ${brokasToStr(brokas)}  ${(title ?? "").slice(0, 60)}`);
        }
        log(`Iš viso ${aktai.length} aktų. Perkratyti: --run`);
    }
    process.exit(0);
}

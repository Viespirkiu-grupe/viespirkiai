#!/usr/bin/env node
/*
Vienkartinis `ted."tedNotices"."turinys"` perkėlimas į sidecar'ą.

    npm run ted:sidecar:backfill            # visi nuskaityti skelbimai
    npm run ted:sidecar:backfill -- --limit 100

Skaitom srautu (XML yra ~36 KB, visų iš karto į atmintį imti nereikia) ir
praleidžiam tuos, kurie sidecar'e jau yra – tad skriptą galima kartoti ir tęsti
po nutraukimo. Postgres pusės `turinys` stulpelis metamas atskiru SQL failu
(`migracijaTedTurinys.sql`) tik po to, kai šitas praeina be trūkumų.
*/
import { streamQuery } from "../../postgres/streamQuery.js";
import { log } from "../../utils/log.js";
import { limitArg, parseArgs } from "../../utils/cliArgs.js";
import { postgres } from "../../postgres/postgres.js";
import { openSqlite } from "../../utils/sqlite.js";
import { sidecarDbPath, sidecarKeyColumn, sidecarTable } from "../../utils/sidecarPaths.js";
import { missingFromBatch } from "../sidecars/sqliteMissing.js";
import { saveTedXml, tedMd5, tedSidecarExists, isTedSidecarConfigured } from "./sidecar.js";

export async function backfillTedSidecar({ limit = null } = {}) {
    if (!isTedSidecarConfigured()) {
        throw new Error("SIDECAR_DIR nenustatytas – rašyti sidecar'o negalima.");
    }

    const { rows: [{ viso }] } = await postgres.query(
        `SELECT count(*)::int viso FROM ted."tedNotices" WHERE "turinys" IS NOT NULL`,
    );
    log(`Perkeliam ${limit ? Math.min(limit, viso) : viso} skelbimų iš ${viso} su turiniu…`);

    const stream = await streamQuery(
        `SELECT "tedNoticeNumber", "turinys"
           FROM ted."tedNotices"
          WHERE "turinys" IS NOT NULL
          ORDER BY "tedNoticeNumber"
          ${limit ? `LIMIT ${Number(limit)}` : ""}`,
        [],
        { batchSize: 100 },
    );

    let perkelta = 0;
    let jauBuvo = 0;
    const pradzia = Date.now();
    let pranesta = pradzia;

    for await (const row of stream) {
        const md5 = tedMd5(row.tedNoticeNumber);
        if (await tedSidecarExists(md5)) {
            jauBuvo += 1;
        } else {
            await saveTedXml(md5, row.turinys);
            perkelta += 1;
        }

        // Kas 5 s, o ne kas N eilučių: greitis labai skiriasi (jau esantį įrašą
        // praleidžiam per mikrosekundes, naują suspaudžiam zstd'u).
        const apdorota = perkelta + jauBuvo;
        if (Date.now() - pranesta >= 5000) {
            pranesta = Date.now();
            const perSek = apdorota / ((pranesta - pradzia) / 1000);
            const liko = viso > apdorota ? Math.round((viso - apdorota) / perSek) : 0;
            log(
                `${apdorota}/${viso} (${Math.round((apdorota / viso) * 100)} %), ` +
                `perkelta ${perkelta}, jau buvo ${jauBuvo}, ` +
                `${perSek.toFixed(1)}/s, liko ~${liko} s`,
            );
        }
    }

    const trukmeS = Math.round((Date.now() - pradzia) / 1000);
    log(`DONE per ${trukmeS} s. Perkelta ${perkelta}, jau buvo ${jauBuvo}.`);
    return { perkelta, jauBuvo };
}

/**
 * Ar visi DB skelbimai su turiniu jau turi sidecar įrašą. Tikrinam partijomis
 * per tą patį `json_each` kelią, kaip `npm run sidecars:sqlite-missing`.
 */
export async function trukstamiSidecare() {
    const { rows } = await postgres.query(
        `SELECT "tedNoticeNumber" FROM ted."tedNotices" WHERE "turinys" IS NOT NULL`,
    );
    const db = openSqlite(sidecarDbPath("ted"), { readonly: true });
    try {
        const trukstami = [];
        for (let i = 0; i < rows.length; i += 500) {
            const dalis = rows.slice(i, i + 500);
            const nerasti = new Set(
                missingFromBatch(
                    db,
                    sidecarTable("ted"),
                    dalis.map((row) => tedMd5(row.tedNoticeNumber)),
                    sidecarKeyColumn("ted"),
                ),
            );
            for (const row of dalis) {
                if (nerasti.has(tedMd5(row.tedNoticeNumber))) trukstami.push(row.tedNoticeNumber);
            }
        }
        return trukstami;
    } finally {
        db.close();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));
    const limit = limitArg(args.limit);
    await backfillTedSidecar({ limit: Number.isFinite(limit) ? limit : null });
    const trukstami = await trukstamiSidecare();
    if (trukstami.length) {
        console.error(`Sidecar'e trūksta ${trukstami.length} skelbimų, pvz.: ${trukstami.slice(0, 5).join(", ")}`);
        process.exitCode = 1;
    } else {
        log("Patikra: visi skelbimai su turiniu yra sidecar'e – galima taikyti migracijaTedTurinys.sql");
    }
    await postgres.end();
}

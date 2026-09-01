import { postgres } from "../postgres/postgres.js";
import { parseArgs } from "node:util";

/**
 * Kurios lentelės ir stulpeliai dar neturi `COMMENT ON`.
 *
 *   node scripts/trukstamiLenteliuKomentarai.js              # santrauka
 *   node scripts/trukstamiLenteliuKomentarai.js --sql eTar   # tuščias šablonas šeimai
 *   node scripts/trukstamiLenteliuKomentarai.js --sql --top 10
 *
 * Rikiuojama pagal lentelės dydį, didžiausios pirma – aprašinėti verta nuo to,
 * ką dažniausiai kas nors atsidarys.
 *
 * Skriptas nieko nekeičia: `--sql` tik atspausdina blankus, kuriuos užpildžius
 * gaunamas eilinis SQL failas projekto šaknyje (`lenteliuKomentarai2.sql`).
 */

const { values } = parseArgs({
    options: {
        sql: { type: "string" },
        top: { type: "string", default: "25" },
        stulpeliai: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
});

async function main() {
    const { rows } = await postgres.query(`
        SELECT
            c.relname                                        AS lentele,
            obj_description(c.oid, 'pg_class')               AS aprasymas,
            pg_table_size(c.oid) + pg_indexes_size(c.oid)    AS dydis,
            count(a.attname)                                 AS stulpeliu,
            count(col_description(a.attrelid, a.attnum))     AS aprasyta
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attribute a
               ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
        GROUP BY c.oid, c.relname
        ORDER BY dydis DESC
    `);

    const filtras = typeof values.sql === "string" && values.sql !== "" ? values.sql : null;
    const atrinktos = filtras ? rows.filter((r) => r.lentele.startsWith(filtras)) : rows;

    if (values.sql === undefined) {
        const beAprasymo = rows.filter((r) => !r.aprasymas);
        const stulpeliuIsViso = rows.reduce((s, r) => s + Number(r.stulpeliu), 0);
        const stulpeliuAprasyta = rows.reduce((s, r) => s + Number(r.aprasyta), 0);

        console.log(`Lentelių: ${rows.length}, aprašyta ${rows.length - beAprasymo.length}`);
        console.log(`Stulpelių: ${stulpeliuIsViso}, aprašyta ${stulpeliuAprasyta}`);
        console.log(`\nDidžiausios be aprašymo (${Math.min(25, beAprasymo.length)} iš ${beAprasymo.length}):`);
        for (const row of beAprasymo.slice(0, 25)) {
            const mb = (Number(row.dydis) / 1024 / 1024).toFixed(0);
            console.log(`  ${row.lentele.padEnd(45)} ${mb.padStart(7)} MB  ${row.aprasyta}/${row.stulpeliu} stulp.`);
        }
        return;
    }

    const riba = Number(values.top) || 25;
    const eilutes = [
        `-- Blankai užpildymui. Sugeneruota ${new Date().toISOString()}`,
        "-- Užpildę pervadinkite į lenteliuKomentarai<N>.sql ir pritaikykite.",
        "",
    ];

    for (const row of atrinktos.slice(0, riba)) {
        if (row.aprasymas && !values.stulpeliai) continue;
        if (!row.aprasymas) {
            eilutes.push(`COMMENT ON TABLE public.${JSON.stringify(row.lentele)} IS '';`);
        }

        if (values.stulpeliai) {
            const { rows: stulpeliai } = await postgres.query(
                `
                SELECT a.attname AS vardas
                FROM pg_attribute a
                JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = $1
                  AND a.attnum > 0 AND NOT a.attisdropped
                  AND col_description(a.attrelid, a.attnum) IS NULL
                ORDER BY a.attnum
                `,
                [row.lentele],
            );
            for (const stulpelis of stulpeliai) {
                eilutes.push(
                    `COMMENT ON COLUMN public.${JSON.stringify(row.lentele)}.${JSON.stringify(stulpelis.vardas)} IS '';`,
                );
            }
        }
        eilutes.push("");
    }

    console.log(eilutes.join("\n"));
}

main()
    .catch((error) => {
        console.error("Nepavyko:", error);
        process.exitCode = 1;
    })
    .finally(() => postgres.end());

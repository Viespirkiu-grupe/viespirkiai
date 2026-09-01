import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { streamQuery } from "../../postgres/streamQuery.js";
import { writeJsonlFile } from "../../utils/jsonl.js";
// Vienintelis „įprasto" teisinio statuso apibrėžimas – nedubliuojam (Node
// natyviai nuskaito .ts tipų nutrynimu).
import { rodomasStatusas } from "../../src/lib/jarStatusas.ts";

// Visi JAR juridiniai asmenys → exports/juridiniai.jsonl (angliški camelCase raktai).
//   npm run export:juridiniai-jsonl
//   node modules/juridiniai/eksportuotiJsonl.js --tik-registruoti --limit 1000
//
// Eilutės srautinamos kursoriumi (žr. streamQuery) – atmintis pastovi ir prie
// milijono įrašų. Rūšiuojama pagal "jarKodas", kad eksportai būtų atkartojami.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(HERE, "../../exports/juridiniai.jsonl");
const PROGRESS_EVERY = 50_000;

function parseArgs(argv) {
    const options = { output: DEFAULT_OUTPUT, limit: null, tikRegistruoti: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--tik-registruoti") {
            options.tikRegistruoti = true;
        } else if (arg === "--output" || arg === "-o") {
            options.output = path.resolve(argv[++i] ?? "");
        } else if (arg === "--limit") {
            const value = Number(argv[++i]);
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error(`Blogas --limit: ${argv[i]}`);
            }
            options.limit = value;
        } else {
            throw new Error(`Nežinomas argumentas: ${arg}`);
        }
    }
    return options;
}

function buildSql({ tikRegistruoti, limit }) {
    return `
        SELECT
            j."jarKodas",
            j."pavadinimas",
            j."registravimoData",
            j."isregistruotas",
            f."pavadinimas" AS "formosPavadinimas",
            s."pavadinimas" AS "statusoPavadinimas",
            j."evrkKodas",
            e."pavadinimas" AS "evrkPavadinimas",
            j."darbuotojai",
            j."vidutinisAtlyginimas",
            aps."pavadinimas" AS "apskritis",
            sav."pavadinimas" AS "savivaldybe",
            CASE WHEN j."location" IS NULL
                THEN NULL ELSE ST_Y(j."location") END AS "lat",
            CASE WHEN j."location" IS NULL
                THEN NULL ELSE ST_X(j."location") END AS "lon"
        FROM public."juridiniai" j
        LEFT JOIN public."juridiniaiFormos" f
            ON f."kodas" = j."formosKodas"
        LEFT JOIN public."juridiniaiStatusai" s
            ON s."kodas" = j."statusoKodas"
        LEFT JOIN public."juridiniaiSavivaldybesPavadinimai" sav
            ON sav."id" = j."savivaldybeId"
        LEFT JOIN public."juridiniaiApskritysPavadinimai" aps
            ON aps."id" = j."apskritisId"
        LEFT JOIN public."juridiniaiEvrk" e
            ON e."kodas" = j."evrkKodas"
        ${tikRegistruoti ? `WHERE j."isregistruotas" = false` : ""}
        ORDER BY j."jarKodas"
        ${limit ? `LIMIT ${limit}` : ""}
    `;
}

/** DB eilutė → eksporto dokumentas. */
export function toRecord(row) {
    return {
        id: row.jarKodas,
        name: row.pavadinimas,
        registrationDate: row.registravimoData ?? null,
        // `isregistruotas` = išregistruotas iš JAR, todėl reikšmė apversta.
        registrationStatus: row.isregistruotas ? "deregistered" : "registered",
        legalForm: row.formosPavadinimas ?? null,
        // „Teisinis stat neįregistruotas" = jokio ypatingo statuso → null.
        legalStatus: rodomasStatusas(row.statusoPavadinimas),
        evrk: row.evrkKodas
            ? { evrkCode: row.evrkKodas, evrkName: row.evrkPavadinimas ?? null }
            : null,
        employees: row.darbuotojai ?? null,
        averageSalary: row.vidutinisAtlyginimas ?? null,
        county: row.apskritis ?? null,
        municipality: row.savivaldybe ?? null,
        location:
            row.lat === null || row.lon === null
                ? null
                : { lat: row.lat, lon: row.lon },
    };
}

async function* records(options, onProgress) {
    const stream = await streamQuery(buildSql(options));
    let seen = 0;
    for await (const row of stream) {
        yield toRecord(row);
        if (++seen % PROGRESS_EVERY === 0) onProgress(seen);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const t0 = Date.now();

    const total = await writeJsonlFile(
        options.output,
        records(options, (seen) => {
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(`${seen} juridinių (${dt}s)`);
        }),
    );

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Eksportuota ${total} juridinių į ${options.output} (${dt}s)`);
}

main()
    .catch((error) => {
        console.error("Nepavyko eksportuoti juridinių:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });

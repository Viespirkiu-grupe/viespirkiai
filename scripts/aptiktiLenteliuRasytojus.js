import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgres } from "../postgres/postgres.js";

/**
 * Aptinka, kuris kodas rašo į kurią lentelę, ir išveda `UPSERT` SQL į stdout.
 *
 *   node scripts/aptiktiLenteliuRasytojus.js > lenteliuRasytojai.sql
 *
 * Skenuojami tik RAŠYMO raštai (`INSERT INTO`, `UPDATE`, `COPY`, `DELETE FROM`)
 * prie literalinio lentelės vardo. `SELECT` sąmoningai ignoruojamas – kitaip
 * pasirodytų, kad į `jar` rašo pusė projekto.
 *
 * Skriptas nieko nekeičia duomenų bazėje ir yra saugus leisti pakartotinai:
 * sugeneruotas `UPSERT` turi `WHERE "aptiktaAutomatiskai"`, tad rankomis
 * suvestų eilučių niekada neperrašo.
 *
 * Ko šis skriptas NEGALI (tai rašoma ranka):
 *   - dinaminių vardų `INSERT INTO "${lentele}"` (quickwit/*, modules/sidecars/*);
 *   - vienkartinių ar metinių importų dažnio – jo kode paprasčiausiai nėra;
 *   - lentelės prasmės: tam yra COMMENT ON.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const KATALOGAI = ["modules", "tasks", "quickwit", "postgres", "utils", "src/lib"];
const PLETINIAI = new Set([".js", ".ts", ".mjs"]);

async function failai(katalogas) {
    const rezultatas = [];
    let irasai;
    try {
        irasai = await fs.readdir(path.join(ROOT, katalogas), { withFileTypes: true });
    } catch {
        return rezultatas;
    }

    for (const irasas of irasai) {
        const santykinis = path.join(katalogas, irasas.name);
        if (irasas.isDirectory()) {
            if (irasas.name === "node_modules") continue;
            rezultatas.push(...(await failai(santykinis)));
        } else if (PLETINIAI.has(path.extname(irasas.name))) {
            rezultatas.push(santykinis);
        }
    }
    return rezultatas;
}

async function lenteliuVardai() {
    const { rows } = await postgres.query(`
        SELECT c.relname AS vardas
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
    `);
    return rows.map((row) => row.vardas);
}

/** `INSERT INTO "x"`, `UPDATE "x"`, `COPY "x"`, `DELETE FROM "x"` – su kabutėmis ar be. */
function rasytojoRegexp(lentele) {
    const vardas = lentele.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
        `(?:INSERT\\s+INTO|UPDATE|COPY|DELETE\\s+FROM)\\s+(?:public\\s*\\.\\s*)?"?${vardas}"?\\b`,
        "i",
    );
}

/** Dinaminis vardas – tokių priskirti negalim, bet verta apie juos pranešti. */
const DINAMINIS = /(?:INSERT\s+INTO|UPDATE|COPY|DELETE\s+FROM)\s+(?:public\s*\.\s*)?["'`]?\$\{/i;

function sqlMasyvas(reiksmes) {
    if (!reiksmes.length) return "'{}'";
    return `'{${reiksmes.map((r) => `"${r.replace(/"/g, '\\"')}"`).join(",")}}'`;
}

async function main() {
    const lenteles = await lenteliuVardai();
    const keliai = (await Promise.all(KATALOGAI.map(failai))).flat();

    const turinys = new Map();
    const dinaminiai = [];
    for (const kelias of keliai) {
        const tekstas = await fs.readFile(path.join(ROOT, kelias), "utf8");
        turinys.set(kelias, tekstas);
        if (DINAMINIS.test(tekstas)) dinaminiai.push(kelias);
    }

    const rasta = new Map();
    for (const lentele of lenteles) {
        const regexp = rasytojoRegexp(lentele);
        const moduliai = [];
        for (const [kelias, tekstas] of turinys) {
            // Greitas atmetimas prieš brangų regexp'ą.
            if (!tekstas.includes(lentele)) continue;
            if (regexp.test(tekstas)) moduliai.push(kelias);
        }
        if (moduliai.length) rasta.set(lentele, moduliai.sort());
    }

    const eilutes = [
        "-- lenteliuRasytojai.sql",
        `-- Sugeneruota ${new Date().toISOString()} scripts/aptiktiLenteliuRasytojus.js`,
        "-- Automatinis spėjimas pagal SQL rašymo raštus kode. Peržiūrėkite prieš taikydami.",
        "",
        "BEGIN;",
        "",
    ];

    for (const [lentele, moduliai] of [...rasta].sort()) {
        eilutes.push(
            `INSERT INTO dba."lenteles" ("schema","lentele","moduliai","aptiktaAutomatiskai")`,
            `VALUES ('public', '${lentele.replace(/'/g, "''")}', ${sqlMasyvas(moduliai)}, true)`,
            `ON CONFLICT ("schema","lentele") DO UPDATE`,
            `   SET "moduliai" = EXCLUDED."moduliai", "atnaujinta" = now()`,
            ` WHERE dba."lenteles"."aptiktaAutomatiskai";`,
            "",
        );
    }

    eilutes.push("COMMIT;");
    console.log(eilutes.join("\n"));

    console.error(`Rasta rašytojų ${rasta.size} iš ${lenteles.length} lentelių.`);
    if (dinaminiai.length) {
        console.error(
            `\nFailai su dinaminiais lentelių vardais (priskirti reikia rankomis):\n  ${dinaminiai.join("\n  ")}`,
        );
    }
    const beRasytojo = lenteles.filter((l) => !rasta.has(l)).sort();
    console.error(`\nBe aptikto rašytojo (${beRasytojo.length}):\n  ${beRasytojo.join(", ")}`);
}

main()
    .catch((error) => {
        console.error("Nepavyko:", error);
        process.exitCode = 1;
    })
    .finally(() => postgres.end());

import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { SCHEMA, transakcija } from "./db.js";
import { ANTRASCIU_LAPAI, importuotiAtaskaitas } from "./ataskaitos.js";
import { antrasciuBvpz, importuotiBvpz, importuotiInstitucijas, importuotiProjektus } from "./institucijos.js";
import { DALIU_LAPAI, importuotiDalis, importuotiDaliuBvpz } from "./dalys.js";
import { DALYVIU_LAPAI, importuotiDalyvius } from "./dalyviai.js";
import { PABAIGU_LAPAI, SUTARCIU_LAPAI, importuotiPabaigas, importuotiSutartis } from "./baigtys.js";
import { ATMETIMU_LAPAI, KRITERIJU_LAPAI, importuotiAtmetimus, importuotiKriterijus } from "./kriterijai.js";
import { importuotiKoncesijas } from "./koncesijos.js";
import { sukurtiKontekstą } from "./kontekstas.js";
import { dataDir, lapas, skaitytiWorkbooka } from "./xlsxSkaitymas.js";

const logger = new Logger(import.meta.url);

const HELP = `VPT apjungtų ataskaitų XLSX importas tiesiai į reliacines lenteles.

Naudojimas:
  node modules/vptXlsxApjungtosAtaskaitos/importuotiXlsx.js [--help]

Failai imami iš modules/vptXlsxApjungtosAtaskaitos/data/ (į git nepatenka).
Schema pritaikoma atskirai (vptXlsxApjungtosAtaskaitos1.sql). Importas
idempotentiškas – kartojant kiekiai nesikeičia.`;

/** Kartą perskaityti workbook'ai. */
const kesas = new Map();

/** @param {string} failas */
async function skaityti(failas) {
    if (!kesas.has(failas)) kesas.set(failas, await skaitytiWorkbooka(failas));
    return kesas.get(failas);
}

/** @param {string} failas */
async function arYra(failas) {
    try {
        await access(path.join(dataDir, failas));
        return true;
    } catch {
        return false;
    }
}

/**
 * Surenka nurodytų failų/lapų eilutes į vieną sąrašą.
 *
 * @param {{failas: string, lapas: string, seima: string}[]} aprasai
 */
async function surinkti(aprasai) {
    const eilutes = [];
    for (const aprasas of aprasai) {
        if (!await arYra(aprasas.failas)) continue;
        const lapai = await skaityti(aprasas.failas);
        for (const eilute of lapas(lapai, aprasas.lapas)) {
            eilutes.push({ seima: aprasas.seima, lapas: aprasas.lapas, eilute });
        }
    }
    return eilutes;
}

/**
 * Pilnas importas: XLSX → visos schemos lentelės viena transakcija.
 *
 * @returns {Promise<Record<string, number>>} lentelė → eilučių kiekis
 */
export async function importuotiApjungtasAtaskaitas() {
    return transakcija(async (client) => {
        const kontekstas = await sukurtiKontekstą(client);

        const antrastes = await surinkti(ANTRASCIU_LAPAI);
        const pagalSeima = ANTRASCIU_LAPAI.map(({ seima }) => ({
            seima,
            eilutes: antrastes.filter((e) => e.seima === seima).map((e) => e.eilute),
        }));
        await importuotiAtaskaitas(client, kontekstas, pagalSeima);
        logger.log(`Ataskaitos: ${kontekstas.ataskaitos.size}`);

        await importuotiInstitucijas(client, kontekstas, antrastes);
        await importuotiProjektus(client, kontekstas, antrastes);
        await importuotiBvpz(client,
            antrasciuBvpz(kontekstas, antrastes.filter((e) => e.seima !== "concession")),
            "submission_cpv");

        const daliuEilutes = await surinkti(DALIU_LAPAI);
        await importuotiDalis(client, kontekstas, daliuEilutes);
        await importuotiDaliuBvpz(client, kontekstas, daliuEilutes);
        logger.log(`Dalys: ${kontekstas.dalys.size}`);

        await importuotiDalyvius(client, kontekstas, await surinkti(DALYVIU_LAPAI));
        logger.log(`Dalyviai: ${kontekstas.dalyviai.size}, pasiūlymai: ${kontekstas.pasiulymai.size}`);

        await importuotiPabaigas(client, kontekstas, await surinkti(PABAIGU_LAPAI));
        await importuotiSutartis(client, kontekstas, await surinkti(SUTARCIU_LAPAI));
        logger.log(`Sutartys: ${kontekstas.sutartys.size}`);

        await importuotiKriterijus(client, kontekstas, await surinkti(KRITERIJU_LAPAI));
        await importuotiAtmetimus(client, kontekstas, await surinkti(ATMETIMU_LAPAI));

        if (await arYra("Koncesijos.xlsx")) {
            await importuotiKoncesijas(client, kontekstas, await skaityti("Koncesijos.xlsx"));
        }

        return suvestine(client);
    });
}

/**
 * Pagrindinių lentelių eilučių kiekiai.
 *
 * @param {import("pg").PoolClient} client
 */
async function suvestine(client) {
    const lenteles = [
        "submission", "procurement_report", "concession_report", "party",
        "report_party", "lot", "participation", "offer", "procedure_outcome",
        "contract", "contract_party",
    ];
    const { rows } = await client.query(
        lenteles.map((lentele) =>
            `SELECT '${lentele}' AS lentele, count(*)::integer AS eiluciu FROM ${SCHEMA}.${lentele}`)
            .join(" UNION ALL "),
    );
    return rows;
}

async function main() {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        console.log(HELP);
        return;
    }
    console.table(await importuotiApjungtasAtaskaitas());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await main();
    } catch (error) {
        console.error(error?.stack ?? error);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}

import Timings from "../../utils/timings.js";
import { postgres } from "../../postgres/postgres.js";
import { specialJarCodes } from "./specialJarCodes.js";

import { gautiDarboSkelbimus } from "../uzimtumoTarnyba/darboSkelbimai.js";
import { gautiFinansuDuomenis } from "../finansai/finansuDuomenys.js";
import { gautiSodrosDuomenis } from "../sodra/sodraDuomenys.js";
import { gautiVmiDuomenis } from "../vmi/vmiDuomenys.js";
import { gautiRegitrosDuomenis } from "../regitra/regitraDuomenys.js";
import { gautiTeismoNuosprendzius } from "../liteko/teismoNuosprendziai.js";
import { gautiIstatiniKapitala } from "../istatinisKapitalas/istatinisKapitalasDuomenys.js";
import { gautiPinregDeklaracijasPagalJarKoda } from "../pinreg/pinregDeklaracijos.js";
import { gautiNepatikimuTiekejuIrasusPagalJarKoda } from "../vptSarasai/nepatikimiTiekejai.js";
import { gautiMelaginguTiekejuIrasusPagalJarKoda } from "../vptSarasai/melagingiTiekejai.js";
import { gautiJadisDalyvius } from "../jadis/jadisDuomenys.js";
import { gautiRcPranesimusPagalJarKoda } from "../registruCentrasPranesimai/rcPranesimai.js";
import { gautiSutarciuDuomenisPagalJarKoda } from "../sutartys/pagalJarKoda.js";
import { rastiDomenusPagalJarKoda } from "../domenai/rastiPagalJarKoda.js";
import { rastiKotisPagalGavejoKoda } from "../kotis/getByJarKodas.js";

export async function getJuridinisInfo(jarKodas, options = {}) {
    let timings = options.timings || new Timings();

    timings.start("jarCsv");
    // Detalus JAR
    const { rows: jarRezultatai } = await postgres.query(
        `SELECT *,
                    ST_X(location::geometry) AS lon,
                    ST_Y(location::geometry) AS lat
             FROM "jarCsv"
             WHERE "jarKodas" = $1
             LIMIT 1`,
        [jarKodas],
    );
    timings.end("jarCsv");

    // data.gov.lt ID JAR
    let jarId;
    timings.start("jar");
    const jarRes = await postgres.query(
        `SELECT "_id" FROM "jar" WHERE "jarKodas" = $1`,
        [jarKodas],
    );
    timings.end("jar");

    if (jarRes.rows && jarRes.rows.length > 0) {
        jarId = jarRes.rows[0]._id;
    }

    if (specialJarCodes[jarKodas]) {
        const { pavadinimas, aprasymas } = specialJarCodes[jarKodas];
        return {
            special: true,
            pavadinimas,
            aprasymas,
            timings,
        };
    }

    // 404
    if (jarRezultatai.length === 0) {
        return {
            error: 404,
            timings,
        };
    }

    let jar = jarRezultatai[0];
    // Nustatome koordinates
    jar.location =
        jar.lat !== null && jar.lon !== null ? [jar.lat, jar.lon] : undefined;

    // Remove temporary lon/lat fields
    delete jar.lon;
    delete jar.lat;

    // Formatuojame JAR datas
    jar.registravimoData = new Date(jar.registravimoData).toLtDate();
    jar.duomenuData = new Date(jar.duomenuData).toLtDate();
    jar.statusasNuo = new Date(jar.statusasNuo).toLtDate();
    jar.jarId = jarId;

    const taskMap = {
        sodra: async () => gautiSodrosDuomenis(jarKodas),
        vmi: async () => gautiVmiDuomenis(jarKodas),
        regitra: async () => gautiRegitrosDuomenis(jarKodas, options?.regitra),
        teismoNuosprendziai: async () =>
            gautiTeismoNuosprendzius(jarKodas, options?.teismoNuosprendziai),
        sutartys: async () =>
            gautiSutarciuDuomenisPagalJarKoda(jarKodas, options?.sutartys),
        finansai: async () => gautiFinansuDuomenis(jarId),
        istatinisKapitalas: async () => gautiIstatiniKapitala(jarId),
        darboSkelbimai: async () =>
            gautiDarboSkelbimus(jarKodas, options?.darboSkelbimai),
        pinreg: async () =>
            gautiPinregDeklaracijasPagalJarKoda(jarKodas, options?.pinreg),
        nepatikimi: async () =>
            gautiNepatikimuTiekejuIrasusPagalJarKoda(jarKodas),
        melagingi: async () =>
            gautiMelaginguTiekejuIrasusPagalJarKoda(jarKodas),
        jadis: async () => gautiJadisDalyvius(jarId),
        rcPranesimai: async () =>
            gautiRcPranesimusPagalJarKoda(jarKodas, options?.rcPranesimai),
        domenai: async () =>
            rastiDomenusPagalJarKoda(jarKodas, options?.domenai),
        kotis: async () => rastiKotisPagalGavejoKoda(jarKodas, options?.kotis),
    };

    // Run all tasks in parallel with timings
    const timedTasks = Object.fromEntries(
        Object.entries(taskMap).map(([key, fn]) => [
            key,
            (async () => {
                timings.start(key);
                const result = await fn();
                timings.end(key);
                return result;
            })(),
        ]),
    );

    const results = await Promise.allSettled(Object.values(timedTasks));

    // Map results back to keys cleanly
    const data = Object.fromEntries(
        Object.keys(timedTasks).map((key, i) => [
            key,
            results[i].status === "fulfilled" ? results[i].value : null,
        ]),
    );

    return {
        asmuo: {
            jar,
            ...data,
        },
        timings,
    };
}

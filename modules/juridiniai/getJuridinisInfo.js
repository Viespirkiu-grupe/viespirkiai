import Timings from "../../utils/timings.js";
import { postgres } from "../../postgres/postgres.js";
import { createTtlPromiseCache } from "../../utils/ttlPromiseCache.js";
import { specialJarCodes } from "./specialJarCodes.js";
import {
    JAR_ADDRESS_JOINS,
    JAR_ADDRESS_SQL,
    JAR_LOCATION_SQL,
} from "./jarReadSql.js";

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
import {
    gautiSutarciuDuomenisPagalJarKoda,
    arTuriSutarciu,
} from "../sutartys/pagalJarKoda.js";
import { rastiDomenusPagalJarKoda } from "../domenai/rastiPagalJarKoda.js";
import { rastiKotisPagalGavejoKoda } from "../kotis/getByJarKodas.js";
import { getEsInvesticijosByJar } from "../2014esinvesticijos/getEsInvesticijosByJar.js";
import { mvpAprasaiPagalJarKoda } from "../mvpTvarkosAprasai/getByJar.js";
import { getVdiPazeidimai } from "../vdi/getPazeidimai.js";

// Vienas asmens puslapis paleidžia ~40 lygiagrečių užklausų, o naršyklės
// prefetch'as ar dvigubas užklausimas tą paketą pakartoja beveik tuo pačiu metu.
// Trumpas kešas sulieja vienu metu vykstančius vienodus krovimus į vieną
// (pending įrašą dalinasi visi kviečiantieji), o 5 s TTL padengia ir prefetch →
// navigacija atvejį. Grąžinamas objektas kviečiančiųjų nemodifikuojamas.
const juridinioKesas = createTtlPromiseCache(5_000);

export async function getJuridinisInfo(jarKodas, options = {}) {
    // `timings` yra kiekvienos užklausos objektas – į kešo raktą neįeina.
    const { timings: _timings, ...kesoOptions } = options;
    return juridinioKesas(`${jarKodas}|${JSON.stringify(kesoOptions)}`, () =>
        uzkrautiJuridinioInfo(jarKodas, options),
    );
}

async function uzkrautiJuridinioInfo(jarKodas, options = {}) {
    let timings = options.timings || new Timings();

    // Check special codes first — pure in-memory, no DB needed
    if (specialJarCodes[jarKodas]) {
        const { pavadinimas, aprasymas } = specialJarCodes[jarKodas];
        return {
            special: true,
            pavadinimas,
            aprasymas,
            timings,
        };
    }

    // Naujas RC JAR modelis ir senasis data.gov.lt įrašas su UUID yra
    // nepriklausomi. UUID kol kas reikalingas kelioms istorinėms integracijoms.
    timings.start("jarAsmenys");
    timings.start("jar");
    const [{ rows: jarRezultatai }, jarRes] = await Promise.all([
        postgres.query(
            `SELECT jar_person.*,
                    jar_form."pavadinimas" AS "formosPavadinimas",
                    jar_status."pavadinimas" AS "statusoPavadinimas",
                    ${JAR_ADDRESS_SQL} AS "adresas",
                    ST_X((${JAR_LOCATION_SQL})::geometry) AS lon,
                    ST_Y((${JAR_LOCATION_SQL})::geometry) AS lat
                 FROM public."jarAsmenys" jar_person
                 LEFT JOIN public."jarFormos" jar_form
                    ON jar_form."kodas" = jar_person."formosKodas"
                 LEFT JOIN public."jarStatusai" jar_status
                    ON jar_status."kodas" = jar_person."statusoKodas"
                 ${JAR_ADDRESS_JOINS}
                 WHERE jar_person."jarKodas" = $1
                 LIMIT 1`,
            [jarKodas],
        ),
        postgres.query(`SELECT * FROM "jar" WHERE "jarKodas" = $1`, [jarKodas]),
    ]);
    timings.end("jarAsmenys");
    timings.end("jar");

    // data.gov.lt ID JAR
    let jarId;
    if (jarRes.rows && jarRes.rows.length > 0) {
        jarId = jarRes.rows[0]._id;
    }

    // Išregistruoti asmenys dabar yra toje pačioje jarAsmenys lentelėje.
    let isregistruotasAsmuo = null;
    if (jarRezultatai[0]?.isregistravimoData) {
        const isr = { ...jarRezultatai[0] };
        isr.registravimoData = isr.registravimoData ? new Date(isr.registravimoData).toLtDate() : null;
        isr.isregistravimoData = isr.isregistravimoData ? new Date(isr.isregistravimoData).toLtDate() : null;
        isr.duomenuData = isr.duomenuData ? new Date(isr.duomenuData).toLtDate() : null;
        isregistruotasAsmuo = isr;
    }

    // 404 — not found in any main registry table
    if (isregistruotasAsmuo) {
        return {
            isregistruotas: true,
            isregistruotasAsmuo,
            timings,
        };
    }

    if (jarRezultatai.length === 0 && jarRes.rows.length === 0) {

        // Nėra JAR registre, bet gali turėti sutarčių (pvz. užsienio tiekėjas,
        // fizinis asmuo ar registro lentelėse trūkstamas asmuo) — tada vietoj
        // 404 rodome ribotą puslapį su sutartimis.
        timings.start("sutartys");
        const sutartys = await gautiSutarciuDuomenisPagalJarKoda(
            jarKodas,
            options?.sutartys,
        );
        timings.end("sutartys");

        if (arTuriSutarciu(sutartys)) {
            return {
                tikSutartys: true,
                jarKodas,
                sutartys,
                timings,
            };
        }

        return {
            error: 404,
            timings,
        };
    }

    let jar = jarRezultatai[0] || jarRes.rows[0];
    // Nustatome koordinates
    jar.location =
        jar.lat != null && jar.lon != null ? [jar.lat, jar.lon] : undefined;

    // Remove temporary lon/lat fields
    delete jar.lon;
    delete jar.lat;

    // Formatuojame JAR datas
    jar.registravimoData = jar.registravimoData ? new Date(jar.registravimoData).toLtDate() : null;
    jar.duomenuData = jar.duomenuData ? new Date(jar.duomenuData).toLtDate() : null;
    jar.statusasNuo = jar.statusasNuo ? new Date(jar.statusasNuo).toLtDate() : null;
    jar.jarId = jarId;

    const taskMap = {
        sodra: async () => gautiSodrosDuomenis(jarKodas),
        vmi: async () => gautiVmiDuomenis(jarKodas, jarId),
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
        esInvesticijos: async () =>
            getEsInvesticijosByJar(jarKodas, options?.esInvesticijos),
        mvpAprasai: async () =>
            mvpAprasaiPagalJarKoda(jarKodas, options?.mvpAprasai),
        vdiPazeidimai: async () =>
            getVdiPazeidimai(jarKodas, options?.vdiPazeidimai),
        turiViesujuPirkimu: async () => {
            const { rows } = await postgres.query(
                `SELECT EXISTS (
                    SELECT 1
                    FROM "viesiejiPirkimai"
                    WHERE "jarKodas" = $1
                ) AS "turiViesujuPirkimu"`,
                [jarKodas],
            );
            return rows[0]?.turiViesujuPirkimu === true;
        },
    };

    // Run all tasks in parallel with timings
    const timedTasks = Object.fromEntries(
        Object.entries(taskMap).map(([key, fn]) => [
            key,
            (async () => {
                timings.start(key);
                let result;
                try {
                    result = await fn();
                } catch (e) {
                    console.error(
                        `Error in task ${key} for JAR ${jarKodas}:`,
                        e,
                    );
                }
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
            isregistruotasAsmuo,
            ...data,
        },
        timings,
    };
}

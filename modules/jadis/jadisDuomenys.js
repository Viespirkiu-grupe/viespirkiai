import { postgres } from "../../postgres/postgres.js";

// JADIS dalyvis yra pati savivaldybė, nurodyta nejuridinio asmens kodu, kurio
// JAR nėra. Savo puslapį turi savivaldybės administracija, todėl vardą
// „X savivaldybė“ paverčiame į „X savivaldybės administracija“ ir ieškome jos
// JAR kodo. Lyginame be diakritikų, nes RC pasitaiko rašybos klaidų
// (pvz. „Zarasu rajono savivaldybė“).
const DIAKRITIKAI = { ą: "a", č: "c", ę: "e", ė: "e", į: "i", š: "s", ų: "u", ū: "u", ž: "z" };

const raktas = (pavadinimas) =>
    pavadinimas.toLowerCase().replace(/[ąčęėįšųūž]/g, (raide) => DIAKRITIKAI[raide]);

const administracijosRaktas = (njaPavadinimas) =>
    raktas(njaPavadinimas.replace(/savivaldybė$/, "savivaldybės administracija"));

// Savivaldybių administracijų yra ~60 ir jos beveik nekinta, todėl visą žemėlapį
// laikome atmintyje — `juridiniai.pavadinimas` indekso neturi, o skenuoti visą
// lentelę per kiekvieną asmens puslapį būtų brangu.
const CACHE_TTL = 60 * 60_000;
let administracijuCache = { laikas: 0, uzklausa: null };

async function gautiAdministracijas(db) {
    const dabar = Date.now();
    if (!administracijuCache.uzklausa || dabar - administracijuCache.laikas > CACHE_TTL) {
        administracijuCache = {
            laikas: dabar,
            uzklausa: db.query(
                `SELECT j."pavadinimas", min(j."jarKodas") AS "jarKodas"
                 FROM public."juridiniai" j
                 WHERE j."pavadinimas" ILIKE '%savivaldybės administracija'
                 GROUP BY 1`,
            ).then(({ rows }) =>
                new Map(rows.map((row) => [raktas(row.pavadinimas), row.jarKodas])),
            ).catch((klaida) => {
                administracijuCache = { laikas: 0, uzklausa: null };
                throw klaida;
            }),
        };
    }
    return administracijuCache.uzklausa;
}

/**
 * JADIS (juridinių asmenų dalyvių informacinės sistemos) atviri duomenys iš
 * Registrų centro: dalyvių skaičiai pagal rūšį, dalyvių sąrašo pateikimo
 * požymis ir valstybės/savivaldybių dalyvavimas.
 */
export async function gautiJadisDuomenis(jarKodas, db = postgres) {
    if (!jarKodas) return { dalyviuSkaiciai: null, sarasas: null, valstybesDalyviai: [] };

    const { rows } = await db.query(
        `SELECT
            (
                SELECT to_jsonb(d)
                FROM (
                    SELECT s."lrFiziniai", s."lrJuridiniai", s."uzsienioFiziniai",
                           s."uzsienioJuridiniai", s."formavimoData"
                    FROM jadis."dalyviuSkaiciai" s
                    WHERE s."jarKodas" = $1
                ) d
            ) AS "dalyviuSkaiciai",
            (
                SELECT to_jsonb(x)
                FROM (
                    SELECT p."sarasasPateiktas", p."sarasoData", p."formavimoData"
                    FROM jadis."dalyviuSarasai" p
                    WHERE p."jarKodas" = $1
                ) x
            ) AS "sarasas",
            COALESCE((
                SELECT jsonb_agg(to_jsonb(v) ORDER BY v."dalis" DESC NULLS LAST)
                FROM (
                    SELECT n."njaKodas", n."njaPavadinimas", n."dalis",
                           n."formavimoData"
                    FROM jadis."valstybesDalyviai" n
                    WHERE n."jarKodas" = $1
                ) v
            ), '[]'::jsonb) AS "valstybesDalyviai"`,
        [jarKodas],
    );

    const duomenys = rows[0] ??
        { dalyviuSkaiciai: null, sarasas: null, valstybesDalyviai: [] };

    // Administracijų paiešką darome atskira užklausa tik tada, kai valstybės ar
    // savivaldybių dalyvių yra — kitaip kiekvienas asmens puslapis be reikalo
    // skenuotų visą `juridiniai` lentelę.
    if (duomenys.valstybesDalyviai.length) {
        const administracijos = await gautiAdministracijas(db);
        for (const dalyvis of duomenys.valstybesDalyviai) {
            dalyvis.administracijosJarKodas =
                administracijos.get(administracijosRaktas(dalyvis.njaPavadinimas)) ?? null;
        }
    }

    return duomenys;
}

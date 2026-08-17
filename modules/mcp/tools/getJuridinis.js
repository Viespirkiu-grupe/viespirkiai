import { z } from "zod";
import { getJuridinisInfo } from "../../juridiniai/getJuridinisInfo.js";

/**
 * Collapse 98 monthly Sodra rows into per-year averages + peak + zero-employee gaps.
 * The raw duomenys are not useful for fraud reasoning — the LLM needs capacity signals,
 * not individual months.
 */
export function aggregateSodra(sodra) {
    if (!sodra) return sodra;
    const { duomenys = [], ...rest } = sodra;

    const byYearMap = {};
    let peak = null;
    const gaps = [];

    for (const d of duomenys) {
        const yr = d.data?.slice(0, 4);
        if (!yr) continue;

        if (!byYearMap[yr]) {
            byYearMap[yr] = {
                metai: +yr,
                sumDraustieji: 0,
                sumAtlyginimas: 0,
                countAtlyginimas: 0,
                months: 0,
            };
        }
        const y = byYearMap[yr];
        y.sumDraustieji += d.draustieji ?? 0;
        y.months++;
        if (d.vidutinisAtlyginimas != null) {
            y.sumAtlyginimas += d.vidutinisAtlyginimas;
            y.countAtlyginimas++;
        }

        if (!peak || (d.draustieji ?? 0) > (peak.draustieji ?? 0)) {
            peak = {
                data: d.data,
                draustieji: d.draustieji ?? 0,
                vidutinisAtlyginimas: d.vidutinisAtlyginimas ?? null,
            };
        }

        if ((d.draustieji ?? 0) === 0) gaps.push(d.data);
    }

    const byYear = Object.values(byYearMap)
        .sort((a, b) => a.metai - b.metai)
        .map(({ metai, sumDraustieji, sumAtlyginimas, countAtlyginimas, months }) => ({
            metai,
            avgDraustieji: months
                ? Math.round((sumDraustieji / months) * 10) / 10
                : null,
            avgAtlyginimas: countAtlyginimas
                ? Math.round(sumAtlyginimas / countAtlyginimas)
                : null,
        }));

    return { ...rest, peak, byYear, gaps };
}

// Line name → output field. Match by lineName because lineTypeId changes between
// accounting standard versions (BST101 → BST022 → BST122, etc.).
const FINANSAI_FIELDS = [
    { field: "pajamos",        names: ["Pardavimo pajamos"] },
    { field: "pelnas",         names: ["Grynasis pelnas (nuostoliai)", "Ataskaitinių metų pelnas (nuostoliai)", "Grynasis pelnas", "Pelnas (nuostoliai) prieš apmokestinimą", "Pelnas prieš apmokestinimą"] },
    { field: "ilgalaikis",     names: ["Ilgalaikis turtas"] },
    { field: "trumpalaikis",   names: ["Trumpalaikis turtas"] },
    { field: "kapitalas",      names: ["Nuosavas kapitalas"] },
    { field: "isipareigojimai",names: ["Mokėtinos sumos ir kiti įsipareigojimai", "Mokėtinos sumos ir įsipareigojimai"] },
];

/**
 * Collapse finansai into one compact row per year with only the 6 fraud-relevant
 * signals. Drops pagalEilute (column-oriented duplicate of ataskaitos with repeated
 * metadata) and all accounting schema fields (templateId, standardId, lineTypeId, etc.).
 */
export function aggregateFinansai(finansai) {
    if (!finansai) return finansai;
    const ataskaitos = finansai.ataskaitos;
    if (!Array.isArray(ataskaitos) || ataskaitos.length === 0) return { byYear: [] };

    const byYearMap = new Map();
    for (const a of ataskaitos) {
            const metai = a.laikotarpisIki ? +a.laikotarpisIki.slice(0, 4) : null;
            if (!metai) continue;

            const allLines = (a.standards ?? []).flatMap((s) => s.lines ?? []);
            const row = byYearMap.get(metai) ?? Object.fromEntries([
                ["metai", metai],
                ...FINANSAI_FIELDS.map(({ field }) => [field, null]),
            ]);
            for (const { field, names } of FINANSAI_FIELDS) {
                const line = allLines.find((l) => names.includes(l.lineName));
                // Balanso ir pelno ataskaitos yra atskiri RC įrašai. Sujungiame
                // juos pagal metus, o kelių pateikimo versijų atveju paliekame
                // pirmą (gautiFinansuDuomenis grąžina naujausią pirmiausia).
                if (row[field] == null && line?.reiksme != null) {
                    row[field] = line.reiksme;
                }
            }
            byYearMap.set(metai, row);
    }

    const byYear = [...byYearMap.values()]
        .sort((a, b) => a.metai - b.metai);

    return { byYear };
}

const limitSchema = z.number().int().min(1).max(50);

export const name = "get_juridinis";
export const description =
    "Grąžina išsamią informaciją apie juridinį asmenį pagal JAR kodą. Apima įmonės duomenis, Sodros statistiką, VMI, sutartis, RC finansines ataskaitas, NVO ir paramos gavėjo žymas, savanorystę, JANGIS pateikimo būseną, JAR dokumentus, JADIS dalyvių duomenis (`jadis.dalyviuSkaiciai` — dalyvių skaičiai pagal rūšį, `jadis.valstybesDalyviai` — valstybės/savivaldybių dalys nuo 0 iki 1, `jadis.sarasas` — ar pateiktas dalyvių sąrašas), PINREG deklaracijas, teismo nuosprendžius ir kt. Duomenys grąžinami su numatytaisiais limitais — nurodykite override parametrus jei reikia daugiau. DĖMESIO dėl `regitra`: anonimizuotuose Regitros duomenyse nėra nei VIN, nei valstybinio numerio, todėl vienodos transporto priemonės sutraukiamos į vieną eilutę su lauku `kiekis` (pvz. `kiekis: 92` reiškia 92 identiškas TP). Bendras TP skaičius yra `regitra.rows` — NE `transportoPriemones` masyvo ilgis. `regitra.atnaujinimoData` rodo, kokios datos yra Regitros nuotrauka.";

export const schema = {
    jarKodas: z
        .string()
        .regex(/^\d{1,9}$/)
        .describe("Juridinio asmens kodas"),
    sutartysLimit: limitSchema
        .default(5)
        .describe("Sutarčių skaičius (maks. 50)"),
    pinregLimit: limitSchema
        .default(3)
        .describe("PINREG deklaracijų skaičius (maks. 50)"),
    teismoNuosprendziaiLimit: limitSchema
        .default(5)
        .describe("Teismo nuosprendžių skaičius (maks. 50)"),
    regitraLimit: limitSchema
        .default(3)
        .describe("Regitros transporto priemonių skaičius (maks. 50)"),
    darboSkelbimaiLimit: limitSchema
        .default(3)
        .describe("Darbo skelbimų skaičius (maks. 50)"),
    rcPranesimaiLimit: limitSchema
        .default(3)
        .describe("RC pranešimų skaičius (maks. 50)"),
    domenaiLimit: limitSchema.default(3).describe("Domenų skaičius (maks. 50)"),
    kotisLimit: limitSchema
        .default(3)
        .describe("KOTIS įrašų skaičius (maks. 50)"),
    esInvesticijosLimit: limitSchema
        .default(3)
        .describe("ES investicijų įrašų skaičius (maks. 50)"),
    mvpAprasaiLimit: limitSchema
        .default(1)
        .describe("MVP aprašų skaičius (maks. 50)"),
};

export async function handler({
    jarKodas,
    sutartysLimit,
    pinregLimit,
    teismoNuosprendziaiLimit,
    regitraLimit,
    darboSkelbimaiLimit,
    rcPranesimaiLimit,
    domenaiLimit,
    kotisLimit,
    esInvesticijosLimit,
    mvpAprasaiLimit,
}) {
    const result = await getJuridinisInfo(jarKodas, {
        sutartys: { limit: sutartysLimit },
        pinreg: { limit: pinregLimit },
        teismoNuosprendziai: { limit: teismoNuosprendziaiLimit },
        regitra: { limit: regitraLimit },
        darboSkelbimai: { limit: darboSkelbimaiLimit },
        rcPranesimai: { limit: rcPranesimaiLimit },
        domenai: { limit: domenaiLimit },
        kotis: { limit: kotisLimit },
        esInvesticijos: { limit: esInvesticijosLimit },
        mvpAprasai: { limit: mvpAprasaiLimit },
    });

    if (result.error === 404) {
        return {
            content: [
                {
                    type: "text",
                    text: `Juridinis asmuo su kodu ${jarKodas} nerastas.`,
                },
            ],
            isError: true,
        };
    }

    if (result.special) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        {
                            pavadinimas: result.pavadinimas,
                            aprasymas: result.aprasymas,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    }

    // Nerastas registre, bet turi sutarčių
    if (result.tikSutartys) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        {
                            jarKodas: result.jarKodas,
                            pastaba:
                                "Asmuo nerastas Juridinių asmenų registre, tačiau turi viešųjų pirkimų sutarčių.",
                            sutartys: result.sutartys,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    }

    // Drop timings — not useful for Claude
    const asmuo = { ...result.asmuo };
    asmuo.sodra = aggregateSodra(asmuo.sodra);
    asmuo.finansai = aggregateFinansai(asmuo.finansai);

    return {
        content: [{ type: "text", text: JSON.stringify(asmuo, null, 2) }],
    };
}

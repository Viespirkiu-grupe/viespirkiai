import { postgres } from "../../postgres/postgres.js";

const LITAI_UZ_EURA = 3.4528;

const sentenceCase = (text) =>
    text
        .replace(/([^.!?]*[.!?]*)/g, (sentence) =>
            sentence.trim()
                ? sentence.trim().charAt(0).toUpperCase() +
                  sentence.trim().slice(1).toLowerCase() + " "
                : "",
        )
        .trim();

const canonicalLineNames = new Map([
    ["Mokėtinos sumos ir įsipareigojimai", "Įsipareigojimai"],
    ["Mokėtinos sumos ir kiti įsipareigojimai", "Įsipareigojimai"],
    ["Grynasis pelnas", "Grynasis pelnas (nuostoliai)"],
    ["Ataskaitinių metų pelnas (nuostoliai)", "Grynasis pelnas (nuostoliai)"],
    ["Pelnas (nuostoliai) prieš apmokestinimą", "Pelnas prieš apmokestinimą"],
]);

const canonicalLineName = (lineName) => canonicalLineNames.get(lineName) ?? lineName;

const reiksmeEurais = (entry) => {
    if (entry.reiksme == null) return null;
    const value = Number(entry.reiksme);
    if (!Number.isFinite(value)) return null;
    // Iki euro įvedimo pasibaigusių laikotarpių RC ataskaitų reikšmės yra
    // litais. Pirminę DB reikšmę paliekame nepakeistą, o skaitydami pateikiame
    // vienodą EUR laiko eilutę.
    if (String(entry.laikotarpisIki).slice(0, 10) < "2015-01-01") {
        return Math.round((value / LITAI_UZ_EURA) * 100) / 100;
    }
    return value;
};

export function formuotiFinansuDuomenis(rows) {
    if (!rows.length) return {};

    const grouped = new Map();
    for (const entry of rows) {
        const key = entry.ataskaitaId ??
            `${entry.ataskaitosTipas}_${entry.laikotarpisNuo}_${entry.laikotarpisIki}_${entry.duomenuData}_${entry.templateId}`;
        if (!grouped.has(key)) grouped.set(key, {
            ataskaitaId: entry.ataskaitaId,
            ataskaitosTipas: entry.ataskaitosTipas,
            ataskaitosTipoKodas: entry.ataskaitosTipoKodas,
            ataskaitosTipoPavadinimas: entry.ataskaitosTipoPavadinimas,
            laikotarpisNuo: entry.laikotarpisNuo,
            laikotarpisIki: entry.laikotarpisIki,
            duomenuData: entry.duomenuData,
            templateId: entry.templateId,
            templateKodas: entry.templateKodas,
            templateName: sentenceCase(entry.templateName),
            standards: {},
        });

        const standards = grouped.get(key).standards;
        standards[entry.standardId] = standards[entry.standardId] || {
            standardId: entry.standardId,
            standardKodas: entry.standardKodas,
            standardName: sentenceCase(entry.standardName),
            lines: [],
        };
        standards[entry.standardId].lines.push({
            lineTypeId: entry.lineTypeId,
            lineTypeKodas: entry.lineTypeKodas,
            lineName: sentenceCase(entry.lineName),
            reiksme: reiksmeEurais(entry),
        });
    }

    const ataskaitos = [...grouped.values()].map((report) => ({
        ...report,
        standards: Object.values(report.standards),
    }));

    const pagalEilute = {};
    for (const report of ataskaitos) {
        const reportMeta = {
            ataskaitaId: report.ataskaitaId,
            ataskaitosTipas: report.ataskaitosTipas,
            ataskaitosTipoKodas: report.ataskaitosTipoKodas,
            ataskaitosTipoPavadinimas: report.ataskaitosTipoPavadinimas,
            laikotarpisNuo: report.laikotarpisNuo,
            laikotarpisIki: report.laikotarpisIki,
            duomenuData: report.duomenuData,
            templateId: report.templateId,
            templateKodas: report.templateKodas,
            templateName: report.templateName,
        };
        for (const standard of report.standards) {
            for (const line of standard.lines) {
                pagalEilute[line.lineName] ??= [];
                pagalEilute[line.lineName].push({ ...line, ...reportMeta });
            }
        }
    }

    const metai = [...new Set(ataskaitos.map((report) =>
        new Date(report.laikotarpisNuo).getFullYear()))]
        .sort((a, b) => a - b);
    const duomenys = {};

    // SQL grąžina naujausias registravimo datas pirmiausia. Jei tais pačiais
    // finansiniais metais yra kelios pateikimo versijos, paliekame pirmąją –
    // naujausią, o ne leidžiame senesnei ją perrašyti.
    for (const report of ataskaitos) {
        const year = new Date(report.laikotarpisNuo).getFullYear();
        const yearIndex = metai.indexOf(year);
        for (const standard of report.standards) {
            for (const line of standard.lines) {
                const lineName = canonicalLineName(line.lineName);
                duomenys[lineName] ??= Array(metai.length).fill(undefined);
                if (duomenys[lineName][yearIndex] === undefined) {
                    duomenys[lineName][yearIndex] = line.reiksme;
                }
            }
        }
    }

    const pelnoRaktas = duomenys["Grynasis pelnas (nuostoliai)"]
        ? "Grynasis pelnas (nuostoliai)"
        : null;
    const length = duomenys["Pardavimo pajamos"]?.length || 0;
    duomenys.Pelningumas = Array.from({ length }, (_, index) => {
        if (!pelnoRaktas) return null;
        const pelnas = duomenys[pelnoRaktas]?.[index];
        const pardavimai = duomenys["Pardavimo pajamos"]?.[index];
        if (typeof pelnas !== "number" || typeof pardavimai !== "number" || pardavimai === 0) {
            return null;
        }
        return Number(((pelnas / pardavimai) * 100).toFixed(2));
    });

    return {
        ataskaitos,
        pagalEilute,
        lentele: { metai, duomenys },
    };
}

export async function gautiFinansuDuomenis(jarKodas, db = postgres) {
    if (!jarKodas) return {};
    const { rows } = await db.query(
        `SELECT
             a."id" AS "ataskaitaId", a."ataskaitosTipas",
             tipas."kodas" AS "ataskaitosTipoKodas",
             tipas."pavadinimas" AS "ataskaitosTipoPavadinimas",
             a."templateId", template."kodas" AS "templateKodas",
             template."pavadinimas" AS "templateName",
             a."standardId", standartas."kodas" AS "standardKodas",
             standartas."pavadinimas" AS "standardName",
             rodiklis."lineTypeId", rodiklio_tipas."kodas" AS "lineTypeKodas",
             rodiklio_tipas."pavadinimas" AS "lineName",
             rodiklis."reiksme", a."laikotarpisNuo", a."laikotarpisIki",
             a."registravimoData" AS "duomenuData", a."formavimoData"
         FROM "rcJar"."finansinesAtaskaitos" a
         JOIN "rcJar"."finansiniuAtaskaituTipai" tipas
           ON tipas."id" = a."ataskaitosTipas"
         JOIN "rcJar"."finansiniuAtaskaituTemplate" template
           ON template."id" = a."templateId"
         JOIN "rcJar"."finansiniuAtaskaituStandartai" standartas
           ON standartas."id" = a."standardId"
         JOIN "rcJar"."finansiniuAtaskaituRodikliai" rodiklis
           ON rodiklis."ataskaitaId" = a."id"
         JOIN "rcJar"."finansiniuAtaskaituRodikliuTipai" rodiklio_tipas
           ON rodiklio_tipas."id" = rodiklis."lineTypeId"
         WHERE a."jarKodas" = $1
         ORDER BY a."registravimoData" DESC, a."laikotarpisNuo" DESC,
                  a."ataskaitosTipas", rodiklis."lineTypeId"`,
        [jarKodas],
    );
    return formuotiFinansuDuomenis(rows);
}

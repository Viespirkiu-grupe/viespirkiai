// Teisės aktų redakcijų palyginimo branduolys: redakcijų sąrašas, teksto
// įkėlimas ir pats skirtumų skaičiavimas. Be jokio išvedimo — ANSI eilutes
// piešia CLI (`palygintiRedakcijas.js`), HTML — puslapis
// (`src/pages/teisesAktas/[id]/palyginimas.astro`).

import { Diff, diffArrays } from "diff";
import { postgres } from "../../postgres/postgres.js";
import { readETarSidecar } from "../eTar/eTarSidecar.js";
import { readESeimasSidecar } from "../eSeimas/eSeimasSidecar.js";
import { indexStructure, normalizeLegalActText } from "../mcp/tools/teisesAktoTurinys.js";

/** Kurio šaltinio lentelėse ieškoti redakcijų — e-TAR ar e-Seimo. */
export async function lenteliuPriesagas(teisesAktoId, db = postgres) {
    const { rows } = await db.query(
        `SELECT 1 FROM "eTarEdition" WHERE "legalActId" = $1 LIMIT 1`,
        [teisesAktoId],
    );
    return rows.length ? "eTar" : "eSeimas";
}

/**
 * Akto redakcijos su laikotarpiais ir žyme, ar turim patį tekstą: e-TAR dalies
 * suvestinių turinio neduoda, tad be šito lyginti tektų aklai.
 */
export async function redakcijuSarasas(teisesAktoId, db = postgres) {
    const p = await lenteliuPriesagas(teisesAktoId, db);
    const { rows } = await db.query(
        `SELECT e."editionToken", e."effectiveFrom"::text AS nuo, e."effectiveTo"::text AS iki,
                e.url, e.ordinal, COALESCE(s."code" = 'provided', false) AS "turiTeksta"
           FROM "${p}Edition" e
           LEFT JOIN "${p}LegalActDocument" d
                  ON d."legalActId" = e."legalActId" AND d."editionToken" = e."editionToken"
           LEFT JOIN "${p}PresenceState" s ON s."presenceStateId" = d."contentPresenceId"
          WHERE e."legalActId" = $1
          ORDER BY e.ordinal`,
        [teisesAktoId],
    );
    return rows;
}

/**
 * Data → redakcija. Jei data ankstesnė už pirmąją suvestinę – originalas;
 * jei redakcijų sąrašo išvis nėra – aktuali suvestinė (`asr`).
 * @returns {{versijosId: string, nuo: string|null, iki: string|null, url: string|null, data: string}|null}
 *   `null`, kai tą dieną galiojusios redakcijos nėra (sąrašą turi iškvietėjas).
 */
export function redakcijaPagalData(rows, data) {
    const galiojanti = rows.find((r) => r.nuo <= data && (r.iki === null || r.iki >= data));
    if (galiojanti) {
        return {
            versijosId: galiojanti.editionToken,
            nuo: galiojanti.nuo,
            iki: galiojanti.iki,
            url: galiojanti.url,
            data,
        };
    }
    if (rows.length && data < rows[0].nuo) {
        return { versijosId: "original", nuo: null, iki: rows[0].nuo, url: null, data };
    }
    if (!rows.length) {
        return { versijosId: "asr", nuo: null, iki: null, url: null, data };
    }
    return null;
}

/**
 * Redakcijos tekstas. Sąmoningai NE per `loadLegalActDocument`: ten paieška eina
 * per `public.dokumentai` be `source`, o tam indekso nėra – 2,7 mln. eilučių
 * seq scan'as ir ~13 s vienai redakcijai. Čia raktas `legalActId` yra indeksuotas.
 *
 * @returns `{ok: true, pavadinimas, text, structure, index}` arba
 *   `{ok: false, priezastis}` — redakcija DB'je gali būti tik kaip įrašas be
 *   teksto (dar nenuskaityta arba šaltinis jo neduoda).
 */
export async function ikeltiRedakcija(teisesAktoId, versijosId, priesaga, db = postgres) {
    const variantas = versijosId === "asr" ? "consolidated_edition" : versijosId;
    const { rows } = await db.query(
        `SELECT d."md5", d."title", d."contentMessage", s."code" AS busena
           FROM "${priesaga}LegalActDocument" d
           JOIN "${priesaga}DocumentVariant" v USING ("documentVariantId")
           LEFT JOIN "${priesaga}PresenceState" s ON s."presenceStateId" = d."contentPresenceId"
          WHERE d."legalActId" = $1 AND (d."editionToken" = $2 OR v."code" = $2)
          ORDER BY CASE WHEN d."editionToken" = $2 THEN 0 ELSE 1 END
          LIMIT 1`,
        [teisesAktoId, variantas],
    );
    const row = rows[0];
    const payload = row?.md5
        ? await (priesaga === "eTar" ? readETarSidecar : readESeimasSidecar)(row.md5)
        : null;
    const officialText = payload?.official_text ?? {};
    const text = normalizeLegalActText(officialText.text);

    if (!text) {
        const priezastis = (row?.contentMessage?.trim() || row?.busena || "")
            .replace(/[\s:]+$/, "");
        return { ok: false, priezastis: priezastis || null };
    }

    const structure = Array.isArray(officialText.structure) ? officialText.structure : [];
    return {
        ok: true,
        pavadinimas: row.title,
        text,
        structure,
        index: indexStructure(structure),
    };
}

/** Raktas dalies tapatybei tarp redakcijų: `part_id` yra HTML id ir kinta. */
function dalisRaktas(path) {
    return path
        .map((label) => label.toLowerCase().replace(/\s+/g, " ").trim())
        .join(" › ");
}

function raktuSeka(index) {
    const matyti = new Map();
    return index.ordered.map((item) => {
        const base = dalisRaktas(item.path);
        const n = (matyti.get(base) ?? 0) + 1;
        matyti.set(base, n);
        return n === 1 ? base : `${base} #${n}`;
    });
}

function pakeitimas(item, pokytis, pries, po, raktas) {
    return {
        raktas,
        partId: item.id,
        kelias: item.path.join(" › "),
        pakopos: item.path.slice(0, -1),
        pavadinimas: item.label,
        pokytis,
        pries,
        po,
    };
}

/**
 * Sulygiuoja dviejų redakcijų struktūras ir grąžina pakeitimų sąrašą
 * dokumento tvarka. Lyginam tik savo dalies tekstą (ne su poskyriais), kad
 * pakeitimas nebūtų skaičiuojamas kiekvienam protėviui iš naujo.
 */
export function palygintiStruktura(indexA, indexB) {
    const keysA = raktuSeka(indexA);
    const keysB = raktuSeka(indexB);
    const pakeitimai = [];
    let ia = 0;
    let ib = 0;

    for (const dalis of diffArrays(keysA, keysB)) {
        if (dalis.removed) {
            for (const raktas of dalis.value) {
                const item = indexA.ordered[ia++];
                const tekstas = normalizeLegalActText(item.node.text);
                if (tekstas) pakeitimai.push(pakeitimas(item, "pašalinta", tekstas, "", raktas));
            }
            continue;
        }
        if (dalis.added) {
            for (const raktas of dalis.value) {
                const item = indexB.ordered[ib++];
                const tekstas = normalizeLegalActText(item.node.text);
                if (tekstas) pakeitimai.push(pakeitimas(item, "pridėta", "", tekstas, raktas));
            }
            continue;
        }
        for (const raktas of dalis.value) {
            const a = indexA.ordered[ia++];
            const b = indexB.ordered[ib++];
            const pries = normalizeLegalActText(a.node.text);
            const po = normalizeLegalActText(b.node.text);
            if (pries !== po) pakeitimai.push(pakeitimas(b, "pakeista", pries, po, raktas));
        }
    }
    return pakeitimai;
}

export function suskaiciuoti(pakeitimai) {
    return {
        pridėta: pakeitimai.filter((p) => p.pokytis === "pridėta").length,
        pašalinta: pakeitimai.filter((p) => p.pokytis === "pašalinta").length,
        pakeista: pakeitimai.filter((p) => p.pokytis === "pakeista").length,
    };
}

function eilutes(text) {
    return text.split("\n").filter((line) => line.trim());
}

/** Kiek dvi eilutės panašios: bendra pradžia ir pabaiga prieš ilgesniąją. */
function panasumas(a, b) {
    const ilgis = Math.max(a.length, b.length);
    if (!ilgis) return 1;
    let pradzia = 0;
    while (pradzia < a.length && pradzia < b.length && a[pradzia] === b[pradzia]) pradzia++;
    let pabaiga = 0;
    while (
        pabaiga < a.length - pradzia
        && pabaiga < b.length - pradzia
        && a[a.length - 1 - pabaiga] === b[b.length - 1 - pabaiga]
    ) pabaiga++;
    return (pradzia + pabaiga) / ilgis;
}

/**
 * Suporuoja pakeistas eilutes su jų atitikmenimis, kad redaguota eilutė būtų
 * rodoma žodžių lygiu, o tikrai naujos ir dingusios – atskirai.
 */
function poruoti(senos, naujos, riba = 0.3) {
    const poros = [];
    const laisvos = new Set(naujos.keys());
    const likusios = [];
    for (const sena of senos) {
        let geriausia = -1;
        let balas = riba;
        for (const j of laisvos) {
            const p = panasumas(sena, naujos[j]);
            if (p > balas) {
                balas = p;
                geriausia = j;
            }
        }
        if (geriausia === -1) likusios.push(sena);
        else {
            laisvos.delete(geriausia);
            poros.push([sena, naujos[geriausia], geriausia]);
        }
    }
    poros.sort((a, b) => a[2] - b[2]);
    return {
        poros,
        likusios,
        pridėtos: [...laisvos].sort((a, b) => a - b).map((j) => naujos[j]),
    };
}

// Skaidom TIK per tarpus. Standartinis `diffWordsWithSpace` skaido ir ties
// skyrybos ženklais, todėl datos susimala: „2024-01-01" → „2024-10-18" virsdavo
// nebeskaitomu „2024-[-01-]{+10+}-[-01-]{+18+}". Visa data kaip vienas žodis
// pasikeičia visa – taip, kaip ją ir skaitai.
const zodziuDiff = new Diff();
zodziuDiff.tokenize = (value) => value.split(/(\s+)/).filter((dalis) => dalis !== "");

/** Žodžių lygio segmentai vienai eilutei. */
function zodziai(pries, po) {
    return zodziuDiff.diff(pries, po).map((d) => ({
        tipas: d.added ? "pridėta" : d.removed ? "pašalinta" : "lygu",
        tekstas: d.value,
    }));
}

/**
 * Vienos dalies skirtumai eilutėmis. Nepakitusių eilučių nerodom: straipsnio
 * tekste dažnai keičiasi vienas sakinys, o gale prisideda eilutė „Punkto
 * pakeitimai“ – žodžių diff'as per visą bloką tokiu atveju supainioja
 * pasikartojančias eilutes ir išveda dešimtis netikrų pakeitimų. Žodžių lygiu
 * smulkinam tik suporuotas pakeistas eilutes.
 *
 * @returns eilutės pavidalu `{tipas: "pakeista", segmentai}` arba
 *   `{tipas: "pridėta"|"pašalinta", tekstas}`.
 */
export function daliesEilutes(pries, po) {
    // Lyginam ne žalią tekstą, o netuščių eilučių sąrašus – kitaip tuščios
    // eilutės nustumia LCS ir vienodos eilutės atrodo kaip pakeistos.
    const blokai = diffArrays(eilutes(pries), eilutes(po));
    const out = [];

    for (let i = 0; i < blokai.length; i++) {
        const dalis = blokai[i];
        if (!dalis.added && !dalis.removed) continue;
        const kitas = blokai[i + 1];
        if (dalis.removed && kitas?.added) {
            i++;
            const { poros, likusios, pridėtos } = poruoti(dalis.value, kitas.value);
            for (const [sena, nauja] of poros) {
                out.push({ tipas: "pakeista", segmentai: zodziai(sena, nauja) });
            }
            for (const sena of likusios) out.push({ tipas: "pašalinta", tekstas: sena });
            for (const nauja of pridėtos) out.push({ tipas: "pridėta", tekstas: nauja });
            continue;
        }
        const tipas = dalis.added ? "pridėta" : "pašalinta";
        for (const line of dalis.value) out.push({ tipas, tekstas: line });
    }
    return out;
}

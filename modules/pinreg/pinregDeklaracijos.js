import { postgres } from "../../postgres/postgres.js";
import { RYSIAI_FROM, RYSIAI_SELECT, RYSIO_POBUDIS_SQL } from "./rysiuUzklausa.js";

const TIPAI = {
    DEKLARUOJANCIO_DARBOVIETE: "darbovietes",
    SUTUOKTINIO_DARBOVIETE: "sutuoktiniuDarbovietes",
    KITI_RYSIAI_SU_JA: "rysiaiSuJa",
};

/** Filtro reikšmė (URL) → `irasoTipas` stulpelio reikšmė. */
export const TIPU_FILTRAI = {
    darbovietes: "DEKLARUOJANCIO_DARBOVIETE",
    sutuoktinio: "SUTUOKTINIO_DARBOVIETE",
    rysiai: "KITI_RYSIAI_SU_JA",
};

// Rikiavimo baltasis sąrašas: raktas ateina iš URL, todėl stulpelio vardas
// niekada nesudaromas iš vartotojo įvesties. Pagal asmenį nerikiuojama sąmoningai
// – vardai rodomi užcenzūruoti, o abėcėlinė tvarka padėtų juos atspėti.
const RIKIAVIMAI = {
    pateikta: 'r."pateikimoData"',
    nuo: 'r."rysioPradzia"',
    iki: 'r."rysioPabaiga"',
    pareigos: 'r."pareigos"',
    tipas: 'r."irasoTipas"',
};

/**
 * PINREG įrašai pagal JAR kodą: filtruojama, rikiuojama ir puslapiuojama
 * duomenų bazėje, kad rezultatas nepriklausytų nuo to, kiek eilučių atsiuntėme
 * į naršyklę.
 *
 * @param {string} jarKodas
 * @param {{ limit?: number|null, offset?: number, sort?: string, kryptis?: string,
 *           tipas?: string, pareigos?: string, galiojimas?: string }} [options]
 */
export async function gautiPinregDeklaracijasPagalJarKoda(
    jarKodas,
    options = {},
) {
    let limit = options.limit ? Number(options.limit) : null;
    const offset = Number(options.offset) > 0 ? Math.floor(Number(options.offset)) : 0;
    const sort = RIKIAVIMAI[options.sort] ? options.sort : "pateikta";
    const kryptis = options.kryptis === "asc" ? "asc" : "desc";
    const tipas = TIPU_FILTRAI[options.tipas] ? options.tipas : null;
    const pareigos = (options.pareigos || "").trim();
    const galiojimas =
        options.galiojimas === "galiojantys" || options.galiojimas === "pasibaige"
            ? options.galiojimas
            : null;

    // Bendros sąlygos (be tipo) – pagal jas skaičiuojami kiekiai kiekvienam tipui,
    // kad filtro parinktys rodytų, kiek įrašų jose liks.
    const params = [jarKodas];
    const salygos = ['r."jarKodas" = $1'];
    if (pareigos) {
        params.push(`%${pareigos}%`);
        salygos.push(
            `(COALESCE(r."pareigos", '') || ' ' || COALESCE(${RYSIO_POBUDIS_SQL}, '')) ILIKE $${params.length}`,
        );
    }
    if (galiojimas === "galiojantys") salygos.push('r."rysioPabaiga" IS NULL');
    if (galiojimas === "pasibaige") salygos.push('r."rysioPabaiga" IS NOT NULL');
    const kur = salygos.join(" AND ");

    const eiluciuParams = [...params];
    let eiluciuKur = kur;
    if (tipas) {
        eiluciuParams.push(TIPU_FILTRAI[tipas]);
        eiluciuKur += ` AND r."irasoTipas" = $${eiluciuParams.length}`;
    }
    const limitSql = limit ? ` LIMIT $${eiluciuParams.length + 1}` : "";
    if (limit) eiluciuParams.push(limit);
    const offsetSql = offset ? ` OFFSET $${eiluciuParams.length + 1}` : "";
    if (offset) eiluciuParams.push(offset);

    const [irasaiQuery, kiekiaiQuery] = await Promise.all([
        postgres.query(
            `SELECT ${RYSIAI_SELECT}
           FROM ${RYSIAI_FROM}
           WHERE ${eiluciuKur}
           ORDER BY ${RIKIAVIMAI[sort]} ${kryptis === "asc" ? "ASC" : "DESC"} NULLS LAST, r."id" DESC
           ${limitSql}${offsetSql}`,
            eiluciuParams,
        ),
        postgres.query(
            `SELECT r."irasoTipas", COUNT(*)::int AS kiekis
           FROM ${RYSIAI_FROM}
           WHERE ${kur}
           GROUP BY r."irasoTipas"`,
            params,
        ),
    ]);

    const kiekiai = { darbovietes: 0, sutuoktiniuDarbovietes: 0, rysiaiSuJa: 0 };
    for (const { irasoTipas, kiekis } of kiekiaiQuery.rows) {
        const raktas = TIPAI[irasoTipas];
        if (raktas) kiekiai[raktas] = kiekis;
    }

    const darbovietesRows = [];
    const sutuoktiniuRows = [];
    const rysiaiRows = [];
    for (const row of irasaiQuery.rows) {
        if (row.irasoTipas === "DEKLARUOJANCIO_DARBOVIETE") {
            darbovietesRows.push(row);
        } else if (row.irasoTipas === "SUTUOKTINIO_DARBOVIETE") {
            sutuoktiniuRows.push(row);
        } else if (row.irasoTipas === "KITI_RYSIAI_SU_JA") {
            rysiaiRows.push(row);
        }
    }

    const darbovietesCount = kiekiai.darbovietes;
    const sutuoktiniuCount = kiekiai.sutuoktiniuDarbovietes;
    const rysiaiCount = kiekiai.rysiaiSuJa;
    // Kiek įrašų atitinka VISUS filtrus (įskaitant tipą) – pagal tai puslapiuojama.
    const filtruotaViso = tipas
        ? kiekiai[TIPAI[TIPU_FILTRAI[tipas]]]
        : darbovietesCount + sutuoktiniuCount + rysiaiCount;

    // Užcenzūruotas vardas: paliekamos tik pirma ir paskutinė raidė.
    function formatName(name) {
        if (!name) return null;

        const titleCased = name
            .toLowerCase()
            .split(" ")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");

        return titleCased
            .split(" ")
            .map((w) =>
                w.length <= 2
                    ? w
                    : w.charAt(0) +
                      "*".repeat(w.length - 2) +
                      w.charAt(w.length - 1),
            )
            .join(" ");
    }

    function paruostiDarboviete(row) {
        return {
            ...row,
            uuid: row.deklaracija,
            asmuo: formatName(`${row.vardas || ""} ${row.pavarde || ""}`.trim()),
            pateikimoData: row.pateikimoData,
        };
    }

    function paruostiSutuoktinio(row) {
        const deklaruojancioVardas =
            row.deklaruojancioVardas || row.susijusioAsmensVardas || "";
        const deklaruojancioPavarde =
            row.deklaruojancioPavarde || row.susijusioAsmensPavarde || "";
        const sutuoktinioVardas = row.sutuoktinioVardas || row.vardas || "";
        const sutuoktinioPavarde = row.sutuoktinioPavarde || row.pavarde || "";

        return {
            ...row,
            uuid: row.deklaracija,
            asmuo: formatName(
                `${deklaruojancioVardas} ${deklaruojancioPavarde}`.trim(),
            ),
            sutuoktinis: formatName(
                `${sutuoktinioVardas} ${sutuoktinioPavarde}`.trim(),
            ),
            pateikimoData: row.pateikimoData,
        };
    }

    function paruostiRysi(row) {
        return {
            ...row,
            uuid: row.deklaracija,
            asmuo: formatName(
                `${row.vardas || "-"} ${row.pavarde || "-"}`.trim(),
            ),
            pateikimoData: row.pateikimoData,
        };
    }

    const darbovietes = darbovietesRows.map(paruostiDarboviete);
    const sutuoktinioDarbovietes = sutuoktiniuRows.map(paruostiSutuoktinio);
    const rysiaiSuJa = rysiaiRows.map(paruostiRysi);

    // Plokščias sąrašas ta pačia tvarka, kokia atėjo iš duomenų bazės – jį rodo
    // puslapio lentelė (rikiavimas jau pritaikytas visiems įrašams, ne tik šiam
    // puslapiui). Grupuoti sąrašai lieka dėl MCP atsakymų struktūros.
    const irasai = irasaiQuery.rows.map((row) => {
        if (row.irasoTipas === "SUTUOKTINIO_DARBOVIETE") {
            return { tipas: "sutuoktinio", ...paruostiSutuoktinio(row) };
        }
        if (row.irasoTipas === "KITI_RYSIAI_SU_JA") {
            return { tipas: "rysiai", ...paruostiRysi(row) };
        }
        return { tipas: "darbovietes", ...paruostiDarboviete(row) };
    });

    return {
        darbovietes,
        sutuoktinioDarbovietes,
        rysiaiSuJa,
        irasai,
        counts: {
            darbovietes: darbovietesCount,
            sutuoktiniuDarbovietes: sutuoktiniuCount,
            rysiaiSuJa: rysiaiCount,
        },
        total: darbovietesCount + sutuoktiniuCount + rysiaiCount,
        filtruotaViso,
        rows:
            darbovietes.length +
            sutuoktinioDarbovietes.length +
            rysiaiSuJa.length,
        limit: limit,
        offset,
        sort,
        kryptis,
        filtrai: { tipas, pareigos, galiojimas },
    };
}

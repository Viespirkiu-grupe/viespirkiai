import { postgres } from "../../postgres/postgres.js";

// `vpmSutartysSumosPirkejasTiekejas` kodai yra text (pasitaiko ir užsienio PVM
// kodų, pvz. "GB879443177"), o `jarAsmenys."jarKodas"` – integer. Cast'as ant
// indeksuoto stulpelio (`j."jarKodas"::text = agg.kodas`) išjungdavo indeksą ir
// versdavo seq scan'ą per visą jarAsmenys lentelę, todėl castinam kitą pusę,
// o ne skaitinius kodus paverčiam NULL (jiems pavadinimo ir taip nėra).
const JAR_KODAS_INT = (kodas) =>
    `CASE WHEN ${kodas} ~ '^[0-9]{1,9}$' THEN ${kodas}::integer END`;

// Dalies kodų `jarAsmenys` lentelėje nėra: RC CSV faile jų nebeliko (pvz.
// UAB "Fegda" – 110801759), arba tai užsienio PVM kodas, kurio JAR ir negali
// turėti. Tokioms eilutėms pavadinimą pasiimam iš pačių sutarčių – ten šalies
// pavadinimas visada įrašytas, tad TOP lentelėse nebeatsiranda „Nežinomas".
// Abu lateral'ai naudoja `(pirmoTiekejoKodas|perkanciosiosOrganizacijosKodas,
// redagavimoData DESC)` indeksus, tad vienai eilutei tai vienas index scan.
const TIEKEJO_PAVADINIMAS_LATERAL = (kodas) => `
             LEFT JOIN LATERAL (
                 SELECT pavadinimas FROM (
                     SELECT s."pavadinimas", v."redagavimoData"
                     FROM public."vpmSutartys" v
                     JOIN public."vpmSutartysSalys" s ON s."id" = v."pirmoTiekejoPavadinimoId"
                     WHERE v."pirmoTiekejoKodas" = ${kodas} AND v."istrinta" = false
                     ORDER BY v."redagavimoData" DESC NULLS LAST LIMIT 1
                 ) pirmas
                 UNION ALL
                 SELECT pavadinimas FROM (
                     SELECT s."pavadinimas", v."redagavimoData"
                     FROM public."vpmSutartysPapildomiTiekejai" p
                     JOIN public."vpmSutartys" v ON v."unikalusId" = p."unikalusId" AND v."istrinta" = false
                     JOIN public."vpmSutartysSalys" s ON s."id" = p."tiekejoPavadinimoId"
                     WHERE p."tiekejoKodas" = ${kodas}
                     ORDER BY v."redagavimoData" DESC NULLS LAST LIMIT 1
                 ) papildomas
                 LIMIT 1
             ) fallback ON true`;

const PIRKEJO_PAVADINIMAS_LATERAL = (kodas) => `
             LEFT JOIN LATERAL (
                 SELECT s."pavadinimas"
                 FROM public."vpmSutartys" v
                 JOIN public."vpmSutartysSalys" s ON s."id" = v."perkanciosiosOrganizacijosPavadinimoId"
                 WHERE v."perkanciosiosOrganizacijosKodas" = ${kodas} AND v."istrinta" = false
                 ORDER BY v."redagavimoData" DESC NULLS LAST LIMIT 1
             ) fallback ON true`;

export async function gautiSutarciuDuomenisPagalJarKoda(
    jarKodas,
    options = {},
) {
    const limitSql = options.limit
        ? `LIMIT ${parseInt(options.limit, 10)}`
        : "";

    const yearFilter = `"metai" >= 2000 AND "metai" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1`;

    const [
        { rows: pirkimaiKasMetus },
        { rows: tiekimaiKasMetus },
        { rows: topTiekejai },
        { rows: topPirkejai },
    ] = await Promise.all([
        postgres.query(
            `SELECT "metai" AS "year", ROUND("pirkimuSuma"::numeric, 2) AS total
             FROM public."vpmSutartysSumosMetai"
             WHERE "saliesKodas" = $1 AND pirkimai > 0 AND ${yearFilter}
             ORDER BY "metai" ASC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT "metai" AS "year", ROUND("pardavimuSuma"::numeric, 2) AS total
             FROM public."vpmSutartysSumosMetai"
             WHERE "saliesKodas" = $1 AND pardavimai > 0 AND ${yearFilter}
             ORDER BY "metai" ASC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT agg."tiekejoKodas" AS "jarKodas", COALESCE(j."pavadinimas", fallback."pavadinimas", 'Nežinomas') AS "pavadinimas", agg."suma" AS "total", agg."pirkimai" AS "count"
             FROM (SELECT "tiekejoKodas", "suma", "pirkimai" FROM "vpmSutartysSumosPirkejasTiekejas" WHERE "pirkejoKodas" = $1 AND "pirkimai" > 0 ORDER BY ("suma" = 'NaN'::numeric), "suma" DESC ${limitSql}) agg
             LEFT JOIN "rcJar"."asmenys" j ON j."jarKodas" = ${JAR_KODAS_INT(`agg."tiekejoKodas"`)}
             ${TIEKEJO_PAVADINIMAS_LATERAL(`agg."tiekejoKodas"`)}
             ORDER BY (agg."suma" = 'NaN'::numeric), agg."suma" DESC`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT agg."pirkejoKodas" AS "jarKodas", COALESCE(j."pavadinimas", fallback."pavadinimas", 'Nežinomas') AS "pavadinimas", agg."suma" AS "total", agg."pirkimai" AS "count"
             FROM (SELECT "pirkejoKodas", "suma", "pirkimai" FROM "vpmSutartysSumosPirkejasTiekejas" WHERE "tiekejoKodas" = $1 AND "pirkimai" > 0 ORDER BY ("suma" = 'NaN'::numeric), "suma" DESC ${limitSql}) agg
             LEFT JOIN "rcJar"."asmenys" j ON j."jarKodas" = ${JAR_KODAS_INT(`agg."pirkejoKodas"`)}
             ${PIRKEJO_PAVADINIMAS_LATERAL(`agg."pirkejoKodas"`)}
             ORDER BY (agg."suma" = 'NaN'::numeric), agg."suma" DESC`,
            [jarKodas],
        ),
    ]);

    return { pirkimaiKasMetus, tiekimaiKasMetus, topPirkejai, topTiekejai };
}

// Ar yra bent viena sutartis pagal kodą (kaip pirkėjo arba tiekėjo)
export function arTuriSutarciu(sutartys) {
    return (
        sutartys.pirkimaiKasMetus.length > 0 ||
        sutartys.tiekimaiKasMetus.length > 0 ||
        sutartys.topTiekejai.length > 0 ||
        sutartys.topPirkejai.length > 0
    );
}

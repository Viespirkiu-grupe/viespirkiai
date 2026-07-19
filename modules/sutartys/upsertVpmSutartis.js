import { postgres } from "../../postgres/postgres.js";
import { canonicalJsonMd5 } from "./canonicalSutartis.js";

// Canonical dokumento atstatymas iš normalizuotų lentelių; eilutės alias — "e".
// Naudojama ir UPSERT_SQL old_document CTE, ir markVpmSutartisIstrinta selecte.
const DOC_JSONB_SQL = `jsonb_build_object(
            'unikalusId', e."unikalusId",
            'pavadinimas', e.pavadinimas,
            'sudarymoData', e."sudarymoData",
            'galiojimoData', e."galiojimoData",
            'faktineIvykdimoData', e."faktineIvykdimoData",
            'paskelbimoData', CASE WHEN e."paskelbimoData" IS NULL THEN NULL
                ELSE to_char(e."paskelbimoData", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
            'redagavimoData', CASE WHEN e."redagavimoData" IS NULL THEN NULL
                ELSE to_char(e."redagavimoData", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
            'perkanciosiosOrganizacijosKodas', e."perkanciosiosOrganizacijosKodas",
            'perkanciosiosOrganizacijosPavadinimas', buyer_name.pavadinimas,
            'sutartiesNumeris', e."sutartiesNumeris",
            'pirkimoNumeris', e."pirkimoNumeris",
            'numatomaVerte', e."numatomaVerte",
            'faktineVerte', e."faktineVerte",
            'pirmoTiekejoKodas', e."pirmoTiekejoKodas",
            'pirmoTiekejoPavadinimas', supplier_name.pavadinimas,
            'papildomiTiekejai', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'kodas', extra."tiekejoKodas",
                        'pavadinimas', extra_name.pavadinimas
                    ) ORDER BY extra.id
                )
                FROM public."vpmSutartysPapildomiTiekejai" extra
                LEFT JOIN public."vpmSutartysSalys" extra_name
                  ON extra_name.id = extra."tiekejoPavadinimoId"
                WHERE extra."unikalusId" = e."unikalusId"
            ), '[]'::jsonb),
            'tipas', type_name.tipas,
            'kategorija', category_name.kategorija,
            'bvpzKodas', e."bvpzKodas",
            'papildomiBvpzKodai', COALESCE((
                SELECT jsonb_agg(extra_bvpz."bvpzKodas" ORDER BY extra_bvpz.id)
                FROM public."vpmSutartysPapildomiBvpzKodai" extra_bvpz
                WHERE extra_bvpz."unikalusId" = e."unikalusId"
            ), '[]'::jsonb),
            'dokumentai', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'pavadinimas', file.pavadinimas,
                        'fileId', file."fileId"
                    ) ORDER BY file.id
                )
                FROM public."vpmSutartysFailai" file
                WHERE file."unikalusId" = e."unikalusId"
            ), '[]'::jsonb),
            'istrinta', e.istrinta,
            'pakeitimas', e.pakeitimas
        )`;

const DOC_JOINS_SQL = `LEFT JOIN public."vpmSutartysSalys" buyer_name
      ON buyer_name.id = e."perkanciosiosOrganizacijosPavadinimoId"
    LEFT JOIN public."vpmSutartysSalys" supplier_name
      ON supplier_name.id = e."pirmoTiekejoPavadinimoId"
    LEFT JOIN public."vpmSutartysTipai" type_name
      ON type_name.id = e."tipasId"
    LEFT JOIN public."vpmSutartysKategorijos" category_name
      ON category_name.id = e."kategorijaId"`;

const UPSERT_SQL = `
WITH incoming AS MATERIALIZED (
    SELECT $1::jsonb AS doc, $2::text AS hash
),
existing AS MATERIALIZED (
    SELECT s.*
    FROM public."vpmSutartys" s, incoming i
    WHERE s."unikalusId" = (i.doc->>'unikalusId')::bigint
    FOR UPDATE
),
names_to_insert AS MATERIALIZED (
    SELECT DISTINCT name AS pavadinimas
    FROM incoming i
    CROSS JOIN LATERAL (
        VALUES
            (i.doc->>'perkanciosiosOrganizacijosPavadinimas'),
            (i.doc->>'pirmoTiekejoPavadinimas')
    ) AS parent_names(name)
    WHERE NULLIF(name, '') IS NOT NULL
    UNION
    SELECT DISTINCT supplier->>'pavadinimas'
    FROM incoming i
    CROSS JOIN LATERAL jsonb_array_elements(
        i.doc->'papildomiTiekejai'
    ) AS supplier
    WHERE NULLIF(supplier->>'pavadinimas', '') IS NOT NULL
),
inserted_names AS (
    INSERT INTO public."vpmSutartysSalys" (pavadinimas)
    SELECT pavadinimas FROM names_to_insert
    ON CONFLICT (pavadinimas) DO NOTHING
    RETURNING id, pavadinimas
),
inserted_type AS (
    INSERT INTO public."vpmSutartysTipai" (tipas)
    SELECT i.doc->>'tipas'
    FROM incoming i
    WHERE NULLIF(i.doc->>'tipas', '') IS NOT NULL
    ON CONFLICT (tipas) DO NOTHING
    RETURNING id, tipas
),
inserted_category AS (
    INSERT INTO public."vpmSutartysKategorijos" (kategorija)
    SELECT i.doc->>'kategorija'
    FROM incoming i
    WHERE NULLIF(i.doc->>'kategorija', '') IS NOT NULL
    ON CONFLICT (kategorija) DO NOTHING
    RETURNING id, kategorija
),
old_document AS MATERIALIZED (
    SELECT
        e.hash,
        ${DOC_JSONB_SQL} AS doc
    FROM existing e
    ${DOC_JOINS_SQL}
),
history AS (
    INSERT INTO public."vpmSutartysChanges" (
        "unikalusId", sutartis, "sutartisHash"
    )
    SELECT (i.doc->>'unikalusId')::bigint, old.doc, old.hash
    FROM incoming i
    JOIN old_document old ON old.hash IS DISTINCT FROM i.hash
    RETURNING id
),
main_upsert AS (
    INSERT INTO public."vpmSutartys" (
        "unikalusId", pavadinimas,
        "sudarymoData", "galiojimoData", "faktineIvykdimoData",
        "paskelbimoData", "redagavimoData",
        "perkanciosiosOrganizacijosKodas",
        "perkanciosiosOrganizacijosPavadinimoId",
        "sutartiesNumeris", "pirkimoNumeris",
        "numatomaVerte", "faktineVerte",
        "pirmoTiekejoKodas", "pirmoTiekejoPavadinimoId", "tiekejuSkaicius",
        "tipasId", "kategorijaId",
        "bvpzKodas", "bvpzKoduSkaicius", "failuSkaicius",
        istrinta, pakeitimas, hash
    )
    SELECT
        (i.doc->>'unikalusId')::bigint,
        i.doc->>'pavadinimas',
        (i.doc->>'sudarymoData')::date,
        (i.doc->>'galiojimoData')::date,
        (i.doc->>'faktineIvykdimoData')::date,
        (i.doc->>'paskelbimoData')::timestamp,
        (i.doc->>'redagavimoData')::timestamp,
        i.doc->>'perkanciosiosOrganizacijosKodas',
        (
            SELECT id FROM public."vpmSutartysSalys"
            WHERE pavadinimas = i.doc->>'perkanciosiosOrganizacijosPavadinimas'
            UNION ALL
            SELECT id FROM inserted_names
            WHERE pavadinimas = i.doc->>'perkanciosiosOrganizacijosPavadinimas'
            LIMIT 1
        ),
        i.doc->>'sutartiesNumeris',
        i.doc->>'pirkimoNumeris',
        (i.doc->>'numatomaVerte')::numeric,
        (i.doc->>'faktineVerte')::numeric,
        i.doc->>'pirmoTiekejoKodas',
        (
            SELECT id FROM public."vpmSutartysSalys"
            WHERE pavadinimas = i.doc->>'pirmoTiekejoPavadinimas'
            UNION ALL
            SELECT id FROM inserted_names
            WHERE pavadinimas = i.doc->>'pirmoTiekejoPavadinimas'
            LIMIT 1
        ),
        1 + jsonb_array_length(i.doc->'papildomiTiekejai'),
        (
            SELECT id FROM public."vpmSutartysTipai"
            WHERE tipas = i.doc->>'tipas'
            UNION ALL
            SELECT id FROM inserted_type WHERE tipas = i.doc->>'tipas'
            LIMIT 1
        ),
        (
            SELECT id FROM public."vpmSutartysKategorijos"
            WHERE kategorija = i.doc->>'kategorija'
            UNION ALL
            SELECT id FROM inserted_category
            WHERE kategorija = i.doc->>'kategorija'
            LIMIT 1
        ),
        (i.doc->>'bvpzKodas')::integer,
        CASE WHEN i.doc->>'bvpzKodas' IS NULL THEN 0 ELSE 1 END
            + jsonb_array_length(i.doc->'papildomiBvpzKodai'),
        jsonb_array_length(i.doc->'dokumentai'),
        (i.doc->>'istrinta')::boolean,
        (i.doc->>'pakeitimas')::boolean,
        i.hash
    FROM incoming i
    ON CONFLICT ("unikalusId") DO UPDATE SET
        pavadinimas = EXCLUDED.pavadinimas,
        "sudarymoData" = EXCLUDED."sudarymoData",
        "galiojimoData" = EXCLUDED."galiojimoData",
        "faktineIvykdimoData" = EXCLUDED."faktineIvykdimoData",
        "paskelbimoData" = EXCLUDED."paskelbimoData",
        "redagavimoData" = EXCLUDED."redagavimoData",
        "perkanciosiosOrganizacijosKodas" = EXCLUDED."perkanciosiosOrganizacijosKodas",
        "perkanciosiosOrganizacijosPavadinimoId" = EXCLUDED."perkanciosiosOrganizacijosPavadinimoId",
        "sutartiesNumeris" = EXCLUDED."sutartiesNumeris",
        "pirkimoNumeris" = EXCLUDED."pirkimoNumeris",
        "numatomaVerte" = EXCLUDED."numatomaVerte",
        "faktineVerte" = EXCLUDED."faktineVerte",
        "pirmoTiekejoKodas" = EXCLUDED."pirmoTiekejoKodas",
        "pirmoTiekejoPavadinimoId" = EXCLUDED."pirmoTiekejoPavadinimoId",
        "tiekejuSkaicius" = EXCLUDED."tiekejuSkaicius",
        "tipasId" = EXCLUDED."tipasId",
        "kategorijaId" = EXCLUDED."kategorijaId",
        "bvpzKodas" = EXCLUDED."bvpzKodas",
        "bvpzKoduSkaicius" = EXCLUDED."bvpzKoduSkaicius",
        "failuSkaicius" = EXCLUDED."failuSkaicius",
        istrinta = EXCLUDED.istrinta,
        pakeitimas = EXCLUDED.pakeitimas,
        hash = EXCLUDED.hash
    WHERE "vpmSutartys".hash IS DISTINCT FROM EXCLUDED.hash
    RETURNING "unikalusId"
),
target_contract AS MATERIALIZED (
    SELECT "unikalusId" FROM existing
    UNION
    SELECT "unikalusId" FROM main_upsert
),
tracking AS (
    INSERT INTO public."vpmSutartysAtnaujinimai" (
        "unikalusId", matyta, atnaujinta, istrinta
    )
    SELECT
        t."unikalusId", now(), now(), (i.doc->>'istrinta')::boolean
    FROM target_contract t, incoming i
    ON CONFLICT ("unikalusId") DO UPDATE SET
        matyta = now(),
        atnaujinta = now(),
        istrinta = EXCLUDED.istrinta
    RETURNING "unikalusId"
),
deleted_suppliers AS (
    DELETE FROM public."vpmSutartysPapildomiTiekejai" old
    USING main_upsert changed
    WHERE old."unikalusId" = changed."unikalusId"
    RETURNING old.id
),
inserted_suppliers AS (
    INSERT INTO public."vpmSutartysPapildomiTiekejai" (
        "unikalusId", "tiekejoKodas", "tiekejoPavadinimoId"
    )
    SELECT
        changed."unikalusId",
        supplier->>'kodas',
        (
            SELECT id FROM public."vpmSutartysSalys"
            WHERE pavadinimas = supplier->>'pavadinimas'
            UNION ALL
            SELECT id FROM inserted_names
            WHERE pavadinimas = supplier->>'pavadinimas'
            LIMIT 1
        )
    FROM main_upsert changed
    JOIN incoming i ON true
    CROSS JOIN LATERAL jsonb_array_elements(
        i.doc->'papildomiTiekejai'
    ) AS supplier
    RETURNING id
),
deleted_bvpz AS (
    DELETE FROM public."vpmSutartysPapildomiBvpzKodai" old
    USING main_upsert changed, incoming i
    WHERE old."unikalusId" = changed."unikalusId"
      AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(i.doc->'papildomiBvpzKodai') code
          WHERE code::integer = old."bvpzKodas"
      )
    RETURNING old.id
),
inserted_bvpz AS (
    INSERT INTO public."vpmSutartysPapildomiBvpzKodai" (
        "unikalusId", "bvpzKodas"
    )
    SELECT changed."unikalusId", code::integer
    FROM main_upsert changed
    JOIN incoming i ON true
    CROSS JOIN LATERAL jsonb_array_elements_text(
        i.doc->'papildomiBvpzKodai'
    ) code
    ON CONFLICT ("unikalusId", "bvpzKodas") DO NOTHING
    RETURNING id
),
deleted_files AS (
    DELETE FROM public."vpmSutartysFailai" old
    USING main_upsert changed
    WHERE old."unikalusId" = changed."unikalusId"
    RETURNING old.id
),
inserted_files AS (
    INSERT INTO public."vpmSutartysFailai" (
        "unikalusId", pavadinimas, "fileId", md5, "failoId"
    )
    SELECT
        changed."unikalusId",
        file->>'pavadinimas',
        (file->>'fileId')::integer,
        previous.md5,
        previous."failoId"
    FROM main_upsert changed
    JOIN incoming i ON true
    CROSS JOIN LATERAL jsonb_array_elements(i.doc->'dokumentai') file
    LEFT JOIN LATERAL (
        SELECT old.md5, old."failoId"
        FROM public."vpmSutartysFailai" old
        WHERE old."unikalusId" = changed."unikalusId"
          AND old."fileId" IS NOT DISTINCT FROM (file->>'fileId')::integer
        ORDER BY old.id
        LIMIT 1
    ) previous ON true
    RETURNING id
),
search_upsert AS (
    INSERT INTO public."vpmSutartysSearch" ("unikalusId", "searchTsv")
    SELECT
        (i.doc->>'unikalusId')::bigint,
        to_tsvector('simple', $3)
    FROM incoming i
    JOIN main_upsert changed
      ON changed."unikalusId" = (i.doc->>'unikalusId')::bigint
    ON CONFLICT ("unikalusId") DO UPDATE SET
        "searchTsv" = EXCLUDED."searchTsv"
    RETURNING "unikalusId"
),
agg_events AS MATERIALIZED (
    SELECT
        -1 AS sign,
        NULLIF(o.doc->>'perkanciosiosOrganizacijosKodas', '') AS pirkejas,
        NULLIF(o.doc->>'pirmoTiekejoKodas', '') AS pirmas_tiekejas,
        o.doc->'papildomiTiekejai' AS papildomi_tiekejai,
        COALESCE(
            (o.doc->>'faktineVerte')::numeric,
            (o.doc->>'numatomaVerte')::numeric
        ) AS verte,
        o.doc->>'sudarymoData' AS sudaryta
    FROM old_document o
    JOIN main_upsert changed
      ON changed."unikalusId" = (o.doc->>'unikalusId')::bigint
    WHERE (o.doc->>'istrinta')::boolean = false
      AND (o.doc->>'pakeitimas')::boolean = false

    UNION ALL

    SELECT
        1,
        NULLIF(i.doc->>'perkanciosiosOrganizacijosKodas', ''),
        NULLIF(i.doc->>'pirmoTiekejoKodas', ''),
        i.doc->'papildomiTiekejai',
        COALESCE(
            (i.doc->>'faktineVerte')::numeric,
            (i.doc->>'numatomaVerte')::numeric
        ),
        i.doc->>'sudarymoData'
    FROM incoming i
    JOIN main_upsert changed
      ON changed."unikalusId" = (i.doc->>'unikalusId')::bigint
    WHERE (i.doc->>'istrinta')::boolean = false
      AND (i.doc->>'pakeitimas')::boolean = false
),
agg_tiekejai AS MATERIALIZED (
    SELECT
        e.sign,
        e.pirkejas,
        e.verte,
        e.sudaryta,
        e.pirmas_tiekejas AS tiekejas
    FROM agg_events e
    WHERE e.pirmas_tiekejas IS NOT NULL

    UNION ALL

    SELECT
        e.sign,
        e.pirkejas,
        e.verte,
        e.sudaryta,
        NULLIF(supplier->>'kodas', '')
    FROM agg_events e
    CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(e.papildomi_tiekejai, '[]'::jsonb)
    ) supplier
    WHERE NULLIF(supplier->>'kodas', '') IS NOT NULL
),
agg_sumos_delta AS MATERIALIZED (
    SELECT
        contribution.salies_kodas,
        SUM(contribution.pirkimai)::integer AS pirkimai,
        SUM(contribution.pirkimu_suma) AS pirkimu_suma,
        SUM(contribution.pardavimai)::integer AS pardavimai,
        SUM(contribution.pardavimu_suma) AS pardavimu_suma
    FROM (
        SELECT
            e.pirkejas AS salies_kodas,
            e.sign AS pirkimai,
            e.sign * COALESCE(e.verte, 0) AS pirkimu_suma,
            0 AS pardavimai,
            0::numeric AS pardavimu_suma
        FROM agg_events e
        WHERE e.pirkejas IS NOT NULL

        UNION ALL

        SELECT
            e.tiekejas,
            0,
            0::numeric,
            e.sign,
            e.sign * COALESCE(e.verte, 0)
        FROM agg_tiekejai e
    ) contribution
    GROUP BY contribution.salies_kodas
    HAVING SUM(contribution.pirkimai) <> 0
        OR SUM(contribution.pirkimu_suma) <> 0
        OR SUM(contribution.pardavimai) <> 0
        OR SUM(contribution.pardavimu_suma) <> 0
),
d_sumos AS (
    INSERT INTO public."vpmSutartysSumos" AS current (
        "saliesKodas", pirkimai, "pirkimuSuma", pardavimai, "pardavimuSuma"
    )
    SELECT
        salies_kodas,
        pirkimai,
        pirkimu_suma,
        pardavimai,
        pardavimu_suma
    FROM agg_sumos_delta
    ON CONFLICT ("saliesKodas") DO UPDATE SET
        pirkimai = current.pirkimai + EXCLUDED.pirkimai,
        "pirkimuSuma" = current."pirkimuSuma" + EXCLUDED."pirkimuSuma",
        pardavimai = current.pardavimai + EXCLUDED.pardavimai,
        "pardavimuSuma" = current."pardavimuSuma" + EXCLUDED."pardavimuSuma"
    RETURNING "saliesKodas"
),
agg_metai_delta AS MATERIALIZED (
    SELECT
        contribution.salies_kodas,
        contribution.metai,
        SUM(contribution.pirkimai)::integer AS pirkimai,
        SUM(contribution.pirkimu_suma) AS pirkimu_suma,
        SUM(contribution.pardavimai)::integer AS pardavimai,
        SUM(contribution.pardavimu_suma) AS pardavimu_suma
    FROM (
        SELECT
            e.pirkejas AS salies_kodas,
            EXTRACT(YEAR FROM e.sudaryta::date)::integer AS metai,
            e.sign AS pirkimai,
            e.sign * COALESCE(e.verte, 0) AS pirkimu_suma,
            0 AS pardavimai,
            0::numeric AS pardavimu_suma
        FROM agg_events e
        WHERE e.pirkejas IS NOT NULL
          AND e.sudaryta IS NOT NULL

        UNION ALL

        SELECT
            e.tiekejas,
            EXTRACT(YEAR FROM e.sudaryta::date)::integer,
            0,
            0::numeric,
            e.sign,
            e.sign * COALESCE(e.verte, 0)
        FROM agg_tiekejai e
        WHERE e.sudaryta IS NOT NULL
    ) contribution
    GROUP BY contribution.salies_kodas, contribution.metai
    HAVING SUM(contribution.pirkimai) <> 0
        OR SUM(contribution.pirkimu_suma) <> 0
        OR SUM(contribution.pardavimai) <> 0
        OR SUM(contribution.pardavimu_suma) <> 0
),
d_metai AS (
    INSERT INTO public."vpmSutartysSumosMetai" AS current (
        "saliesKodas", metai,
        pirkimai, "pirkimuSuma", pardavimai, "pardavimuSuma"
    )
    SELECT
        salies_kodas,
        metai,
        pirkimai,
        pirkimu_suma,
        pardavimai,
        pardavimu_suma
    FROM agg_metai_delta
    ON CONFLICT ("saliesKodas", metai) DO UPDATE SET
        pirkimai = current.pirkimai + EXCLUDED.pirkimai,
        "pirkimuSuma" = current."pirkimuSuma" + EXCLUDED."pirkimuSuma",
        pardavimai = current.pardavimai + EXCLUDED.pardavimai,
        "pardavimuSuma" = current."pardavimuSuma" + EXCLUDED."pardavimuSuma"
    RETURNING "saliesKodas", metai
),
agg_pt_delta AS MATERIALIZED (
    SELECT
        e.pirkejas,
        e.tiekejas,
        SUM(e.sign)::integer AS pirkimai,
        SUM(e.sign * COALESCE(e.verte, 0)) AS suma
    FROM agg_tiekejai e
    WHERE e.pirkejas IS NOT NULL
    GROUP BY e.pirkejas, e.tiekejas
    HAVING SUM(e.sign) <> 0
        OR SUM(e.sign * COALESCE(e.verte, 0)) <> 0
),
d_pt AS (
    INSERT INTO public."vpmSutartysSumosPirkejasTiekejas" AS current (
        "pirkejoKodas", "tiekejoKodas", pirkimai, suma
    )
    SELECT pirkejas, tiekejas, pirkimai, suma
    FROM agg_pt_delta
    ON CONFLICT ("pirkejoKodas", "tiekejoKodas") DO UPDATE SET
        pirkimai = current.pirkimai + EXCLUDED.pirkimai,
        suma = current.suma + EXCLUDED.suma
    RETURNING "pirkejoKodas", "tiekejoKodas"
)
SELECT
    EXISTS(SELECT 1 FROM existing) AS existed,
    EXISTS(SELECT 1 FROM main_upsert) AS written,
    EXISTS(SELECT 1 FROM history) AS archived,
    EXISTS(SELECT 1 FROM tracking) AS tracked;
`;

/** Build the full-text-search input from the canonical contract JSON. */
export function buildVpmSutartisSearchText(canonicalJson) {
    const contract = typeof canonicalJson === "string"
        ? JSON.parse(canonicalJson)
        : canonicalJson;
    const values = [
        contract.unikalusId,
        contract.pavadinimas,
        contract.bvpzKodas,
        contract.kategorija,
        contract.perkanciosiosOrganizacijosPavadinimas,
        contract.perkanciosiosOrganizacijosKodas,
        contract.sutartiesNumeris,
        contract.pirmoTiekejoPavadinimas,
        contract.pirmoTiekejoKodas,
        contract.tipas,
        contract.pirkimoNumeris,
        ...(contract.papildomiTiekejai ?? []).flatMap((supplier) => [
            supplier.pavadinimas,
            supplier.kodas,
        ]),
        ...(contract.papildomiBvpzKodai ?? []),
    ];

    return values
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value).trim())
        .filter((value) => value !== "")
        .join(" ");
}

/**
 * Upsert one normalized VPM contract. The statement is atomic: an old version
 * is archived before a changed hash replaces the normalized rows.
 */
export async function upsertVpmSutartis(prepared, db = postgres) {
    const searchText = buildVpmSutartisSearchText(prepared.json);
    const result = await db.query(UPSERT_SQL, [
        prepared.json,
        prepared.md5,
        searchText,
    ]);
    return result.rows[0];
}

/**
 * Pažymi vpm sutartį kaip ištrintą šaltinyje. Vietoje tiesioginio istrinta
 * UPDATE (kuris apeitų vpmSutartysChanges archyvą ir inkrementinius
 * vpmSutartysSumos* agregatus) atstato saugomą canonical dokumentą,
 * nustato istrinta=true ir perleidžia per įprastą upsert kelią.
 * @returns {Promise<boolean>} true jei sutartis buvo pažymėta, false jei
 *   jos nėra arba jau ištrinta.
 */
export async function markVpmSutartisIstrinta(unikalusId, db = postgres) {
    const res = await db.query(
        `SELECT ${DOC_JSONB_SQL} AS doc
         FROM public."vpmSutartys" e
         ${DOC_JOINS_SQL}
         WHERE e."unikalusId" = $1;`,
        [unikalusId],
    );
    const doc = res.rows[0]?.doc;
    if (!doc || doc.istrinta) return false;

    doc.istrinta = true;
    await upsertVpmSutartis(canonicalJsonMd5(doc), db);
    return true;
}

export { UPSERT_SQL };

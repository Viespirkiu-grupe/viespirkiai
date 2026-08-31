CREATE OR REPLACE VIEW v_sutartys AS
SELECT s."unikalusId" AS "sutartiesUnikalusId",
       s."sutartiesNumeris",
       s."pirkimoNumeris",
       s."sudarymoData"::timestamp AS "sudarymoData",
       s."paskelbimoData",
       s."galiojimoData"::timestamp AS "galiojimoData",
       s."faktineIvykdimoData"::timestamp AS "faktineIvykdimoData",
       s."redagavimoData" AS "paskutinioRedagavimoData",
       a.matyta AS "paskutinioAtnaujinimoData",
       a.matyta AS "paskutiniKartaMatyta",
       a.atnaujinta AS "paskutiniKartaAtnaujinta",
       s."numatomaVerte"::numeric AS verte,
       s.verte::numeric AS suma,
       s."faktineVerte"::numeric AS "faktineIvykdimoVerte",
       s.pavadinimas,
       COALESCE(
           b.code || CASE WHEN b.checksum IS NULL THEN '' ELSE '-' || b.checksum END,
           s."bvpzKodas"::text
       ) AS "bvpzKodas",
       b.pavadinimas AS "bvpzPavadinimas",
       COALESCE(eb.kodai, '{}'::text[]) AS "papildomiBvpzKodai",
       COALESCE(eb.pavadinimai, '{}'::text[]) AS "papildomiBvpzPavadinimai",
       ARRAY[COALESCE(
           b.code || CASE WHEN b.checksum IS NULL THEN '' ELSE '-' || b.checksum END,
           s."bvpzKodas"::text
       )] || COALESCE(eb.kodai, '{}'::text[]) AS "bvpzKodai",
       ARRAY[b.pavadinimas] || COALESCE(eb.pavadinimai, '{}'::text[]) AS "bvpzPavadinimai",
       k.kategorija,
       t.tipas,
       CASE UPPER(TRIM(t.tipas))
           WHEN 'TSP'            THEN 'Tarptautinis arba supaprastintas pirkimas'
           WHEN 'MVP'            THEN 'Mažos vertės pirkimas'
           WHEN 'ŽS'             THEN 'Žodinė sutartis'
           WHEN 'MVPŽ'           THEN 'Mažos vertės pirkimas (žodinė sutartis)'
           WHEN 'SPŽ'            THEN 'Supaprastintas pirkimas (žodinė sutartis)'
           WHEN 'PPS'            THEN 'Pagrindinė pirkimo sutartis'
           WHEN 'VS'             THEN 'Vidaus sandoris'
           WHEN 'SP'             THEN 'Sutarties pakeitimas'
           WHEN 'PSĮ'            THEN 'Pirkimas iš susijusios įmonės'
           WHEN 'ILGALAIKĖ MVPŽ' THEN 'Ilgalaikis mažos vertės pirkimas (žodinė sutartis)'
           ELSE UPPER(TRIM(t.tipas))
       END AS "tipoPavadinimas",
       s.istrinta,
       s."failuSkaicius" AS "dokumentuKiekis",
       s."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       buyer_name.pavadinimas AS "perkanciojiOrganizacija",
       pb.pavadinimas AS pirkejas,
       s."pirmoTiekejoKodas" AS "tiekejoKodas",
       supplier_name.pavadinimas AS "tiekejoPavadinimas",
       COALESCE(tb.pavadinimas, supplier_name.pavadinimas) AS tiekejas,
       COALESCE(et.pavadinimai, '{}'::text[]) AS "papildomiTiekejai",
       COALESCE(et.kodai, '{}'::text[]) AS "papildomiTiekejaiKodai",
       ARRAY[s."pirmoTiekejoKodas"] || COALESCE(et.kodai, '{}'::text[]) AS "tiekejaiKodai",
       ARRAY[supplier_name.pavadinimas] || COALESCE(et.pavadinimai, '{}'::text[]) AS tiekejai
FROM "vpmSutartys" s
LEFT JOIN "vpmSutartysAtnaujinimai" a ON a."unikalusId" = s."unikalusId"
LEFT JOIN "vpmSutartysSalys" buyer_name ON buyer_name.id = s."perkanciosiosOrganizacijosPavadinimoId"
LEFT JOIN "vpmSutartysSalys" supplier_name ON supplier_name.id = s."pirmoTiekejoPavadinimoId"
LEFT JOIN "vpmSutartysTipai" t ON t.id = s."tipasId"
LEFT JOIN "vpmSutartysKategorijos" k ON k.id = s."kategorijaId"
LEFT JOIN LATERAL (
    SELECT code.code, code.checksum, code.pavadinimas
    FROM bvpz."kodai" code
    WHERE code.code = s."bvpzKodas"::text
    LIMIT 1
) b ON true
LEFT JOIN "rcJar"."asmenys" pb ON pb."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
LEFT JOIN "rcJar"."asmenys" tb ON tb."jarKodas"::text = s."pirmoTiekejoKodas"
LEFT JOIN LATERAL (
    SELECT array_agg(COALESCE(
               b2.code || CASE WHEN b2.checksum IS NULL THEN '' ELSE '-' || b2.checksum END,
               x."bvpzKodas"::text
           ) ORDER BY x.id) AS kodai,
           array_agg(b2.pavadinimas ORDER BY x.id) AS pavadinimai
    FROM "vpmSutartysPapildomiBvpzKodai" x
    LEFT JOIN bvpz."kodai" b2 ON b2.code = x."bvpzKodas"::text
    WHERE x."unikalusId" = s."unikalusId"
) eb ON true
LEFT JOIN LATERAL (
    SELECT array_agg(n.pavadinimas ORDER BY x.id) AS pavadinimai,
           array_agg(x."tiekejoKodas" ORDER BY x.id) AS kodai
    FROM "vpmSutartysPapildomiTiekejai" x
    LEFT JOIN "vpmSutartysSalys" n ON n.id = x."tiekejoPavadinimoId"
    WHERE x."unikalusId" = s."unikalusId"
) et ON true

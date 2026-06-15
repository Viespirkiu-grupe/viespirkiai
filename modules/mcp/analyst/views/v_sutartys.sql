CREATE TEMP VIEW v_sutartys AS
SELECT s."sutartiesUnikalusId",
       s."sutartiesNumeris",
       s."pirkimoNumeris",
       s."sudarymoData",
       s."paskelbimoData",
       s."galiojimoData",
       s."faktineIvykdimoData",
       s."paskutinioRedagavimoData",
       s."paskutinioAtnaujinimoData",
       a."paskutiniKartaMatyta",
       a."paskutiniKartaAtnaujinta",
       s.verte,
       s.suma,
       s."faktineIvykdimoVerte",
       s.pavadinimas,
       s."bvpzKodas",
       s."bvpzPavadinimas",
       s."papildomiBvpzKodai",
       s."papildomiBvpzPavadinimai",
       ARRAY[s."bvpzKodas"] || COALESCE(s."papildomiBvpzKodai", '{}')           AS "bvpzKodai",
       ARRAY[s."bvpzPavadinimas"] || COALESCE(s."papildomiBvpzPavadinimai", '{}') AS "bvpzPavadinimai",
       s.kategorija,
       s.tipas,
       CASE UPPER(TRIM(s.tipas))
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
           ELSE UPPER(TRIM(s.tipas))
       END                                                                        AS "tipoPavadinimas",
       s.istrinta,
       s."dokumentuKiekis",
       s."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       s."perkanciojiOrganizacija",
       pb.pavadinimas                      AS pirkejas,
       s."tiekejoKodas",
       s."tiekejas"                        AS "tiekejoPavadinimas",
       COALESCE(tb.pavadinimas, s."tiekejas") AS tiekejas,
       s."papildomiTiekejai",
       s."papildomiTiekejaiKodai",
       ARRAY[s."tiekejoKodas"] || COALESCE(s."papildomiTiekejaiKodai", '{}')     AS "tiekejaiKodai",
       ARRAY[s."tiekejas"] || COALESCE(s."papildomiTiekejai", '{}')              AS tiekejai
FROM sutartys s
         LEFT JOIN "sutartysAtnaujinimai" a ON a."sutartiesUnikalusId" = s."sutartiesUnikalusId"
         LEFT JOIN "jarCsv" pb ON pb."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
         LEFT JOIN "jarCsv" tb ON tb."jarKodas"::text = s."tiekejoKodas"

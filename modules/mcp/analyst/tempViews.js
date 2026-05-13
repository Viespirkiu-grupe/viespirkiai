export const VIEW_DEFINITIONS = {
    v_company: `CREATE TEMP VIEW v_company AS
SELECT j."jarKodas"::text,
       j.pavadinimas,
       j.adresas,
       j."registravimoData",
       j."formosPavadinimas",
       j."statusoPavadinimas",
       j."statusasNuo",
       s.data                                                                   AS "sodraData",
       (COALESCE(s.draustieji, 0) + COALESCE(s.draustieji2, 0))                AS darbuotojai,
       s."vidutinisAtlyginimas",
       s."imokuSuma",
       EXISTS(SELECT 1
              FROM "melagingiTiekejai" m
              WHERE m."tiekejoJarKodas" = j."jarKodas"::text
                AND (m."itrauktasIki" IS NULL OR m."itrauktasIki" >= CURRENT_DATE)) AS "melagingisTiekejas",
       EXISTS(SELECT 1
              FROM "nepatikimiTiekejai" n
              WHERE n."tiekejoJarKodas" = j."jarKodas"::text
                AND (n."itrauktaIki" IS NULL OR n."itrauktaIki" >= CURRENT_DATE))   AS "nepatikimasTiekejas",
       (SELECT COUNT(*)
        FROM "vdiPazeidimai" v
        WHERE v."jarKodas" = j."jarKodas"::text)                                AS "vdiPazeidimuSkaicius",
       (SELECT COUNT(*)
        FROM "bylosDalyviai" bd
        WHERE bd.kodas = j."jarKodas"::text)                                    AS "bylosSkaicius",
       (SELECT COUNT(*)
        FROM domenai d
        WHERE d."savininkoKodas" = j."jarKodas"::text)                          AS "domenaiSkaicius",
       (SELECT COUNT(*)
        FROM "neskelbiamosDerybos" nd
        WHERE nd."jarKodas" = j."jarKodas"::text)                               AS "neskelbiamosDerybosSkaicius"
FROM "jarCsv" j
         LEFT JOIN LATERAL (
    SELECT draustieji, draustieji2, "vidutinisAtlyginimas", "imokuSuma", data
    FROM sodra
    WHERE "jarKodas" = j."jarKodas"::text
    ORDER BY data DESC NULLS LAST
    LIMIT 1
    ) s ON true`,

    v_sutartys: `CREATE TEMP VIEW v_sutartys AS
SELECT s."sutartiesUnikalusId",
       s."sutartiesNumeris",
       s."pirkimoNumeris",
       s."sudarymoData",
       s."paskelbimoData",
       s."galiojimoData",
       s."faktineIvykdimoData",
       s."paskutinioRedagavimoData",
       s."paskutinioAtnaujinimoData",
       s."paskutiniKartaMatyta",
       s."paskutiniKartaAtnaujinta",
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
       tb.pavadinimas                      AS tiekejas,
       s."papildomiTiekejai",
       s."papildomiTiekejaiKodai",
       ARRAY[s."tiekejoKodas"] || COALESCE(s."papildomiTiekejaiKodai", '{}')     AS "tiekejaiKodai",
       ARRAY[s."tiekejas"] || COALESCE(s."papildomiTiekejai", '{}')              AS tiekejai
FROM sutartys s
         LEFT JOIN "jarCsv" pb ON pb."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
         LEFT JOIN "jarCsv" tb ON tb."jarKodas"::text = s."tiekejoKodas"`,

    v_pirkimas: `CREATE TEMP VIEW v_pirkimas AS
SELECT p."pirkimoId",
       p.pavadinimas,
       p."jarKodas",
       o.pavadinimas AS organizatorius,
       o.trumpinys,
       o.miestas,
       p."pirkimoBudas",
       p.statusas,
       p.zingsnis,
       p."pirkimoObjektoTipas",
       p."numatomaVerteEUR",
       p."paskelbimoData",
       p."pasiulymuPateikimoTerminas",
       p."esFinansavimas",
       p."bvpzKodai",
       p.informacija
FROM "viesiejiPirkimai" p
         LEFT JOIN "viesiejiPirkimaiVykdytojai" o ON o.id = p."pirkimoVykdytojasId"`,

    v_person_links: `CREATE TEMP VIEW v_person_links AS
SELECT r.id,
       r.deklaracija,
       r.vardas,
       r.pavarde,
       r."susijusioAsmensVardas",
       r."susijusioAsmensPavarde",
       r."jarKodas",
       j.pavadinimas AS "imonesVardas",
       r.pareigos,
       r."irasoTipas",
       r."darbovietesTipas",
       r."rysioPobudzioPavadinimas",
       r."rysioPradzia",
       r."rysioPabaiga",
       r."yraJuridinisAsmuo",
       r."registruotaLietuvoje",
       r."jaTeisinesFormosPavadinimas",
       r."kienoRysys",
       r."dalyvaujaViesuosePirkimuose",
       r."dalyvavimoVpInformacija",
       r."pateikimoData"
FROM "pinregJuridiniaiRysiai" r
         LEFT JOIN "jarCsv" j ON j."jarKodas"::text = r."jarKodas"`,

    v_dalyviai: `CREATE TEMP VIEW v_dalyviai AS
SELECT a."pirkimoNumeris",
       a."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       a."pirkimoBudas",
       a."sukurtaAt"                       AS "ataskaitosData",
       a."pirkimoObjektoPavadinimas",
       a."pagrindinisKodasBvpz",
       a."daliuSkaicius",
       a."interesuKonfliktasNustatytas",
       a."interesuKonfliktoPriemones",
       a."konkurencijaIskreipiantisAsmuo",
       a."konkurencijosPriemones",
       a."pretenzijaPateikta",
       a."ieskinysTeismui",
       d.kodas                             AS "tiekejoKodas",
       j.pavadinimas                       AS tiekejas,
       d."fizinisAsmuo",
       d.salis,
       e."eileNumeris",
       e.kaina::numeric                    AS "pasiulymoKaina",
       ap.statusas                         AS "atmetimoPriezastis"
FROM atn1ataskaitos a
         JOIN atn1dalyviai d ON d."ataskaitaId" = a.id
         LEFT JOIN "atn1pasiulymuEile" e
                   ON e."ataskaitaId" = a.id AND e."dalyvioKodas" = d.kodas
         LEFT JOIN "atn1atmestiPasiulymai" ap
                   ON ap."ataskaitaId" = a.id AND ap."dalyvioKodas" = d.kodas
         LEFT JOIN "jarCsv" j ON j."jarKodas"::text = d.kodas`,

    v_bylos: `CREATE TEMP VIEW v_bylos AS
SELECT b.id           AS "bylosId",
       b."bylosNumeris",
       b."bylosRusis",
       b.data         AS "bylosData",
       b.teismas,
       bd.kodas       AS "jarKodas",
       j.pavadinimas  AS "dalyvioPavadinimas",
       bd.pavadinimas AS "dalyvioVardasIrPavarde",
       bd."bylojeKaip"
FROM "bylosDalyviai" bd
         JOIN bylos b ON b.id = bd."bylosId"
         LEFT JOIN "jarCsv" j ON j."jarKodas"::text = bd.kodas`,
};

export const TEMP_VIEWS_SQL = Object.values(VIEW_DEFINITIONS).join(';\n\n') + ';';

export const VIEW_NAMES = new Set(Object.keys(VIEW_DEFINITIONS));

// Maps each main (FROM-clause) table to the view that fully covers it.
// getSchema uses this to suppress raw table listings in favour of the view.
export const COVERED_TABLES_BY_VIEWS = {
    jarCsv:                  "v_company",
    sutartys:                "v_sutartys",
    viesiejiPirkimai:        "v_pirkimas",
    pinregJuridiniaiRysiai:  "v_person_links",
    atn1ataskaitos:          "v_dalyviai",
    bylosDalyviai:           "v_bylos",
};

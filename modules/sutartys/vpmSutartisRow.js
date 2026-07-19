/*
SQL fragmentai, atstatantys senos public.sutartys eilutės formą iš vpm
lentelių. Naudojama pereinamuoju laikotarpiu ten, kur vartotojai
(Quickwit doc builder, Spinta/JSONL eksportas) dar tikisi senos plokščios
eilutės, bet duomenų šaltinis jau yra vpm.

BVPŽ pavadinimai ir kontrolinė cifra (pvz. „-7“ kode „45000000-7“)
vpm nesaugomi, todėl atstatomi iš bvpzKodai žodyno. Žodyno `mask`
yra sutrumpintas hierarchinis kodas, todėl rodomas kodas sudedamas iš
`code` ir `checksum`.
*/

export const VPM_SUTARTIS_ROW_SELECT = `
    s."unikalusId" AS "sutartiesUnikalusId",
    s.pavadinimas,
    s."pirkimoNumeris",
    CASE WHEN s."bvpzKodas" IS NULL THEN NULL
         ELSE COALESCE(
             bvpz.code || CASE WHEN NULLIF(bvpz.checksum, '') IS NULL
                               THEN '' ELSE '-' || bvpz.checksum END,
             s."bvpzKodas"::text
         ) END AS "bvpzKodas",
    bvpz.pavadinimas AS "bvpzPavadinimas",
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'pavadinimas', f.pavadinimas,
            'url', 'https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&Itemid=109&dok_id='
                   || s."unikalusId" || '&file_id=' || f."fileId"
        ) ORDER BY f.id)
        FROM public."vpmSutartysFailai" f
        WHERE f."unikalusId" = s."unikalusId"
    ), '[]'::jsonb) AS dokumentai,
    s."failuSkaicius" AS "dokumentuKiekis",
    s."faktineIvykdimoData",
    s."faktineVerte" AS "faktineIvykdimoVerte",
    s."galiojimoData",
    kategorija.kategorija AS kategorija,
    s."paskelbimoData",
    atn.matyta AS "paskutinioAtnaujinimoData",
    atn.matyta AS "paskutiniKartaMatyta",
    atn.atnaujinta AS "paskutiniKartaAtnaujinta",
    s."redagavimoData" AS "paskutinioRedagavimoData",
    buyer_name.pavadinimas AS "perkanciojiOrganizacija",
    s."perkanciosiosOrganizacijosKodas",
    s."sudarymoData",
    s."sutartiesNumeris",
    supplier_name.pavadinimas AS tiekejas,
    s."pirmoTiekejoKodas" AS "tiekejoKodas",
    tipas.tipas AS tipas,
    s."numatomaVerte" AS verte,
    s.verte AS suma,
    COALESCE(extra_tiekejai.pavadinimai, '{}'::text[]) AS "papildomiTiekejai",
    COALESCE(extra_tiekejai.kodai, '{}'::text[]) AS "papildomiTiekejaiKodai",
    COALESCE(extra_bvpz.kodai, '{}'::text[]) AS "papildomiBvpzKodai",
    COALESCE(extra_bvpz.pavadinimai, '{}'::text[]) AS "papildomiBvpzPavadinimai",
    s.istrinta,
    search."searchTsv" AS search_tsv`;

export const VPM_SUTARTIS_ROW_FROM = `
    public."vpmSutartys" s
    LEFT JOIN public."vpmSutartysSalys" buyer_name
      ON buyer_name.id = s."perkanciosiosOrganizacijosPavadinimoId"
    LEFT JOIN public."vpmSutartysSalys" supplier_name
      ON supplier_name.id = s."pirmoTiekejoPavadinimoId"
    LEFT JOIN public."vpmSutartysTipai" tipas ON tipas.id = s."tipasId"
    LEFT JOIN public."vpmSutartysKategorijos" kategorija
      ON kategorija.id = s."kategorijaId"
    LEFT JOIN LATERAL (
        SELECT b.code, b.checksum, b.pavadinimas
        FROM public."bvpzKodai" b
        WHERE b.code = s."bvpzKodas"::text
        LIMIT 1
    ) bvpz ON true
    LEFT JOIN public."vpmSutartysAtnaujinimai" atn
      ON atn."unikalusId" = s."unikalusId"
    LEFT JOIN public."vpmSutartysSearch" search
      ON search."unikalusId" = s."unikalusId"
    LEFT JOIN LATERAL (
        SELECT
            array_agg(en.pavadinimas ORDER BY e.id) AS pavadinimai,
            array_agg(e."tiekejoKodas" ORDER BY e.id) AS kodai
        FROM public."vpmSutartysPapildomiTiekejai" e
        LEFT JOIN public."vpmSutartysSalys" en
          ON en.id = e."tiekejoPavadinimoId"
        WHERE e."unikalusId" = s."unikalusId"
    ) extra_tiekejai ON true
    LEFT JOIN LATERAL (
        SELECT
            array_agg(COALESCE(
                b.code || CASE WHEN NULLIF(b.checksum, '') IS NULL
                               THEN '' ELSE '-' || b.checksum END,
                eb."bvpzKodas"::text
            ) ORDER BY eb.id) AS kodai,
            array_agg(b.pavadinimas ORDER BY eb.id) AS pavadinimai
        FROM public."vpmSutartysPapildomiBvpzKodai" eb
        LEFT JOIN public."bvpzKodai" b ON b.code = eb."bvpzKodas"::text
        WHERE eb."unikalusId" = s."unikalusId"
    ) extra_bvpz ON true`;

/** Pilna senos eilutės formos subužklausa skaitymo vartotojams. */
export const VPM_SUTARTIS_ROW_SQL = `
    SELECT ${VPM_SUTARTIS_ROW_SELECT}
    FROM ${VPM_SUTARTIS_ROW_FROM}`;

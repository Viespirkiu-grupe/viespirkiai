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

import { preparedStatement } from "../../postgres/prepared.js";

export const VPM_SUTARTIS_ROW_SELECT = `
    s."unikalusId" AS "sutartiesUnikalusId",
    s.pavadinimas,
    s."pirkimoNumeris",
    CASE WHEN s."bvpzKodas" IS NULL THEN NULL
         ELSE COALESCE(
             bvpz.code || CASE WHEN bvpz.checksum IS NULL
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
        FROM "vpmSutartys"."failai" f
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
    s.istrinta`;
/*
`search."searchTsv"` čia sąmoningai NĖRA: tsvector didelis, rezultatuose
nereikalingas ir nutekėdavo į MCP/JSON atsakymus. Jungtis su
`vpmSutartys."search"` FROM'e lieka – ja filtruoja tekstinė paieška
(`searchSutartys.js`); kai stulpelių iš jos niekas neima, Postgres unikalią
LEFT JOIN jungtį pašalina pats.
*/

export const VPM_SUTARTIS_ROW_FROM = `
    "vpmSutartys"."sutartys" s
    LEFT JOIN "vpmSutartys"."salys" buyer_name
      ON buyer_name.id = s."perkanciosiosOrganizacijosPavadinimoId"
    LEFT JOIN "vpmSutartys"."salys" supplier_name
      ON supplier_name.id = s."pirmoTiekejoPavadinimoId"
    LEFT JOIN "vpmSutartys"."tipai" tipas ON tipas.id = s."tipasId"
    LEFT JOIN "vpmSutartys"."kategorijos" kategorija
      ON kategorija.id = s."kategorijaId"
    LEFT JOIN LATERAL (
        SELECT b.code, b.checksum, b.pavadinimas
        FROM bvpz."kodai" b
        WHERE b.code = s."bvpzKodas"::text
        LIMIT 1
    ) bvpz ON true
    LEFT JOIN "vpmSutartys"."atnaujinimai" atn
      ON atn."unikalusId" = s."unikalusId"
    LEFT JOIN "vpmSutartys"."search" search
      ON search."unikalusId" = s."unikalusId"
    LEFT JOIN LATERAL (
        SELECT
            array_agg(en.pavadinimas ORDER BY e.id) AS pavadinimai,
            array_agg(e."tiekejoKodas" ORDER BY e.id) AS kodai
        FROM "vpmSutartys"."papildomiTiekejai" e
        LEFT JOIN "vpmSutartys"."salys" en
          ON en.id = e."tiekejoPavadinimoId"
        WHERE e."unikalusId" = s."unikalusId"
    ) extra_tiekejai ON true
    LEFT JOIN LATERAL (
        SELECT
            array_agg(COALESCE(
                b.code || CASE WHEN b.checksum IS NULL
                               THEN '' ELSE '-' || b.checksum END,
                eb."bvpzKodas"::text
            ) ORDER BY eb.id) AS kodai,
            array_agg(b.pavadinimas ORDER BY eb.id) AS pavadinimai
        FROM "vpmSutartys"."papildomiBvpzKodai" eb
        LEFT JOIN bvpz."kodai" b ON b.code = eb."bvpzKodas"::text
        WHERE eb."unikalusId" = s."unikalusId"
    ) extra_bvpz ON true`;

/** Pilna senos eilutės formos subužklausa skaitymo vartotojams. */
export const VPM_SUTARTIS_ROW_SQL = `
    SELECT ${VPM_SUTARTIS_ROW_SELECT}
    FROM ${VPM_SUTARTIS_ROW_FROM}`;

/*
Dažniausios statiškos užklausos – kaip prepared statement'ai. Užklausos tekstas
~4 KB, tad planavimas užima didesnę dalį laiko nei pats vykdymas; paruošus planą
jungčiai, point lookup atpinga ~2,5 karto. Vardai turi būti unikalūs kiekvienam
skirtingam tekstui.
*/

/** Viena sutartis pagal `sutartiesUnikalusId`. */
export const sutartisPagalId = preparedStatement(
    "vpmSutartisPagalId",
    `SELECT * FROM (${VPM_SUTARTIS_ROW_SQL}) sutartys
     WHERE "sutartiesUnikalusId" = $1 LIMIT 1`,
);

/** Panašios sutartys (tas pats pirkėjas, tiekėjas ir vertė). */
export const panasiosSutartys = preparedStatement(
    "vpmPanasiosSutartys",
    `SELECT * FROM (${VPM_SUTARTIS_ROW_SQL}) sutartys
     WHERE "sutartiesUnikalusId" != $1
       AND "perkanciosiosOrganizacijosKodas" = $2
       AND "tiekejoKodas" = $3
       AND verte = $4
       AND istrinta = false
     ORDER BY "paskutinioRedagavimoData" DESC`,
);

/** Sutarties kortelė paieškos panelėje (tik rodomi laukai). */
export const sutartisPanelei = preparedStatement(
    "vpmSutartisPanelei",
    `SELECT
         "sutartiesUnikalusId"::text AS id,
         pavadinimas,
         tipas,
         "sutartiesNumeris",
         "pirkimoNumeris",
         "perkanciojiOrganizacija" AS pirkejas,
         "perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
         tiekejas,
         "tiekejoKodas",
         verte,
         "faktineIvykdimoVerte" AS "faktineVerte",
         "sudarymoData",
         "galiojimoData",
         "bvpzKodas",
         "bvpzPavadinimas",
         "dokumentuKiekis"
     FROM (${VPM_SUTARTIS_ROW_SQL}) sutartys
     WHERE "sutartiesUnikalusId" = $1
       AND istrinta = false
     LIMIT 1`,
);

/** Panašios sutartys, tik pagrindiniai laukai (MCP atsakymams). */
export const panasiosSutartysTrumpai = preparedStatement(
    "vpmPanasiosSutartysTrumpai",
    `SELECT "sutartiesUnikalusId", pavadinimas, verte, "faktineIvykdimoVerte", "sudarymoData", tipas
     FROM (${VPM_SUTARTIS_ROW_SQL}) sutartys
     WHERE "sutartiesUnikalusId" != $1
       AND "perkanciosiosOrganizacijosKodas" = $2
       AND "tiekejoKodas" = $3
       AND verte = $4
       AND istrinta = false
     ORDER BY "paskutinioRedagavimoData" DESC`,
);

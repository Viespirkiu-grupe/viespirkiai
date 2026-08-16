import { postgres } from "../../postgres/postgres.js";

export async function gautiJarPapildomusDuomenis(
    jarKodas,
    { dokumentaiLimit = 10 } = {},
    db = postgres,
) {
    const limit = dokumentaiLimit == null
        ? 1_000_000
        : Math.max(1, Math.min(Number(dokumentaiLimit) || 10, 1_000_000));
    const { rows } = await db.query(
        `SELECT
            COALESCE((
                SELECT jsonb_agg(to_jsonb(z) ORDER BY z."statusasNuo" DESC)
                FROM (
                    SELECT s."zymosTipas", tipas."pavadinimas" AS "zymosPavadinimas",
                           s."formosKodas", forma."pavadinimas" AS "formosPavadinimas",
                           s."statusasNuo", s."statusasIki", s."formavimoData"
                    FROM public."jarZymuStatusai" s
                    JOIN public."jarZymuTipai" tipas ON tipas."kodas" = s."zymosTipas"
                    LEFT JOIN public."jarFormos" forma ON forma."kodas" = s."formosKodas"
                    WHERE s."jarKodas" = $1
                ) z
            ), '[]'::jsonb) AS "zymos",
            COALESCE((
                SELECT jsonb_agg(to_jsonb(s) ORDER BY s."laikotarpisIki" DESC)
                FROM (
                    SELECT v."savanoriuSkaicius", v."savanorystesValanduSkaicius",
                           v."laikotarpisNuo", v."laikotarpisIki", v."formavimoData",
                           v."formosKodas", forma."pavadinimas" AS "formosPavadinimas"
                    FROM public."jarSavanoryste" v
                    LEFT JOIN public."jarFormos" forma ON forma."kodas" = v."formosKodas"
                    WHERE v."jarKodas" = $1
                ) s
            ), '[]'::jsonb) AS "savanoryste",
            (
                SELECT to_jsonb(j)
                FROM (
                    SELECT t."sarasasPateiktas", t."sarasoBusena",
                           busena."pavadinimas" AS "sarasoBusenosPavadinimas",
                           t."sarasoPateikimoData", t."formavimoData"
                    FROM public."jarJangisTeikimai" t
                    LEFT JOIN public."jarJangisBusenos" busena
                      ON busena."kodas" = t."sarasoBusena"
                    WHERE t."jarKodas" = $1
                ) j
            ) AS "jangis",
            COALESCE((
                SELECT jsonb_agg(to_jsonb(a) ORDER BY a."anuliavimoRegistravimoData" DESC)
                FROM (
                    SELECT x."templateId", template."kodas" AS "templateKodas",
                           template."pavadinimas" AS "templateName",
                           x."laikotarpisNuo", x."laikotarpisIki",
                           x."anuliavimoRegistravimoData", x."formavimoData"
                    FROM public."jarFinansiniuAtaskaituAnuliavimai" x
                    JOIN public."jarFinansiniuAtaskaituTemplate" template
                      ON template."id" = x."templateId"
                    WHERE x."jarKodas" = $1
                ) a
            ), '[]'::jsonb) AS "finansiniuAtaskaituAnuliavimai",
            (
                SELECT to_jsonb(v)
                FROM (
                    SELECT x."paskutineAtaskaitaIki", x."formavimoData"
                    FROM public."jarFinansiniuAtaskaituVelavimai" x
                    WHERE x."jarKodas" = $1
                ) v
            ) AS "finansiniuAtaskaituVelavimas",
            COALESCE((
                SELECT jsonb_agg(to_jsonb(n) ORDER BY n."nepateiktaUzMetus" DESC)
                FROM (
                    SELECT x."nepateiktaUzMetus", x."formavimoData"
                    FROM public."jarFinansiniuAtaskaituNepateikimai" x
                    WHERE x."jarKodas" = $1
                ) n
            ), '[]'::jsonb) AS "finansiniuAtaskaituNepateikimai",
            jsonb_build_object(
                'count', (SELECT count(*) FROM public."jarDokumentai" d WHERE d."jarKodas" = $1),
                'rows', COALESCE((
                    SELECT jsonb_agg(to_jsonb(d) ORDER BY d."dokumentoRegistravimoData" DESC, d."id" DESC)
                    FROM (
                        SELECT x."id", x."dokumentoTipas", x."dokumentoPotipis",
                               potipis."pavadinimas" AS "dokumentoPotipioPavadinimas",
                               x."dokumentoData", x."dokumentoRegistravimoData", x."formavimoData"
                        FROM public."jarDokumentai" x
                        LEFT JOIN public."jarDokumentuPotipiai" potipis
                          ON potipis."dokumentoTipas" = x."dokumentoTipas"
                         AND potipis."dokumentoPotipis" = x."dokumentoPotipis"
                        WHERE x."jarKodas" = $1
                        ORDER BY x."dokumentoRegistravimoData" DESC, x."id" DESC
                        LIMIT $2
                    ) d
                ), '[]'::jsonb)
            ) AS "dokumentai"`,
        [jarKodas, limit],
    );
    return rows[0] ?? {
        zymos: [], savanoryste: [], jangis: null,
        finansiniuAtaskaituAnuliavimai: [],
        finansiniuAtaskaituVelavimas: null,
        finansiniuAtaskaituNepateikimai: [],
        dokumentai: { count: 0, rows: [] },
    };
}

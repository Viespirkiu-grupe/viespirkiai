-- Pirkėjo–tiekėjo ryšys — the trading relationship between one buyer and one
-- supplier, as a subject in its own right.
--
-- Several canonical indicators decide something about the *relationship*
-- rather than about any single contract: award concentration, repeated awards,
-- a small first purchase followed by much larger ones, repeated direct awards
-- near a threshold. Those need one durable subject per pair, with the pair's
-- whole history summarised on it.
--
-- Grain: one row per (pirkejoKodas, tiekejoKodas). "rysioRaktas" is
-- pirkejoKodas || ':' || tiekejoKodas.
--
-- Reads vpmSutartys."sutartys" directly rather than v_sutartys: this aggregates the
-- whole contract corpus, and v_sutartys adds a dozen joins per row that the
-- aggregate does not use.
--
-- Only the *primary* supplier ("pirmoTiekejoKodas") forms a relationship here.
-- Additional suppliers on a joint contract ("vpmSutartys"."papildomiTiekejai")
-- are deliberately excluded: a consortium member is not in the same
-- relationship with the buyer as the lead contractor, and treating them
-- identically would inflate every concentration measure.

CREATE OR REPLACE VIEW v_pirkejo_tiekejo_rysys AS
SELECT s."perkanciosiosOrganizacijosKodas" || ':' || s."pirmoTiekejoKodas" AS "rysioRaktas",
       s."perkanciosiosOrganizacijosKodas"                  AS "pirkejoKodas",
       s."pirmoTiekejoKodas"                                AS "tiekejoKodas",
       count(*)                                             AS "sutarciuSkaicius",
       count(*) FILTER (WHERE s."pirkimoNumeris" IS NOT NULL)
                                                            AS "sutarciuSuPirkimoNumeriu",
       sum(s.verte::numeric)                                AS "bendraSuma",
       sum(s."faktineVerte"::numeric)                       AS "bendraFaktineSuma",
       min(s.verte::numeric)                                AS "maziausiaSuma",
       max(s.verte::numeric)                                AS "didziausiaSuma",
       min(s."sudarymoData")::timestamp                     AS "pirmaSutartisData",
       max(s."sudarymoData")::timestamp                     AS "paskutineSutartisData",
       count(DISTINCT s."bvpzKodas")                        AS "bvpzKoduSkaicius",
       count(DISTINCT t.tipas)                              AS "sutarciuTipuSkaicius"
FROM "vpmSutartys"."sutartys" s
         LEFT JOIN "vpmSutartys"."tipai" t ON t.id = s."tipasId"
-- Blank and punctuation-only codes name no party, so they form no
-- relationship. Codes are otherwise kept as recorded: whether a code resolves
-- to a registered company is a data-sufficiency question for the indicator,
-- not grounds for the model to deny the relationship exists.
WHERE s.istrinta = false
  AND s."perkanciosiosOrganizacijosKodas" ~ '[A-Za-z0-9]'
  AND s."pirmoTiekejoKodas" ~ '[A-Za-z0-9]'
GROUP BY 1, 2, 3

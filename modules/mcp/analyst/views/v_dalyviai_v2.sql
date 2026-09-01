-- Risk service's own copy of v_dalyviai, isolated under a _v2 suffix so the
-- three deployed indicators' collect.sql statements never depend on
-- whatever the shared analyst v_dalyviai view happens to look like at any
-- given time. Same definition as v_dalyviai.sql — keep the two in sync by
-- hand until the shared view is retired in favor of this one.
--
-- Viena eilutė per (pirkimas, tiekėjas, pirkimo dalis). PPA XLSX turinys.
-- xlsx failu (pavadinimas: PPA-*, ATN-*, Atn-1*) jei reikia papildomos detalės:
-- p.4=dalyviai, p.6=atmesti pasiūlymai su kainomis, p.7=pasiūlymų eilė su kainomis.
CREATE OR REPLACE VIEW v_dalyviai_v2 AS
SELECT a."pirkimoNumeris",
       a."perkanciosiosOrganizacijosKodas" AS "pirkejoKodas",
       pb.pavadinimas                        AS "pirkimoBudas",
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
       salis.pavadinimas                    AS salis,
       p."daliesNumeris",
       p."eileNumeris",
       p."pasiulymoKaina",
       p."atmetimoPriezastis",
       p."atmetimoStatusas",
       p."atmetimoTeisinisPagrindas"
FROM ppa."ataskaitos" a
         LEFT JOIN ppa."pirkimoBudai" pb ON pb.id = a."pirkimoBudasId"
         JOIN ppa."dalyviai" d ON d."ataskaitaId" = a.id
         LEFT JOIN ppa."salys" salis ON salis.id = d."salisId"
         LEFT JOIN LATERAL (
             SELECT COALESCE(e."daliesNumeris", ap."daliesNumeris") AS "daliesNumeris",
                    e."eileNumeris"                                 AS "eileNumeris",
                    -- e.kaina (ppa."pasiulymuEile", "pasiūlymų eilė su kainomis") only
                    -- carries a price for a bid that made it into the price ranking.
                    -- ap.pasiulymoKaina (ppa."atmestiPasiulymai") carries the same fact
                    -- for a bid that never was, recorded at rejection time — without this
                    -- fallback a disqualified bid's price is populated for ~1% of
                    -- disqualified bids instead of ~40% (see LT-AWD-02's README).
                    COALESCE(NULLIF(e.kaina, '')::numeric,
                             NULLIF(ap."pasiulymoKaina", '')::numeric)                     AS "pasiulymoKaina",
                    apr.pavadinimas                                 AS "atmetimoPriezastis",
                    aps.pavadinimas                                 AS "atmetimoStatusas",
                    atp.pavadinimas                                 AS "atmetimoTeisinisPagrindas"
             FROM ppa."pasiulymuEile" e
                      FULL OUTER JOIN ppa."atmestiPasiulymai" ap
                                      ON ap."ataskaitaId" = e."ataskaitaId"
                                          AND ap."dalyvioKodas" = e."dalyvioKodas"
                                          AND ap."daliesNumeris" = e."daliesNumeris"
                      LEFT JOIN ppa."atmetimoPriezastys" apr
                                ON apr.id = ap."atmetimoPriezastysId"
                      LEFT JOIN ppa."atmestuPasiulymuStatusai" aps
                                ON aps.id = ap."statusasId"
                      LEFT JOIN ppa."atmetimoTeisiniaiPagrindai" atp
                                ON atp.id = ap."atmetimoTeisinisPagrindasId"
             WHERE COALESCE(e."ataskaitaId", ap."ataskaitaId") = a.id
               AND COALESCE(e."dalyvioKodas", ap."dalyvioKodas") = d.kodas
         ) p ON true
         -- Matched on the "rcJar"."asmenys" integer key rather than on "jarKodas"::text:
         -- a cast on the indexed side makes asmenys_pkey unusable, so the
         -- planner had no choice but to seq-scan all ~548k rows and sort them
         -- externally on every query that touches this view — several seconds,
         -- paid even by the Procurement Reader's queries, none of which select
         -- "tiekejas" at all. Comparing the raw column instead both enables the
         -- pkey lookup and lets Postgres prove the join is one-to-one, so it
         -- drops the join outright when "tiekejas" is not selected.
         --
         -- The guard is equivalent, not merely conservative: "jarKodas" is an
         -- integer, so a d.kodas that is non-numeric, zero-padded, or wider than
         -- a 9-digit registry code (an 11-digit personal code, say) could never
         -- have matched the old text comparison either. Verified against the
         -- warehouse: zero rows resolve to a different "rcJar"."asmenys" row.
         LEFT JOIN "rcJar"."asmenys" j
                   ON j."jarKodas" = CASE WHEN d.kodas ~ '^[1-9][0-9]{0,8}$' THEN d.kodas::int END

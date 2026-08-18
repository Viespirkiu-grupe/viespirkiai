-- Rinka — one product market, identified by its BVPŽ (CPV) division.
--
-- Market concentration, geographic allocation and the prevalence of bidding
-- consortia are statements about a market, not about any procurement in it.
-- Those indicators need a durable market subject to attach a result to.
--
-- Grain: one row per two-digit BVPŽ division observed in procurement notices.
-- "rinkosRaktas" is 'bvpz:' || skyrius, so the key states the classification
-- level it was taken at — a later group- or class-level market would be a
-- different key, not a redefinition of this one.
--
-- The entity enumerates markets and names them. It deliberately carries no
-- windowed statistics: every market indicator compares over its own reviewed
-- period, so a "contracts in the last N months" column here would be either
-- the wrong window for most callers or a column per window. The indicator
-- narrows to its market and computes its own window.

CREATE OR REPLACE VIEW v_rinka AS
SELECT 'bvpz:' || r.skyrius              AS "rinkosRaktas",
       'bvpzSkyrius'                     AS lygis,
       r.skyrius                         AS kodas,
       b.pavadinimas                     AS pavadinimas,
       r."pirkimuSkaicius",
       r."pirkejuSkaicius",
       r."bvpzKoduSkaicius",
       r."pirmasPirkimas",
       r."paskutinisPirkimas"
FROM (
    SELECT left(k.kodas, 2)                    AS skyrius,
           count(DISTINCT p."pirkimoId")       AS "pirkimuSkaicius",
           count(DISTINCT p."jarKodas")        AS "pirkejuSkaicius",
           count(DISTINCT k.kodas)             AS "bvpzKoduSkaicius",
           min(p."paskelbimoData")             AS "pirmasPirkimas",
           max(p."paskelbimoData")             AS "paskutinisPirkimas"
    FROM "viesiejiPirkimai" p
             CROSS JOIN LATERAL unnest(p."bvpzKodai") AS k(kodas)
    WHERE k.kodas ~ '^[0-9]{8}'
    GROUP BY 1
) r
    -- BVPŽ žodyne skyrių atitinka kodas XX000000; jei jo nėra, pavadinimas
    -- lieka NULL, o rinka vis tiek egzistuoja.
         LEFT JOIN "bvpzKodai" b ON b.code = r.skyrius || '000000'

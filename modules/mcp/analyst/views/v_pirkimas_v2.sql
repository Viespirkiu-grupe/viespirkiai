-- Risk service's own copy of v_pirkimas, isolated under a _v2 suffix so the
-- Procurement Reader (modules/risk/procurementReader.ts) never depends on
-- whatever the shared analyst v_pirkimas view happens to look like at any
-- given time. Same definition as v_pirkimas.sql — keep the two in sync by
-- hand until the shared view is retired in favor of this one.

CREATE OR REPLACE VIEW v_pirkimas_v2 AS
SELECT 'cvpis' AS saltinis,
       p."pirkimoId"::text AS "pirkimoNumeris",
       p.pavadinimas,
       p."jarKodas",
       NULL::text AS "jarKodasSaltinis",
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
         LEFT JOIN "viesiejiPirkimaiVykdytojai" o ON o.id = p."pirkimoVykdytojasId"
UNION ALL
SELECT 'cvpp' AS saltinis,
       c."pirkimoNumeris" AS "pirkimoNumeris",
       c.pavadinimas,
       sj."perkanciosiosOrganizacijosKodas" AS "jarKodas",
       CASE WHEN sj."perkanciosiosOrganizacijosKodas" IS NOT NULL THEN 'sutartys-join' END AS "jarKodasSaltinis",
       c."pirkimoVykdytojas" AS organizatorius,
       NULL AS trumpinys,
       NULL AS miestas,
       NULL AS "pirkimoBudas",
       NULL AS statusas,
       NULL AS zingsnis,
       NULL AS "pirkimoObjektoTipas",
       NULL AS "numatomaVerteEUR",
       c."paskelbimoData",
       c."pasiulymuPateikimoTerminas",
       NULL AS "esFinansavimas",
       NULL AS "bvpzKodai",
       c.link AS informacija
FROM "cvppViesiejiPirkimai" c
         LEFT JOIN LATERAL (
             SELECT s."perkanciosiosOrganizacijosKodas"
             FROM "vpmSutartys" s
             WHERE s."pirkimoNumeris" = c."pirkimoNumeris"
               AND s."perkanciosiosOrganizacijosKodas" IS NOT NULL
               AND s.istrinta = false
             LIMIT 1
         ) sj ON true
WHERE c."skelbimoTipas" = 'Skelbimas apie pirkimą'
  AND NOT EXISTS (
      SELECT 1 FROM "viesiejiPirkimai" p
      WHERE p."pirkimoId"::text = c."pirkimoNumeris"
  )

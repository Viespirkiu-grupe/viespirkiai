CREATE OR REPLACE VIEW v_pirkimas AS
SELECT 'cvpis' AS saltinis,
       p."pirkimoId",
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
       c."pirkimoNumeris" AS "pirkimoId",
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
             FROM sutartys s
             WHERE s."pirkimoNumeris" = c."pirkimoNumeris"
               AND s."perkanciosiosOrganizacijosKodas" IS NOT NULL
             LIMIT 1
         ) sj ON true
WHERE c."skelbimoTipas" = 'Skelbimas apie pirkimą'
  AND NOT EXISTS (
      SELECT 1 FROM "viesiejiPirkimai" p
      WHERE p."pirkimoId" = c."pirkimoNumeris"
  )

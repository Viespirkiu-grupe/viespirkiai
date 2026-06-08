CREATE TEMP VIEW v_bylos AS
SELECT n.id           AS "bylosId",
       n."bylosNumeris",
       n."bylosRusis",
       n.data         AS "bylosData",
       n.teismas,
       d.kodas        AS "jarKodas",
       j.pavadinimas  AS "dalyvioPavadinimas",
       d.pavadinimas  AS "dalyvioVardasIrPavarde",
       d."bylojeKaip"
FROM "teismoNuosprendziaiDalyviai" d
         JOIN "teismoNuosprendziai" n ON n.id = d."nuosprendzioId"
         LEFT JOIN "jarCsv" j ON j."jarKodas"::text = d.kodas

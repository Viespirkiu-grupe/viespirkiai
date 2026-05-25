CREATE TEMP VIEW v_bylos AS
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
         LEFT JOIN "jarCsv" j ON j."jarKodas"::text = bd.kodas

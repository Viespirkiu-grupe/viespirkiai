-- Skelbimas — one publication event about a procurement.
--
-- A procurement is advertised, corrected, consulted on and awarded through a
-- sequence of published notices. Indicators about advertising, prior
-- publication, market consultation and award timing read this entity rather
-- than the notice row itself.
--
-- Grain: one row per published notice. "skelbimoRaktas" is
-- saltinis || ':' || skelbimoId.
--
-- "skelbimoRusis" is the business classification indicators test against; the
-- raw Lithuanian title stays in "skelbimoTipas" so a reader can verify it. The
-- two source systems word the same notice kind differently, which is exactly
-- why the normalised column exists.

CREATE OR REPLACE VIEW v_skelbimas AS
SELECT 'cvpis:' || s.id::text        AS "skelbimoRaktas",
       'cvpis'                       AS saltinis,
       s."pirkimoId"::text           AS "pirkimoNumeris",
       s.tipas                       AS "skelbimoTipas",
       -- Eiliškumas svarbus: sudėtiniai tipai (pvz. „skelbimas apie pirkimą
       -- arba skelbimas apie projekto konkursą") pirmiausia yra skelbimai apie
       -- pirkimą, todėl ta sąlyga tikrinama anksčiau už projekto konkursą.
       CASE
           WHEN s.tipas ILIKE '%apie sutarties skyrim%'
             OR s.tipas ILIKE '%apie sutarties arba koncesijos skyrim%' THEN 'sutartis'
           WHEN s.tipas ILIKE '%patais%' OR s.tipas ILIKE '%papildom%'  THEN 'pataisa'
           WHEN s.tipas ILIKE '%išankstinis informacinis%'              THEN 'isankstinis'
           WHEN s.tipas ILIKE '%projekto konkurso rezultat%'            THEN 'projektoKonkursoRezultatai'
           WHEN s.tipas ILIKE '%apie pirkim%'                           THEN 'pirkimas'
           WHEN s.tipas ILIKE '%projekto konkurs%'                      THEN 'projektoKonkursas'
           ELSE 'kita'
       END                           AS "skelbimoRusis",
       s."paskelbimoData",
       s."ikelimoData",
       s.statusas,
       s."downloadHref"              AS nuoroda
FROM "eppsViesiejiPirkimai"."skelbimai" s

UNION ALL

SELECT 'cvpp:' || c."skelbimoId"::text AS "skelbimoRaktas",
       'cvpp'                          AS saltinis,
       c."pirkimoId"::text             AS "pirkimoNumeris",
       c."skelbimoTipas",
       CASE
           WHEN c."skelbimoTipas" ILIKE '%ex-ante%'                     THEN 'savanoriskasExAnte'
           WHEN c."skelbimoTipas" ILIKE '%apie sutarties pakeitim%'     THEN 'sutartiesPakeitimas'
           WHEN c."skelbimoTipas" ILIKE '%apie sutarties skyrim%'
             OR c."skelbimoTipas" ILIKE '%apie sutarties arba koncesijos skyrim%'
             OR c."skelbimoTipas" ILIKE '%apie sutarčių sudarym%'       THEN 'sutartis'
           WHEN c."skelbimoTipas" ILIKE '%rinkos konsultacij%'          THEN 'rinkosKonsultacija'
           WHEN c."skelbimoTipas" ILIKE '%techninių specifikacij%'      THEN 'techSpecProjektas'
           WHEN c."skelbimoTipas" ILIKE '%patais%'
             OR c."skelbimoTipas" ILIKE '%neužbaigt%'                   THEN 'pataisa'
           WHEN c."skelbimoTipas" ILIKE '%kvietimas dalyvauti konkurse%'
             OR c."skelbimoTipas" ILIKE '%apie pirkim%'
             OR c."skelbimoTipas" ILIKE '%mažos vertės pirkim%'         THEN 'pirkimas'
           WHEN c."skelbimoTipas" ILIKE '%išankstinis informacinis%'
             OR c."skelbimoTipas" ILIKE '%reguliarus orientacinis%'     THEN 'isankstinis'
           WHEN c."skelbimoTipas" ILIKE '%kvalifikacijos vertinimo sistem%'
                                                                        THEN 'kvalifikacijosSistema'
           WHEN c."skelbimoTipas" ILIKE '%projekto konkurso rezultat%'  THEN 'projektoKonkursoRezultatai'
           WHEN c."skelbimoTipas" ILIKE '%projekto konkurs%'            THEN 'projektoKonkursas'
           ELSE 'kita'
       END                             AS "skelbimoRusis",
       c."issiuntimoData"              AS "paskelbimoData",
       NULL::timestamp                 AS "ikelimoData",
       c.busena                        AS statusas,
       c.link                          AS nuoroda
FROM cvpp."skelbimai" c

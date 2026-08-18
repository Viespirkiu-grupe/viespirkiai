-- Pirkimo planas — one planned procurement, as published by a buyer before
-- any notice exists.
--
-- The plan is the earliest point in the procurement lifecycle and the only
-- evidence that a purchase was foreseen. Indicators about planning
-- transparency and about awards made outside the plan read this entity.
--
-- Grain: one row per planned procurement. "planoRaktas" is the plan's own id
-- as text; a plan has no procurement number, so it links to v_pirkimas only by
-- buyer, object and period, never by key. That is a property of the source,
-- not of this view: the plan register and the notice register are not joined
-- by the Public Procurement Office either.

CREATE OR REPLACE VIEW v_pirkimo_planas AS
SELECT p.id::text                            AS "planoRaktas",
       v."jarKodas"                          AS "pirkejoKodas",
       v.pavadinimas                         AS "pirkejoPavadinimas",
       p."pirkimoPavadinimas"                AS pavadinimas,
       d.aprasymas,
       tipas.pavadinimas                     AS "pirkimoTipas",
       budas.pavadinimas                     AS "pirkimoBudas",
       direktyva.pavadinimas                 AS direktyva,
       d."apskaiciuotaKaina"                 AS "numatomaVerte",
       d.kiekiai,
       d."pirkimoPradziosData",
       d."pasiulymuTeikimoData",
       d."numatomaSutartiesTrukmeMenesiais",
       d."preliminariPirkimoSukurimoData",
       COALESCE(k.kodai, '{}'::text[])       AS "bvpzKodai",
       COALESCE(array_length(k.kodai, 1), 0) AS "bvpzKoduSkaicius"
FROM "planuojamiPirkimai" p
         LEFT JOIN "planuojamiPirkimaiDuomenys" d ON d."pirkimoId" = p.id
         LEFT JOIN "planuojamiPirkimaiVykdytojai" v ON v.id = p."vykdytojoId"
         LEFT JOIN "planuojamiPirkimaiTipai" tipas ON tipas.id = p."pirkimoTipoId"
         LEFT JOIN "planuojamiPirkimaiBudai" budas ON budas.id = p."pirkimoBudoId"
         LEFT JOIN "planuojamiPirkimaiDirektyvos" direktyva ON direktyva.id = p."direktyvosId"
         LEFT JOIN LATERAL (
             SELECT array_agg(b."bvpzKodas"::text) AS kodai
             FROM "planuojamiPirkimaiBvpzKodai" b
             WHERE b."pirkimoId" = p.id
         ) k ON true

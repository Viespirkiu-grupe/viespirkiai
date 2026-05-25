CREATE TEMP VIEW v_person_links AS
SELECT r.id,
       r.deklaracija,
       r.vardas,
       r.pavarde,
       r."susijusioAsmensVardas",
       r."susijusioAsmensPavarde",
       r."jarKodas",
       j.pavadinimas AS "imonesVardas",
       r.pareigos,
       r."irasoTipas",
       r."darbovietesTipas",
       r."rysioPobudzioPavadinimas",
       r."rysioPradzia",
       r."rysioPabaiga",
       r."yraJuridinisAsmuo",
       r."registruotaLietuvoje",
       r."jaTeisinesFormosPavadinimas",
       r."kienoRysys",
       r."dalyvaujaViesuosePirkimuose",
       r."dalyvavimoVpInformacija",
       r."pateikimoData"
FROM "pinregJuridiniaiRysiai" r
         LEFT JOIN "jarCsv" j ON j."jarKodas"::text = r."jarKodas"

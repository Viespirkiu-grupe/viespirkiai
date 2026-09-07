-- rcJar."pateiktuDokumentuTipai"."id": smallint → integer.
--
-- Kodėl: 001 laikė tipų sąrašą uždaru ir mažu (realiai jų 192), tad id buvo
-- smallint. Bet įrašymo sakinys (modules/rcJarDokumentai/irasymas.js) kiekvienam
-- nuskaitytam puslapiui darė `INSERT … SELECT DISTINCT "tipas" … ON CONFLICT
-- DO NOTHING`, o konfliktuojanti eilutė identity sekos reikšmę vis tiek
-- sunaudoja. Po ~20 tūkst. įmonių seka atsirėmė į smallint lubas:
--   nextval: reached maximum value of sequence "pateiktuDokumentuTipai_id_seq"
--            (32767)
-- Pati priežastis – degimas – taisoma kode (`NOT EXISTS` filtras prieš
-- `ON CONFLICT`), bet jau sunaudotų 32 767 reikšmių neatgausi: seka
-- nepersukama, o esamų eilučių id perrašyti nėra prasmės. Todėl stulpelis
-- praplečiamas iki integer ir seka tęsiasi nuo 32 768.
--
-- Aprašymų žodynas (`pateiktuDokumentuAprasymai`) jau buvo integer, tad jam
-- užteko kodo pataisos – seka ten buvo nuėjusi iki 414 067 prie 5 947 eilučių.
--
-- Šis failas po pritaikymo neredaguojamas. Pritaikius: `npm run db:schema:dump`.

BEGIN;

-- Pirma nurodantis stulpelis, kad FK tikrinimas nedirbtų per tipų konversiją.
ALTER TABLE "rcJar"."pateiktiDokumentai"
    ALTER COLUMN "tipasId" TYPE integer;

-- Identity stulpelio tipo keitimas kartu perrašo ir jo sekos duomenų tipą.
ALTER TABLE "rcJar"."pateiktuDokumentuTipai"
    ALTER COLUMN "id" TYPE integer;

COMMIT;

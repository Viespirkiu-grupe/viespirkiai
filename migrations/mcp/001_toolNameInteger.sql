-- mcp."toolName"."id": smallint → integer.
--
-- Kodėl: žodyne realiai 17 eilučių (tiek yra MCP įrankių), tad id buvo
-- smallint. Bet `modules/mcp/mcpLogger.js` KIEKVIENAM įrankio iškvietimui darė
-- `INSERT … ON CONFLICT ("toolName") DO UPDATE`, o konfliktuojanti eilutė
-- identity sekos reikšmę vis tiek sunaudoja. Taigi seka degė po vieną id per
-- toolcall'ą ir 2026-09-01 10:54 atsirėmė į smallint lubas:
--   nextval: reached maximum value of sequence "toolName_id_seq" (32767)
-- Nuo tos akimirkos kiekvienas `logToolCall` krito su 2200H, o klaida buvo
-- ryjama tyliai (catch reagavo tik į 25006), tad žurnalas — ir kartu Quickwit
-- indeksas `mcpToolCalls` — stovėjo 6 paras be jokio signalo.
--
-- Ta pati klaida, kaip migrations/rcJar/002_pateiktuDokumentuTipaiInteger.sql.
-- Pati priežastis – degimas – taisoma kode (`NOT EXISTS` filtras prieš
-- `ON CONFLICT`), bet sunaudotų 32 767 reikšmių neatgausi: seka nepersukama, o
-- esamų eilučių id perrašyti nėra prasmės. Todėl stulpelis praplečiamas iki
-- integer ir seka tęsiasi nuo 32 768.
--
-- `userAgent` ir `errorMsg` žodynai jau integer, tad jiems užtenka kodo
-- pataisos: `userAgent_id_seq` buvo nuėjusi iki 32 775 prie 84 eilučių,
-- `errorMsg_id_seq` – iki 96 prie 88 (ši dega tik per klaidas, tad sveika).
--
-- Šis failas po pritaikymo neredaguojamas. Pritaikius: `npm run db:schema:dump`.

BEGIN;

-- Pirma nurodantis stulpelis, kad FK tikrinimas nedirbtų per tipų konversiją.
ALTER TABLE mcp."toolCalls"
    ALTER COLUMN "toolNameId" TYPE integer;

-- Identity stulpelio tipo keitimas kartu perrašo ir jo sekos duomenų tipą.
ALTER TABLE mcp."toolName"
    ALTER COLUMN "id" TYPE integer;

COMMIT;

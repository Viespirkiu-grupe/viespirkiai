-- Regitros JTP parko duomenų automatinio atnaujinimo schema.
--
-- Repo neturi migracijų karkaso — dbSchema/*.sql yra generuojami dumpai
-- (postgres/dumpSchema.js). Šis failas taikomas RANKOMIS vieną kartą, po to:
--     npm run db:schema:dump
--
-- Taikymas:
--     psql "$DB" -f modules/regitra/schema.sql
--
-- DĖMESIO: 1 žingsnis IŠVALO esamą `regitra` lentelę. Tai sąmoninga — esami
-- duomenys yra viena nuotrauka be `md5` rakto ir be istorinės vertės, o šviežia
-- pilna nuotrauka importuojama iškart po to (`npm run regitra:atnaujinti`).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. regitra — unikalios TP eilutės. Nuo šiol TIK INSERT: eilutės niekada
--    neatnaujinamos ir netrinamos. Tapatybė = `md5` nuo kanoninio eilutės JSON
--    (anonimizuotuose duomenyse nėra nei VIN, nei valst. numerio, todėl pats
--    eilutės turinys IR YRA tapatybė).
-- ---------------------------------------------------------------------------
TRUNCATE TABLE regitra;

ALTER TABLE regitra ADD COLUMN md5 text NOT NULL;
ALTER TABLE regitra ADD CONSTRAINT regitra_pkey PRIMARY KEY (md5);

-- Esami "jarKodas" indeksai (idx_16501_jarKodas,
-- regitra_jarkodas_pirmosiosregistracijosdata_idx) paliekami nepakeisti.

-- ---------------------------------------------------------------------------
-- 2. regitraMatymai — istorija: kada eilutė pirmą/paskutinį kartą matyta.
--    Siaura lentelė, atnaujinama kartą per mėnesį. Aktualus parkas:
--        WHERE "atnaujinimoData" = (naujausia nuotraukos data)
-- ---------------------------------------------------------------------------
CREATE TABLE "regitraMatymai" (
    "md5"             text PRIMARY KEY REFERENCES regitra(md5),
    "pirmaMatytaData" date    NOT NULL,
    "atnaujinimoData" date    NOT NULL,  -- paskutinė nuotrauka, kurioje eilutė buvo
    "kiekis"          integer NOT NULL,  -- kiek vienodų TP toje nuotraukoje
                                         -- (~15 % eilučių yra tikslūs dublikatai —
                                         --  realūs parkai, pvz. 92 vienodi L200)
    "matymuSkaicius"  integer NOT NULL   -- keliose nuotraukose iš viso matyta;
                                         -- palyginus su nuotraukų skaičiumi tarp
                                         -- pirmaMatytaData ir atnaujinimoData
                                         -- matosi, ar eilutė buvo dingusi ir grįžusi
);

CREATE INDEX "regitraMatymai_atnaujinimoData_idx"
    ON "regitraMatymai" ("atnaujinimoData");

-- ---------------------------------------------------------------------------
-- 3. regitraAtnaujinimai — kiekvienos naktinės patikros ir importo žurnalas.
--    Leidžia nedirbti perteklinai: prieš siunčiant 41 MB ZIP palyginamas
--    naujausio įrašo etag / Last-Modified su HEAD atsakymu.
-- ---------------------------------------------------------------------------
CREATE TABLE "regitraAtnaujinimai" (
    "id"               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tikrintaData"     timestamptz NOT NULL DEFAULT now(),
    "etag"             text,          -- serverio ETag
    "pakeitimoData"    timestamptz,   -- serverio Last-Modified
    "dydis"            bigint,        -- Content-Length
    "zipMd5"           text,          -- parsiųsto ZIP md5 (antra apsauga, jei
                                      -- serveris pakeičia etag nepakeitęs turinio)
    "duomenuData"      date,          -- nuotraukos data (iš Last-Modified);
                                      -- ši reikšmė rašoma į regitraMatymai.atnaujinimoData
    "busena"           text NOT NULL, -- 'nepakito' | 'importuota' | 'klaida'
    "eiluciuSkaicius"  integer,       -- eilučių CSV faile
    "unikaliuSkaicius" integer,       -- unikalių md5 toje nuotraukoje
    "naujuSkaicius"    integer,       -- kiek md5 anksčiau nebuvo matyta
    "importuotaData"   timestamptz,
    "klaida"           text,
    CONSTRAINT "regitraAtnaujinimai_busena_check"
        CHECK ("busena" IN ('nepakito', 'importuota', 'klaida'))
);

CREATE INDEX "regitraAtnaujinimai_tikrintaData_idx"
    ON "regitraAtnaujinimai" ("tikrintaData" DESC);

-- ---------------------------------------------------------------------------
-- 4. regitraImportas — laikinas staging vienam importui.
--    UNLOGGED: nerašoma į WAL, todėl 516 tūkst. eilučių sukrenta greitai.
--    LIKE išsaugo tą pačią stulpelių tvarką kaip `regitra` (md5 — paskutinis),
--    todėl veikia `INSERT INTO regitra SELECT DISTINCT ON (md5) * FROM ...`.
--    Sąmoningai BE pirminio rakto — dublikatai čia leidžiami ir suskaičiuojami.
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE "regitraImportas" (LIKE regitra);

COMMIT;

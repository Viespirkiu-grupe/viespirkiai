-- Schema `rcJar`: JAR-ui pateiktų dokumentų registras iš
-- https://www.registrucentras.lt/jar/p/dok.php?kod=<jarKodas> (2026-09).
--
-- Kodėl atskirai nuo esamos `rcJar."dokumentai"`:
--   * `rcJar."dokumentai"` sudėliota iš atvirų duomenų `JAR_DOKUMENTAI_*.csv`.
--     Tie failai apima TIK steigimo dokumentus — `JAR_DOKUMENTAI_2024.csv`
--     (44 255 eil.) turi vien Nuostatus, Steigimo aktus, Įstatus, Steigimo
--     sutartis ir kelis jų pakeitimus; žodyne `rcJar."dokumentuPotipiai"` –
--     17 potipių. `dok.php` tam pačiam juridiniam asmeniui (302676496) rodo
--     45 eilutes vietoje 3: prašymus JAR-1-E, akcininkų sprendimus, sutikimus
--     suteikti patalpas, įgaliojimus, akcininkų sąrašus, užsienio registrų
--     išrašus, finansinės atskaitomybės pateikimus.
--   * Ir techniškai: CSV importas (modules/juridiniai/jarAdditionalImport/scope.js)
--     `DELETE`ina `rcJar."dokumentai"` eilutes pagal importo apimtį, tad
--     scrapinti duomenys ten neišgyventų.
--
-- Ko `dok.php` duoda daugiau už CSV: RC vidinį dokumento ID (`<tr id="tr_…">`,
-- juo dokumentas užsakomas), gavimo datą ir lapų skaičių.
--
-- Šis failas po pritaikymo neredaguojamas — kitas pakeitimas yra naujas
-- migrations/rcJar/002_<vardas>.sql. Pritaikius: `npm run db:schema:dump`.

BEGIN;

-- 1. Žodynai ---------------------------------------------------------------
-- Puslapio stulpelis „Dokumentas / aprašymas" yra dvi dalys, atskirtos pirmu
-- ` / `. Kairė – uždaras dokumento tipų sąrašas, dešinė – laisvas tekstas,
-- kuris irgi masiškai kartojasi („2024 m. finansinė atskaitomybė, aiškinamasis
-- raštas, auditoriaus išvada" – kiekvienai įmonei kasmet). Abu – žodynuose.

CREATE TABLE "rcJar"."pateiktuDokumentuTipai" (
    "id" smallint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "pavadinimas" text NOT NULL
);

COMMENT ON TABLE "rcJar"."pateiktuDokumentuTipai" IS
    'dok.php dokumento tipo žodynas – dalis prieš pirmą „ / " stulpelyje „Dokumentas / aprašymas".';

ALTER TABLE ONLY "rcJar"."pateiktuDokumentuTipai"
    ADD CONSTRAINT "pateiktuDokumentuTipai_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "rcJar"."pateiktuDokumentuTipai"
    ADD CONSTRAINT "pateiktuDokumentuTipai_pavadinimas_key" UNIQUE ("pavadinimas");

CREATE TABLE "rcJar"."pateiktuDokumentuAprasymai" (
    "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
    "pavadinimas" text NOT NULL
);

COMMENT ON TABLE "rcJar"."pateiktuDokumentuAprasymai" IS
    'dok.php dokumento aprašymo žodynas – dalis po pirmo „ / "; laisvas tekstas, bet stipriai pasikartojantis.';

ALTER TABLE ONLY "rcJar"."pateiktuDokumentuAprasymai"
    ADD CONSTRAINT "pateiktuDokumentuAprasymai_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "rcJar"."pateiktuDokumentuAprasymai"
    ADD CONSTRAINT "pateiktuDokumentuAprasymai_pavadinimas_key" UNIQUE ("pavadinimas");

-- 2. Faktų lentelė ---------------------------------------------------------

CREATE TABLE "rcJar"."pateiktiDokumentai" (
    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "jarKodas" integer NOT NULL,
    "rcId" bigint,
    "tipasId" smallint NOT NULL,
    "aprasymasId" integer,
    "dokumentoData" date,
    "gavimoData" date,
    "registravimoData" date,
    "lapuSkaicius" smallint,
    "sukurta" timestamp with time zone DEFAULT now() NOT NULL,
    "matyta" timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE "rcJar"."pateiktiDokumentai" IS
    'Juridinio asmens JAR-ui pateikti dokumentai iš registrucentras.lt/jar/p/dok.php – pilnas sąrašas, kurio atviruose duomenyse nėra. Pačių dokumentų turinys RC mokamas, čia tik metaduomenys.';
COMMENT ON COLUMN "rcJar"."pateiktiDokumentai"."rcId" IS
    'RC vidinis dokumento ID iš eilutės `<tr id="tr_13286314">`; juo dokumentas užsakomas. NULL toms eilutėms, kurios ID neturi (finansinės atskaitomybės pateikimai).';
COMMENT ON COLUMN "rcJar"."pateiktiDokumentai"."matyta" IS
    'Paskutinis nuskaitymas, kuriame eilutė dar buvo puslapyje. Iš RC dingusios eilutės netrinamos – jos tiesiog atsilieka nuo rcJar."dokumentuEile"."nuskaityta".';

ALTER TABLE ONLY "rcJar"."pateiktiDokumentai"
    ADD CONSTRAINT "pateiktiDokumentai_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "rcJar"."pateiktiDokumentai"
    ADD CONSTRAINT "pateiktiDokumentai_tipas_fk" FOREIGN KEY ("tipasId")
        REFERENCES "rcJar"."pateiktuDokumentuTipai"("id");
ALTER TABLE ONLY "rcJar"."pateiktiDokumentai"
    ADD CONSTRAINT "pateiktiDokumentai_aprasymas_fk" FOREIGN KEY ("aprasymasId")
        REFERENCES "rcJar"."pateiktuDokumentuAprasymai"("id");
ALTER TABLE ONLY "rcJar"."pateiktiDokumentai"
    ADD CONSTRAINT "pateiktiDokumentai_jarKodas_check"
        CHECK ("jarKodas" >= 100000000 AND "jarKodas" <= 999999999);

-- Du atskiri unikalūs indeksai, nes eilutės skirstosi į dvi rūšis. Turinčioms
-- RC ID jis pats yra raktas; neturinčioms tenka lyginti visą eilutę.
-- Įrašymas (modules/rcJarDokumentai/irasymas.js) dėl to daro du INSERT'us.
CREATE UNIQUE INDEX "pateiktiDokumentai_rcId_key"
    ON "rcJar"."pateiktiDokumentai" USING btree ("rcId")
    WHERE "rcId" IS NOT NULL;
CREATE UNIQUE INDEX "pateiktiDokumentai_beRcId_key"
    ON "rcJar"."pateiktiDokumentai" USING btree
        ("jarKodas", "tipasId", "aprasymasId", "dokumentoData", "gavimoData", "registravimoData")
    NULLS NOT DISTINCT
    WHERE "rcId" IS NULL;
CREATE INDEX "pateiktiDokumentai_jarKodas_idx"
    ON "rcJar"."pateiktiDokumentai" USING btree ("jarKodas", "registravimoData" DESC);
CREATE INDEX "pateiktiDokumentai_registravimoData_brin_idx"
    ON "rcJar"."pateiktiDokumentai" USING brin ("registravimoData");

-- 3. Nuskaitymo eilė -------------------------------------------------------
-- Po eilutę kiekvienam JAR kodui; „eilė" ir „būsena" ta pati lentelė, nes
-- kiekvienas kodas perskaitomas amžinai, tik vis kitu laiku.
-- FK į rcJar."asmenys" sąmoningai nededamas: tą lentelę perrašo CSV importas,
-- o nutrūkstantis FK jį stabdytų. Nebeegzistuojantys kodai iškrenta patys
-- (dok.php grąžina „Įrašų nerasta"), o naujus prideda papildytiEile.js.

CREATE TABLE "rcJar"."dokumentuEile" (
    "jarKodas" integer NOT NULL,
    "nextAttempt" timestamp with time zone DEFAULT now() NOT NULL,
    "nuskaityta" timestamp with time zone,
    "bandymai" smallint DEFAULT 0 NOT NULL,
    "klaida" text,
    "eiluciuRasta" integer
);

COMMENT ON TABLE "rcJar"."dokumentuEile" IS
    'dok.php nuskaitymo eilė ir būsena – po eilutę kiekvienam JAR kodui. Sėkmė nustumia "nextAttempt" per RC_JAR_DOKUMENTAI_INTERVAL_DAYS, klaida – eksponentiškai.';
COMMENT ON COLUMN "rcJar"."dokumentuEile"."bandymai" IS
    'Iš eilės einančių nesėkmių skaičius; po sėkmės nunulinamas.';
COMMENT ON COLUMN "rcJar"."dokumentuEile"."eiluciuRasta" IS
    'Kiek dokumentų eilučių puslapyje matyta paskutinį kartą; 0 – „Įrašų nerasta" (normalu).';

ALTER TABLE ONLY "rcJar"."dokumentuEile"
    ADD CONSTRAINT "dokumentuEile_pkey" PRIMARY KEY ("jarKodas");

CREATE INDEX "dokumentuEile_nextAttempt_idx"
    ON "rcJar"."dokumentuEile" USING btree ("nextAttempt");

-- 4. Teisės ----------------------------------------------------------------
-- `rcJar` schemoje pg_default_acl įrašo nėra, tad naujoms lentelėms teisės
-- duodamos rankomis – toks pat rinkinys, kaip ant rcJar."dokumentai".

GRANT SELECT ON
    "rcJar"."pateiktiDokumentai",
    "rcJar"."pateiktuDokumentuTipai",
    "rcJar"."pateiktuDokumentuAprasymai",
    "rcJar"."dokumentuEile"
    TO kiaurastekinis, "viespirkiaiDev", viesduomenys;

COMMIT;

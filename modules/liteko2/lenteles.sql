-- LITEKO2 (https://liteko-api-pub.teismas.lt) lentelės.
--
-- Atskiros nuo `teismoNuosprendziai` (LITEKO1 HTML scraperio) — šaltinis kitas,
-- identifikatoriai kiti (liteko2Id), o metaduomenų kur kas daugiau. LITEKO1
-- lieka istorijai (iki 2026-05), LITEKO2 – naujiems sprendimams.
--
-- Normalizacija: sprendimų lentelėje kartojosi teismo, rūmų, bylos rūšies,
-- sprendimo tipo, kategorijų ir vaidmenų pavadinimai. Visi jie iškelti į
-- žodynus, o sprendimai laiko tik `*Id`. Matuota per API (1292 sprendimai):
-- 20 teismų, 26 rūmai, 4 bylų rūšys, 4 sprendimų tipai, 264 kategorijos
-- (pavadinimai su klasifikatoriumi sutampa 100 %), 15 dalyvio vaidmenų,
-- 74 teisėjai (id ↔ vardas 1:1). Rodymui reikia JOIN'ų – tam yra
-- `liteko2SprendimaiView` failo apačioje.
--
-- Idempotentiška: galima paleisti kelis kartus.
--   psql "$DSN" -f modules/liteko2/lenteles.sql

-- ─────────────────────────────────────────────────────────────────────────
-- Klasifikatoriai (/v1/classifiers/*) — sinchronizuoja klasifikatoriai.js.
-- Sprendimai į juos rodo per tekstinį `liteko2Id`; FK sąmoningai nėra, kad
-- vėluojantis klasifikatorių sinchras nestabdytų sprendimų nuskaitymo.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."liteko2Teismai" (
    "liteko2Id"     text PRIMARY KEY,
    "saltinioId"    text,
    "kodas"         text,
    "pavadinimas"   text NOT NULL,
    "tevinisId"     text,
    "tipas"         text,
    "aktyvus"       boolean,
    "aktyvusNuo"    date,
    "neaktyvusNuo"  date,
    "atnaujinta"    timestamp with time zone DEFAULT now() NOT NULL
);

-- Sąrašo endpoint'as duoda tik pavadinimus (be id), todėl inventoriaus žingsnis
-- teismą randa pagal pavadinimą — indeksas privalo būti unikalus.
CREATE UNIQUE INDEX IF NOT EXISTS "liteko2Teismai_pavadinimas_key"
    ON public."liteko2Teismai" USING btree ("pavadinimas");

CREATE TABLE IF NOT EXISTS public."liteko2ByluRusys" (
    "liteko2Id"     text PRIMARY KEY,
    "saltinioId"    text,
    "pavadinimas"   text NOT NULL,
    "atnaujinta"    timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "liteko2ByluRusys_pavadinimas_key"
    ON public."liteko2ByluRusys" USING btree ("pavadinimas");

CREATE TABLE IF NOT EXISTS public."liteko2DokumentuTipai" (
    "liteko2Id"     text PRIMARY KEY,
    "saltinioId"    text,
    "pavadinimas"   text NOT NULL,
    "atnaujinta"    timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "liteko2DokumentuTipai_pavadinimas_key"
    ON public."liteko2DokumentuTipai" USING btree ("pavadinimas");

CREATE TABLE IF NOT EXISTS public."liteko2Kategorijos" (
    "liteko2Id"         text PRIMARY KEY,
    "saltinioId"        text,
    "kodas"             text,
    "pavadinimas"       text NOT NULL,
    "tevineKategorija"  text,
    "bylosRusiesId"     text,
    "atnaujinta"        timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "liteko2Kategorijos_tevineKategorija_idx"
    ON public."liteko2Kategorijos" USING btree ("tevineKategorija");

-- Teisėjų klasifikatoriaus API neturi — žodynas pildomas iš sprendimų
-- (`decisionJudges`), kur `id` ↔ „<kodas> <Vardas Pavardė>" susiejimas 1:1.
CREATE TABLE IF NOT EXISTS public."liteko2Teisejai" (
    "liteko2Id"     text PRIMARY KEY,
    "kodas"         text,
    "vardas"        text,
    "atnaujinta"    timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "liteko2Teisejai_vardas_idx"
    ON public."liteko2Teisejai" USING btree ("vardas");

-- Dalyvio vaidmuo byloje („Trečiasis suinteresuotas asmuo" ir pan.) — 15 ilgokų
-- tekstų, kartojamų kiekvienoje šalies eilutėje.
CREATE TABLE IF NOT EXISTS public."liteko2Vaidmenys" (
    "id"            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas"   text NOT NULL,
    CONSTRAINT "liteko2Vaidmenys_pavadinimas_key" UNIQUE ("pavadinimas")
);

-- ─────────────────────────────────────────────────────────────────────────
-- Sprendimai (/v1/decisions ir /v1/decisions/{liteko2Id})
--
-- `turinioNuskaitymas`: 0 – nenuskaityta; teigiamas – sėkmingo nuskaitymo
-- versija (scrapeContent.js TURINIO_VERSIJA); -1 – klaida; -2 – vykdoma.
-- `md5` – stabilus raktas sidecar'ui ir būsimam `public.dokumentai` įrašui:
-- md5('liteko2:' || "liteko2Id").
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."liteko2Sprendimai" (
    "id"                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "liteko2Id"             text NOT NULL,
    "saltinioId"            text,
    "md5"                   text NOT NULL,
    "teismoId"              text,
    "rumuId"                text,
    "bylosRusiesId"         text,
    "sprendimoTipoId"       text,
    "bylosNumeris"          text,
    "bylosEilesNr"          text,
    "teisminisProcesoNr"    text,
    "bylaGauta"             date,
    "bylosAprasymas"        text,
    "sprendimoData"         timestamp with time zone,
    "busena"                text,
    "atsauktas"             boolean DEFAULT false NOT NULL,
    "atsauktasAptiktas"     timestamp with time zone,
    "turinioNuskaitymas"    integer DEFAULT 0 NOT NULL,
    "turinioMd5"            text,
    "klaida"                text,
    "sukurta"               timestamp with time zone DEFAULT now() NOT NULL,
    "atnaujinta"            timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "liteko2Sprendimai_liteko2Id_key" UNIQUE ("liteko2Id"),
    CONSTRAINT "liteko2Sprendimai_md5_key" UNIQUE ("md5")
);

CREATE INDEX IF NOT EXISTS "liteko2Sprendimai_sprendimoData_idx"
    ON public."liteko2Sprendimai" USING btree ("sprendimoData" DESC);
CREATE INDEX IF NOT EXISTS "liteko2Sprendimai_bylosNumeris_idx"
    ON public."liteko2Sprendimai" USING btree ("bylosNumeris");
CREATE INDEX IF NOT EXISTS "liteko2Sprendimai_teisminisProcesoNr_idx"
    ON public."liteko2Sprendimai" USING btree ("teisminisProcesoNr");
CREATE INDEX IF NOT EXISTS "liteko2Sprendimai_teismoId_idx"
    ON public."liteko2Sprendimai" USING btree ("teismoId");
-- Eilė turinio nuskaitymui: nenuskaityti, senesnės versijos ir pakibę (-2) įrašai.
CREATE INDEX IF NOT EXISTS "liteko2Sprendimai_turinioEile_idx"
    ON public."liteko2Sprendimai" USING btree ("turinioNuskaitymas", "sprendimoData" DESC)
    WHERE ("turinioNuskaitymas" >= -2 AND "atsauktas" = false);

-- ─────────────────────────────────────────────────────────────────────────
-- Sprendimo vaikai — perrašomi (DELETE + INSERT) kiekvieno turinio nuskaitymo
-- metu, todėl surogatinių raktų nereikia: PK yra pati sąsaja.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."liteko2SprendimuDalyviai" (
    "id"            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "sprendimoId"   bigint NOT NULL
        REFERENCES public."liteko2Sprendimai"("id") ON DELETE CASCADE,
    "liteko2Id"     text,
    "saltinioId"    text,
    "vaidmuoId"     smallint REFERENCES public."liteko2Vaidmenys"("id"),
    -- Pavadinimas ir kodas lieka eilutėje: 218 dalyvių → 180 unikalių vardų,
    -- o dalis fizinių asmenų iš viso be kodo, tad atskiro asmenų žodyno raktas
    -- būtų nepatikimas.
    "pavadinimas"   text,
    "kodas"         text,
    -- Denormalizuota sprendimo data, kad paieška pagal kodą apsieitų be JOIN.
    "data"          date
);

CREATE INDEX IF NOT EXISTS "liteko2SprendimuDalyviai_sprendimoId_idx"
    ON public."liteko2SprendimuDalyviai" USING btree ("sprendimoId");
CREATE INDEX IF NOT EXISTS "liteko2SprendimuDalyviai_kodas_data_idx"
    ON public."liteko2SprendimuDalyviai" USING btree ("kodas", "data" DESC)
    INCLUDE ("sprendimoId");

CREATE TABLE IF NOT EXISTS public."liteko2SprendimuTeisejai" (
    "sprendimoId"   bigint NOT NULL
        REFERENCES public."liteko2Sprendimai"("id") ON DELETE CASCADE,
    "teisejoId"     text NOT NULL REFERENCES public."liteko2Teisejai"("liteko2Id"),
    PRIMARY KEY ("sprendimoId", "teisejoId")
);

CREATE INDEX IF NOT EXISTS "liteko2SprendimuTeisejai_teisejoId_idx"
    ON public."liteko2SprendimuTeisejai" USING btree ("teisejoId");

CREATE TABLE IF NOT EXISTS public."liteko2SprendimuKategorijos" (
    "sprendimoId"   bigint NOT NULL
        REFERENCES public."liteko2Sprendimai"("id") ON DELETE CASCADE,
    -- Pavadinimo čia nelaikom: `liteko2Kategorijos` jį turi ir jie sutampa 1:1.
    "kategorijosId" text NOT NULL,
    PRIMARY KEY ("sprendimoId", "kategorijosId")
);

CREATE INDEX IF NOT EXISTS "liteko2SprendimuKategorijos_kategorijosId_idx"
    ON public."liteko2SprendimuKategorijos" USING btree ("kategorijosId");

-- Failai (docx / html / paveikslėliai). `url` nesaugom — jis visada yra
-- /v1/decisions/<liteko2Id>/files/<urlencode(failoVardas)>. Turinys DB
-- nepatenka: html tekstas keliauja į sidecar (modules/liteko2/sidecar.js).
CREATE TABLE IF NOT EXISTS public."liteko2SprendimuFailai" (
    "sprendimoId"   bigint NOT NULL
        REFERENCES public."liteko2Sprendimai"("id") ON DELETE CASCADE,
    "failoVardas"   text NOT NULL,
    "dydis"         bigint,
    "contentType"   text,
    "md5"           text,
    PRIMARY KEY ("sprendimoId", "failoVardas")
);

-- ─────────────────────────────────────────────────────────────────────────
-- `atnaujinta` trigeris.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.liteko2_set_atnaujinta()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW."atnaujinta" = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "liteko2Sprendimai_set_atnaujinta" ON public."liteko2Sprendimai";
CREATE TRIGGER "liteko2Sprendimai_set_atnaujinta"
    BEFORE UPDATE ON public."liteko2Sprendimai"
    FOR EACH ROW EXECUTE FUNCTION public.liteko2_set_atnaujinta();

-- ─────────────────────────────────────────────────────────────────────────
-- Patogumo vaizdas: sprendimas su išskleistais žodynų pavadinimais.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public."liteko2SprendimaiView" AS
SELECT s.*,
       t."pavadinimas"  AS "teismas",
       r."pavadinimas"  AS "rumai",
       br."pavadinimas" AS "bylosRusis",
       dt."pavadinimas" AS "sprendimoTipas"
FROM public."liteko2Sprendimai" s
LEFT JOIN public."liteko2Teismai" t        ON t."liteko2Id"  = s."teismoId"
LEFT JOIN public."liteko2Teismai" r        ON r."liteko2Id"  = s."rumuId"
LEFT JOIN public."liteko2ByluRusys" br     ON br."liteko2Id" = s."bylosRusiesId"
LEFT JOIN public."liteko2DokumentuTipai" dt ON dt."liteko2Id" = s."sprendimoTipoId";

-- ─────────────────────────────────────────────────────────────────────────
-- Ateičiai: kai sprendimai propaguosis į public.dokumentai (source = 'liteko2'),
-- reikės tokio paties dalinio unikalaus indekso, kokį turi 'liteko':
--
--   CREATE UNIQUE INDEX dokumentai_liteko2_md5 ON public.dokumentai
--       USING btree (md5) WHERE (source = 'liteko2'::text);
-- ─────────────────────────────────────────────────────────────────────────

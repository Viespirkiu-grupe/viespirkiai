-- Test-only fixture tables: just the columns the risk indicators' collect.sql
-- statements and the Procurement Reader read, reproduced from the real column
-- types (see dbSchema/, generated via `npm run db:schema:dump` against the
-- real database). No FKs to unrelated tables, no triggers, no generated/
-- search columns — this schema exists only so each indicator's collect.it.ts
-- and test/risk/procurementReader.it.ts can run the real statements
-- (public.v_pirkimas + public.v_pirkimo_dalis + public.v_dalyviai, applied on
-- top of this file by the test setup) against fixture rows, per
-- docs/indicators-story/risk-service-architecture-v2.md.
--
-- The real database has since moved most of these out of `public` into a
-- schema per source system — ATN-1/PPA procedure-completion reports into
-- `ppa` (buvę public."xlsxPPA*"), CVP IS notices into `eppsViesiejiPirkimai`
-- (buvę public."viesiejiPirkimai*"), the CVPP archive into `cvpp`, and the RC
-- JAR register into `rcJar` (buvęs public."jarAsmenys"). The _v2 views read
-- them there, so the fixtures below have to live there too; only
-- public."vpmSutartys" is still a public table in the real database.
--
-- The schemas themselves are created by 000_grants.sql, which runs as admin:
-- risk_rw holds no CREATE on this database.
--
-- This file is applied only to the local risk-dev Postgres container, never
-- to the real database.

CREATE TABLE IF NOT EXISTS "eppsViesiejiPirkimai"."pirkimai" (
    "pavadinimas"                text,
    "pirkimoId"                  integer NOT NULL UNIQUE,
    "pirkimoVykdytojas"          text,
    "informacija"                text,
    "paskelbimoData"             timestamp without time zone,
    "pasiulymuPateikimoTerminas" timestamp without time zone,
    "pirkimoBudas"               text,
    "statusas"                   text,
    "zingsnis"                   text,
    "numatomaVerteEUR"           numeric,
    "bvpzKodai"                  text[],
    "pirkimoObjektoTipas"        text,
    "esFinansavimas"             boolean,
    "pirkimoVykdytojasId"        text,
    "jarKodas"                   text
);

CREATE TABLE IF NOT EXISTS "eppsViesiejiPirkimai"."vykdytojai" (
    "id"           text PRIMARY KEY,
    "pavadinimas"  text,
    "trumpinys"    text,
    "miestas"      text
);

CREATE TABLE IF NOT EXISTS "eppsViesiejiPirkimai"."dalys" (
    "id"           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pirkimoId"    integer NOT NULL REFERENCES "eppsViesiejiPirkimai"."pirkimai" ("pirkimoId") ON DELETE CASCADE,
    "rusis"        text NOT NULL,
    "numeris"      integer,
    "pavadinimas"  text
);

CREATE TABLE IF NOT EXISTS cvpp."archyvoSkelbimai" (
    "skelbimoKodas"              text PRIMARY KEY,
    "pavadinimas"                text,
    "pirkimoVykdytojas"          text,
    "skelbimoTipas"              text,
    "pirkimoNumeris"             text,
    "pasiulymuPateikimoTerminas" date,
    "paskelbimoData"             date,
    "link"                       text
);

CREATE TABLE IF NOT EXISTS public."vpmSutartys" (
    "unikalusId"                        bigint PRIMARY KEY,
    "perkanciosiosOrganizacijosKodas"   text,
    "pirkimoNumeris"                    text,
    "sudarymoData"                      date,
    "istrinta"                          boolean DEFAULT false NOT NULL
);

-- xlsxPPA* — v_dalyviai.sql's real source tables (ATN-1/PPA reports).
-- Lookup tables first, referenced by the report/rejection tables below.

CREATE TABLE IF NOT EXISTS "ppa"."pirkimoBudai" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "ppa"."salys" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "ppa"."atmetimoPriezastys" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "ppa"."atmestuPasiulymuStatusai" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "ppa"."atmetimoTeisiniaiPagrindai" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "ppa"."ataskaitos" (
    "id"                                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pirkimoNumeris"                    text,
    "pirkimoObjektoPavadinimas"         text,
    "perkanciosiosOrganizacijosKodas"   text,
    "pagrindinisKodasBvpz"              text,
    "daliuSkaicius"                     integer,
    "pirkimoBudasId"                    integer REFERENCES "ppa"."pirkimoBudai" (id),
    "interesuKonfliktasNustatytas"      boolean,
    "interesuKonfliktoPriemones"        text,
    "konkurencijaIskreipiantisAsmuo"    boolean,
    "konkurencijosPriemones"            text,
    "pretenzijaPateikta"                boolean,
    "ieskinysTeismui"                   boolean,
    "preliminariSutartis"               boolean,
    "elektroninisPirkimas"              boolean,
    "sukurtaAt"                         timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ppa"."dalyviai" (
    "id"            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"   bigint NOT NULL REFERENCES "ppa"."ataskaitos" (id) ON DELETE CASCADE,
    "fizinisAsmuo"  boolean,
    "kodas"         text,
    "salisId"       integer REFERENCES "ppa"."salys" (id)
);

CREATE TABLE IF NOT EXISTS "ppa"."pasiulymuEile" (
    "id"             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"    bigint NOT NULL REFERENCES "ppa"."ataskaitos" (id) ON DELETE CASCADE,
    "daliesNumeris"  text,
    "eileNumeris"    integer,
    "dalyvioKodas"   text,
    "kaina"          text
);

CREATE TABLE IF NOT EXISTS "ppa"."atmestiPasiulymai" (
    "id"                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"            bigint NOT NULL REFERENCES "ppa"."ataskaitos" (id) ON DELETE CASCADE,
    "daliesNumeris"          text,
    "dalyvioKodas"           text,
    "atmetimoPriezastysId"   integer REFERENCES "ppa"."atmetimoPriezastys" (id),
    "statusasId"             integer REFERENCES "ppa"."atmestuPasiulymuStatusai" (id),
    "atmetimoTeisinisPagrindasId" integer REFERENCES "ppa"."atmetimoTeisiniaiPagrindai" (id),
    "pasiulymoKaina"         text
);

CREATE TABLE IF NOT EXISTS "ppa"."proceduruPabaiga" (
    "id"                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"            bigint NOT NULL REFERENCES "ppa"."ataskaitos" (id) ON DELETE CASCADE,
    "daliesNumeris"          text,
    "proceduruPabaiga"       text,
    "sprendimoPriemimoData"  date,
    "sprendimoPriezastys"    text
);

CREATE TABLE IF NOT EXISTS "rcJar"."asmenys" (
    "jarKodas"     integer PRIMARY KEY,
    "pavadinimas"  text NOT NULL
);

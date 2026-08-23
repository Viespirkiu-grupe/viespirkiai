-- Test-only `public` tables: just the columns the risk indicators' collect.sql
-- statements and the Procurement Reader read, reproduced from the real column
-- types (see dbSchema/, generated via `npm run db:schema:dump` against the
-- real database). No FKs to unrelated tables, no triggers, no generated/
-- search columns — this schema exists only so each indicator's collect.it.ts
-- and test/risk/procurementReader.it.ts can run the real statements
-- (public.v_pirkimas + public.v_pirkimo_dalis + public.v_dalyviai, applied on
-- top of this file by the test setup) against fixture rows, per
-- docs/indicators-story/risk-service-architecture-v2.md.
--
-- The xlsxPPA* tables reproduce v_dalyviai.sql's real source (the ATN-1/PPA
-- procedure-completion reports) — the real database renamed these from an
-- earlier atn1* naming; see the note in test/risk/testPublicDb.ts.
--
-- This file is applied only to the local risk-dev Postgres container, never
-- to the real database.

CREATE TABLE IF NOT EXISTS public."viesiejiPirkimai" (
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

CREATE TABLE IF NOT EXISTS public."viesiejiPirkimaiVykdytojai" (
    "id"           text PRIMARY KEY,
    "pavadinimas"  text,
    "trumpinys"    text,
    "miestas"      text
);

CREATE TABLE IF NOT EXISTS public."viesiejiPirkimaiDalys" (
    "id"           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pirkimoId"    integer NOT NULL REFERENCES "viesiejiPirkimai" ("pirkimoId") ON DELETE CASCADE,
    "rusis"        text NOT NULL,
    "numeris"      integer,
    "pavadinimas"  text
);

CREATE TABLE IF NOT EXISTS public."cvppViesiejiPirkimai" (
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
    "istrinta"                          boolean DEFAULT false NOT NULL
);

-- xlsxPPA* — v_dalyviai.sql's real source tables (ATN-1/PPA reports).
-- Lookup tables first, referenced by the report/rejection tables below.

CREATE TABLE IF NOT EXISTS public."xlsxPPApirkimoBudai" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public."xlsxPPAsalys" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public."xlsxPPAatmetimoPriezastys" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public."xlsxPPAatmestuPasiulymuStatusai" (
    "id"          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pavadinimas" text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public."xlsxPPAataskaitos" (
    "id"                                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pirkimoNumeris"                    text,
    "pirkimoObjektoPavadinimas"         text,
    "perkanciosiosOrganizacijosKodas"   text,
    "pagrindinisKodasBvpz"              text,
    "daliuSkaicius"                     integer,
    "pirkimoBudasId"                    integer REFERENCES "xlsxPPApirkimoBudai" (id),
    "interesuKonfliktasNustatytas"      boolean,
    "interesuKonfliktoPriemones"        text,
    "konkurencijaIskreipiantisAsmuo"    boolean,
    "konkurencijosPriemones"            text,
    "pretenzijaPateikta"                boolean,
    "ieskinysTeismui"                   boolean,
    "sukurtaAt"                         timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."xlsxPPAdalyviai" (
    "id"            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"   bigint NOT NULL REFERENCES "xlsxPPAataskaitos" (id) ON DELETE CASCADE,
    "fizinisAsmuo"  boolean,
    "kodas"         text,
    "salisId"       integer REFERENCES "xlsxPPAsalys" (id)
);

CREATE TABLE IF NOT EXISTS public."xlsxPPApasiulymuEile" (
    "id"             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"    bigint NOT NULL REFERENCES "xlsxPPAataskaitos" (id) ON DELETE CASCADE,
    "daliesNumeris"  text,
    "eileNumeris"    integer,
    "dalyvioKodas"   text,
    "kaina"          text
);

CREATE TABLE IF NOT EXISTS public."xlsxPPAatmestiPasiulymai" (
    "id"                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"            bigint NOT NULL REFERENCES "xlsxPPAataskaitos" (id) ON DELETE CASCADE,
    "daliesNumeris"          text,
    "dalyvioKodas"           text,
    "atmetimoPriezastysId"   integer REFERENCES "xlsxPPAatmetimoPriezastys" (id),
    "statusasId"             integer REFERENCES "xlsxPPAatmestuPasiulymuStatusai" (id)
);

CREATE TABLE IF NOT EXISTS public."jarAsmenys" (
    "jarKodas"     integer PRIMARY KEY,
    "pavadinimas"  text NOT NULL
);

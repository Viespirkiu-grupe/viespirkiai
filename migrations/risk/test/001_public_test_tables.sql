-- Test-only `public` tables: just the columns LT-COM-01's calculate.sql
-- reads, reproduced from the real column types (see dbSchema/, generated via
-- `npm run db:schema:dump` against the real database). No FKs to unrelated
-- tables, no triggers, no generated/search columns — this schema exists only
-- so modules/risk/indicators/LT-COM-01/calculate.test.ts can run the real
-- SQL (public.v_pirkimas + public.v_dalyviai, applied on top of this file by
-- the test setup) against fixture rows, per risk-service-architecture.md §11
-- ("tests exercise the calculation through the same evaluation context the
-- run job supplies").
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

CREATE TABLE IF NOT EXISTS public."atn1ataskaitos" (
    "id"                                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "pirkimoNumeris"                    text,
    "pirkimoObjektoPavadinimas"         text,
    "perkanciosiosOrganizacijosKodas"   text,
    "pagrindinisKodasBvpz"              text,
    "daliuSkaicius"                     integer,
    "pirkimoBudas"                      text,
    "interesuKonfliktasNustatytas"      boolean,
    "interesuKonfliktoPriemones"        text,
    "konkurencijaIskreipiantisAsmuo"    boolean,
    "konkurencijosPriemones"            text,
    "pretenzijaPateikta"                boolean,
    "ieskinysTeismui"                   boolean,
    "sukurtaAt"                         timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."atn1dalyviai" (
    "id"           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"  bigint NOT NULL REFERENCES public."atn1ataskaitos" (id) ON DELETE CASCADE,
    "fizinisAsmuo" boolean,
    "kodas"        text,
    "salis"        text
);

CREATE TABLE IF NOT EXISTS public."atn1pasiulymuEile" (
    "id"              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"      bigint NOT NULL REFERENCES public."atn1ataskaitos" (id) ON DELETE CASCADE,
    "daliesNumeris"    text,
    "eileNumeris"      integer,
    "dalyvioKodas"     text,
    "kaina"            text
);

CREATE TABLE IF NOT EXISTS public."atn1atmestiPasiulymai" (
    "id"             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ataskaitaId"    bigint NOT NULL REFERENCES public."atn1ataskaitos" (id) ON DELETE CASCADE,
    "daliesNumeris"  text,
    "dalyvioKodas"   text,
    "statusas"       text
);

CREATE TABLE IF NOT EXISTS public."jarAsmenys" (
    "jarKodas"     integer PRIMARY KEY,
    "pavadinimas"  text NOT NULL
);

-- Schema `vpmSutartys`, 1 revizija: 19 `public."vpmSutartys*"` lentelių
-- perkeliamos į jau egzistuojančią `vpmSutartys` schemą ir joms nuimamas
-- prefiksas – schema vardą jau pasako (ta pati konvencija kaip
-- migrations/risk/001_risk.sql ir kaip jau esančiose vpmSutartys."atviriDuomenys",
-- vpmSutartys."objektuPavadinimai").
--
-- Perkėlimas yra tik katalogo operacija: duomenys nejudinami, indeksai
-- neperkuriami. 8,7 GB duomenų (public."vpmSutartys" 2961 MB,
-- "vpmSutartysSearch" 3171 MB, "vpmSutartysAtnaujinimai" 974 MB ir kt.)
-- lieka vietoje – ALTER'iai trunka milisekundes, bet kiekvienam reikia
-- ACCESS EXCLUSIVE užrakto, tad taikyti reikia be aktyvių scrape/index
-- darbų (žr. „Taikymas“ apačioje).
--
-- Kartu su lentele automatiškai persikelia: indeksai, constraint'ai,
-- identity sekos, trigeriai ir lentelių GRANT'ai (schemos USAGE roles
-- admin/viespirkiai/kiaurastekinis/viespirkiaiDev/viesduomenys/analyst jau
-- turi). public."v_pirkimas" ir kiti view'ai lentelę seka pagal OID, tad
-- nenulūžta – tik jų definicija ims rodyti naują vardą.
--
-- Kas NEpersikelia savaime ir sutvarkoma žemiau: objektų vardai (§2),
-- trigerių vardai (§3), funkcijų kūnuose įrašyti lentelių vardai (§4),
-- dba."lenteles" registras (§5).
--
-- SĄMONINGAI PALIKTA: public.enqueue_vpm_sutartis_adp(),
-- public.vpm_sutartys_index_queue_trigger(), public.sutartys_pavadinimai_maintain()
-- ir public.sutartys_atviri_adp_queue_trigger() lieka `public` schemoje –
-- perkeliamos tik lentelės. Funkcijų perkėlimas – atskira migracija, jei prireiks.
--
-- Taikymas (rankomis, kaip ir risk migracijos) — BŪTINA `admin` role:
-- lentelės, trigerių funkcijos ir dba."lenteles" priklauso jai, o programos
-- rolė `viespirkiai` (PG_USER) čia gauna „must be owner of table" klaidą.
--   psql -h $PG_DIRECT_HOST -p $PG_DIRECT_PORT -U admin -d $PG_DATABASE \
--        -v ON_ERROR_STOP=1 -f migrations/vpmSutartys/001_isPublic.sql
-- Prieš tai sustabdyti task runner'į (scrape, indexQueue, ADP eilė), kad
-- ACCESS EXCLUSIVE užraktas nelauktų ilgų transakcijų.
--
-- Kodo pusė jau pertvarkyta kartu su šia migracija (suderinamumo view'ų
-- `public` schemoje SĄMONINGAI nepaliekama, tad kodas ir migracija
-- deploy'inami kartu):
--   * visos užklausos rašo "vpmSutartys"."<lentelė>";
--   * analyst (MCP execute_query) VPT sutarčių žalios lentelės nebemato:
--     schema-kvalifikuoti vardai jam draudžiami, o nekvalifikuotas `sutartys`
--     search_path'e reiškia SABIS registrą (`sabis` eina pirmiau), tad
--     "vpmSutartys" išimtas iš TABLE_WHITELIST — dengia `v_sutartys` view'as,
--     į kurį nukreipia get_schema;
--   * `v_*` view'ai lieka kaip buvę — po SET SCHEMA jie seka lentelę per OID,
--     o jų DDL failai atnaujinti kitam `ensureViews` paleidimui.

BEGIN;

SET LOCAL lock_timeout = '30s';        -- nelaukiam už ilgos transakcijos
SET LOCAL statement_timeout = '10min';

-- 1. Lentelių perkėlimas ir pervadinimas -------------------------------------
--
-- Vardų atitikmenys (senas -> naujas); tvarka nesvarbi, FK'ai seka OID'ą.

ALTER TABLE public."vpmSutartys"                     SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysAdpQueue"             SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysAprasymai"            SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysAprasymaiQueue"       SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysAtnaujinimai"         SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysBrokas"               SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysChanges"              SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysFailai"               SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysIndexQueue"           SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysKategorijos"          SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysPapildomiBvpzKodai"   SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysPapildomiTiekejai"    SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysSalys"                SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysSearch"               SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysSudarymoDatos"        SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysSumos"                SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysSumosMetai"           SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysSumosPirkejasTiekejas" SET SCHEMA "vpmSutartys";
ALTER TABLE public."vpmSutartysTipai"                SET SCHEMA "vpmSutartys";

ALTER TABLE "vpmSutartys"."vpmSutartys"                     RENAME TO "sutartys";
ALTER TABLE "vpmSutartys"."vpmSutartysAdpQueue"             RENAME TO "adpQueue";
ALTER TABLE "vpmSutartys"."vpmSutartysAprasymai"            RENAME TO "aprasymai";
ALTER TABLE "vpmSutartys"."vpmSutartysAprasymaiQueue"       RENAME TO "aprasymaiQueue";
ALTER TABLE "vpmSutartys"."vpmSutartysAtnaujinimai"         RENAME TO "atnaujinimai";
ALTER TABLE "vpmSutartys"."vpmSutartysBrokas"               RENAME TO "brokas";
ALTER TABLE "vpmSutartys"."vpmSutartysChanges"              RENAME TO "changes";
ALTER TABLE "vpmSutartys"."vpmSutartysFailai"               RENAME TO "failai";
ALTER TABLE "vpmSutartys"."vpmSutartysIndexQueue"           RENAME TO "indexQueue";
ALTER TABLE "vpmSutartys"."vpmSutartysKategorijos"          RENAME TO "kategorijos";
ALTER TABLE "vpmSutartys"."vpmSutartysPapildomiBvpzKodai"   RENAME TO "papildomiBvpzKodai";
ALTER TABLE "vpmSutartys"."vpmSutartysPapildomiTiekejai"    RENAME TO "papildomiTiekejai";
ALTER TABLE "vpmSutartys"."vpmSutartysSalys"                RENAME TO "salys";
ALTER TABLE "vpmSutartys"."vpmSutartysSearch"               RENAME TO "search";
ALTER TABLE "vpmSutartys"."vpmSutartysSudarymoDatos"        RENAME TO "sudarymoDatos";
ALTER TABLE "vpmSutartys"."vpmSutartysSumos"                RENAME TO "sumos";
ALTER TABLE "vpmSutartys"."vpmSutartysSumosMetai"           RENAME TO "sumosMetai";
ALTER TABLE "vpmSutartys"."vpmSutartysSumosPirkejasTiekejas" RENAME TO "sumosPirkejasTiekejas";
ALTER TABLE "vpmSutartys"."vpmSutartysTipai"                RENAME TO "tipai";

-- 2. Indeksų, constraint'ų ir sekų vardai ------------------------------------
--
-- ~130 objektų, tad ne po vieną eilutę, o vienoda taisyklė. Prefiksas
-- nuimamas taip pat, kaip ir lentelėms, papildomai išvalant seną
-- `vpmSutartys_tz_new_*` palikimą (lentelė kadaise buvo perrašyta per
-- `_tz_new` kopiją):
--     vpmSutartys_tz_new_pkey          -> sutartys_pkey
--     vpmSutartys_org_tiek_numverte_idx-> sutartys_org_tiek_numverte_idx
--     vpmSutartysSalys_pavadinimas_key -> salys_pavadinimas_key
--     vpmSutartysSumosMetai_pkey       -> sumosMetai_pkey
-- Liečiami tik objektai, kurių vardas prasideda „vpmSutartys“, tad seniau
-- schemoje buvę „atviri*“ / „objektuPavadinimai*“ vardai nepaliesti.

DO $$
DECLARE
    r        record;
    naujas   text;
BEGIN
    -- 2.1 constraint'ai (PK, UNIQUE, FK, CHECK, NOT NULL)
    FOR r IN
        SELECT c.relname AS lentele, con.conname AS senas
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vpmSutartys' AND con.conname LIKE 'vpmSutartys%'
    LOOP
        naujas := CASE
            WHEN r.senas LIKE 'vpmSutartys\_tz\_new\_%' THEN 'sutartys_' || substr(r.senas, 20)
            WHEN r.senas LIKE 'vpmSutartys\_%'          THEN 'sutartys_' || substr(r.senas, 13)
            ELSE lower(substr(r.senas, 12, 1)) || substr(r.senas, 13)
        END;
        EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
                       'vpmSutartys', r.lentele, r.senas, naujas);
    END LOOP;

    -- 2.2 indeksai be constraint'o ir identity sekos
    FOR r IN
        SELECT c.relkind, c.relname AS senas
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vpmSutartys'
          AND c.relkind IN ('i', 'S')
          AND c.relname LIKE 'vpmSutartys%'
    LOOP
        naujas := CASE
            WHEN r.senas LIKE 'vpmSutartys\_tz\_new\_%' THEN 'sutartys_' || substr(r.senas, 20)
            WHEN r.senas LIKE 'vpmSutartys\_%'          THEN 'sutartys_' || substr(r.senas, 13)
            ELSE lower(substr(r.senas, 12, 1)) || substr(r.senas, 13)
        END;
        EXECUTE format('ALTER %s %I.%I RENAME TO %I',
                       CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'INDEX' END,
                       'vpmSutartys', r.senas, naujas);
    END LOOP;
END $$;

-- 3. Trigerių vardai ---------------------------------------------------------
--
-- Snake_case „vpm_sutartys_*“ palikimas -> camelCase pagal eilės/lentelės
-- vardą, kaip vpmSutartys."atviriDuomenys" trigeriai („adpEile_ins_del“).
-- Pačios funkcijos lieka public schemoje (žr. §4).

ALTER TRIGGER "vpm_sutartys_adp_queue_ins_del"   ON "vpmSutartys"."sutartys" RENAME TO "adpQueue_ins_del";
ALTER TRIGGER "vpm_sutartys_adp_queue_upd"       ON "vpmSutartys"."sutartys" RENAME TO "adpQueue_upd";
ALTER TRIGGER "vpm_sutartys_index_queue_ins_del" ON "vpmSutartys"."sutartys" RENAME TO "indexQueue_ins_del";
ALTER TRIGGER "vpm_sutartys_index_queue_upd"     ON "vpmSutartys"."sutartys" RENAME TO "indexQueue_upd";
ALTER TRIGGER "vpm_sutartys_pavadinimai_ins"     ON "vpmSutartys"."sutartys" RENAME TO "objektuPavadinimai_ins";
ALTER TRIGGER "vpm_sutartys_pavadinimai_upd"     ON "vpmSutartys"."sutartys" RENAME TO "objektuPavadinimai_upd";
ALTER TRIGGER "vpm_sutartys_pavadinimai_del"     ON "vpmSutartys"."sutartys" RENAME TO "objektuPavadinimai_del";
ALTER TRIGGER "juridiniai_refresh_vpmsutartyssumos" ON "vpmSutartys"."sumos" RENAME TO "juridiniai_refresh_sumos";

-- 4. Funkcijos, kurių kūne lentelės vardas įrašytas tekstu --------------------
--
-- Kūnas nesekamas per OID, tad po perkėlimo šios dvi lūžtų per pirmą trigerį.
-- Kitos vpmSutartys liečiančios funkcijos taisymo nereikalauja:
-- public.sutartys_pavadinimai_maintain() jau rašo į vpmSutartys."objektuPavadinimai",
-- public.vpm_sutartys_adp_queue_trigger() ir
-- public.sutartys_atviri_adp_queue_trigger() kviečia tik enqueue funkciją.

CREATE OR REPLACE FUNCTION public.enqueue_vpm_sutartis_adp(contract_id bigint)
 RETURNS void
 LANGUAGE sql
AS $function$
    INSERT INTO "vpmSutartys"."adpQueue" ("unikalusId", "queuedAt")
    SELECT contract_id, clock_timestamp()
    WHERE contract_id IS NOT NULL
    ON CONFLICT ("unikalusId") DO UPDATE SET
        "queuedAt" = EXCLUDED."queuedAt"
$function$;

CREATE OR REPLACE FUNCTION public.vpm_sutartys_index_queue_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "vpmSutartys"."indexQueue" ("unikalusId", keitimas)
        VALUES (NEW."unikalusId", 'insert');
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO "vpmSutartys"."indexQueue" ("unikalusId", keitimas)
        VALUES (NEW."unikalusId", 'patch');
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO "vpmSutartys"."indexQueue" ("unikalusId", keitimas)
        VALUES (OLD."unikalusId", 'delete');
    END IF;
    RETURN NULL;
END;
$function$;

-- 5. dba."lenteles" registras ------------------------------------------------
--
-- PK yra (schema, lentele), tad eilutės atnaujinamos, o ne perkuriamos –
-- išlieka rankomis surašytas saltinis/saltinioUrl. „grupeId“ nustatomas
-- rankiniu būdu į „sutartys“ (id 2): grupavimo taisyklė
-- dba."grupiuTaisykles".prefiksas = 'vpmSutartys' po pervadinimo nebesutaptų
-- su naujais vardais („salys“, „failai“ …), o taisyklės lyginamos tik su
-- lentelės vardu (src/lib/dbSchema/grupes.ts), ne su schema.

UPDATE dba."lenteles" l
SET "schema"  = 'vpmSutartys',
    "lentele" = m."naujas",
    "grupeId" = COALESCE(l."grupeId", 2)
FROM (VALUES
    ('vpmSutartys',                     'sutartys'),
    ('vpmSutartysAdpQueue',             'adpQueue'),
    ('vpmSutartysAprasymai',            'aprasymai'),
    ('vpmSutartysAprasymaiQueue',       'aprasymaiQueue'),
    ('vpmSutartysAtnaujinimai',         'atnaujinimai'),
    ('vpmSutartysBrokas',               'brokas'),
    ('vpmSutartysChanges',              'changes'),
    ('vpmSutartysFailai',               'failai'),
    ('vpmSutartysIndexQueue',           'indexQueue'),
    ('vpmSutartysKategorijos',          'kategorijos'),
    ('vpmSutartysPapildomiBvpzKodai',   'papildomiBvpzKodai'),
    ('vpmSutartysPapildomiTiekejai',    'papildomiTiekejai'),
    ('vpmSutartysSalys',                'salys'),
    ('vpmSutartysSearch',               'search'),
    ('vpmSutartysSudarymoDatos',        'sudarymoDatos'),
    ('vpmSutartysSumos',                'sumos'),
    ('vpmSutartysSumosMetai',           'sumosMetai'),
    ('vpmSutartysSumosPirkejasTiekejas','sumosPirkejasTiekejas'),
    ('vpmSutartysTipai',                'tipai')
) AS m(senas, naujas)
WHERE l."schema" = 'public' AND l."lentele" = m.senas;

-- Grupavimo taisyklė pagal prefiksą lieka be darbo: po pervadinimo nė vienas
-- vardas nebeprasideda „vpmSutartys" (grupė priskirta rankiniu būdu aukščiau).
DELETE FROM dba."grupiuTaisykles" WHERE prefiksas = 'vpmSutartys';

-- 6. Patikros ----------------------------------------------------------------
--
-- Jei kuri nors nepraeina, transakcija nutraukiama ir niekas nepasikeičia.

DO $$
DECLARE
    kiek int;
BEGIN
    SELECT count(*) INTO kiek
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'vpmSutartys%';
    IF kiek > 0 THEN
        RAISE EXCEPTION 'public schemoje liko % vpmSutartys* objektų', kiek;
    END IF;

    SELECT count(*) INTO kiek
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'vpmSutartys' AND c.relkind IN ('r', 'p');
    IF kiek <> 28 THEN   -- 9 senos (atviri*, objektuPavadinimai) + 19 perkeltų
        RAISE EXCEPTION 'vpmSutartys schemoje % lentelės, tikėtasi 28', kiek;
    END IF;

    SELECT count(*) INTO kiek
    FROM dba."lenteles" WHERE "schema" = 'public' AND "lentele" LIKE 'vpmSutartys%';
    IF kiek > 0 THEN
        RAISE EXCEPTION 'dba.lenteles liko % senų eilučių', kiek;
    END IF;
END $$;

COMMIT;

-- Po COMMIT (ne transakcijoje): planuotojo statistika lieka galioti –
-- ANALYZE nereikalingas, nes eilutės nejudėjo. Schemos dump'as
-- atnaujinamas per `npm run db:schema:dump` (dbSchema/public.vpmSutartys*.sql
-- pakeičiami dbSchema/vpmSutartys.*.sql failais).
--
-- Atstatymas, jei prireiktų: tie patys ALTER'iai atvirkščiai
-- (RENAME TO "vpmSutartys*", SET SCHEMA public) + §4 funkcijų kūnai su
-- public."vpmSutartysAdpQueue" / public."vpmSutartysIndexQueue".

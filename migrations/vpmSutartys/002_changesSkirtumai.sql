-- Schema `vpmSutartys`, 2 revizija: vpmSutartys."changes" įgauna materializuotą
-- pakeitimo santrauką (`skirtumai` jsonb) ir iš jos išvestus stulpelius.
--
-- KODĖL. Iki šiol skirtumas tarp dviejų sutarties snapshot'ų buvo skaičiuojamas
-- tik JS pusėje (modules/sutartys/recentChanges.js diffContractDocuments), tad
-- SQL'as apie pakeitimo turinį nežinojo nieko. Dėl to /sutartys/redagavimai
-- neturi nė vieno filtro: negalima nei paklausti „rodyk tik vertės pokyčius“,
-- nei paslėpti triukšmo. O triukšmo dauguma – iš 6000 naujausių pakeitimų
-- 45 % yra tokie, kur pasikeitė vien `redagavimoData` (šaltinio timestamp'as),
-- ir daugiau niekas.
--
-- KAS SAUGOMA. `skirtumai` – objektas, kurio raktai yra pakitę kanoniniai
-- laukai, o reikšmės – {"pries": …, "po": …}. Masyvams (dokumentai,
-- papildomiTiekejai, papildomiBvpzKodai) lyginamas visas masyvas, o įrašomas
-- elementų kiekis – detalų dokumentų diff'ą (dokumentai[fileId=…]) toliau daro
-- JS atvaizdavimui, o filtravimui užtenka fakto „dokumentai pasikeitė“.
--
--     {"numatomaVerte": {"pries": 1161.60, "po": 3484.80},
--      "faktineVerte":  {"pries": null,    "po": 3484.80},
--      "_verte": {"pries": 1161.60, "po": 3484.80,
--                 "pagrindas": {"pries": "numatoma", "po": "faktine"}}}
--
-- Vienas jsonb stulpelis vietoj stulpelio kiekvienam filtrui: „kas pasikeitė“
-- facetai yra `skirtumai ? 'numatomaVerte'` / `skirtumai ?| ARRAY[…]` per GIN
-- indeksą, ir naujam laukui filtruoti nebereikia ALTER TABLE.
--
-- `_verte` – vienintelis išvestinis raktas (kanoniniai laukai `_` neturi, tad
-- kolizijos negali būti). Jo reikia todėl, kad numatoma ir faktinė vertė nėra
-- du lygiaverčiai skaičiai: iš 151 faktinės vertės pokyčio 123 (81 %) yra
-- null → reikšmė, o numatoma nebūna null niekada. Todėl pinigų judesys
-- skaičiuojamas iš aktualios vertės = COALESCE(faktinė, numatoma):
--
--     n 14000→10000, f 14000→10000   →  14000 → 10000   (viena eilutė, ne dvi)
--     n 1161.60→3484.80, f null→3484.80 → 1161.60 → 3484.80 (+2323.20)
--     n nepakito 8000,  f null→5000  →   8000 → 5000    (–3000; be _verte
--                                        šito nesimatytų, nes `skirtumai`
--                                        turi tik faktineVerte)
--     f atsirado lygi numatomai      →  _verte NĖRA: tai ne pinigų pokytis,
--                                        o patvirtinimas (UI rodo ramia žyma)
--
-- Svarbu: `_verte` neišvedamas iš paties `skirtumai` turinio – reikia ir
-- NEpakitusio lauko reikšmės, tad skaičiuojamas įrašymo metu, kai po ranka yra
-- abu pilni dokumentai (upsertVpmSutartis.js `history` CTE).
--
-- NULL `skirtumai` reiškia „vėlesnė būsena nežinoma“ – tą patį, ką JS pusėje
-- reiškia `if (!row.after) return null` (pakeitimas, kurio sutarties nebėra
-- vpmSutartys."sutartys"). Tokių eilučių dabar nėra nė vienos, bet stulpelis
-- sąmoningai paliekamas NULLable ir dėl deploy'o eiliškumo: migracija saugi
-- ir su senu kodu (jis tiesiog nepildo stulpelio), o atsilikusias eilutes bet
-- kada užpildo `npm run sutartys:rebuildDiffs`.
--
-- Trynimas nesugadina invarianto: vpmSutartys."changes" eilutės trinamos tik
-- per trintiNuliniusPakeitimus.js, o "nulinė" eilutė yra kanoniškai tapati
-- sekančiai, tad ankstesnės eilutės diff'as po trynimo nepasikeičia.
-- Po to vertėtų vieną kartą paleisti `npm run sutartys:rebuildDiffs -- --visus`.
--
-- Lentelė maža (14 876 eilutės, ~40 MB), tad ADD COLUMN + backfill + generuoti
-- stulpeliai (lentelės perrašymas su ACCESS EXCLUSIVE) trunka sekundes.
--
-- Taikymas — BŪTINA `admin` role (lentelė ir schema priklauso jai; programos
-- rolė `viespirkiai` gautų „must be owner of table"):
--   psql -h $PG_DIRECT_HOST -p $PG_DIRECT_PORT -U admin -d $PG_DATABASE \
--        -v ON_ERROR_STOP=1 -f migrations/vpmSutartys/002_changesSkirtumai.sql
--
-- Atstatymas: DROP COLUMN "skirtumai" CASCADE (generuoti stulpeliai ir indeksai
-- nukrenta kartu), DROP FUNCTION "vpmSutartys"."perskaiciuotiSkirtumus"(boolean),
-- DROP FUNCTION "vpmSutartys"."diffJsonb"(jsonb, jsonb).

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '10min';

-- 1. Diff'o funkcija ---------------------------------------------------------
--
-- Atitikmuo recentChanges.js diffContractDocuments(): patikrinta su 3000
-- naujausių pakeitimų – pakitusių laukų aibės sutampa 3000/3000.
-- `unikalusId` praleidžiamas (jis niekada nekinta ir yra raktas, ne turinys).

CREATE OR REPLACE FUNCTION "vpmSutartys"."diffJsonb"(senas jsonb, naujas jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT COALESCE((
        SELECT jsonb_object_agg(
            laukas,
            jsonb_build_object(
                -- Masyvai lyginami pilni, saugomas tik elementų kiekis.
                'pries', CASE WHEN jsonb_typeof(senas -> laukas) = 'array'
                    THEN to_jsonb(jsonb_array_length(senas -> laukas))
                    ELSE senas -> laukas END,
                'po', CASE WHEN jsonb_typeof(naujas -> laukas) = 'array'
                    THEN to_jsonb(jsonb_array_length(naujas -> laukas))
                    ELSE naujas -> laukas END
            )
        )
        FROM (
            SELECT laukas FROM jsonb_object_keys(COALESCE(senas, '{}'::jsonb)) AS laukas
            UNION
            SELECT laukas FROM jsonb_object_keys(COALESCE(naujas, '{}'::jsonb)) AS laukas
        ) AS visi
        WHERE laukas <> 'unikalusId'
          AND (senas -> laukas) IS DISTINCT FROM (naujas -> laukas)
    ), '{}'::jsonb)
    || (
        -- `_verte`: aktualios vertės (faktinė, o jos nesant – numatoma) judesys.
        -- Dedamas tik kai suma tikrai pasikeitė; „atsirado faktinė, lygi
        -- numatomai" lieka matomas per žalią `faktineVerte` raktą, bet į vertės
        -- filtrą nepatenka.
        SELECT CASE WHEN v."priesVerte" IS DISTINCT FROM v."poVerte"
            THEN jsonb_build_object('_verte', jsonb_build_object(
                'pries', v."priesVerte",
                'po', v."poVerte",
                'pagrindas', jsonb_build_object(
                    'pries', v."priesPagrindas",
                    'po', v."poPagrindas")))
            ELSE '{}'::jsonb END
        FROM (
            SELECT
                COALESCE(f."priesF", f."priesN") AS "priesVerte",
                COALESCE(f."poF", f."poN") AS "poVerte",
                CASE WHEN f."priesF" IS NOT NULL THEN 'faktine'
                     WHEN f."priesN" IS NOT NULL THEN 'numatoma' END AS "priesPagrindas",
                CASE WHEN f."poF" IS NOT NULL THEN 'faktine'
                     WHEN f."poN" IS NOT NULL THEN 'numatoma' END AS "poPagrindas"
            FROM (
                -- `->>` grąžina SQL NULL ir kai rakto nėra, ir kai jis JSON null.
                SELECT
                    (senas  ->> 'faktineVerte')::numeric  AS "priesF",
                    (senas  ->> 'numatomaVerte')::numeric AS "priesN",
                    (naujas ->> 'faktineVerte')::numeric  AS "poF",
                    (naujas ->> 'numatomaVerte')::numeric AS "poN"
            ) f
        ) v
    )
$$;

COMMENT ON FUNCTION "vpmSutartys"."diffJsonb"(jsonb, jsonb) IS
    'Dviejų canonical sutarties dokumentų skirtumas: {laukas: {pries, po}} + išvestinis _verte (aktualios vertės judesys). Atitinka JS diffContractDocuments().';

-- 2. Stulpelis su santrauka --------------------------------------------------

ALTER TABLE "vpmSutartys"."changes"
    ADD COLUMN "skirtumai" jsonb;

COMMENT ON COLUMN "vpmSutartys"."changes"."skirtumai" IS
    'Pakeitimo santrauka: {laukas: {pries, po}} tarp šios eilutės snapshot''o ir sekančio (arba dabartinės sutarties). Masyvams – elementų kiekis. Papildomas išvestinis raktas _verte – aktualios vertės (faktinė, o jos nesant numatoma) judesys su pagrindu. NULL – vėlesnė būsena nežinoma.';

-- 3. Backfill funkcija ir pirmas paleidimas ----------------------------------
--
-- Ta pati funkcija naudojama ir migracijoje, ir `npm run sutartys:rebuildDiffs`,
-- kad backfill'o SQL gyventų vienoje vietoje.
-- `tikTrukstamus` = true → liečiamos tik sutartys, turinčios NULL skirtumus.
-- Sekančios eilutės snapshot'as imamas per lead(); paskutinei sutarties
-- eilutei „po" yra dabartinė sutartis, surenkama iš normalizuotų lentelių
-- (ta pati projekcija kaip recentChanges.js CHANGES_PROJECTION).

CREATE OR REPLACE FUNCTION "vpmSutartys"."perskaiciuotiSkirtumus"(
    "tikTrukstamus" boolean DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
    kiek bigint;
BEGIN
    WITH poros AS (
        SELECT
            c.id,
            c."unikalusId",
            c.sutartis AS senas,
            lead(c.sutartis) OVER (PARTITION BY c."unikalusId" ORDER BY c.id) AS kitas
        FROM "vpmSutartys"."changes" c
        -- Filtruojama sutarties, o ne eilutės lygiu: lead() reikia visų
        -- sutarties eilučių, kitaip „po" būtų paimtas per toli.
        WHERE NOT "tikTrukstamus" OR EXISTS (
            SELECT 1 FROM "vpmSutartys"."changes" tuscia
            WHERE tuscia."unikalusId" = c."unikalusId"
              AND tuscia."skirtumai" IS NULL
        )
    )
    UPDATE "vpmSutartys"."changes" ch
    SET "skirtumai" = "vpmSutartys"."diffJsonb"(p.senas, COALESCE(p.kitas, dabartine.doc))
    FROM poros p
    LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
            'unikalusId', e."unikalusId",
            'pavadinimas', e.pavadinimas,
            'sudarymoData', e."sudarymoData",
            'galiojimoData', e."galiojimoData",
            'faktineIvykdimoData', e."faktineIvykdimoData",
            'paskelbimoData', CASE WHEN e."paskelbimoData" IS NULL THEN NULL
                ELSE to_char(e."paskelbimoData", 'YYYY-MM-DD"T"HH24:MI:SS.MS') END,
            'redagavimoData', CASE WHEN e."redagavimoData" IS NULL THEN NULL
                ELSE to_char(e."redagavimoData", 'YYYY-MM-DD"T"HH24:MI:SS.MS') END,
            'perkanciosiosOrganizacijosKodas', e."perkanciosiosOrganizacijosKodas",
            'perkanciosiosOrganizacijosPavadinimas', buyer_name.pavadinimas,
            'sutartiesNumeris', e."sutartiesNumeris",
            'pirkimoNumeris', e."pirkimoNumeris",
            'numatomaVerte', e."numatomaVerte",
            'faktineVerte', e."faktineVerte",
            'pirmoTiekejoKodas', e."pirmoTiekejoKodas",
            'pirmoTiekejoPavadinimas', supplier_name.pavadinimas,
            'papildomiTiekejai', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'kodas', extra."tiekejoKodas",
                        'pavadinimas', extra_name.pavadinimas
                    ) ORDER BY extra.id
                )
                FROM "vpmSutartys"."papildomiTiekejai" extra
                LEFT JOIN "vpmSutartys"."salys" extra_name
                  ON extra_name.id = extra."tiekejoPavadinimoId"
                WHERE extra."unikalusId" = e."unikalusId"
            ), '[]'::jsonb),
            'tipas', type_name.tipas,
            'kategorija', category_name.kategorija,
            'bvpzKodas', e."bvpzKodas",
            'papildomiBvpzKodai', COALESCE((
                SELECT jsonb_agg(extra_bvpz."bvpzKodas" ORDER BY extra_bvpz.id)
                FROM "vpmSutartys"."papildomiBvpzKodai" extra_bvpz
                WHERE extra_bvpz."unikalusId" = e."unikalusId"
            ), '[]'::jsonb),
            'dokumentai', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'pavadinimas', file.pavadinimas,
                        'fileId', file."fileId"
                    ) ORDER BY file.id
                )
                FROM "vpmSutartys"."failai" file
                WHERE file."unikalusId" = e."unikalusId"
            ), '[]'::jsonb),
            'istrinta', e.istrinta,
            'pakeitimas', e.pakeitimas
        ) AS doc
        FROM "vpmSutartys"."sutartys" e
        LEFT JOIN "vpmSutartys"."salys" buyer_name
          ON buyer_name.id = e."perkanciosiosOrganizacijosPavadinimoId"
        LEFT JOIN "vpmSutartys"."salys" supplier_name
          ON supplier_name.id = e."pirmoTiekejoPavadinimoId"
        LEFT JOIN "vpmSutartys"."tipai" type_name
          ON type_name.id = e."tipasId"
        LEFT JOIN "vpmSutartys"."kategorijos" category_name
          ON category_name.id = e."kategorijaId"
        WHERE e."unikalusId" = p."unikalusId"
    ) dabartine ON p.kitas IS NULL   -- dabartinės sutarties reikia tik paskutinei eilutei
    WHERE ch.id = p.id
      -- Sutartis dingusi iš vpmSutartys."sutartys" – „po" nežinomas, paliekam NULL.
      AND COALESCE(p.kitas, dabartine.doc) IS NOT NULL
      AND (NOT "tikTrukstamus" OR ch."skirtumai" IS NULL)
      -- Be pokyčio neperrašinėjam (mažiau bloat'o kartotiniuose paleidimuose).
      AND ch."skirtumai" IS DISTINCT FROM
          "vpmSutartys"."diffJsonb"(p.senas, COALESCE(p.kitas, dabartine.doc));

    GET DIAGNOSTICS kiek = ROW_COUNT;
    RETURN kiek;
END;
$$;

COMMENT ON FUNCTION "vpmSutartys"."perskaiciuotiSkirtumus"(boolean) IS
    'Užpildo vpmSutartys."changes"."skirtumai". true (numatyta) – tik sutartys su trūkstamais skirtumais, false – visos. Grąžina atnaujintų eilučių skaičių.';

SELECT "vpmSutartys"."perskaiciuotiSkirtumus"(false) AS "užpildyta";

-- 4. Išvestiniai stulpeliai --------------------------------------------------
--
-- Kuriami PO backfill'o – kitaip lentelė būtų perrašoma du kartus.
-- Visos išraiškos immutable (jsonb_delete, jsonb_exists, `->`, `->>`, ::numeric),
-- tad tinka GENERATED ... STORED.

ALTER TABLE "vpmSutartys"."changes"
    -- Numatytojo srauto filtras: pakeitimas, kuriame yra kas nors daugiau nei
    -- šaltinio redagavimo timestamp'as. 45 % pakeitimų čia iškrenta.
    ADD COLUMN "reiksmingas" boolean
        GENERATED ALWAYS AS (("skirtumai" - 'redagavimoData') <> '{}'::jsonb) STORED,
    -- Aktualios vertės pokytis eurais; NULL, kai vertė nejudėjo arba atsirado
    -- pirmą kartą (tada – "verteAtsirado").
    ADD COLUMN "verteDelta" numeric
        GENERATED ALWAYS AS (
            ("skirtumai" -> '_verte' ->> 'po')::numeric
          - ("skirtumai" -> '_verte' ->> 'pries')::numeric) STORED,
    ADD COLUMN "verteAtsirado" boolean
        GENERATED ALWAYS AS (
            ("skirtumai" ? '_verte')
        AND ("skirtumai" -> '_verte' ->> 'pries') IS NULL) STORED,
    -- Ryškus būsenos pokytis, kurį UI rodo atskira žyma.
    ADD COLUMN "busena" text
        GENERATED ALWAYS AS (CASE
            WHEN "skirtumai" -> 'istrinta' ->> 'po' = 'true' THEN 'istrinta'
            WHEN "skirtumai" -> 'istrinta' ->> 'pries' = 'true' THEN 'atkurta'
        END) STORED;

COMMENT ON COLUMN "vpmSutartys"."changes"."reiksmingas" IS
    'Ar pakeitime yra kas nors be `redagavimoData`. false – šaltinio timestamp''o bumptelėjimas be turinio (~45 % visų pakeitimų).';
COMMENT ON COLUMN "vpmSutartys"."changes"."verteDelta" IS
    'Aktualios vertės (COALESCE(faktinė, numatoma)) pokytis eurais. NULL, kai vertė nejudėjo arba atsirado pirmą kartą.';
COMMENT ON COLUMN "vpmSutartys"."changes"."verteAtsirado" IS
    'Sutartis anksčiau neturėjo jokios vertės, o po pakeitimo turi – deltos nėra, bet įvykis rikiuojamas atskirai.';
COMMENT ON COLUMN "vpmSutartys"."changes"."busena" IS
    'istrinta | atkurta | NULL – ar pakeitimas yra sutarties ištrynimas ar atkūrimas šaltinyje.';

-- 5. Indeksai ----------------------------------------------------------------

-- „Kas pasikeitė" facetai ir filtrai: `skirtumai ? 'numatomaVerte'`,
-- `skirtumai ?| ARRAY['numatomaVerte','faktineVerte']`. Būtinas numatytasis
-- jsonb_ops (jsonb_path_ops `?` operatoriaus nepalaiko).
CREATE INDEX "changes_skirtumai_idx"
    ON "vpmSutartys"."changes" USING gin ("skirtumai");

-- Numatytasis sąrašas: naujausi reikšmingi pakeitimai.
CREATE INDEX "changes_pakeitimoData_reiksmingi_idx"
    ON "vpmSutartys"."changes" ("pakeitimoData" DESC)
    WHERE "reiksmingas";

-- Rikiavimas „didžiausias vertės pokytis".
CREATE INDEX "changes_verteDelta_idx"
    ON "vpmSutartys"."changes" ("verteDelta")
    WHERE "verteDelta" IS NOT NULL;

-- Sutarties istorijai (RECENT_CHANGES_SQL eina id DESC vienos sutarties viduje).
CREATE INDEX "changes_unikalusId_id_idx"
    ON "vpmSutartys"."changes" ("unikalusId", id DESC);

-- 6. Patikros ----------------------------------------------------------------

DO $$
DECLARE
    tusti      int;
    reiksmingi int;
    viso       int;
BEGIN
    SELECT count(*) INTO viso FROM "vpmSutartys"."changes";

    -- Šiuo metu orphan'ų (sutarties nebėra) nėra nė vieno, tad NULL neturi likti.
    SELECT count(*) INTO tusti
    FROM "vpmSutartys"."changes" c
    WHERE c."skirtumai" IS NULL
      AND EXISTS (SELECT 1 FROM "vpmSutartys"."sutartys" s
                  WHERE s."unikalusId" = c."unikalusId");
    IF tusti > 0 THEN
        RAISE EXCEPTION 'Neužpildyti skirtumai: % eilutės su egzistuojančia sutartimi', tusti;
    END IF;

    -- Sveiko proto riba: reikšmingų turi būti ~55 %, ne 0 ir ne 100 %.
    SELECT count(*) INTO reiksmingi FROM "vpmSutartys"."changes" WHERE "reiksmingas";
    IF viso > 1000 AND (reiksmingi = 0 OR reiksmingi = viso) THEN
        RAISE EXCEPTION 'Įtartina: reikšmingų % iš % – patikrink diffJsonb()', reiksmingi, viso;
    END IF;

    RAISE NOTICE 'changes: % eilučių, iš jų reikšmingų % (% %%)',
        viso, reiksmingi, round(100.0 * reiksmingi / NULLIF(viso, 0));
END $$;

COMMIT;

-- Po COMMIT: statistika po lentelės perrašymo.
--   ANALYZE "vpmSutartys"."changes";
-- Schemos dump'as – `npm run db:schema:dump`.

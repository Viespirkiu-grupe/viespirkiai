-- Schema `files`: failų posistemė, iškelta iš `public` (2026-09). 25 lentelės —
-- pats failų registras, jo žodynai (pavadinimai, plėtiniai, md5, šaltiniai),
-- eilės (parsiuntimo, teksto ištraukimo, OCR, dokumentų indeksavimo),
-- nuskaitymo rezultatai bei `dezes` (failų saugyklos dėžės, skaitomos prie
-- failų). Po šio ir `migrations/infra/001_infra.sql` `public` schemoje lieka
-- tik `vpmSutartys*` lentelės, PostGIS `spatial_ref_sys` ir bendros funkcijos.
--
-- Lentelės pervadinamos nuimant `files` prefiksą — schema jį jau pasako, kaip
-- ir `risk` schemoje (žr. migrations/risk/001_risk.sql). `files."files"` lieka
-- su savo vardu: tai pati failų lentelė, o ne jos priedas. `dezes` irgi
-- nekeičiama.
--
-- Ko šis failas NEKEIČIA sąmoningai:
--   * Apribojimų, indeksų ir sekų vardai lieka su senu `files` prefiksu
--     ("filesOcrStatus_pkey", "filesMd5_id_seq" ir pan.). Jie niekur kode
--     neminimi (sekos – identity stulpelių, kreipiamasi per lentelę), o
--     pervadinimas būtų ~150 papildomų sakinių; jei norisi tvarkos — atskira
--     migracija 002.
--   * Funkcijos (files_stats_trigger, "filesStatsRebuild", …) lieka `public`
--     schemoje. Trigeriai jas mini per OID, tad perkėlimas jų nenutraukia, bet
--     ir naudos neduotų; keičiami tik jų kūnai, kuriuose lentelės nurodytos
--     tekstu.
--   * Užsienio raktai iš kitų schemų (documents."documents"."fileId",
--     ppa."ataskaitos"."failasId" → files) ir view'ai saugomi pagal OID —
--     perkėlimo metu nenutrūksta ir perrašinėti jų nereikia.
--
-- Pritaikius: `npm run db:schema:dump` perrašo dbSchema/ failus
-- (public.files*.sql, public.dezes.sql → files.*.sql).
--
-- Šis failas po pritaikymo neredaguojamas — kitas pakeitimas yra naujas
-- migrations/files/002_<vardas>.sql.

BEGIN;

CREATE SCHEMA IF NOT EXISTS files;

COMMENT ON SCHEMA files IS
    'Failų posistemė: failų registras, jo žodynai, parsiuntimo ir nuskaitymo eilės, OCR rezultatai bei saugyklos dėžės.';

-- 1. Enum tipas -------------------------------------------------------------
--
-- "filesDocumentsQueueChange" naudojamas tik documentsQueue.change stulpelyje.
-- Stulpelis tipą mini per OID, tad perkėlimas ir pervadinimas jo nepaliečia.

ALTER TYPE public."filesDocumentsQueueChange" SET SCHEMA files;
ALTER TYPE files."filesDocumentsQueueChange" RENAME TO "documentsQueueChange";

-- 2. Lentelių perkėlimas ----------------------------------------------------
--
-- Kartu su lentele keliauja jai priklausantys indeksai, apribojimai ir
-- stulpelių sekos.

ALTER TABLE public."files" SET SCHEMA files;
ALTER TABLE public."dezes" SET SCHEMA files;
ALTER TABLE public."filesAuthors" SET SCHEMA files;
ALTER TABLE public."filesDataExtraction" SET SCHEMA files;
ALTER TABLE public."filesDocumentsQueue" SET SCHEMA files;
ALTER TABLE public."filesDownloadQueue" SET SCHEMA files;
ALTER TABLE public."filesExtensions" SET SCHEMA files;
ALTER TABLE public."filesExtractionQueue" SET SCHEMA files;
ALTER TABLE public."filesFilenames" SET SCHEMA files;
ALTER TABLE public."filesHidden" SET SCHEMA files;
ALTER TABLE public."filesInfoFiles" SET SCHEMA files;
ALTER TABLE public."filesLocations" SET SCHEMA files;
ALTER TABLE public."filesMd5" SET SCHEMA files;
ALTER TABLE public."filesMd5Boxes" SET SCHEMA files;
ALTER TABLE public."filesMd5BoxesCounts" SET SCHEMA files;
ALTER TABLE public."filesMd5BoxesCountsDistribution" SET SCHEMA files;
ALTER TABLE public."filesOcrQueue" SET SCHEMA files;
ALTER TABLE public."filesOcrStatsDay" SET SCHEMA files;
ALTER TABLE public."filesOcrStatus" SET SCHEMA files;
ALTER TABLE public."filesPasswords" SET SCHEMA files;
ALTER TABLE public."filesPhotos" SET SCHEMA files;
ALTER TABLE public."filesSourceTitles" SET SCHEMA files;
ALTER TABLE public."filesSpecialTypeNames" SET SCHEMA files;
ALTER TABLE public."filesSpecialTypes" SET SCHEMA files;
ALTER TABLE public."filesStats" SET SCHEMA files;

-- 3. Pervadinimas -----------------------------------------------------------

ALTER TABLE files."filesAuthors" RENAME TO "authors";
ALTER TABLE files."filesDataExtraction" RENAME TO "dataExtraction";
ALTER TABLE files."filesDocumentsQueue" RENAME TO "documentsQueue";
ALTER TABLE files."filesDownloadQueue" RENAME TO "downloadQueue";
ALTER TABLE files."filesExtensions" RENAME TO "extensions";
ALTER TABLE files."filesExtractionQueue" RENAME TO "extractionQueue";
ALTER TABLE files."filesFilenames" RENAME TO "filenames";
ALTER TABLE files."filesHidden" RENAME TO "hidden";
ALTER TABLE files."filesInfoFiles" RENAME TO "infoFiles";
ALTER TABLE files."filesLocations" RENAME TO "locations";
ALTER TABLE files."filesMd5" RENAME TO "md5";
ALTER TABLE files."filesMd5Boxes" RENAME TO "md5Boxes";
ALTER TABLE files."filesMd5BoxesCounts" RENAME TO "md5BoxesCounts";
ALTER TABLE files."filesMd5BoxesCountsDistribution" RENAME TO "md5BoxesCountsDistribution";
ALTER TABLE files."filesOcrQueue" RENAME TO "ocrQueue";
ALTER TABLE files."filesOcrStatsDay" RENAME TO "ocrStatsDay";
ALTER TABLE files."filesOcrStatus" RENAME TO "ocrStatus";
ALTER TABLE files."filesPasswords" RENAME TO "passwords";
ALTER TABLE files."filesPhotos" RENAME TO "photos";
ALTER TABLE files."filesSourceTitles" RENAME TO "sourceTitles";
ALTER TABLE files."filesSpecialTypeNames" RENAME TO "specialTypeNames";
ALTER TABLE files."filesSpecialTypes" RENAME TO "specialTypes";
ALTER TABLE files."filesStats" RENAME TO "stats";

-- Sekų atskirai kelti nereikia: visos devynios šių lentelių sekos priklauso
-- savo stulpeliams (`files_id_seq` ir kt. – identity, `dezes_id_seq` – serial),
-- o SET SCHEMA tokias perkelia kartu su lentele. Patikrinta pg_depend'e prieš
-- rašant šį failą; vienintelė `public` seka, kuri lieka, yra "quickwitIdIntSeq"
-- ir ji su failais nesusijusi.

-- 4. Funkcijos --------------------------------------------------------------
--
-- plpgsql kūne lentelės nurodytos tekstu (ne regclass), tad kiekvieną funkciją,
-- mininčią perkeltas lenteles, reikia perrašyti. Parašai ir vardai nesikeičia,
-- tad trigeriai lieka kaip buvę.

CREATE OR REPLACE FUNCTION public."filesDataExtraction_stats_trigger"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE files."stats" s
        SET extracted       = GREATEST(s.extracted - d.ok, 0),
            "extractFailed" = GREATEST(s."extractFailed" - d.failed, 0),
            words           = GREATEST(s.words - d.words, 0),
            pages           = GREATEST(s.pages - d.pages, 0),
            characters      = GREATEST(s.characters - d.characters, 0)
        FROM (
            SELECT f."extensionId",
                   count(*) FILTER (WHERE o.status = 0) AS ok,
                   count(*) FILTER (WHERE o.status < 0) AS failed,
                   COALESCE(sum(o."wordCount"), 0) AS words,
                   COALESCE(sum(o."pageCount"), 0) AS pages,
                   COALESCE(sum(o."characterCount"), 0) AS characters
            FROM old_table o
            JOIN files.files f ON f.id = o.id
            WHERE f."extensionId" IS NOT NULL
            GROUP BY f."extensionId"
        ) d
        WHERE s."extensionId" = d."extensionId";

    ELSIF TG_OP = 'UPDATE' THEN
        -- Be UPDATE OF sąrašo (draudžiama su transition table'ėmis), tad
        -- nepasikeitusias eilutes atmetam čia.
        UPDATE files."stats" s
        SET extracted       = GREATEST(s.extracted - d.ok, 0),
            "extractFailed" = GREATEST(s."extractFailed" - d.failed, 0),
            words           = GREATEST(s.words - d.words, 0),
            pages           = GREATEST(s.pages - d.pages, 0),
            characters      = GREATEST(s.characters - d.characters, 0)
        FROM (
            SELECT f."extensionId",
                   count(*) FILTER (WHERE o.status = 0) AS ok,
                   count(*) FILTER (WHERE o.status < 0) AS failed,
                   COALESCE(sum(o."wordCount"), 0) AS words,
                   COALESCE(sum(o."pageCount"), 0) AS pages,
                   COALESCE(sum(o."characterCount"), 0) AS characters
            FROM old_table o
            JOIN new_table n ON n.id = o.id
            JOIN files.files f ON f.id = o.id
            WHERE f."extensionId" IS NOT NULL
              AND (o.status, o."wordCount", o."pageCount", o."characterCount")
                  IS DISTINCT FROM (n.status, n."wordCount", n."pageCount", n."characterCount")
            GROUP BY f."extensionId"
        ) d
        WHERE s."extensionId" = d."extensionId";
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO files."stats" AS s ("extensionId", extracted, "extractFailed", words, pages, characters)
        SELECT f."extensionId",
               count(*) FILTER (WHERE n.status = 0),
               count(*) FILTER (WHERE n.status < 0),
               COALESCE(sum(n."wordCount"), 0),
               COALESCE(sum(n."pageCount"), 0),
               COALESCE(sum(n."characterCount"), 0)
        FROM new_table n
        JOIN files.files f ON f.id = n.id
        WHERE f."extensionId" IS NOT NULL
        GROUP BY f."extensionId"
        ON CONFLICT ("extensionId") DO UPDATE
            SET extracted       = s.extracted + EXCLUDED.extracted,
                "extractFailed" = s."extractFailed" + EXCLUDED."extractFailed",
                words           = s.words + EXCLUDED.words,
                pages           = s.pages + EXCLUDED.pages,
                characters      = s.characters + EXCLUDED.characters;

    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO files."stats" AS s ("extensionId", extracted, "extractFailed", words, pages, characters)
        SELECT f."extensionId",
               count(*) FILTER (WHERE n.status = 0),
               count(*) FILTER (WHERE n.status < 0),
               COALESCE(sum(n."wordCount"), 0),
               COALESCE(sum(n."pageCount"), 0),
               COALESCE(sum(n."characterCount"), 0)
        FROM new_table n
        JOIN old_table o ON o.id = n.id
        JOIN files.files f ON f.id = n.id
        WHERE f."extensionId" IS NOT NULL
          AND (o.status, o."wordCount", o."pageCount", o."characterCount")
              IS DISTINCT FROM (n.status, n."wordCount", n."pageCount", n."characterCount")
        GROUP BY f."extensionId"
        ON CONFLICT ("extensionId") DO UPDATE
            SET extracted       = s.extracted + EXCLUDED.extracted,
                "extractFailed" = s."extractFailed" + EXCLUDED."extractFailed",
                words           = s.words + EXCLUDED.words,
                pages           = s.pages + EXCLUDED.pages,
                characters      = s.characters + EXCLUDED.characters;
    END IF;

    RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public."filesOcrStatus_stats_trigger"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE files."stats" s
        SET "ocrDone"     = GREATEST(s."ocrDone" - d.done, 0),
            "ocrFailed"   = GREATEST(s."ocrFailed" - d.failed, 0),
            "ocrPending"  = GREATEST(s."ocrPending" - d.pending, 0),
            "ocrReserved" = GREATEST(s."ocrReserved" - d.reserved, 0),
            "ocrExceeded" = GREATEST(s."ocrExceeded" - d.exceeded, 0)
        FROM (
            SELECT f."extensionId",
                   count(*) FILTER (WHERE o.status =  1) AS done,
                   count(*) FILTER (WHERE o.status = -1) AS failed,
                   count(*) FILTER (WHERE o.status =  0) AS pending,
                   count(*) FILTER (WHERE o.status = -3) AS reserved,
                   count(*) FILTER (WHERE o.status = -6) AS exceeded
            FROM old_table o
            JOIN files.files f ON f.id = o.id
            WHERE f."extensionId" IS NOT NULL
            GROUP BY f."extensionId"
        ) d
        WHERE s."extensionId" = d."extensionId";

    ELSIF TG_OP = 'UPDATE' THEN
        -- filesOcrStatus atnaujinama ir rezervuojant/atlaisvinant, tad statuso
        -- nekeitusias eilutes būtina atmesti — kitaip trigeris suktųsi veltui.
        UPDATE files."stats" s
        SET "ocrDone"     = GREATEST(s."ocrDone" - d.done, 0),
            "ocrFailed"   = GREATEST(s."ocrFailed" - d.failed, 0),
            "ocrPending"  = GREATEST(s."ocrPending" - d.pending, 0),
            "ocrReserved" = GREATEST(s."ocrReserved" - d.reserved, 0),
            "ocrExceeded" = GREATEST(s."ocrExceeded" - d.exceeded, 0)
        FROM (
            SELECT f."extensionId",
                   count(*) FILTER (WHERE o.status =  1) AS done,
                   count(*) FILTER (WHERE o.status = -1) AS failed,
                   count(*) FILTER (WHERE o.status =  0) AS pending,
                   count(*) FILTER (WHERE o.status = -3) AS reserved,
                   count(*) FILTER (WHERE o.status = -6) AS exceeded
            FROM old_table o
            JOIN new_table n ON n.id = o.id
            JOIN files.files f ON f.id = o.id
            WHERE f."extensionId" IS NOT NULL
              AND o.status IS DISTINCT FROM n.status
            GROUP BY f."extensionId"
        ) d
        WHERE s."extensionId" = d."extensionId";
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO files."stats" AS s
            ("extensionId", "ocrDone", "ocrFailed", "ocrPending", "ocrReserved", "ocrExceeded")
        SELECT f."extensionId",
               count(*) FILTER (WHERE n.status =  1),
               count(*) FILTER (WHERE n.status = -1),
               count(*) FILTER (WHERE n.status =  0),
               count(*) FILTER (WHERE n.status = -3),
               count(*) FILTER (WHERE n.status = -6)
        FROM new_table n
        JOIN files.files f ON f.id = n.id
        WHERE f."extensionId" IS NOT NULL
        GROUP BY f."extensionId"
        ON CONFLICT ("extensionId") DO UPDATE
            SET "ocrDone"     = s."ocrDone" + EXCLUDED."ocrDone",
                "ocrFailed"   = s."ocrFailed" + EXCLUDED."ocrFailed",
                "ocrPending"  = s."ocrPending" + EXCLUDED."ocrPending",
                "ocrReserved" = s."ocrReserved" + EXCLUDED."ocrReserved",
                "ocrExceeded" = s."ocrExceeded" + EXCLUDED."ocrExceeded";

    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO files."stats" AS s
            ("extensionId", "ocrDone", "ocrFailed", "ocrPending", "ocrReserved", "ocrExceeded")
        SELECT f."extensionId",
               count(*) FILTER (WHERE n.status =  1),
               count(*) FILTER (WHERE n.status = -1),
               count(*) FILTER (WHERE n.status =  0),
               count(*) FILTER (WHERE n.status = -3),
               count(*) FILTER (WHERE n.status = -6)
        FROM new_table n
        JOIN old_table o ON o.id = n.id
        JOIN files.files f ON f.id = n.id
        WHERE f."extensionId" IS NOT NULL
          AND o.status IS DISTINCT FROM n.status
        GROUP BY f."extensionId"
        ON CONFLICT ("extensionId") DO UPDATE
            SET "ocrDone"     = s."ocrDone" + EXCLUDED."ocrDone",
                "ocrFailed"   = s."ocrFailed" + EXCLUDED."ocrFailed",
                "ocrPending"  = s."ocrPending" + EXCLUDED."ocrPending",
                "ocrReserved" = s."ocrReserved" + EXCLUDED."ocrReserved",
                "ocrExceeded" = s."ocrExceeded" + EXCLUDED."ocrExceeded";
    END IF;

    RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public."filesStatsRebuild"()
 RETURNS void
 LANGUAGE sql
AS $function$
    TRUNCATE files."stats";

    INSERT INTO files."stats" ("extensionId", files, bytes, downloaded, "downloadFailed",
                                     extracted, "extractFailed", words, pages, characters,
                                     "ocrDone", "ocrFailed", "ocrPending", "ocrReserved", "ocrExceeded")
    SELECT f."extensionId",
           count(*),
           COALESCE(sum(f.filesize), 0),
           count(*) FILTER (WHERE f."downloadStatus" = 1),
           count(*) FILTER (WHERE f."downloadStatus" < 0),
           count(*) FILTER (WHERE e.status = 0),
           count(*) FILTER (WHERE e.status < 0),
           COALESCE(sum(e."wordCount"), 0),
           COALESCE(sum(e."pageCount"), 0),
           COALESCE(sum(e."characterCount"), 0),
           count(*) FILTER (WHERE o.status =  1),
           count(*) FILTER (WHERE o.status = -1),
           count(*) FILTER (WHERE o.status =  0),
           count(*) FILTER (WHERE o.status = -3),
           count(*) FILTER (WHERE o.status = -6)
    FROM files.files f
    LEFT JOIN files."dataExtraction" e ON e.id = f.id
    LEFT JOIN files."ocrStatus" o ON o.id = f.id
    WHERE f."extensionId" IS NOT NULL
    GROUP BY f."extensionId";
$function$
;

CREATE OR REPLACE FUNCTION public.files_documents_queue_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO files."documentsQueue" ("fileId", change)
        VALUES (OLD.id, 'delete'::files."documentsQueueChange");
        RETURN OLD;
    END IF;

    INSERT INTO files."documentsQueue" ("fileId", change)
    VALUES (
        NEW.id,
        (CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'patch' END)::files."documentsQueueChange"
    );
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.files_md5_boxes_counts_decrement(target_md5_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_count integer;
BEGIN
    UPDATE files."md5BoxesCounts"
    SET count = count - 1
    WHERE "md5Id" = target_md5_id
    RETURNING count INTO new_count;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nėra files.md5BoxesCounts įrašo md5Id=%', target_md5_id;
    END IF;

    PERFORM public.files_md5_boxes_counts_move(new_count + 1, new_count);

    IF new_count = 0 THEN
        DELETE FROM files."md5BoxesCounts"
        WHERE "md5Id" = target_md5_id;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.files_md5_boxes_counts_increment(target_md5_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_count integer;
BEGIN
    INSERT INTO files."md5BoxesCounts" AS counts ("md5Id", count)
    VALUES (target_md5_id, 1)
    ON CONFLICT ("md5Id") DO UPDATE
    SET count = counts.count + 1
    RETURNING count INTO new_count;

    PERFORM public.files_md5_boxes_counts_move(new_count - 1, new_count);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.files_md5_boxes_counts_move(old_count integer, new_count integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Užtikriname, kad abu reikalingi kibirai egzistuoja. Nulinė tarpinė
    -- reikšmė leidžiama ir pašalinama funkcijos pabaigoje.
    INSERT INTO files."md5BoxesCountsDistribution" (count, "filesCount")
    SELECT bucket, 0
    FROM (VALUES (old_count), (new_count)) AS buckets(bucket)
    WHERE bucket > 0
    GROUP BY bucket
    ORDER BY bucket
    ON CONFLICT (count) DO NOTHING;

    -- Visada užrakiname mažesnį kibirą pirmiau, kad lygiagretūs perėjimai
    -- tarp skirtingų count reikšmių nesukeltų deadlock.
    PERFORM count
    FROM files."md5BoxesCountsDistribution"
    WHERE count IN (old_count, new_count)
      AND count > 0
    ORDER BY count
    FOR UPDATE;

    UPDATE files."md5BoxesCountsDistribution"
    SET "filesCount" = "filesCount"
        + CASE WHEN count = new_count THEN 1 ELSE 0 END
        - CASE WHEN count = old_count THEN 1 ELSE 0 END
    WHERE count IN (old_count, new_count)
      AND count > 0;

    DELETE FROM files."md5BoxesCountsDistribution"
    WHERE "filesCount" = 0;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.files_md5_boxes_counts_truncate_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    TRUNCATE TABLE
        files."md5BoxesCountsDistribution",
        files."md5BoxesCounts";
    RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.files_stats_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO files."stats" AS s (
            "extensionId", files, bytes,
            downloaded, "downloadedBytes",
            unarchived, "unarchivedBytes",
            "downloadFailed", "downloadFailedBytes",
            pending, "pendingBytes")
        SELECT COALESCE(n."extensionId", 0),
               count(*),
               COALESCE(sum(n.filesize), 0),
               count(*) FILTER (WHERE n."downloadStatus" = 1),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" = 1), 0),
               count(*) FILTER (WHERE n."downloadStatus" = -5),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" = -5), 0),
               count(*) FILTER (WHERE n."downloadStatus" < 0 AND n."downloadStatus" <> -5),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" < 0 AND n."downloadStatus" <> -5), 0),
               count(*) FILTER (WHERE n."downloadStatus" = 0),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" = 0), 0)
        FROM new_table n
        GROUP BY COALESCE(n."extensionId", 0)
        ON CONFLICT ("extensionId") DO UPDATE
            SET files                 = s.files                 + EXCLUDED.files,
                bytes                 = s.bytes                 + EXCLUDED.bytes,
                downloaded            = s.downloaded            + EXCLUDED.downloaded,
                "downloadedBytes"     = s."downloadedBytes"     + EXCLUDED."downloadedBytes",
                unarchived            = s.unarchived            + EXCLUDED.unarchived,
                "unarchivedBytes"     = s."unarchivedBytes"     + EXCLUDED."unarchivedBytes",
                "downloadFailed"      = s."downloadFailed"      + EXCLUDED."downloadFailed",
                "downloadFailedBytes" = s."downloadFailedBytes" + EXCLUDED."downloadFailedBytes",
                pending               = s.pending               + EXCLUDED.pending,
                "pendingBytes"        = s."pendingBytes"        + EXCLUDED."pendingBytes";

    ELSIF TG_OP = 'DELETE' THEN
        UPDATE files."stats" s
        SET files                 = GREATEST(s.files                 - d.files, 0),
            bytes                 = GREATEST(s.bytes                 - d.bytes, 0),
            downloaded            = GREATEST(s.downloaded            - d.downloaded, 0),
            "downloadedBytes"     = GREATEST(s."downloadedBytes"     - d."downloadedBytes", 0),
            unarchived            = GREATEST(s.unarchived            - d.unarchived, 0),
            "unarchivedBytes"     = GREATEST(s."unarchivedBytes"     - d."unarchivedBytes", 0),
            "downloadFailed"      = GREATEST(s."downloadFailed"      - d."downloadFailed", 0),
            "downloadFailedBytes" = GREATEST(s."downloadFailedBytes" - d."downloadFailedBytes", 0),
            pending               = GREATEST(s.pending               - d.pending, 0),
            "pendingBytes"        = GREATEST(s."pendingBytes"        - d."pendingBytes", 0)
        FROM (
            SELECT COALESCE(o."extensionId", 0) AS "extensionId",
                   count(*) AS files,
                   COALESCE(sum(o.filesize), 0) AS bytes,
                   count(*) FILTER (WHERE o."downloadStatus" = 1) AS downloaded,
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" = 1), 0) AS "downloadedBytes",
                   count(*) FILTER (WHERE o."downloadStatus" = -5) AS unarchived,
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" = -5), 0) AS "unarchivedBytes",
                   count(*) FILTER (WHERE o."downloadStatus" < 0 AND o."downloadStatus" <> -5) AS "downloadFailed",
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" < 0 AND o."downloadStatus" <> -5), 0) AS "downloadFailedBytes",
                   count(*) FILTER (WHERE o."downloadStatus" = 0) AS pending,
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" = 0), 0) AS "pendingBytes"
            FROM old_table o
            GROUP BY COALESCE(o."extensionId", 0)
        ) d
        WHERE s."extensionId" = d."extensionId";

    ELSE  -- UPDATE: nuimam senas reikšmes, uždedam naujas.
        -- Trigeris kabinamas be UPDATE OF sąrašo (Postgres to neleidžia kartu su
        -- transition table'ėmis), tad nesusijusius atnaujinimus atmetam čia.
        UPDATE files."stats" s
        SET files                 = GREATEST(s.files                 - d.files, 0),
            bytes                 = GREATEST(s.bytes                 - d.bytes, 0),
            downloaded            = GREATEST(s.downloaded            - d.downloaded, 0),
            "downloadedBytes"     = GREATEST(s."downloadedBytes"     - d."downloadedBytes", 0),
            unarchived            = GREATEST(s.unarchived            - d.unarchived, 0),
            "unarchivedBytes"     = GREATEST(s."unarchivedBytes"     - d."unarchivedBytes", 0),
            "downloadFailed"      = GREATEST(s."downloadFailed"      - d."downloadFailed", 0),
            "downloadFailedBytes" = GREATEST(s."downloadFailedBytes" - d."downloadFailedBytes", 0),
            pending               = GREATEST(s.pending               - d.pending, 0),
            "pendingBytes"        = GREATEST(s."pendingBytes"        - d."pendingBytes", 0)
        FROM (
            SELECT COALESCE(o."extensionId", 0) AS "extensionId",
                   count(*) AS files,
                   COALESCE(sum(o.filesize), 0) AS bytes,
                   count(*) FILTER (WHERE o."downloadStatus" = 1) AS downloaded,
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" = 1), 0) AS "downloadedBytes",
                   count(*) FILTER (WHERE o."downloadStatus" = -5) AS unarchived,
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" = -5), 0) AS "unarchivedBytes",
                   count(*) FILTER (WHERE o."downloadStatus" < 0 AND o."downloadStatus" <> -5) AS "downloadFailed",
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" < 0 AND o."downloadStatus" <> -5), 0) AS "downloadFailedBytes",
                   count(*) FILTER (WHERE o."downloadStatus" = 0) AS pending,
                   COALESCE(sum(o.filesize) FILTER (WHERE o."downloadStatus" = 0), 0) AS "pendingBytes"
            FROM old_table o
            JOIN new_table n ON n.id = o.id
            WHERE (o."extensionId", o.filesize, o."downloadStatus")
                  IS DISTINCT FROM (n."extensionId", n.filesize, n."downloadStatus")
            GROUP BY COALESCE(o."extensionId", 0)
        ) d
        WHERE s."extensionId" = d."extensionId";

        INSERT INTO files."stats" AS s (
            "extensionId", files, bytes,
            downloaded, "downloadedBytes",
            unarchived, "unarchivedBytes",
            "downloadFailed", "downloadFailedBytes",
            pending, "pendingBytes")
        SELECT COALESCE(n."extensionId", 0),
               count(*),
               COALESCE(sum(n.filesize), 0),
               count(*) FILTER (WHERE n."downloadStatus" = 1),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" = 1), 0),
               count(*) FILTER (WHERE n."downloadStatus" = -5),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" = -5), 0),
               count(*) FILTER (WHERE n."downloadStatus" < 0 AND n."downloadStatus" <> -5),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" < 0 AND n."downloadStatus" <> -5), 0),
               count(*) FILTER (WHERE n."downloadStatus" = 0),
               COALESCE(sum(n.filesize) FILTER (WHERE n."downloadStatus" = 0), 0)
        FROM new_table n
        JOIN old_table o ON o.id = n.id
        WHERE (o."extensionId", o.filesize, o."downloadStatus")
              IS DISTINCT FROM (n."extensionId", n.filesize, n."downloadStatus")
        GROUP BY COALESCE(n."extensionId", 0)
        ON CONFLICT ("extensionId") DO UPDATE
            SET files                 = s.files                 + EXCLUDED.files,
                bytes                 = s.bytes                 + EXCLUDED.bytes,
                downloaded            = s.downloaded            + EXCLUDED.downloaded,
                "downloadedBytes"     = s."downloadedBytes"     + EXCLUDED."downloadedBytes",
                unarchived            = s.unarchived            + EXCLUDED.unarchived,
                "unarchivedBytes"     = s."unarchivedBytes"     + EXCLUDED."unarchivedBytes",
                "downloadFailed"      = s."downloadFailed"      + EXCLUDED."downloadFailed",
                "downloadFailedBytes" = s."downloadFailedBytes" + EXCLUDED."downloadFailedBytes",
                pending               = s.pending               + EXCLUDED.pending,
                "pendingBytes"        = s."pendingBytes"        + EXCLUDED."pendingBytes";
    END IF;

    RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.files_sutartys_adp_queue_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_dok_id bigint;
BEGIN
    -- Sutarčių šaltinio raktas: sourceId0 = dokId (žr. failuIrasymas.js SALTINIAI).
    IF TG_OP = 'DELETE' THEN
        SELECT CASE WHEN st.title = 'sutartys' AND OLD."sourceId0" ~ '^[0-9]+$'
                    THEN OLD."sourceId0"::bigint END
        INTO v_dok_id
        FROM files."sourceTitles" st WHERE st.id = OLD."sourceTitleId";
        IF v_dok_id IS NOT NULL THEN PERFORM public.enqueue_vpm_sutartis_adp(v_dok_id); END IF;
        RETURN OLD;
    END IF;

    SELECT CASE WHEN st.title = 'sutartys' AND NEW."sourceId0" ~ '^[0-9]+$'
                THEN NEW."sourceId0"::bigint END
    INTO v_dok_id
    FROM files."sourceTitles" st WHERE st.id = NEW."sourceTitleId";
    IF v_dok_id IS NOT NULL THEN PERFORM public.enqueue_vpm_sutartis_adp(v_dok_id); END IF;
    RETURN NEW;
END;
$function$
;

-- 5. Teisės ------------------------------------------------------------------
--
-- Lentelių ACL keliauja kartu su lentele (SELECT: `kiaurastekinis`,
-- `viespirkiaiDev`, `viesduomenys`), bet be USAGE ant schemos jos lieka
-- nepasiekiamos. Toks pat rinkinys yra ant visų kitų iš `public` iškeltų
-- schemų. `viespirkiai` (aplikacijos rolė) čia nereikalinga – ji yra
-- `pg_read_all_data`/`pg_write_all_data` narė. `analyst` negauna nieko: šios
-- lentelės nėra MCP TABLE_WHITELIST'e.

GRANT USAGE ON SCHEMA files TO kiaurastekinis, "viespirkiaiDev", viesduomenys;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
    GRANT SELECT ON TABLES TO kiaurastekinis, "viespirkiaiDev", viesduomenys;

-- 6. Lentelių registras -----------------------------------------------------
--
-- dba."lenteles" eilučių šioms lentelėms nebuvo – grupę jos gaudavo per
-- dba."grupiuTaisykles" prefiksus `files` ir `dezes`. Po pervadinimo tie
-- prefiksai nebeatpažįsta nė vienos lentelės (`authors`, `md5`, `stats` …),
-- o taisyklės schemos nežino (žr. src/lib/dbSchema/grupes.ts – grupuojama tik
-- pagal vardą), tad be šių eilučių visos 25 nukristų į „Nesugrupuota".
--
-- Taip pat elgtasi su kiekviena kita iš `public` iškelta schema: `sodra`,
-- `liteko`, `ppa`, `vpmSutartys` ir kt. dba."lenteles" eilutes turi.
--
-- "aptiktaAutomatiskai" = true palieka eilutes atviras
-- `npm run db:schema:rasytojai` skriptui, kad jis užpildytų "moduliai"
-- (jo ON CONFLICT liečia tik "moduliai", tad "grupeId" išlieka).

INSERT INTO dba."lenteles" ("schema", "lentele", "grupeId", "aptiktaAutomatiskai")
SELECT 'files', v.lentele, g.id, true
FROM (VALUES
    ('files'),
    ('dezes'),
    ('authors'),
    ('dataExtraction'),
    ('documentsQueue'),
    ('downloadQueue'),
    ('extensions'),
    ('extractionQueue'),
    ('filenames'),
    ('hidden'),
    ('infoFiles'),
    ('locations'),
    ('md5'),
    ('md5Boxes'),
    ('md5BoxesCounts'),
    ('md5BoxesCountsDistribution'),
    ('ocrQueue'),
    ('ocrStatsDay'),
    ('ocrStatus'),
    ('passwords'),
    ('photos'),
    ('sourceTitles'),
    ('specialTypeNames'),
    ('specialTypes'),
    ('stats')
) AS v(lentele)
JOIN dba."grupes" g ON g.raktas = 'failai'
ON CONFLICT ("schema", "lentele") DO NOTHING;

-- dba."grupiuTaisykles" prefiksai `files` ir `dezes` lieka: `files` vis dar
-- atitinka pačią files."files" lentelę, `dezes` – files."dezes". Kitoms 23
-- grupę duoda aukščiau įrašytos eilutės (rankinis įrašas nugali taisyklę).

COMMIT;

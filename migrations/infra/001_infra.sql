-- Schema `infra`: aplikacijos vidinės infrastruktūros lentelės, iškeltos iš
-- `public` (2026-09). Trys lentelės, kurios aprašo ne duomenų šaltinius, o
-- pačią nuskaitymo mašineriją: dokumentų nuskaitymo mazgus, OCR mazgus ir
-- proxy serverius. `public` lieka duomenų (files*, vpmSutartys*) schema.
--
-- Lentelių pavadinimai nesikeičia — perkeliama tik schema, tad duomenys,
-- pirminiai raktai, indeksai ir sekos keliauja kartu su ALTER TABLE SET SCHEMA.
-- Į `infra` NEDUODAMA teisių `analyst` rolei: šios lentelės į MCP
-- TABLE_WHITELIST niekada nebuvo įtrauktos ir neturi būti matomos užklausose.
--
-- Pritaikius: `npm run db:schema:dump` perrašo dbSchema/ failus
-- (public.dokNuskaitytojai.sql, public.ocrNuskaitytojai.sql,
-- public.scrapeProxies.sql → infra.*.sql).
--
-- Šis failas po pritaikymo neredaguojamas — kitas pakeitimas yra naujas
-- migrations/infra/002_<vardas>.sql.

BEGIN;

CREATE SCHEMA IF NOT EXISTS infra;

COMMENT ON SCHEMA infra IS
    'Vidinė nuskaitymo infrastruktūra: dokumentų ir OCR mazgai, scrape proxy. Ne duomenų šaltinis — čia laikoma tik tai, kas aprašo pačią sistemą.';

-- 1. Lentelių perkėlimas ----------------------------------------------------
--
-- Kartu su lentele automatiškai persikelia jai priklausantys indeksai,
-- apribojimai ir stulpelių sekos ("ocrNuskaitytojai_id_seq",
-- "scrapeProxies_id_seq"; "dokNuskaitytojai" naudoja IDENTITY).
-- Išorinės nuorodos (public."filesOcrStatus"."nodeId",
-- public."filesOcrStatsDay"."nodeId" → "ocrNuskaitytojai", ir abiejų mazgų
-- lentelių "apiRaktasId" → auth."raktai") saugomos pagal OID, tad
-- perkėlimo metu nenutrūksta ir jų perrašinėti nereikia.

ALTER TABLE public."dokNuskaitytojai" SET SCHEMA infra;
ALTER TABLE public."ocrNuskaitytojai" SET SCHEMA infra;
ALTER TABLE public."scrapeProxies"    SET SCHEMA infra;

-- 2. Trigerio funkcija ------------------------------------------------------
--
-- public.track_ocr_rezervacijos() kūne lentelė nurodyta vardu (regclass
-- nesaugomas), tad ją reikia perrašyti su nauja schema. Funkcija ir ją
-- naudojantis trigeris lieka `public` — juda tik nuoroda į mazgų lentelę.

CREATE OR REPLACE FUNCTION public.track_ocr_rezervacijos()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- INSERT: new reserved file
    IF TG_OP = 'INSERT' THEN
        IF NEW."ocrState" = -3 THEN
            UPDATE infra."ocrNuskaitytojai"
            SET rezervacijos = COALESCE(rezervacijos, 0) + 1
            WHERE pavadinimas = NEW."ocrNode";
        END IF;
        RETURN NEW;
    END IF;

    -- DELETE: reserved file removed
    IF TG_OP = 'DELETE' THEN
        IF OLD."ocrState" = -3 THEN
            UPDATE infra."ocrNuskaitytojai"
            SET rezervacijos = GREATEST(COALESCE(rezervacijos, 0) - 1, 0)
            WHERE pavadinimas = OLD."ocrNode";
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE cases

    -- became reserved
    IF NEW."ocrState" = -3 AND OLD."ocrState" IS DISTINCT FROM -3 THEN
        UPDATE infra."ocrNuskaitytojai"
        SET rezervacijos = COALESCE(rezervacijos, 0) + 1
        WHERE pavadinimas = NEW."ocrNode";
    END IF;

    -- released from reservation
    IF OLD."ocrState" = -3 AND NEW."ocrState" IS DISTINCT FROM -3 THEN
        UPDATE infra."ocrNuskaitytojai"
        SET rezervacijos = GREATEST(COALESCE(rezervacijos, 0) - 1, 0)
        WHERE pavadinimas = OLD."ocrNode";
    END IF;

    -- moved between nodes while reserved
    IF OLD."ocrState" = -3
       AND NEW."ocrState" = -3
       AND OLD."ocrNode" IS DISTINCT FROM NEW."ocrNode" THEN

        UPDATE infra."ocrNuskaitytojai"
        SET rezervacijos = GREATEST(COALESCE(rezervacijos, 0) - 1, 0)
        WHERE pavadinimas = OLD."ocrNode";

        UPDATE infra."ocrNuskaitytojai"
        SET rezervacijos = COALESCE(rezervacijos, 0) + 1
        WHERE pavadinimas = NEW."ocrNode";
    END IF;

    RETURN NEW;
END;
$function$;

COMMIT;

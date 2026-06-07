-- ============================================================================
-- dokumentaiLocationTiles — precomputed heatmap tile aggregation + sync trigger
-- ----------------------------------------------------------------------------
-- Mirrors the juridiniai heatmap setup (public.jarCsvLocationTiles +
-- syncjarcsvlocationtiles() / trg_syncjarcsvlocationtiles): the PNG tile
-- endpoint reads pre-aggregated point counts per web-mercator XYZ tile, and a
-- row trigger keeps those counts in sync as documents change.
--
--   * dokumentai ALREADY carry coordinates in dokumentai.location — only READ.
--   * Counts are maintained per zoom 0..20 (same range as the jarCsv trigger);
--     the tile endpoint serves zoom = leafletZoom + OVERSAMPLE(4).
--   * No GiST index: the one-off rebuild is a full scan + GROUP BY; afterwards
--     the trigger touches only the affected (zoom,tileX,tileY) rows.
--   * UPDATE only re-buckets when location actually changed — dokumentai is a
--     busy table, so we skip the decrement/increment churn on unrelated updates
--     (this is the one deliberate improvement over the jarCsv version).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."dokumentaiLocationTiles" (
    "zoom"       smallint NOT NULL,
    "tileX"      integer  NOT NULL,
    "tileY"      integer  NOT NULL,
    "pointCount" integer  NOT NULL,
    CONSTRAINT "dokumentaiLocationTiles_pkey" PRIMARY KEY ("zoom", "tileX", "tileY")
);

CREATE INDEX IF NOT EXISTS "dokumentaiLocationTiles_zoom_tileX_tileY_idx"
    ON public."dokumentaiLocationTiles" USING btree ("zoom", "tileX", "tileY");

-- ----------------------------------------------------------------------------
-- 1) One-off full rebuild from the coordinates that already exist.
--    web-mercator tile math:
--      tileX = floor( (lon + 180) / 360 * 2^z )
--      tileY = floor( (1 - ln(tan(lat) + sec(lat)) / pi) / 2 * 2^z )
-- ----------------------------------------------------------------------------
TRUNCATE public."dokumentaiLocationTiles";

INSERT INTO public."dokumentaiLocationTiles" ("zoom", "tileX", "tileY", "pointCount")
SELECT
    zoom,
    "tileX",
    "tileY",
    count(*)::int AS "pointCount"
FROM (
    SELECT
        z::smallint AS zoom,
        floor( ((ST_X(d.location::geometry) + 180.0) / 360.0) * power(2.0, z) )::int AS "tileX",
        floor(
            (1.0 - ln(
                tan(radians(ST_Y(d.location::geometry)))
                + 1.0 / cos(radians(ST_Y(d.location::geometry)))
            ) / pi()) / 2.0 * power(2.0, z)
        )::int AS "tileY"
    FROM public.dokumentai d
    CROSS JOIN generate_series(0, 20) AS z
    WHERE d.location IS NOT NULL
      AND ST_Y(d.location::geometry) BETWEEN -85.05112878 AND 85.05112878
) t
GROUP BY zoom, "tileX", "tileY";

ANALYZE public."dokumentaiLocationTiles";

-- ----------------------------------------------------------------------------
-- 2) Incremental sync trigger — keeps the tiles in step with dokumentai writes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.syncdokumentailocationtiles()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    z         int;
    oldTileX  int;
    oldTileY  int;
    newTileX  int;
    newTileY  int;
BEGIN
    -- DELETE: drop the old point from every zoom.
    IF TG_OP = 'DELETE' THEN
        IF OLD.location IS NOT NULL THEN
            FOR z IN 0..20 LOOP
                oldTileX := floor((ST_X(OLD.location::geometry) + 180) / 360 * power(2.0, z))::int;
                oldTileY := floor((1 - ln(tan(radians(ST_Y(OLD.location::geometry))) + 1 / cos(radians(ST_Y(OLD.location::geometry)))) / pi()) / 2 * power(2.0, z))::int;

                UPDATE public."dokumentaiLocationTiles"
                SET "pointCount" = "pointCount" - 1
                WHERE "zoom" = z AND "tileX" = oldTileX AND "tileY" = oldTileY;

                DELETE FROM public."dokumentaiLocationTiles"
                WHERE "zoom" = z AND "tileX" = oldTileX AND "tileY" = oldTileY
                  AND "pointCount" <= 0;
            END LOOP;
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE that doesn't move the point: nothing to do (dokumentai is busy).
    IF TG_OP = 'UPDATE' AND NEW.location IS NOT DISTINCT FROM OLD.location THEN
        RETURN NEW;
    END IF;

    -- INSERT / UPDATE: remove the old point (UPDATE) then add the new one.
    IF TG_OP = 'UPDATE' AND OLD.location IS NOT NULL THEN
        FOR z IN 0..20 LOOP
            oldTileX := floor((ST_X(OLD.location::geometry) + 180) / 360 * power(2.0, z))::int;
            oldTileY := floor((1 - ln(tan(radians(ST_Y(OLD.location::geometry))) + 1 / cos(radians(ST_Y(OLD.location::geometry)))) / pi()) / 2 * power(2.0, z))::int;

            UPDATE public."dokumentaiLocationTiles"
            SET "pointCount" = "pointCount" - 1
            WHERE "zoom" = z AND "tileX" = oldTileX AND "tileY" = oldTileY;

            DELETE FROM public."dokumentaiLocationTiles"
            WHERE "zoom" = z AND "tileX" = oldTileX AND "tileY" = oldTileY
              AND "pointCount" <= 0;
        END LOOP;
    END IF;

    IF NEW.location IS NOT NULL THEN
        FOR z IN 0..20 LOOP
            newTileX := floor((ST_X(NEW.location::geometry) + 180) / 360 * power(2.0, z))::int;
            newTileY := floor((1 - ln(tan(radians(ST_Y(NEW.location::geometry))) + 1 / cos(radians(ST_Y(NEW.location::geometry)))) / pi()) / 2 * power(2.0, z))::int;

            INSERT INTO public."dokumentaiLocationTiles" ("zoom", "tileX", "tileY", "pointCount")
            VALUES (z, newTileX, newTileY, 1)
            ON CONFLICT ("zoom", "tileX", "tileY")
            DO UPDATE SET "pointCount" = public."dokumentaiLocationTiles"."pointCount" + 1;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_syncdokumentailocationtiles ON public.dokumentai;
CREATE TRIGGER trg_syncdokumentailocationtiles
    AFTER INSERT OR DELETE OR UPDATE ON public.dokumentai
    FOR EACH ROW EXECUTE FUNCTION public.syncdokumentailocationtiles();

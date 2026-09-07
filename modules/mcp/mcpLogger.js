/**
 * MCP įrankių iškvietimų žurnalas. Lentelės gyvena `mcp` schemoje
 * (DDL — mcpSchema.sql): faktų eilutė `mcp."toolCalls"` laiko tik žodynų ID.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";

const logger = new Logger();

export const requestContext = new AsyncLocalStorage();

let dbReadOnly = false;

/** Nežinomos klaidos loginamos po vieną kartą kodui – kad hot path'as nespamintų. */
const pranestosKlaidos = new Set();

/**
 * Žodynų reikšmių riba. `userAgent` ateina iš kliento header'io, tad be ribos
 * piktas klientas galėtų prikišti neribotai unikalių eilučių į žodyną.
 * Realūs duomenys (2026-08) telpa į 111 simbolių.
 */
const MAX_ZODYNO_ILGIS = 256;

/**
 * Vienas sakinys: žodynų upsert'ai CTE viduje + faktų eilutė. Taip hot path'e
 * lieka vienas round-trip ir nereikia proceso cache'o.
 *
 * Žodynų INSERT'ai atsirenka `NOT EXISTS` prieš `ON CONFLICT DO NOTHING`, nes
 * konfliktuojanti eilutė identity sekos reikšmę vis tiek sunaudoja: be šito
 * filtro kiekvienas toolcall'as degino po vieną id ir 17 eilučių `toolName`
 * lentelė išnaudojo visą smallint seką (žr.
 * migrations/mcp/001_toolNameInteger.sql). `ON CONFLICT` paliekamas lenktynėms
 * tarp lygiagrečių iškvietimų.
 *
 * Id imamas repo šablonu „esama eilutė UNION ALL ką tik įterpta", nes CTE'os
 * viena kitos įterptų eilučių nemato. Lenktynių atveju (tą pačią naują reikšmę
 * įterpia kitas procesas) `RETURNING` tuščias, o bazinė lentelė matoma tik
 * sakinio snapshot'e – tokia viena eilutė žurnale prarandama su NOT NULL
 * klaida, kurią dabar bent pamatysim log'e.
 */
const INSERT_SQL = `
    WITH tn AS (
        INSERT INTO mcp."toolName" ("toolName")
        SELECT $1::text
        WHERE NOT EXISTS (
            SELECT 1 FROM mcp."toolName" WHERE "toolName" = $1::text)
        ON CONFLICT ("toolName") DO NOTHING
        RETURNING id
    ), em AS (
        INSERT INTO mcp."errorMsg" ("errorMsg")
        SELECT $4::text
        WHERE $4::text IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM mcp."errorMsg" WHERE "errorMsg" = $4::text)
        ON CONFLICT ("errorMsg") DO NOTHING
        RETURNING id
    ), ua AS (
        INSERT INTO mcp."userAgent" ("userAgent")
        SELECT $5::text
        WHERE $5::text IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM mcp."userAgent" WHERE "userAgent" = $5::text)
        ON CONFLICT ("userAgent") DO NOTHING
        RETURNING id
    )
    INSERT INTO mcp."toolCalls" ("toolNameId", "durationMs", success, "errorMsgId", "userAgentId")
    SELECT
        (SELECT id FROM mcp."toolName" WHERE "toolName" = $1::text
         UNION ALL SELECT id FROM tn LIMIT 1),
        $2,
        $3,
        (SELECT id FROM mcp."errorMsg" WHERE "errorMsg" = $4::text
         UNION ALL SELECT id FROM em LIMIT 1),
        (SELECT id FROM mcp."userAgent" WHERE "userAgent" = $5::text
         UNION ALL SELECT id FROM ua LIMIT 1)`;

function trumpinti(value) {
    if (value == null) return null;
    return String(value).slice(0, MAX_ZODYNO_ILGIS);
}

export async function logToolCall({ toolName, durationMs, success, errorMsg }) {
    if (dbReadOnly) return;
    const ctx = requestContext.getStore();
    try {
        await postgres.query(INSERT_SQL, [
            trumpinti(toolName),
            durationMs,
            success,
            trumpinti(errorMsg),
            trumpinti(ctx?.userAgent),
        ]);
    } catch (err) {
        // Read-only replika – tyli ir žinoma būsena, daugiau nebandom.
        if (err?.code === "25006") {
            dbReadOnly = true;
            return;
        }
        // Visa kita anksčiau buvo ryjama be pėdsako: kai 2026-09 seka atsirėmė
        // į smallint lubas, žurnalas stovėjo 6 paras ir niekas to nematė.
        const raktas = err?.code ?? err?.message;
        if (!pranestosKlaidos.has(raktas)) {
            pranestosKlaidos.add(raktas);
            logger.log(
                `logToolCall nepavyko (${err?.code ?? "be kodo"}): ${err?.message}`,
            );
        }
    }
}

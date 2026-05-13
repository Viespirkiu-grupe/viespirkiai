import {z} from "zod";
import {analystPool} from "../analyst/pool.js";
import {MAX_QUERY_LENGTH, validateSql} from "../analyst/validateSql.js";
import {logToolCall} from "../mcpLogger.js";
import config from "../../../utils/config.js";

const PAGE_SIZE = 50;

export const name = "execute_query";
export const description =
    "Vykdo tik skaitymo SQL SELECT užklausas viešųjų pirkimų duomenų bazėje. " +
    "Naudok TIK agreguotai analizei: skaičiavimams, santykiams, statistikai, lentelių jungimui. " +
    "Paieškai (sutarčių, dokumentų, skelbimų, įmonių) naudok specialius įrankius: " +
    "search_sutartys, search_failai, search_viesieji_pirkimai, search_juridiniai — ne šį įrankį. " +
    "Prieš rašant užklausą iškvieskite get_schema stulpelių pavadinimams patikrinti. " +
    "Rezultatai puslapiuojami — " + PAGE_SIZE + " eilučių per puslapį. " +
    "Pasiekiami rodiniai: v_company, v_sutartys, v_pirkimas, v_person_links, v_dalyviai, v_bylos.";

export const schema = {
    query: z
        .string()
        .min(10)
        .max(MAX_QUERY_LENGTH)
        .describe("SQL SELECT statement to execute"),
    purpose: z
        .string()
        .min(5)
        .max(500)
        .describe("Human-readable description of what this query is testing — written to the audit log"),
    page: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(1)
        .describe("Page number (1-based). Page size is fixed at 50 rows. Max page is 200."),
};

export async function handler({query, purpose, page}) {
    const error = validateSql(query);
    if (error) {
        // No logging via logToolCall is happening here, because invalid requests not worth logging
        return {
            content: [{type: "text", text: error}],
            isError: true,
        };
    }

    const offset = (page - 1) * PAGE_SIZE;
    // Fetch one extra row to detect whether more pages exist — avoids a full-scan COUNT(*) OVER ()
    const wrappedSql = `SELECT q.*
                        FROM (${query}) AS q
                        LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;

    const start = Date.now();
    const client = await analystPool.connect();

    try {
        await client.query(`SET LOCAL statement_timeout = '${Number(config.mcpQueryTimeout)}s'`);
        const result = await client.query(wrappedSql);

        const durationMs = Date.now() - start;
        const hasMore = result.rows.length > PAGE_SIZE;
        const rows = hasMore ? result.rows.slice(0, PAGE_SIZE) : result.rows;

        const payload = {
            rows,
            page,
            pageSize: PAGE_SIZE,
            rowCount: rows.length,
            hasMore,
            durationMs,
        };

        logToolCall({ toolName: name, durationMs, success: true });
        return {
            content: [{type: "text", text: JSON.stringify(payload)}],
        };
    } catch (err) {
        logToolCall({ toolName: name, durationMs: Date.now() - start, success: false, errorMsg: err.message });
        return {
            content: [{type: "text", text: err.message}],
            isError: true,
        };
    } finally {
        client.release();
    }
}

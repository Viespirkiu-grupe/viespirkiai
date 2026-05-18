import { z } from "zod";
import { analystPool } from "../analyst/pool.js";
import { MAX_QUERY_LENGTH, validateSql } from "../analyst/validateSql.js";
import { executeWithColumnFix } from "../analyst/columnFixer.js";
import { logToolCall } from "../mcpLogger.js";
import configModule from "../../../utils/config.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = configModule as any;

const PAGE_SIZE = 50;

export const name = "execute_query";
export const description =
    "Vykdo skaitymo SQL SELECT užklausas viešųjų pirkimų DB. " +
    "NAUDOK visada kai reikia tikslių skaičių, sumų, procentų, tendencijų ar bet kokio kiekybinio fakto — " +
    "search_* įrankiai grąžina maks. 50 eilučių su total=null ir NEGALI pagrįsti kiekybinių teiginių. " +
    "Paieškai naudok: search_sutartys, search_failai, search_viesieji_pirkimai, search_juridiniai. " +
    "Rodinių stulpeliai (get_schema nereikia — rašyk užklausą iš karto): " +
    "v_sutartys→sutartiesUnikalusId,pirkejoKodas,pirkejas,tiekejoKodas,tiekejas,verte,sudarymoData,bvpzKodas,tipas,istrinta,pirkimoNumeris,faktineIvykdimoVerte; " +
    "v_company→jarKodas,pavadinimas,darbuotojai,vidutinisAtlyginimas,imokuSuma,melagingisTiekejas,nepatikimasTiekejas,bylosSkaicius,domenaiSkaicius,registravimoData; " +
    "v_pirkimas→pirkimoId,jarKodas,organizatorius,pirkimoBudas,statusas,numatomaVerteEUR,esFinansavimas,bvpzKodai,paskelbimoData; " +
    "v_person_links→id,vardas,pavarde,jarKodas,imonesVardas,pareigos,irasoTipas,rysioPradzia,rysioPabaiga,yraJuridinisAsmuo,registruotaLietuvoje; " +
    "v_dalyviai→pirkimoNumeris,pirkejoKodas,tiekejoKodas,tiekejas,eileNumeris,pasiulymoKaina,atmetimoPriezastis,interesuKonfliktasNustatytas; " +
    "v_bylos→bylosId,jarKodas,bylosNumeris,bylosRusis,bylosData,teismas,bylojeKaip. " +
    "Lentelėms (ne v_*) iškvieskite get_schema(table, mode:'detail') prieš rašant užklausą. " +
    "Rezultatai puslapiuojami — " + PAGE_SIZE + " eilučių per puslapį.";

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

export async function handler({ query, purpose, page }: { query: string; purpose: string; page: number }): Promise<object> {
    console.error(`[execute_query] CALL query="${query}" purpose="${purpose}" page=${page}`);
    const error = validateSql(query);
    if (error) {
        console.error(`[execute_query] INVALID query="${query}" reason="${error}"`);
        return {
            content: [{ type: "text", text: error }],
            isError: true,
        };
    }

    return await executeWithColumnFix(
        (q) => _runQuery(q, purpose, page),
        query,
    );
}

async function _runQuery(query: string, purpose: string, page: number) {
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

        console.error(`[execute_query] OK rows=${rows.length} hasMore=${hasMore} durationMs=${durationMs}`);
        logToolCall({ toolName: name, durationMs, success: true, errorMsg: undefined });
        return {
            content: [{ type: "text", text: JSON.stringify(payload) }],
        };
    } catch (err: unknown) {
        const msg = (err as Error & { code?: string }).code === "42703" || (err as Error).message.includes("does not exist")
            ? (err as Error).message + "\n\nHINT: Column names differ between tables and views. Call get_schema with the exact table/view name and mode:'detail' to see the correct column list before retrying."
            : (err as Error).message;
        console.error(`[execute_query] ERROR query="${query}" error="${(err as Error).message}"`);
        logToolCall({ toolName: name, durationMs: Date.now() - start, success: false, errorMsg: (err as Error).message });
        return {
            content: [{ type: "text", text: msg }],
            isError: true,
        };
    } finally {
        client.release();
    }
}

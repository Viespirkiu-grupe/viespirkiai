import {z} from "zod";
import {analystPool} from "../analyst/pool.js";
import {MAX_QUERY_LENGTH, validateSql} from "../analyst/validateSql.js";
import {executeWithColumnFix} from "../analyst/columnFixer.js";
import {logToolCall} from "../mcpLogger.js";
import config from "../../../utils/config.js";

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

export async function handler({query, purpose, page}) {
    const error = validateSql(query);
    if (error) {
        // No logging via logToolCall is happening here, because invalid requests not worth logging
        return {
            content: [{type: "text", text: error}],
            isError: true,
        };
    }

    return await executeWithColumnFix(
        (q) => _runQuery(q, purpose, page),
        query,
    );
}

async function _runQuery(query, purpose, page) {
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
        let msg = err.message;
        // PostgreSQL error code 42703 = undefined_column
        if (err.code === "42703" || msg.includes("does not exist")) {
            msg += "\n\nHINT: Column names differ between tables and views. Call get_schema with the exact table/view name and mode:'detail' to see the correct column list before retrying.";
        }
        return {
            content: [{type: "text", text: msg}],
            isError: true,
        };
    } finally {
        client.release();
    }
}

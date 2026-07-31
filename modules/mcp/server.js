import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import config from "../../utils/config.js";
import { logToolCall } from "./mcpLogger.js";
import * as getFailas from "./tools/getFailas.js";
import * as getFailasTekstas from "./tools/getFailasTekstas.js";
import * as getJuridinis from "./tools/getJuridinis.js";
import * as getPinregAsmuo from "./tools/getPinregAsmuo.js";
import * as getPinregJar from "./tools/getPinregJar.js";
import * as getSutartis from "./tools/getSutartis.js";
import * as getViesasisPirkimas from "./tools/getViesasisPirkimas.js";
import * as searchDokumentai from "./tools/searchDokumentai.js";
import * as searchJuridiniai from "./tools/searchJuridiniai.js";
import * as searchSutartys from "./tools/searchSutartys.js";
import * as searchViesiejiPirkimai from "./tools/searchViesiejiPirkimai.js";
import * as getSchema from "./tools/getSchema.js";
import * as executeQuery from "./tools/executeQuery.js";

function wrapHandler(toolName, handler) {
    return async (params) => {
        const start = Date.now();
        try {
            const result = await handler(params);
            const durationMs = Date.now() - start;
            const isError = result?.isError === true;
            logToolCall({ toolName, durationMs, success: !isError });
            return result;
        } catch (err) {
            logToolCall({
                toolName,
                params,
                durationMs: Date.now() - start,
                success: false,
                errorMsg: err?.message,
            });
            throw err;
        }
    };
}

const tools = config.enableExecuteQueryMcpOnly
    ? [getSchema, executeQuery]
    : [
          getFailas,
          getFailasTekstas,
          getJuridinis,
          getPinregAsmuo,
          getPinregJar,
          getSutartis,
          getViesasisPirkimas,
          searchDokumentai,
          searchJuridiniai,
          searchSutartys,
          searchViesiejiPirkimai,
          ...(config.enableExecuteQueryMcp ? [getSchema, executeQuery] : []),
      ];

export function createMcpServer() {
    const server = new McpServer({ name: "viespirkiai", version: "1.0.0" });
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                // Įrankiai eksportuoja žalią laukų rinkinį — SDK v2 nori pilnos
                // Standard Schema schemos, todėl apvyniojam z.object.
                inputSchema: z.object(tool.schema),
            },
            wrapHandler(tool.name, tool.handler),
        );
    }
    return server;
}

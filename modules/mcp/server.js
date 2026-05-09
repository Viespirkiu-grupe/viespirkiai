import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logToolCall } from "./mcpLogger.js";
import * as getFailas from "./tools/getFailas.js";
import * as getFailasTekstas from "./tools/getFailasTekstas.js";
import * as getJuridinis from "./tools/getJuridinis.js";
import * as getPinregAsmuo from "./tools/getPinregAsmuo.js";
import * as getPinregJar from "./tools/getPinregJar.js";
import * as getSutartis from "./tools/getSutartis.js";
import * as getViesasisPirkimas from "./tools/getViesasisPirkimas.js";
import * as searchFailai from "./tools/searchFailai.js";
import * as searchJuridiniai from "./tools/searchJuridiniai.js";
import * as searchSutartys from "./tools/searchSutartys.js";
import * as searchViesiejiPirkimai from "./tools/searchViesiejiPirkimai.js";

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

const tools = [
    getFailas,
    getFailasTekstas,
    getJuridinis,
    getPinregAsmuo,
    getPinregJar,
    getSutartis,
    getViesasisPirkimas,
    searchFailai,
    searchJuridiniai,
    searchSutartys,
    searchViesiejiPirkimai,
];

export function createMcpServer() {
    const server = new McpServer({ name: "viespirkiai", version: "1.0.0" });
    for (const tool of tools) {
        server.tool(tool.name, tool.description, tool.schema, wrapHandler(tool.name, tool.handler));
    }
    return server;
}

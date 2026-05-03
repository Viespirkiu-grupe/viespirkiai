import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logToolCall } from "./mcpLogger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTools() {
    const files = await readdir(join(__dirname, "tools"));
    return Promise.all(
        files
            .filter((f) => f.endsWith(".js"))
            .map(
                (f) => import(pathToFileURL(join(__dirname, "tools", f)).href),
            ),
    );
}

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

const tools = await loadTools();

export function createMcpServer() {
    const server = new McpServer({ name: "viespirkiai", version: "1.0.0" });
    for (const tool of tools) {
        server.tool(tool.name, tool.description, tool.schema, wrapHandler(tool.name, tool.handler));
    }
    return server;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const tools = await loadTools();

export function createMcpServer() {
    const server = new McpServer({ name: "viespirkiai", version: "1.0.0" });
    for (const tool of tools) {
        server.tool(tool.name, tool.description, tool.schema, tool.handler);
    }
    return server;
}

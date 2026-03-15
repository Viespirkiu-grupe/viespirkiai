import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../modules/mcp/server.js";

const mcpRouter = express.Router();

mcpRouter.post("/mcp", async (req, res) => {
    const server = await createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

export default mcpRouter;

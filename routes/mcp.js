import express from "express";

const mcpRouter = express.Router();

let mcpImports = null;

mcpRouter.post("/mcp", async (req, res) => {
    if (!mcpImports) {
        mcpImports = await Promise.all([
            import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
            import("../modules/mcp/server.js"),
        ]);
    }
    const [{ StreamableHTTPServerTransport }, { createMcpServer }] = mcpImports;
    const server = await createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

export default mcpRouter;

import express from "express";
import config from "../utils/config.js";
import { requestContext } from "../modules/mcp/mcpLogger.js";

const mcpRouter = express.Router();

mcpRouter.get("/mcp", (req, res) => {
    res.render("mcp", { customHead: config.customHead });
});

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
    const ctx = { userAgent: req.headers["user-agent"] ?? null };
    await requestContext.run(ctx, () => transport.handleRequest(req, res, req.body));
});

export default mcpRouter;

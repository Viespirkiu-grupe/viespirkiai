import { createMcpServer } from '@/modules/mcp/server.js';
import { requestContext } from '@/modules/mcp/mcpLogger.js';
import { createMcpHandler } from '@modelcontextprotocol/server';

/**
 * MCP serveris veikia be būsenos (stateless): jokių sesijų, jokio initialize
 * rankos paspaudimo, jokių atvirų SSE srautų. Kiekvieną užklausą aptarnauja
 * šviežias serverio egzempliorius iš to paties factory, todėl bet kuri užklausa
 * gali nutūpti ant bet kurio instanso už paprasto round-robin balancerio.
 */
const handler = createMcpHandler(() => createMcpServer(), {
  legacy: 'stateless',
  onerror: (error) => {
    console.error(JSON.stringify({ type: 'mcp-error', message: error.message }));
  },
});

export function isMcpTransportRequest(request: Request): boolean {
  return request.method === 'POST';
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  return await requestContext.run(
    { userAgent: request.headers.get('user-agent') ?? null },
    async () => handler.fetch(request),
  );
}

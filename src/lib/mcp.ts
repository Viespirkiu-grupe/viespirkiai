import { createMcpServer } from '@/modules/mcp/server.js';
import { requestContext } from '@/modules/mcp/mcpLogger.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export function isMcpTransportRequest(request: Request): boolean {
  const acceptHeader = request.headers.get('accept') ?? '';

  return (
    request.method === 'POST' ||
    request.method === 'DELETE' ||
    (request.method === 'GET' && acceptHeader.includes('text/event-stream'))
  );
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  return await requestContext.run(
    { userAgent: request.headers.get('user-agent') ?? null },
    async () => transport.handleRequest(request),
  );
}

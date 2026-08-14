import { describe, expect, it } from 'vitest';
import { handleMcpRequest, isMcpTransportRequest } from '@/src/lib/mcp';

const MODERN_PROTOCOL_VERSION = '2026-07-28';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:1010/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** 2026-07-28 užklausa: savarankiška, su kliento tapatybe `_meta` vokelyje. */
function modernPost(id: number, method: string, params: Record<string, unknown> = {}): Request {
  return post(
    {
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    },
    {
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      'mcp-method': method,
      // SEP-2243: tools/call privalo skelbti įrankio vardą antraštėje, kad
      // gateway'us galėtų maršrutizuoti neskaitydamas kūno.
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
    },
  );
}

/** SSE atsakymo kūne suranda pirmą JSON-RPC pranešimą. */
async function readSseMessage(response: Response): Promise<any> {
  const text = await response.text();
  const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
  return JSON.parse(dataLine!.slice('data:'.length).trim());
}

describe('stateless MCP — 2026-07-28 era', () => {
  it('atsako į tools/list be initialize, be sesijos, paprastu JSON', async () => {
    const response = await handleMcpRequest(modernPost(1, 'tools/list'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('mcp-session-id')).toBeNull();

    const payload = await response.json();
    expect(payload.id).toBe(1);
    expect(Array.isArray(payload.result.tools)).toBe(true);
    expect(payload.result.tools.length).toBeGreaterThan(0);
    expect(payload.result.tools.map((tool: any) => tool.name)).toContain('get_dokumentas_tekstas');
    expect(payload.result.tools.map((tool: any) => tool.name)).toContain('get_teises_akto_tekstas');
    expect(payload.result.tools.map((tool: any) => tool.name)).toContain('get_teises_akto_istrauka');
  });

  it('kiekviena užklausa nepriklausoma — antra be jokio ankstesnio konteksto', async () => {
    const payload = await (await handleMcpRequest(modernPost(2, 'tools/list'))).json();
    expect(payload.id).toBe(2);
    expect(payload.error).toBeUndefined();
  });

  it('tools/call be Mcp-Name antraštės atmetamas', async () => {
    const request = post(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_failas',
          arguments: { id: 1 },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'mcp-protocol-version': MODERN_PROTOCOL_VERSION, 'mcp-method': 'tools/call' },
    );

    const payload = await (await handleMcpRequest(request)).json();
    expect(payload.error.code).toBe(-32020);
  });

  it('tools/call su Mcp-Name pasiekia įrankį ir jo argumentų validaciją', async () => {
    const response = await handleMcpRequest(
      modernPost(5, 'tools/call', { name: 'get_failas', arguments: { id: 'ne-id' } }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toContain('get_failas');
  });

  it('palaiko server/discover — pajėgumai be rankos paspaudimo', async () => {
    const response = await handleMcpRequest(modernPost(3, 'server/discover'));
    const payload = await response.json();

    expect(payload.error).toBeUndefined();
    expect(payload.result.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    expect(payload.result.capabilities.tools).toBeDefined();
    expect(payload.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('viespirkiai');
  });
});

describe('stateless MCP — 2025 era (atgalinis suderinamumas)', () => {
  it('sena tools/list užklausa be initialize aptarnaujama be sesijos', async () => {
    const response = await handleMcpRequest(
      post({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeNull();

    const payload = await readSseMessage(response);
    expect(payload.id).toBe(10);
    expect(Array.isArray(payload.result.tools)).toBe(true);
  });
});

describe('transporto maršrutizavimas', () => {
  it('tik POST laikomas transporto užklausa', () => {
    expect(isMcpTransportRequest(post({}))).toBe(true);
    expect(isMcpTransportRequest(new Request('http://localhost:1010/mcp'))).toBe(false);
    expect(
      isMcpTransportRequest(
        new Request('http://localhost:1010/mcp', {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
        }),
      ),
    ).toBe(false);
    expect(isMcpTransportRequest(new Request('http://localhost:1010/mcp', { method: 'DELETE' }))).toBe(false);
  });
});

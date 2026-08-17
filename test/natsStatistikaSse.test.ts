import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handler: undefined as undefined | ((payload: unknown, raw: string, subject: string) => void),
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../utils/natsHub.js', () => ({
  subscribe: mocks.subscribe.mockImplementation(
    (_subject: string, handler: (payload: unknown, raw: string, subject: string) => void) => {
      mocks.handler = handler;
      return mocks.unsubscribe;
    },
  ),
}));

import { GET } from '../src/pages/statistika/nats/sse.ts';

describe('/statistika/nats/sse', () => {
  it('prenumeruoja visus subject ir perduoda tikrą subject naršyklei', async () => {
    const abort = new AbortController();
    const response = await GET({
      request: new Request('http://localhost/statistika/nats/sse', { signal: abort.signal }),
    } as any) as Response;

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(mocks.subscribe).toHaveBeenCalledWith('>', expect.any(Function));

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe('retry: 1000\n\n');

    mocks.handler?.({ source: 'test', count: 2 }, '', 'viespirkiai.dev.work.test.ready');
    const chunk = decoder.decode((await reader.read()).value);
    expect(chunk).toContain('viespirkiai.dev.work.test.ready');
    expect(chunk).toContain('"count":2');

    abort.abort();
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});

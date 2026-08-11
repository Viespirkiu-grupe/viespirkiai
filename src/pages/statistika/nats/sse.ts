import type { APIRoute } from 'astro';
import { subscribe } from '@/utils/natsHub.js';

type NatsEvent = {
  receivedAt: number;
  subject: string;
  payload: unknown;
};

type Listener = (event: NatsEvent) => void;

// Viena wildcard prenumerata procese, nepriklausomai nuo atidarytų naršyklių.
// Istorijos serveryje nekaupiame: kiekviena naršyklė pati laiko paskutinius 1000.
const listeners = new Set<Listener>();
let unsubscribeNats: (() => void) | undefined;

function addListener(listener: Listener) {
  listeners.add(listener);
  if (!unsubscribeNats) {
    unsubscribeNats = subscribe('>', (payload, _raw, subject) => {
      const event: NatsEvent = { receivedAt: Date.now(), subject, payload };
      for (const current of [...listeners]) current(event);
    });
  }
}

function removeListener(listener: Listener) {
  listeners.delete(listener);
  if (listeners.size === 0 && unsubscribeNats) {
    unsubscribeNats();
    unsubscribeNats = undefined;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let cancelStream = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const stop = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        removeListener(send);
      };
      cancelStream = stop;

      const send = (event: NatsEvent) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          stop();
        }
      };

      request.signal.addEventListener('abort', stop, { once: true });

      try {
        controller.enqueue(encoder.encode('retry: 1000\n\n'));
      } catch {
        stop();
        return;
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          stop();
        }
      }, 15_000);

      addListener(send);
    },
    cancel() {
      cancelStream();
    },
  });

  return new Response(stream, { headers });
};

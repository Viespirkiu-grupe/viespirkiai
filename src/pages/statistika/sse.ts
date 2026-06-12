import type { APIRoute } from 'astro';
import { gautiStatistika, humanizeStatistika, buildSsePayload, diffPayload } from '@/modules/statistika/statistika.js';

// Vienas bendras ticker'is visoms SSE jungtims: statistika paruošiama kartą
// per tick'ą, o ne kiekvienai jungčiai atskirai.
const TICK_MS = 1000;

type Subscriber = { onPayload: (payload: any) => void; onError: () => void };

const subscribers = new Set<Subscriber>();
let ticker: ReturnType<typeof setInterval> | undefined;

async function buildPayload() {
  return buildSsePayload(humanizeStatistika(await gautiStatistika()));
}

async function tick() {
  let payload;
  try {
    payload = await buildPayload();
  } catch {
    for (const sub of [...subscribers]) sub.onError();
    return;
  }
  for (const sub of [...subscribers]) sub.onPayload(payload);
}

function subscribe(sub: Subscriber) {
  subscribers.add(sub);
  if (!ticker) ticker = setInterval(tick, TICK_MS);
}

function unsubscribe(sub: Subscriber) {
  subscribers.delete(sub);
  if (subscribers.size === 0 && ticker) {
    clearInterval(ticker);
    ticker = undefined;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let lastPayload: any = null;
      let lastTimestampOnlySentAt = 0;

      const sendUpdate = (nextPayload: any) => {
        if (closed || request.signal.aborted) return;
        try {
          const delta = diffPayload(lastPayload, nextPayload);
          if (delta === undefined) return;
          const keys = Object.keys(delta);
          if (keys.length === 1 && keys[0] === 'atnaujinta') {
            const now = Date.now();
            if (now - lastTimestampOnlySentAt < 1000) return;
            lastTimestampOnlySentAt = now;
          }
          lastPayload = nextPayload;
          controller.enqueue(enc.encode(`data: ${JSON.stringify(delta)}\n\n`));
        } catch { stop(); }
      };

      const subscriber: Subscriber = { onPayload: sendUpdate, onError: () => stop() };

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe(subscriber);
      };

      request.signal.addEventListener('abort', stop, { once: true });

      try { controller.enqueue(enc.encode('retry: 1000\n\n')); } catch { stop(); return; }

      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(enc.encode(': ping\n\n')); } catch { stop(); }
      }, 15000);

      try {
        sendUpdate(await buildPayload());
      } catch { stop(); return; }
      if (!closed) subscribe(subscriber);
    },
  });

  return new Response(stream, { headers });
};

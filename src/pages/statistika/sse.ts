import type { APIRoute } from 'astro';
import { gautiStatistika, humanizeStatistika, buildSsePayload, diffPayload } from '@/modules/statistika/statistika.js';

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
      let interval: ReturnType<typeof setInterval> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let lastPayload: any = null;
      let lastTimestampOnlySentAt = 0;

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
      };

      request.signal.addEventListener('abort', stop, { once: true });

      try { controller.enqueue(enc.encode('retry: 1000\n\n')); } catch { stop(); return; }

      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(enc.encode(': ping\n\n')); } catch { stop(); }
      }, 15000);

      const sendUpdate = async () => {
        if (closed || request.signal.aborted) return;
        try {
          const statistika = await gautiStatistika();
          const nextPayload = buildSsePayload(humanizeStatistika(statistika));
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

      await sendUpdate();
      interval = setInterval(sendUpdate, 100);
    },
  });

  return new Response(stream, { headers });
};

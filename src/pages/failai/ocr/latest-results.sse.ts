import type { APIRoute } from 'astro';
import { loadLatestOcrResults } from '../../../lib/ocrLatestResults.ts';

export const GET: APIRoute = async ({ request }) => {
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let interval: ReturnType<typeof setInterval> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let lastPayload = '';

      const stop = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (heartbeat) clearInterval(heartbeat);
      };

      request.signal.addEventListener('abort', stop, { once: true });

      const push = async () => {
        if (closed || request.signal.aborted) return;
        try {
          const items = await loadLatestOcrResults(15);
          const nextPayload = JSON.stringify(items);
          if (nextPayload === lastPayload) return;
          lastPayload = nextPayload;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ updatedAt: Date.now() })}\n\n`));
        } catch {
          stop();
        }
      };

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
      }, 15000);

      await push();

      interval = setInterval(() => {
        void push();
      }, 250);
    },
  });

  return new Response(stream, { headers });
};

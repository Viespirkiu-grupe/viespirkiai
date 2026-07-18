import type { APIRoute } from 'astro';
import { subscribe } from '../../../../postgres/pgNotifyHub.js';
import { loadLatestOcrResults } from '../../../lib/ocrLatestResults.ts';

const OCR_RESULTS_CHANNEL = 'ocr_latest_results';

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
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;
      let lastPayload = '';

      const sendItems = async () => {
        if (closed || request.signal.aborted) return;
        try {
          const items = await loadLatestOcrResults(15);
          const nextPayload = JSON.stringify(items);
          if (nextPayload === lastPayload) return;
          lastPayload = nextPayload;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ items })}\n\n`));
        } catch {
          stop();
        }
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = undefined;
        }
      };

      request.signal.addEventListener('abort', () => { stop(); }, { once: true });

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

      try {
        unsubscribe = subscribe(OCR_RESULTS_CHANNEL, () => { void sendItems(); });
        await sendItems();
      } catch {
        stop();
      }
    },
  });

  return new Response(stream, { headers });
};

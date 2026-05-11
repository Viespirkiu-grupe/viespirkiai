import type { APIRoute } from 'astro';
import { postgres } from '../../../../postgres/postgres.js';
import { loadLatestOcrResults } from '../../../lib/ocrLatestResults.ts';
import { ocrLiveUpdates } from '../../../lib/ocrLiveUpdates.ts';

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
      let interval: ReturnType<typeof setInterval> | undefined;
      let client: Awaited<ReturnType<typeof postgres.connect>> | undefined;
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
          await stop();
        }
      };

      const onNotification = () => { void sendItems(); };

      const stop = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (interval) clearInterval(interval);
        if (client) {
          client.removeListener('notification', onNotification);
          try {
            await client.query(`UNLISTEN ${OCR_RESULTS_CHANNEL}`);
          } catch {}
          client.release();
        }
      };

      request.signal.addEventListener('abort', () => { void stop(); }, { once: true });

      try {
        controller.enqueue(encoder.encode('retry: 1000\n\n'));
      } catch {
        await stop();
        return;
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          void stop();
        }
      }, 15000);

      if (ocrLiveUpdates.mode === 'poll') {
        await sendItems();
        interval = setInterval(() => {
          void sendItems();
        }, ocrLiveUpdates.intervalMs);
        return;
      }

      try {
        client = await postgres.connect();
        await client.query(`LISTEN ${OCR_RESULTS_CHANNEL}`);
        client.on('notification', onNotification);
        await sendItems();
      } catch {
        await stop();
      }
    },
  });

  return new Response(stream, { headers });
};

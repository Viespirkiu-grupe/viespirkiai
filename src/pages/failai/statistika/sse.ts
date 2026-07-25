import { formatDateTime } from '../../../../utils/time.js';
import { linksniuotiOnly } from '../../../../utils/linksniai.js';
import { convertUnit } from '../../../../utils/units.js';
import { gautiFailuStatistika } from '../statistika.json.ts';

function buildPayload(statistika: any) {
  const totalWords = Number(statistika.nuskaitymas.zodziai.total);
  const nuskaityti = Number(statistika.nuskaitymas.nuskaityti);

  return {
    atnaujinta: formatDateTime(new Date()),
    totalWordsNumber: totalWords.toLocaleString('lt-LT'),
    totalWordsLabel: `${linksniuotiOnly(totalWords, ['žodis', 'žodžiai', 'žodžių', 'žodžio'])} teksto`,
    // Tikras nuskaityto turinio dydis — parsiųstų failų baitai.
    dataSize: convertUnit(Number(Number(Number(statistika.failai.dydziai.parsiusti).toFixed(2))), { from: 'B', to: 'GB' }),
    filesWithWordsNumber: nuskaityti.toLocaleString('lt-LT'),
    filesWithWordsLabel: linksniuotiOnly(nuskaityti, ['failas', 'failai', 'failų', 'failo']),
  };
}

const loadStats = gautiFailuStatistika;

export async function GET({ request }: { request: Request }) {
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

      const stop = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
      };

      request.signal.addEventListener('abort', stop, { once: true });

      const push = async () => {
        if (closed || request.signal.aborted) return;
        try {
          const payload = buildPayload(await loadStats());
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
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

      await push();

      interval = setInterval(() => {
        void push();
      }, 1000);
    },
  });

  return new Response(stream, { headers });
}
import { postgres } from '../../../../postgres/postgres.js';
import { formatDateTime } from '../../../../utils/time.js';
import { linksniuotiOnly } from '../../../../utils/linksniai.js';
import { convertUnit } from '../../../../utils/units.js';

function buildPayload(statistika: any) {
  const totalWords = Number(statistika.nuskaitymas.zodziai.total);
  const failaiSuZodziais = Number(statistika.nuskaitymas.zodziai.failaiSuZodziais);
  const visiFailai = Number(statistika.failai.kiekiai.visi);
  const visiDydziai = Number(statistika.failai.dydziai.visi);
  const duomenuBaitai = visiDydziai * (visiFailai > 0 ? failaiSuZodziais / visiFailai : 0);

  return {
    atnaujinta: formatDateTime(new Date()),
    totalWordsNumber: totalWords.toLocaleString('lt-LT'),
    totalWordsLabel: `${linksniuotiOnly(totalWords, ['žodis', 'žodžiai', 'žodžių', 'žodžio'])} teksto`,
    dataSize: convertUnit(Number(Number(duomenuBaitai.toFixed(2))), { from: 'B', to: 'GB' }),
    filesWithWordsNumber: failaiSuZodziais.toLocaleString('lt-LT'),
    filesWithWordsLabel: linksniuotiOnly(failaiSuZodziais, ['failas', 'failai', 'failų', 'failo']),
  };
}

async function loadStats() {
  const { rows } = await postgres.query(`SELECT metrika, eilute, verte FROM "failaiCounts";`);
  const counts = rows.reduce((acc: any, row: any) => {
    const { metrika, eilute, verte } = row;
    if (!acc[metrika]) acc[metrika] = eilute === 'ALL' ? verte : {};
    if (eilute === 'ALL') acc[metrika] = verte;
    else acc[metrika][eilute] = verte;
    return acc;
  }, {});

  return {
    failai: {
      kiekiai: {
        visi: counts.visi,
        klaida: counts.klaida,
        parsiusti: counts.parsiusti,
        neparsiusti: counts.visi - counts.parsiusti - counts.klaida - counts.extracted,
      },
      dydziai: {
        visi: (counts.dydis / counts.parsiusti) * counts.visi,
        klaida: (counts.dydis / counts.parsiusti) * counts.klaida,
        parsiusti: counts.dydis,
        neparsiusti: (counts.dydis / counts.parsiusti) * (counts.visi - counts.parsiusti - counts.klaida - counts.extracted),
      },
    },
    nuskaitymas: {
      zodziai: {
        total: counts.zodziuSuma,
        failaiSuZodziais: counts.zodziuKiekisNeNulis,
      },
    },
  };
}

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
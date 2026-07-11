// Statistikos puslapio „tiesioginio atnaujinimo" (SSE) elgesys. Mygtukas
// #liveUpdate atidaro EventSource į /statistika/sse ir perpiešia rodiklius bei
// lenteles pagal gaunamą payload. Iškelta iš statistika/index.astro inline
// script'o, kad būtų tipizuojama ir atskirta nuo markup'o.
import { escapeHtml } from '@design-system/lib/html.ts';

export function initStatistikaLive() {
  const button = document.getElementById('liveUpdate');
  if (!button) return;
  let evtSource: EventSource | null = null;

  const setText = (key: string, value: string) => {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = value;
  };

  const updatePage = (payload: any) => {
    if (payload.atnaujinta !== undefined) setText('atnaujinta', payload.atnaujinta);

    const fk = payload.failai?.kiekiai;
    if (fk?.visi !== undefined) setText('failai.kiekiai.visi', fk.visi);
    if (fk?.parsiusti !== undefined) setText('failai.kiekiai.parsiusti', fk.parsiusti);
    if (fk?.klaida !== undefined) setText('failai.kiekiai.klaida', fk.klaida);
    if (fk?.neparsiusti !== undefined) setText('failai.kiekiai.neparsiusti', fk.neparsiusti);

    const fd = payload.failai?.dydziai;
    if (fd?.visi !== undefined) setText('failai.dydziai.visi', fd.visi);
    if (fd?.parsiusti !== undefined) setText('failai.dydziai.parsiusti', fd.parsiusti);
    if (fd?.klaida !== undefined) setText('failai.dydziai.klaida', fd.klaida);
    if (fd?.neparsiusti !== undefined) setText('failai.dydziai.neparsiusti', fd.neparsiusti);

    const z = payload.nuskaitymas?.zodziai;
    if (z?.total !== undefined) setText('nuskaitymas.zodziai.total', z.total);
    if (z?.vidurkis !== undefined) setText('nuskaitymas.zodziai.vidurkis', z.vidurkis);
    if (z?.vidurkisNeNulis !== undefined) setText('nuskaitymas.zodziai.vidurkisNeNulis', z.vidurkisNeNulis);
    if (z?.failuSuZodziaisDalis !== undefined) setText('nuskaitymas.zodziai.failuSuZodziaisDalis', z.failuSuZodziaisDalis);

    const db = payload.database;
    if (db?.uptime !== undefined) setText('database.uptime', db.uptime);
    if (db?.xact_commit !== undefined) setText('database.xact_commit', db.xact_commit);
    if (db?.tup_inserted !== undefined) setText('database.tup_inserted', db.tup_inserted);
    if (db?.tup_updated !== undefined) setText('database.tup_updated', db.tup_updated);
    if (db?.tup_deleted !== undefined) setText('database.tup_deleted', db.tup_deleted);
    if (db?.tup_fetched !== undefined) setText('database.tup_fetched', db.tup_fetched);

    const pvBody = document.getElementById('pagalVersijaBody');
    if (pvBody && payload.nuskaitymas?.pagalVersija) {
      pvBody.innerHTML = payload.nuskaitymas.pagalVersija.map((v: any) =>
        `<tr><td>${escapeHtml(v.status)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(v.kiekis)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(v.procentai)}</td></tr>`
      ).join('');
    }

    const tnBody = document.getElementById('topNuskaitytojaiBody');
    if (tnBody && payload.topDokNuskaitytojai) {
      tnBody.innerHTML = payload.topDokNuskaitytojai.map((n: any) =>
        `<tr><td>${escapeHtml(n.viesasPavadinimas)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(n.nuskaitytidokumentai)}</td></tr>`
      ).join('');
    }

    const lBody = document.getElementById('lentelesBody');
    if (lBody && payload.lenteles) {
      lBody.innerHTML = payload.lenteles.map((l: any) =>
        `<tr class="${l.isTotal ? 'font-bold' : ''}"><td>${escapeHtml(l.tableName)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(l.dataSize)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(l.indexSize)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(l.totalSize)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(l.approxRowCount)}</td></tr>`
      ).join('');
    }

    if (payload.eiles) {
      payload.eiles.forEach((e: any) => {
        const value = document.querySelector(`[data-queue="${CSS.escape(e.tableName)}"]`);
        if (value) value.textContent = e.approxRowCount;
      });
    }

    const qiBody = document.getElementById('quickwitIndeksaiBody');
    if (qiBody && payload.quickwitIndeksai) {
      qiBody.innerHTML = payload.quickwitIndeksai.map((i: any) =>
        `<tr><td class="cell-mono cell-right cell-nowrap">${escapeHtml(i.id)}</td><td>${escapeHtml(i.lentele)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(i.seq)}</td><td class="cell-mono cell-nowrap">${escapeHtml(i.indeksas)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(i.shardSize)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(i.gyvosEilutes)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(i.iterptosEilutes)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(i.mirusiosEilutes)}</td><td>${escapeHtml(i.current)}</td><td class="cell-mono cell-nowrap">${escapeHtml(i.sukurta)}</td><td class="cell-mono cell-nowrap">${escapeHtml(i.indexConfigHash)}</td></tr>`
      ).join('');
    }

    const rBody = document.getElementById('replikacijaBody');
    if (rBody && payload.replikacija) {
      rBody.innerHTML = payload.replikacija.length === 0
        ? `<tr><td colspan="11" class="text-muted">Nėra prisijungusių replikų</td></tr>`
        : payload.replikacija.map((r: any) =>
          `<tr><td class="cell-mono cell-nowrap">${escapeHtml(r.client_addr)}</td><td>${escapeHtml(r.state)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.sent_lsn)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.write_lsn)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.flush_lsn)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.replay_lsn)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.write_lag)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.flush_lag)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.replay_lag)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.primary_current_lsn)}</td><td class="cell-mono cell-right cell-nowrap">${escapeHtml(r.bytes_behind)}</td></tr>`
        ).join('');
    }
  };

  const stopSSE = () => {
    if (!evtSource) return;
    evtSource.close(); evtSource = null;
    button.textContent = '▶ Tiesioginis atnaujinimas';
    button.classList.replace('btn-primary', 'btn-outline');
  };

  const startSSE = () => {
    evtSource?.close();
    evtSource = new EventSource('/statistika/sse');
    button.textContent = '⏸ Tiesioginis atnaujinimas';
    button.classList.replace('btn-outline', 'btn-primary');
    evtSource.onmessage = (e) => updatePage(JSON.parse(e.data));
    evtSource.onerror = () => {
      evtSource?.close(); evtSource = null;
      setTimeout(() => { if (button.classList.contains('btn-primary')) startSSE(); }, 500);
    };
  };

  button.addEventListener('click', () => (evtSource ? stopSSE() : startSSE()));
}

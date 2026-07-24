// Eigos/greičio formatavimas ilgai sukantiems batch'iniams darbams. Tie patys
// `secs()`, `mb()`, `eta()` buvo kopijuojami į kiekvieną migracijos scriptą.

/** Skaičius lietuviška grupavimo forma: 1 234 567. */
export function nf(value) {
    return Number(value).toLocaleString("lt-LT");
}

/** Milisekundės → sekundės su 2 skaitmenimis po kablelio (be vieneto). */
export function secs(ms) {
    return (ms / 1000).toFixed(2);
}

/** Baitai → MB su 1 skaitmeniu (be vieneto). */
export function mb(bytes) {
    return (bytes / 1024 / 1024).toFixed(1);
}

/** Sekundės → „45s" / „3.2min" / „1.4h". */
export function fmtDur(secLeft) {
    if (!Number.isFinite(secLeft) || secLeft < 0) return "?";
    if (secLeft < 90) return `${secLeft.toFixed(0)}s`;
    if (secLeft < 5400) return `${(secLeft / 60).toFixed(1)}min`;
    return `${(secLeft / 3600).toFixed(1)}h`;
}

/**
 * Likęs laikas pagal vidutinį greitį nuo pradžios.
 * @param {number} done - kiek jau padaryta
 * @param {number} total - kiek iš viso (gali būti Infinity → „-")
 * @param {number} elapsedMs
 */
export function eta(done, total, elapsedMs) {
    if (!done || !Number.isFinite(total) || done >= total) return "-";
    return fmtDur(((total - done) * elapsedMs) / done / 1000);
}

/** Dalis nuo bendro laiko procentais: „37%". */
export function pctOf(ms, totalMs) {
    return `${((ms / totalMs) * 100).toFixed(0)}%`;
}

// Slenkančio lango greitis/ETA: laikom (t, n) įvykius ir skaičiuojam vnt/s per
// paskutinių W ms langą, o ne per viso proceso vidurkį (kuris „atsimena" lėtą startą).
const DEFAULT_WINDOWS = [15000, 60000, 300000]; // 15s / 60s / 5min

export class SlidingEta {
    /**
     * @param {number} startMs - `performance.now()` darbo pradžioje
     * @param {number[]} [windows] - langų dydžiai ms
     */
    constructor(startMs, windows = DEFAULT_WINDOWS) {
        this.start = startMs;
        this.windows = windows;
        this.events = []; // {t, n}, didėjančia t tvarka
    }

    add(now, n) {
        this.events.push({ t: now, n });
        const oldest = now - this.windows[this.windows.length - 1];
        let drop = 0;
        while (drop < this.events.length && this.events[drop].t < oldest) drop++;
        if (drop) this.events.splice(0, drop);
    }

    /** Greitis (vnt/s) per paskutinius W ms. */
    rate(now, W) {
        const cutoff = now - W;
        let sum = 0;
        for (let i = this.events.length - 1; i >= 0; i--) {
            if (this.events[i].t < cutoff) break;
            sum += this.events[i].n;
        }
        const spanMs = Math.min(W, now - this.start);
        return spanMs > 0 ? sum / (spanMs / 1000) : 0;
    }

    /** „15s 42v/s→3.1min | 60s 38v/s→3.4min | 5m 40v/s→3.3min" */
    format(now, remaining, unit = "v") {
        return this.windows
            .map((W) => {
                const r = this.rate(now, W);
                const label = W < 60000 ? `${W / 1000}s` : `${W / 60000}min`;
                const left = r > 0 && Number.isFinite(remaining) ? fmtDur(remaining / r) : "?";
                return `${label} ${r.toFixed(0)}${unit}/s→${left}`;
            })
            .join(" | ");
    }
}

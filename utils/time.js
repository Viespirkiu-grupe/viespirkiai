import { DateTime } from "luxon";

/**
 * Converts a UTC Date object to Lithuanian local time (Europe/Vilnius),
 * accounting for daylight saving time.
 * @param {Date|string|number|null|undefined} utcDate - A UTC date value.
 * @returns {string|number|null|undefined} - A formatted date string or the original input if it cannot be converted.
 */
export function toLithuanianTime(utcDate) {
    if (
        utcDate === null ||
        utcDate === undefined ||
        utcDate === "" ||
        utcDate === 0
    ) {
        return utcDate;
    }

    // If utcDate is a number, assume it's a Unix timestamp in seconds
    if (typeof utcDate === "number") {
        return DateTime.fromSeconds(utcDate, { zone: "utc" })
            .setZone("Europe/Vilnius")
            .toFormat("yyyy-MM-dd HH:mm:ss");
    }

    let dateTime;

    if (utcDate instanceof Date) {
        dateTime = DateTime.fromJSDate(utcDate, { zone: "utc" });
    } else if (typeof utcDate === "string") {
        dateTime = DateTime.fromSQL(utcDate, { zone: "utc" });
        if (!dateTime.isValid) {
            dateTime = DateTime.fromISO(utcDate, { zone: "utc" });
        }
    } else {
        return utcDate;
    }

    return dateTime.isValid
        ? dateTime.setZone("Europe/Vilnius").toFormat("yyyy-MM-dd HH:mm:ss")
        : utcDate;
}

/**
 * Converts specific date fields in an object to Lithuanian local time.
 * The fields are: sudarymoData, galiojimoData, faktineIvykdimoData,
 * paskelbimoData, paskutinioAtnaujinimoData,
 * and paskutinioRedagavimoData.
 * @param {Object} item
 * @returns {Object}
 */
export function dataToLithuanianTime(item) {
    const keys = [
        "sudarymoData",
        "galiojimoData",
        "faktineIvykdimoData",
        "paskelbimoData",
        "paskutinioAtnaujinimoData",
        "paskutinioRedagavimoData",
        "duomenuData",
        "statusasNuo",
        "registravimoData",
    ];

    keys.forEach((key) => {
        item[key] = toLithuanianTime(item[key]);
    });
    return item;
}

/**
 * Converts an array of objects, converting specific date fields
 * to Lithuanian local time.
 * @param {Array} data
 * @returns {Array}
 */
export function arrayToLithuanianTime(data) {
    return data.map(dataToLithuanianTime);
}

/**
 * Palaukia nurodytą milisekundžių skaičių.
 *
 * Perdavus `signal`, laukimas nutraukiamas anksčiau (be klaidos) — taip
 * ilgai veikiančių darbininkų retry ciklai nestabdo graceful shutdown'o.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal] Nutraukia laukimą prieš laiką.
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();

        const timer = setTimeout(finish, ms);

        function finish() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", finish);
            resolve();
        }

        signal?.addEventListener("abort", finish, { once: true });
    });
}

/**
 * Bet kokią datos/laiko reikšmę paverčia RFC 3339 (UTC) eilute — tokia forma, kokios
 * tikisi Quickwit `datetime` laukai.
 *
 * SVARBU dėl laiko juostos: PostgreSQL `timestamp without time zone` stulpeliai per
 * `postgres/postgres.js` tipo parserį grįžta kaip paprasta eilutė („2026-07-07 23:31:29")
 * BE juostos žymės, o duomenys į juos rašomi Lietuvos vietos laiku. Todėl tokia eilutė
 * čia interpretuojama kaip `Europe/Vilnius` ir konvertuojama į UTC. Anksčiau kiekvienas
 * Quickwit indeksuotojas turėjo savo `toRfc3339` kopiją ir jos elgėsi skirtingai —
 * viešųjų pirkimų versija Vilniaus laiką laikė UTC ir pastumdavo laiką 2–3 val.
 *
 * `timestamp with time zone` stulpeliai grįžta kaip `Date` — jiems juostos spėlioti
 * nereikia, `toISOString()` jau duoda teisingą UTC.
 *
 * Vien datos reikšmė („2026-06-30") juostos neturi ir turėti negali — paliekama kaip
 * UTC vidurnaktis, kad nenuslinktų į praėjusią dieną.
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {string|null} RFC 3339 eilutė UTC juostoje arba null.
 */
export function toRfc3339(value) {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();

    if (typeof value === "string") {
        // Vien data — be juostos, paliekam UTC vidurnaktį.
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;

        // „YYYY-MM-DD HH:MM:SS[.fff]" — PostgreSQL timestamp be juostos, saugomas
        // Lietuvos vietos laiku.
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
            const dt = DateTime.fromSQL(value, { zone: "Europe/Vilnius" });
            return dt.isValid
                ? dt.toUTC().toISO({ suppressMilliseconds: true })
                : value;
        }

        // Jau su juosta (ISO su Z arba ±HH:MM) arba nežinomas formatas — nekeičiam.
        return value;
    }

    return String(value);
}

export function formatDateTime(value) {
    if (!value) return "—";
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString("lt-LT", { hour12: false });
}

export function formatDuration(value) {
    if (value === null || typeof value === "undefined") return "—";
    const ms = Math.round(Number(value));
    if (!Number.isFinite(ms) || ms < 0) return "—";
    if (ms < 1000) return `${ms} ms`;

    const totalSecondsFloat = ms / 1000;
    if (totalSecondsFloat < 10) {
        return `${totalSecondsFloat.toLocaleString("lt-LT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
    }

    const totalSeconds = Math.round(totalSecondsFloat);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours} val ${String(minutes).padStart(2, "0")} min ${String(seconds).padStart(2, "0")} s`;
    if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
    return `${totalSeconds} s`;
}

Date.prototype.toLtDate = function () {
    return this.toLocaleDateString("lt-LT", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
};

Date.prototype.toLtTime = function () {
    return this.toLocaleTimeString("lt-LT", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
};

Date.prototype.toLtDateTime = function () {
    return this.toLtDate() + " " + this.toLtTime();
};

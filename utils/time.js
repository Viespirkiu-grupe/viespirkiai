import { DateTime } from "luxon";

/**
 * Converts a UTC Date object to Lithuanian local time (Europe/Vilnius),
 * accounting for daylight saving time.
 * @param {Date|null|undefined} utcDate - A UTC Date object, null, or undefined.
 * @returns {String|null|undefined} - A formatted date string or the original input if null/undefined.
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

    // Otherwise, treat it as a Date object
    return DateTime.fromJSDate(utcDate, { zone: "utc" })
        .setZone("Europe/Vilnius")
        .toFormat("yyyy-MM-dd HH:mm:ss");
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

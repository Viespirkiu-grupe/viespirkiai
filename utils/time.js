import { DateTime } from "luxon";

/**
 * Converts a UTC Date object to Lithuanian local time (Europe/Vilnius),
 * accounting for daylight saving time.
 * @param {Date|null|undefined} utcDate - A UTC Date object, null, or undefined.
 * @returns {String|null|undefined} - A formatted date string or the original input if null/undefined.
 */
export function toLithuanianTime(utcDate) {
	if (utcDate === null || utcDate === undefined || utcDate === "") {
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
		"registravimoData"
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
 * Converts a Date object to a Lithuanian date string in the format "yyyy-mm-dd".
 * @returns {Date}
 */
Date.prototype.toLtDate = function () {
	return this.toLocaleDateString("lt-LT", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
};

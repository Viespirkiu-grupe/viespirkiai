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
	if (typeof utcDate === 'number') {
		return DateTime.fromSeconds(utcDate, { zone: "utc" })
			.setZone("Europe/Vilnius")
			.toFormat("yyyy-MM-dd HH:mm:ss");
	}
	
	// Otherwise, treat it as a Date object
	return DateTime.fromJSDate(utcDate, { zone: "utc" })
		.setZone("Europe/Vilnius")
		.toFormat("yyyy-MM-dd HH:mm:ss");
}

export function unixEpochToLithuanianTime(epoch){
	console.log(epoch)
	if (epoch === null || epoch === undefined || epoch === "") {
		return epoch;
	}
	return DateTime.fromSeconds(epoch, { zone: "utc" })
		.setZone("Europe/Vilnius")
		.toFormat("yyyy-MM-dd HH:mm:ss");
}

export function dataToLithuanianTime(item) {
	const keys = [
		"sudarymoData",
		"galiojimoData",
		"faktineIvykdimoData",
		"paskelbimoData",
		"paskutinioAtnaujinimoData",
		"paskutinioRedagavimoData",
	];

	keys.forEach((key) => {
		item[key] = toLithuanianTime(item[key]);
	});
	return item;
}

export function arrayToLithuanianTime(data) {
	return data.map(dataToLithuanianTime);
}

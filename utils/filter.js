/**
 * Builds a Typesense filter from the provided query object.
 * @param {Object} query 
 * @returns {Object}
 */
export function buildTypesenseFilter(query) {
	const filters = [];
	const values = {};
	const queryParams = [];
	let usedHiddenFields = false;

	const config = [
		{
			key: "perkanciosiosOrganizacijosKodas",
			apply: (val) => {
				filters.push(`perkanciosiosOrganizacijosKodas:=${val}`);
				usedHiddenFields = true;
			},
		},
		{
			key: "tiekejoKodas",
			apply: (val) => {
				filters.push(`tiekejoKodas:=${val}`);
				usedHiddenFields = true;
			},
		},
		{
			key: "sudarymoDataNuo",
			apply: (val) => {
				const ts = Math.floor(new Date(val).getTime() / 1000);
				filters.push(`sudarymoData:>=${ts}`);
				usedHiddenFields = true;
			},
		},
		{
			key: "sudarymoDataIki",
			apply: (val) => {
				const ts = Math.floor(new Date(val).getTime() / 1000);
				filters.push(`sudarymoData:<=${ts}`);
				usedHiddenFields = true;
			},
		},
		{
			key: "verteNuo",
			apply: (val) => {
				filters.push(`verte:>=${parseFloat(val.replace(",", "."))}`);
				usedHiddenFields = true;
			},
		},
		{
			key: "verteIki",
			apply: (val) => {
				filters.push(`verte:<=${parseFloat(val.replace(",", "."))}`);
				usedHiddenFields = true;
			},
		},
		{
			key: "sutartiesUnikalusID",
			apply: (val) => {
				filters.push(`sutartiesUnikalusID:=${parseInt(val, 10)}`);
				usedHiddenFields = true;
			},
		},
		{
			key: "tikSuDokumentais",
			apply: () => {
				filters.push(`dokumentuKiekis:>0`);
				usedHiddenFields = true;
			},
			isBoolean: true,
		},
	];

	for (const { key, apply, isBoolean } of config) {
		if (isBoolean && query[key] !== undefined) {
			apply();
			values[key] = true;
			queryParams.push(`${key}=true`);
		} else if (query[key]?.length > 0) {
			apply(query[key]);
			values[key] = query[key];
			queryParams.push(`${key}=${encodeURIComponent(query[key])}`);
		}
	}

	return {
		filterBy: filters.join(" && "),
		values,
		queryParams: queryParams.length ? "&" + queryParams.join("&") : "",
		usedHiddenFields,
	};
}


/**
 * Builds a MongoDB filter from the provided query object.
 * @param {Object} query 
 * @returns {Object}
 */
export function buildMongoFilter(query) {
	const filter = {};
	const values = {};
	const queryParams = [];
	let usedHiddenFields = false;

	const config = [
		{
			key: "search",
			apply: (val) => {
				filter.$text = { $search: `"${val}"` };
			},
		},
		{
			key: "perkanciosiosOrganizacijosKodas",
			apply: (val) => {
				filter.perkanciosiosOrganizacijosKodas = val;
				usedHiddenFields = true;
			},
		},
		{
			key: "tiekejoKodas",
			apply: (val) => {
				filter.tiekejoKodas = val;
				usedHiddenFields = true;
			},

		},
		{
			key: "sudarymoDataNuo",
			apply: (val) => {
				filter.sudarymoData = { ...filter.sudarymoData, $gte: new Date(val) };
				usedHiddenFields = true;
			},

		},
		{
			key: "sudarymoDataIki",
			apply: (val) => {
				filter.sudarymoData = { ...filter.sudarymoData, $lte: new Date(val) };
				usedHiddenFields = true;
			},
		},
		{
			key: "verteNuo",
			apply: (val) => {
				filter.verte = {
					...filter.verte,
					$gte: parseFloat(val.replace(/,/g, ".")),
				};
				usedHiddenFields = true;
			},
		},
		{
			key: "verteIki",
			apply: (val) => {
				filter.verte = {
					...filter.verte,
					$lte: parseFloat(val.replace(/,/g, ".")),
				};
				usedHiddenFields = true;
			},
		},
		{
			key: "sutartiesUnikalusID",
			apply: (val) => {
				filter.sutartiesUnikalusID = parseInt(val, 10);
				usedHiddenFields = true;
			},
		},
		{
			key: "tikSuDokumentais",
			apply: () => {
				filter.dokumentuKiekis = { $gt: 0 };
				usedHiddenFields = true;
			},
			isBoolean: true,
		},


	];

	for (const { key, apply, isBoolean } of config) {
		if (isBoolean && query[key] !== undefined) {
			apply();
			values[key] = true;
			queryParams.push(`${key}=true`);
		} else if (query[key]?.length > 0) {
			apply(query[key]);
			values[key] = query[key];
			queryParams.push(`${key}=${encodeURIComponent(query[key])}`);
		}
	}

	return {
		filter,
		values,
		queryParams: queryParams.length ? "&" + queryParams.join("&") : "",
		usedHiddenFields
	};
}
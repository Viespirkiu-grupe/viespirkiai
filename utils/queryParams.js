export default function cleanEmptyQueryParams(req, res, next) {
	const originalQuery = req.query;
	const cleanedQuery = {};

	for (const [key, value] of Object.entries(originalQuery)) {
		if (value !== "" && value !== null && value !== undefined) {
			cleanedQuery[key] = value;
		}
	}

	const originalKeys = Object.keys(originalQuery);
	const cleanedKeys = Object.keys(cleanedQuery);

	if (originalKeys.length !== cleanedKeys.length) {
		const queryString = new URLSearchParams(cleanedQuery).toString();
		const redirectUrl = req.path + (queryString ? `?${queryString}` : "");
		return res.redirect(redirectUrl);
	}

	next();
}

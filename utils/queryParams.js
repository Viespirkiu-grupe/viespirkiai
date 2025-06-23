/**
 * Middleware to clean empty query parameters from the request.
 * If any empty parameters are found, it redirects to the same path with cleaned query parameters.
 * @param {Request} req
 * @param {Response} res
 * @param {Function} next
 * @returns {void|Response}
 */
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

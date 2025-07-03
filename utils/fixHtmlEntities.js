/**
 * Fixes common HTML entities and other formatting issues in a string.
 * @param {String} string
 * @returns {String}
 */
export function fixHtmlEntities(string) {
	return string.replace(
		/&amp;|&lt;|&gt;|&quot;|&#39;|&#160;|&nbsp;|&euro;|\\"/g,
		(match) => {
			const entities = {
				"&amp;": "&",
				"&lt;": "<",
				"&gt;": ">",
				"&quot;": '"',
				"&#39;": "'",
				"&#160;": " ",
				"&nbsp;": " ",
				"&euro;": "€",
				'\\"': '"',
			};
			return entities[match];
		}
	);
}

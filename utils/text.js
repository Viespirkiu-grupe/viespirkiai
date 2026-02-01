/**
 * Converts a string with accented or special Lithuanian characters into plain ASCII.
 *
 * The function first normalizes the string using NFD (Normalization Form Decomposition)
 * to separate accents, then removes combining diacritical marks. It also manually replaces
 * special Lithuanian letters with their ASCII equivalents.
 *
 * @param {string} str - The input string that may contain accented or special characters.
 * @returns {string} The ASCII-only version of the input string. Returns the original input if falsy.
 *
 * @example
 * toAscii("Ąžuolas") // returns "Azuolas"
 * toAscii("Šeima")   // returns "Seima"
 * toAscii("ėėė")     // returns "eee"
 */
export function toAscii(str) {
    if (!str) return str;
    // first normalize to NFD (separates accents)
    let s = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // handle special Lithuanian letters manually
    const replacements = {
        ą: "a",
        č: "c",
        ę: "e",
        ė: "e",
        į: "i",
        š: "s",
        ų: "u",
        ū: "u",
        ž: "z",
        Ą: "A",
        Č: "C",
        Ę: "E",
        Ė: "E",
        Į: "I",
        Š: "S",
        Ų: "U",
        Ū: "U",
        Ž: "Z",
    };

    return s.replace(/[^\u0000-\u007f]/g, (c) => replacements[c] || c);
}

/**
 * Converts a string into camelCase format.
 *
 * The function first converts the string to ASCII (removing accents and special Lithuanian letters),
 * then removes all non-alphanumeric characters (except spaces), collapses multiple spaces,
 * and finally converts the string to camelCase.
 *
 * @param {string} str - The input string to convert.
 * @returns {string} The camelCase version of the input string. Returns an empty string if input is falsy.
 *
 * @example
 * toCamelCase("Labas pasaulis")      // returns "labasPasaulis"
 * toCamelCase("Šviesus rytas!")      // returns "sviesusRytas"
 * toCamelCase("įdomūs_ženklai123")  // returns "idomusZenkla123"
 */
export function toCamelCase(str) {
    if (!str) return "";

    str = toAscii(str);

    // Remove everything except letters and numbers
    str = str.replace(/[^a-zA-Z0-9ąčęėįšųūžĄČĘĖĮŠŲŪŽ\s]/g, " ");

    // Collapse multiple spaces
    str = str.replace(/\s+/g, " ").trim();

    // Convert to camelCase
    return str
        .replace(/[_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
        .replace(/^(.)/, (_, c) => c.toLowerCase());
}

/**
 * Calculates the Levenshtein distance between two strings.
 *
 * The Levenshtein distance is a measure of the number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string into another.
 * Comparison is case-insensitive.
 *
 * @param {string} a - The first string.
 * @param {string} b - The second string.
 * @returns {number} The Levenshtein distance between the two strings.
 *
 * @example
 * levenshtein("kitten", "sitting"); // returns 3
 * levenshtein("Apple", "apple");    // returns 0
 * levenshtein("flaw", "lawn");      // returns 2
 */
export function levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, () =>
        Array(a.length + 1).fill(0),
    );

    for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost =
                a[j - 1].toLowerCase() === b[i - 1].toLowerCase() ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1, // deletion
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j - 1] + cost, // substitution
            );
        }
    }
    return matrix[b.length][a.length];
}

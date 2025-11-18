export const UNITS = {
    data: {
        units: ["B", "KB", "MB", "GB", "TB", "PB"],
        factors: Array(5).fill(1024),
    },
    time: {
        units: ["s", "min", "h", "d"],
        factors: [60, 60, 24],
    },
    length: {
        units: ["mm", "cm", "m", "km"],
        factors: [10, 100, 1000],
    },
};

/**
 * Find the category for a given unit.
 * @param {string} unit - The unit to find the category for.
 * @returns {string|null} - The category name or null if not found.
 */
function findCategory(unit) {
    for (const [category, config] of Object.entries(UNITS)) {
        if (config.units.includes(unit)) return category;
    }
    return null;
}

/**
 * Convert a value from one unit to another within a specified category.
 * @param {number} value - The numeric value to convert.
 * @param {string|object} categoryOrOptions - The category name or options object.
 * @param {object} [options] - Options for conversion if category is provided.
 * @param {string|number} [options.from] - The unit or index to convert from.
 * @param {string|number} [options.to] - The unit or index to convert to, or "auto".
 * @param {number} [options.precision=2] - Decimal places in the result.
 * @returns {string} - The converted value with unit.
 */
export function convertUnit(value, categoryOrOptions, options = {}) {
    let category, opts;

    if (typeof categoryOrOptions === "string") {
        // check if it's a known category
        if (UNITS[categoryOrOptions]) {
            category = categoryOrOptions;
            opts = options;
        } else {
            // assume it's a unit
            opts = { from: categoryOrOptions, ...options };
            category = findCategory(categoryOrOptions) || "data";
        }
    } else if (typeof categoryOrOptions === "object") {
        opts = categoryOrOptions;
        if (opts.from) category = findCategory(opts.from);
        if (!category && opts.to) category = findCategory(opts.to);
        if (!category) category = "data"; // fallback
    } else {
        category = "data";
        opts = {};
    }

    const config = UNITS[category];
    if (!config) throw new Error(`Unknown category: ${category}`);

    const { units, factors } = config;
    let val = Number(value);
    let index =
        typeof opts.from === "string"
            ? units.indexOf(opts.from)
            : opts.from || 0;
    if (index === -1) throw new Error(`Unknown from-unit: ${opts.from}`);

    const precision = opts.precision ?? 2;
    const to = opts.to ?? "auto";

    if (to === "auto") {
        while (index < factors.length && val >= factors[index]) {
            val /= factors[index];
            index++;
        }
        return `${val.toFixed(precision)} ${units[index]}`;
    } else {
        let toIndex = typeof to === "string" ? units.indexOf(to) : to;
        if (toIndex === -1) throw new Error(`Unknown to-unit: ${to}`);
        while (index < toIndex) {
            val /= factors[index];
            index++;
        }
        while (index > toIndex) {
            index--;
            val *= factors[index];
        }
        return `${val.toFixed(precision)} ${units[toIndex]}`;
    }
}

Number.prototype.convertUnit = function (categoryOrOptions, options) {
    return convertUnit(this.valueOf(), categoryOrOptions, options);
};

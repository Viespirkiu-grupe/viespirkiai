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
    // Add more categories as needed
};

// Helper: find category based on a unit string
function findCategory(unit) {
    for (const [category, config] of Object.entries(UNITS)) {
        if (config.units.includes(unit)) return category;
    }
    return null;
}

// Core conversion function
export function convertUnit(value, categoryOrOptions, options = {}) {
    let category, opts;

    if (typeof categoryOrOptions === "string" && UNITS[categoryOrOptions]) {
        category = categoryOrOptions;
        opts = options;
    } else if (typeof categoryOrOptions === "object") {
        opts = categoryOrOptions;
        if (opts.from) category = findCategory(opts.from);
        if (!category && opts.to) category = findCategory(opts.to);
        if (!category) category = "data"; // default fallback
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

// Extend Number.prototype
Number.prototype.convertUnit = function (categoryOrOptions, options) {
    return convertUnit(this.valueOf(), categoryOrOptions, options);
};

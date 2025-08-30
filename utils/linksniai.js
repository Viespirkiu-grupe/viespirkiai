export function linksniuoti(number, cases = ["įrašas", "įrašai", "įrašų"]) {
    const n = Math.abs(Number(number));

    // Determine correct Lithuanian plural form
    let form;
    if (n % 10 === 1 && n % 100 !== 11) {
        form = cases[0]; // singular
    } else if (
        [2, 3, 4, 5, 6, 7, 8, 9].includes(n % 10) &&
        !(n % 100 >= 11 && n % 100 <= 19)
    ) {
        form = cases[1]; // few
    } else {
        form = cases[2]; // many
    }

    // Format number with spaces (Lithuanian style)
    const formattedNumber = n.toLocaleString("lt-LT").replace(/\u00A0/g, " ");

    return `${formattedNumber} ${form}`;
}

export function linksniuotiK(number, cases = ["įrašo", "įrašų"]) {
    const n = Math.abs(Number(number));

    let form;
    // singular genitive: numbers ending with 1 but not 11, 111, 211, ...
    if (n % 10 === 1 && n % 100 !== 11) {
        form = cases[0]; // singular
    } else {
        form = cases[1]; // plural genitive
    }

    const formattedNumber = n.toLocaleString("lt-LT").replace(/\u00A0/g, " ");

    return `${formattedNumber} ${form}`;
}

// Extend Number.prototype
Number.prototype.linksniuoti = function (cases) {
    return linksniuoti(this.valueOf(), cases);
};

Number.prototype.linksniuotiK = function (cases) {
    return linksniuotiK(this.valueOf(), cases);
};

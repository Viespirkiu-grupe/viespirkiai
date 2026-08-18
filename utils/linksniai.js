/**
 * Linksniavimo funkcijos lietuvių kalbai
 * @param {number} number - Skaičius, kurį reikia linksniuoti
 * @param {string[]} cases - Linksnių formos masyvas: ["įrašas", "įrašai", "įrašų", "įrašo"]
 * @returns {string} - Suformatuotas skaičius su tinkama linksnio forma
 */
export function linksniuoti(
    number,
    cases = ["įrašas", "įrašai", "įrašų", "įrašo"],
) {
    const n = Math.abs(Number(number));
    const str = number.toString();
    const hasFraction = str.includes(".") || str.includes(",");

    let form;
    if (hasFraction && n !== 0) {
        // many (trupmeninė dalis)
        form = cases[3];
    } else if (n % 10 === 1 && !(n % 100 >= 11 && n % 100 <= 19)) {
        // one
        form = cases[0];
    } else if (
        n % 10 >= 2 &&
        n % 10 <= 9 &&
        !(n % 100 >= 11 && n % 100 <= 19)
    ) {
        // few
        form = cases[1];
    } else {
        // other
        form = cases[2];
    }

    const formattedNumber = n.toLocaleString("lt-LT").replace(/\u00A0/g, " ");

    return `${formattedNumber} ${form}`;
}

export function linksniuotiOnly(
    number,
    cases = ["įrašas", "įrašai", "įrašų", "įrašo"],
) {
    const n = Math.abs(Number(number));
    const str = number.toString();
    const hasFraction = str.includes(".") || str.includes(",");

    let form;
    if (hasFraction && n !== 0) {
        // many (trupmeninė dalis)
        form = cases[3];
    } else if (n % 10 === 1 && !(n % 100 >= 11 && n % 100 <= 19)) {
        // one
        form = cases[0];
    } else if (
        n % 10 >= 2 &&
        n % 10 <= 9 &&
        !(n % 100 >= 11 && n % 100 <= 19)
    ) {
        // few
        form = cases[1];
    } else {
        // other
        form = cases[2];
    }

    return `${form}`;
}

/**
 * Linksniavimo funkcija lietuvių kalbai, skirtas skaičiams naudojamiems su kilmininku
 * @param {number} number - Skaičius, kurį reikia linksniuoti
 * @param {string[]} cases - Linksnių formos masyvas: ["įrašo", "įrašų"]
 * @returns {string} - Suformatuotas skaičius su tinkama linksnio forma
 */
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

/**
 * Kaip `linksniuotiK`, tik grąžina vien žodį (be skaičiaus) — kai skaičius
 * jau atvaizduotas atskirai (pvz. su savo žymėjimu ar formatavimu).
 * @param {number} number - Skaičius, pagal kurį parenkama forma
 * @param {string[]} cases - Linksnių formos masyvas: ["įrašo", "įrašų"]
 * @returns {string} - Tinkama kilmininko forma
 */
export function linksniuotiKOnly(number, cases = ["įrašo", "įrašų"]) {
    const n = Math.abs(Number(number));
    return n % 10 === 1 && n % 100 !== 11 ? cases[0] : cases[1];
}

Number.prototype.linksniuoti = function (cases) {
    return linksniuoti(this.valueOf(), cases);
};

Number.prototype.linksniuotiOnly = function (cases) {
    return linksniuotiOnly(this.valueOf(), cases);
};

Number.prototype.linksniuotiK = function (cases) {
    return linksniuotiK(this.valueOf(), cases);
};

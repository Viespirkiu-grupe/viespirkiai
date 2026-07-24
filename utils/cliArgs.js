// Bendri CLI argumentų helperiai konsolinėms komandoms (modules/**/… paleidžiamiems
// per `node` arba npm scriptus). Prieš tai kiekvienas scriptas turėjo savo parseArgs
// kopiją — logika identiška, tad laikom vienoje vietoje.

/**
 * `--raktas reikšmė` ir `--vėliavėlė` → objektas.
 * Vėliavėlė be reikšmės (arba prieš kitą `--`) tampa `true`.
 * @param {string[]} argv - paprastai `process.argv.slice(2)`
 * @returns {Record<string, string|true>}
 */
export function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

/**
 * Skaičius su numatytąja reikšme; `--limit` be reikšmės traktuojamas kaip nenurodytas.
 * @param {string|true|undefined} value
 * @param {number} fallback
 */
export function numArg(value, fallback) {
    if (value == null || value === true || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Kaip `numArg`, tik nenurodyta reikšmė reiškia „be ribos" (Infinity). */
export function limitArg(value) {
    return numArg(value, Infinity);
}

/** Teigiamas sveikasis skaičius arba klaida (griežtesniems CLI su validacija). */
export function positiveInteger(value, option) {
    if (!/^\d+$/.test(value ?? "") || Number(value) < 1) {
        throw new Error(`${option} turi būti teigiamas sveikasis skaičius`);
    }
    return Number(value);
}

/**
 * Pozicinio stiliaus argumentų skaitytuvas: `flag("--dry-run")`, `opt("--after", 0)`.
 * @param {string[]} argv
 */
export function createArgReader(argv) {
    return {
        flag: (name) => argv.includes(name),
        opt: (name, fallback) => {
            const index = argv.indexOf(name);
            return index >= 0 ? argv[index + 1] : fallback;
        },
        positional: () => argv.filter((arg) => !arg.startsWith("--")),
    };
}

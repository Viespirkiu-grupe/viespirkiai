/**
 * Finds matching darbovietes between two sets based on vardas and pavarde.
 * @param {Array} darbovietesA
 * @param {Array} darbovietesB
 * @returns {Array} List of matching entries with both records
 */
export function findMatchingDarbovietes(darbovietesA, darbovietesB) {
    const matches = [];

    for (const a of darbovietesA || []) {
        for (const b of darbovietesB || []) {
            if (a.vardas === b.vardas && a.pavarde === b.pavarde) {
                matches.push({
                    vardas: a.vardas,
                    pavarde: a.pavarde,
                    darbovieteA: a,
                    darbovieteB: b,
                });
            }
        }
    }

    return matches;
}

/**
 * Finds matching sutuoktiniu darbovietes based on either declarer or spouse.
 * @param {Array} darbovietesA
 * @param {Array} darbovietesB
 * @returns {Array} List of matches
 */
export function findMatchingSutuoktiniuDarbovietes(darbovietesA, darbovietesB) {
    const matches = [];

    for (const a of darbovietesA || []) {
        for (const b of darbovietesB || []) {
            if (
                (a.deklaruojancioVardas === b.deklaruojancioVardas &&
                    a.deklaruojancioPavarde === b.deklaruojancioPavarde) ||
                (a.sutuoktinioVardas === b.sutuoktinioVardas &&
                    a.sutuoktinioPavarde === b.sutuoktinioPavarde)
            ) {
                matches.push({
                    deklaruojancioVardas: a.deklaruojancioVardas,
                    deklaruojancioPavarde: a.deklaruojancioPavarde,
                    sutuoktinioVardas: a.sutuoktinioVardas,
                    sutuoktinioPavarde: a.sutuoktinioPavarde,
                    darbovieteA: a,
                    darbovieteB: b,
                });
            }
        }
    }

    return matches;
}

/**
 * Finds matching rysiaiSuJa entries based on vardas and pavarde.
 * @param {Array} rysiaiA
 * @param {Array} rysiaiB
 * @returns {Array} List of matches
 */
export function findMatchingRysiaiSuJa(rysiaiA, rysiaiB) {
    const matches = [];

    for (const a of rysiaiA || []) {
        for (const b of rysiaiB || []) {
            if (a.vardas === b.vardas && a.pavarde === b.pavarde) {
                matches.push({
                    vardas: a.vardas,
                    pavarde: a.pavarde,
                    rysiaiA: a,
                    rysiaiB: b,
                });
            }
        }
    }

    return matches;
}

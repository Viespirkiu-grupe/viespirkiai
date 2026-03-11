/**
 * Maps a pinreg declaration JSON to pinregJuridiniaiRysiai rows.
 * @param {object} deklaracija - Parsed declaration JSON
 * @returns {Array} - Array of row objects
 */
export function deklaracijaToRysiai(deklaracija) {
    return [
        // KITI_RYSIAI_SU_JA
        ...(deklaracija.rysiaiSuJa || []).map((r) => ({
            irasoTipas: "KITI_RYSIAI_SU_JA",
            jarKodas: r.jaKodas,
            deklaracija: deklaracija.accessUuid,
            vardas: deklaracija.teikejas?.vardas || null,
            pavarde: deklaracija.teikejas?.pavarde || null,
            pavadinimas: r.pavadinimas,
            rysioPradzia: r.rysioPradzia,
            rysioPabaiga: r.rysioPabaiga || null,
            duomenuSaltinis: r.duomenuSaltinis || null,
            registruotaLietuvoje: r.registruotaLietuvoje,
            jaTeisinesFormosKodas: r.jaTeisinesFormosKodas,
            jaTeisinesFormosPavadinimas: r.jaTeisinesFormosPavadinimas,
            uzpildytaAutomatiskai: r.uzpildytaAutomatiskai,
            kienoRysys: r.kienoRysys,
            pastabos: r.pastabos,
            rysioPobudzioPavadinimas: r.rysioPobudzioPavadinimas,
            dalyvavimoVpInformacija: r.dalyvavimoVpInformacija,
            dalyvaujaViesuosePirkimuose: r.dalyvaujaViesuosePirkimuose,
            susijusioAsmensVardas: null,
            susijusioAsmensPavarde: null,
            pareigos: null,
            teisejoKodas: null,
            darbovietesTipas: null,
            pateikimoData: deklaracija.pateikimoData,
        })),

        // SUTUOKTINIO_DARBOVIETE
        ...(deklaracija.sutuoktinioDarbovietes || []).flatMap((d) =>
            (d.pareigos || []).map((p) => ({
                irasoTipas: "SUTUOKTINIO_DARBOVIETE",
                jarKodas: d.jaKodas || d.jarKodas,
                deklaracija: deklaracija.accessUuid,
                susijusioAsmensVardas: deklaracija.teikejas?.vardas || null,
                susijusioAsmensPavarde: deklaracija.teikejas?.pavarde || null,
                vardas: deklaracija.sutuoktinis?.vardas || null,
                pavarde: deklaracija.sutuoktinis?.pavarde || null,
                pavadinimas: d.pavadinimas,
                rysioPradzia: d.rysioPradzia,
                rysioPabaiga: null,
                duomenuSaltinis: JSON.stringify(d.duomenuSaltiniai || []),
                registruotaLietuvoje: d.registruotaLietuvoje,
                uzpildytaAutomatiskai: d.uzpildytaAutomatiskai,
                jaTeisinesFormosPavadinimas: d.jaTeisinesFormosPavadinimas,
                pareigos: p.pareigos,
                teisejoKodas: p.teisejoKodas,
                darbovietesTipas: d.darbovietesTipas,
                jaTeisinesFormosKodas: null,
                kienoRysys: null,
                pastabos: null,
                rysioPobudzioPavadinimas: null,
                dalyvavimoVpInformacija: null,
                dalyvaujaViesuosePirkimuose: null,
                pateikimoData: deklaracija.pateikimoData,
            })),
        ),

        // DEKLARUOJANCIO_DARBOVIETE
        ...(deklaracija.darbovietes || []).flatMap((d) =>
            (d.pareigos || []).map((p) => ({
                irasoTipas: "DEKLARUOJANCIO_DARBOVIETE",
                jarKodas: d.jaKodas || d.jarKodas,
                deklaracija: deklaracija.accessUuid,
                vardas: deklaracija.teikejas?.vardas || null,
                pavarde: deklaracija.teikejas?.pavarde || null,
                pavadinimas: d.pavadinimas,
                rysioPradzia: d.rysioPradzia,
                rysioPabaiga: null,
                duomenuSaltinis: JSON.stringify(d.duomenuSaltiniai || []),
                registruotaLietuvoje: d.registruotaLietuvoje,
                uzpildytaAutomatiskai: d.uzpildytaAutomatiskai,
                jaTeisinesFormosPavadinimas: d.jaTeisinesFormosPavadinimas,
                pareigos: p.pareigos,
                teisejoKodas: p.teisejoKodas,
                darbovietesTipas: d.darbovietesTipas,
                jaTeisinesFormosKodas: null,
                susijusioAsmensVardas: null,
                susijusioAsmensPavarde: null,
                kienoRysys: null,
                pastabos: null,
                rysioPobudzioPavadinimas: null,
                dalyvavimoVpInformacija: null,
                dalyvaujaViesuosePirkimuose: null,
                pateikimoData: deklaracija.pateikimoData,
            })),
        ),
    ];
}

const COLUMNS = [
    "irasoTipas",
    "jarKodas",
    "deklaracija",
    "vardas",
    "pavarde",
    "pavadinimas",
    "rysioPradzia",
    "rysioPabaiga",
    "duomenuSaltinis",
    "registruotaLietuvoje",
    "jaTeisinesFormosKodas",
    "jaTeisinesFormosPavadinimas",
    "uzpildytaAutomatiskai",
    "susijusioAsmensVardas",
    "susijusioAsmensPavarde",
    "pareigos",
    "teisejoKodas",
    "darbovietesTipas",
    "kienoRysys",
    "pastabos",
    "rysioPobudzioPavadinimas",
    "dalyvavimoVpInformacija",
    "dalyvaujaViesuosePirkimuose",
    "pateikimoData",
];

/**
 * Replaces all pinregJuridiniaiRysiai rows for a declaration, within a transaction.
 * @param {object} client - pg pool client
 * @param {string} accessUuid
 * @param {Array} allRows
 */
export async function upsertRysiai(client, accessUuid, allRows) {
    await client.query(
        `DELETE FROM "pinregJuridiniaiRysiai" WHERE "deklaracija" = $1`,
        [accessUuid],
    );

    if (!allRows.length) return;

    const valuesPlaceholders = allRows
        .map(
            (_, idx) =>
                `(${COLUMNS.map((__, i) => `$${idx * COLUMNS.length + i + 1}`).join(",")})`,
        )
        .join(",");

    const params = allRows.flatMap((r) => COLUMNS.map((c) => r[c] ?? null));

    await client.query(
        `INSERT INTO "pinregJuridiniaiRysiai" (${COLUMNS.map((c) => `"${c}"`).join(",")})
         VALUES ${valuesPlaceholders}`,
        params,
    );
}

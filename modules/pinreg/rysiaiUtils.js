/**
 * Maps a pinreg declaration JSON to pinreg."juridiniaiRysiai" rows.
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

// Rašytojo laukai. `rysioPobudzioPavadinimas` ir teisinės formos kodas /
// pavadinimas čia lieka tekstu – id jiems parenka SQL (žodynai `pinreg`
// schemoje). `teisejoKodas` išmestas: šaltinis jo neduoda nė vienoje eilutėje.
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
    "darbovietesTipas",
    "kienoRysys",
    "pastabos",
    "rysioPobudzioPavadinimas",
    "dalyvavimoVpInformacija",
    "dalyvaujaViesuosePirkimuose",
    "pateikimoData",
];

/**
 * Replaces all pinreg."juridiniaiRysiai" rows for a declaration, within a transaction.
 * @param {object} client - pg pool client
 * @param {string} accessUuid
 * @param {Array} allRows
 */
export async function upsertRysiai(client, accessUuid, allRows) {
    await client.query(
        `DELETE FROM pinreg."juridiniaiRysiai" WHERE "deklaracija" = $1`,
        [accessUuid],
    );

    if (!allRows.length) return;

    const stulpeliai = COLUMNS.map((c) => `"${c}"`).join(", ");
    const valuesPlaceholders = allRows
        .map(
            (_, idx) =>
                `(${COLUMNS.map((__, i) => `$${idx * COLUMNS.length + i + 1}`).join(",")})`,
        )
        .join(",");

    const params = allRows.flatMap((r) => COLUMNS.map((c) => r[c] ?? null));

    // Žodynai papildomi ir id parenkami tame pačiame sakinyje – be kešo ir be
    // atskirų kreipinių kiekvienai deklaracijai.
    await client.query(
        `WITH incoming AS (
             SELECT * FROM (VALUES ${valuesPlaceholders}) AS x(${stulpeliai})
         ), ins_pobudziai AS (
             INSERT INTO pinreg."rysiuPobudziai" ("pavadinimas")
             SELECT DISTINCT nullif(btrim("rysioPobudzioPavadinimas"), '') FROM incoming
             WHERE nullif(btrim("rysioPobudzioPavadinimas"), '') IS NOT NULL
             ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
         ), ins_formos AS (
             INSERT INTO pinreg."teisinesFormos" ("kodas", "pavadinimas")
             SELECT DISTINCT nullif(btrim("jaTeisinesFormosKodas"), ''),
                             nullif(btrim("jaTeisinesFormosPavadinimas"), '')
             FROM incoming
             WHERE nullif(btrim("jaTeisinesFormosKodas"), '') IS NOT NULL
                OR nullif(btrim("jaTeisinesFormosPavadinimas"), '') IS NOT NULL
             ON CONFLICT ("kodas", "pavadinimas") DO NOTHING RETURNING "id", "kodas", "pavadinimas"
         )
         INSERT INTO pinreg."juridiniaiRysiai" (
             "deklaracija", "irasoTipas", "vardas", "pavarde",
             "susijusioAsmensVardas", "susijusioAsmensPavarde", "jarKodas",
             "pavadinimas", "registruotaLietuvoje", "teisinesFormosId", "pareigos",
             "darbovietesTipas", "rysioPobudzioId", "kienoRysys", "rysioPradzia",
             "rysioPabaiga", "uzpildytaAutomatiskai", "duomenuSaltinis",
             "dalyvaujaViesuosePirkimuose", "dalyvavimoVpInformacija", "pastabos",
             "pateikimoData"
         )
         SELECT
             i."deklaracija"::uuid,
             i."irasoTipas"::pinreg."irasoTipas",
             i."vardas", i."pavarde", i."susijusioAsmensVardas",
             i."susijusioAsmensPavarde", i."jarKodas", i."pavadinimas",
             i."registruotaLietuvoje"::boolean,
             (SELECT "id" FROM pinreg."teisinesFormos"
               WHERE COALESCE("kodas", '') = COALESCE(nullif(btrim(i."jaTeisinesFormosKodas"), ''), '')
                 AND COALESCE("pavadinimas", '') = COALESCE(nullif(btrim(i."jaTeisinesFormosPavadinimas"), ''), '')
               UNION ALL
              SELECT "id" FROM ins_formos
               WHERE COALESCE("kodas", '') = COALESCE(nullif(btrim(i."jaTeisinesFormosKodas"), ''), '')
                 AND COALESCE("pavadinimas", '') = COALESCE(nullif(btrim(i."jaTeisinesFormosPavadinimas"), ''), '')
               LIMIT 1),
             i."pareigos",
             nullif(btrim(i."darbovietesTipas"), '')::pinreg."darbovietesTipas",
             (SELECT "id" FROM pinreg."rysiuPobudziai"
               WHERE "pavadinimas" = nullif(btrim(i."rysioPobudzioPavadinimas"), '')
               UNION ALL
              SELECT "id" FROM ins_pobudziai
               WHERE "pavadinimas" = nullif(btrim(i."rysioPobudzioPavadinimas"), '')
               LIMIT 1),
             nullif(btrim(i."kienoRysys"), '')::pinreg."kienoRysys",
             i."rysioPradzia"::date, i."rysioPabaiga"::date,
             i."uzpildytaAutomatiskai"::boolean, i."duomenuSaltinis"::jsonb,
             i."dalyvaujaViesuosePirkimuose"::boolean, i."dalyvavimoVpInformacija",
             i."pastabos", i."pateikimoData"::timestamptz
         FROM incoming i`,
        params,
    );
}

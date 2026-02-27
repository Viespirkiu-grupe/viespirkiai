import { postgres } from "../../postgres/postgres.js";
import { spawn } from "child_process";
import { log } from "../../utils/log.js";

/**
 * Nuskaityti vieną VTEK deklaraciją ir įrašyti į pinregJuridiniaiRysiai.
 * @returns {Promise<boolean>} true jei nuskaityta, false jei daugiau deklaracijų nėra
 */
export async function nuskaitytiPinregDeklaracija() {
    const deklaracijaRes = await postgres.query(
        `SELECT * FROM pinreg WHERE nuskaitytas IS NULL LIMIT 1`,
    );
    if (deklaracijaRes.rowCount === 0) return false;

    const deklaracija = deklaracijaRes.rows[0];
    const url = `https://pinreg.vtek.lt/external/deklaracijos/${deklaracija.uuid}/view/viesa`;
    log(url);

    const data = await new Promise((resolve, reject) => {
        const curl = spawn("curl", [
            "-s",
            "-w",
            "%{http_code}",
            "-o",
            "-",
            url,
        ]);
        let output = "";
        curl.stdout.on("data", (chunk) => (output += chunk));

        curl.on("close", async () => {
            const status = output.slice(-3);
            const body = output.slice(0, -3);

            if (status !== "200") {
                log(
                    `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                );
                await postgres.query(
                    `UPDATE pinreg SET nuskaitytas = -1 WHERE uuid = $1`,
                    [deklaracija.uuid],
                );
                return reject(
                    new Error(
                        `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                    ),
                );
            }

            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(err);
            }
        });

        curl.on("error", reject);
    });

    // Žymime nuskaitytą
    await postgres.query(
        `UPDATE pinreg SET nuskaitytas = 1, json = $1 WHERE uuid = $2`,
        [data, deklaracija.uuid],
    );

    // Paruošiame visus juridinius ryšius vienam insert
    const allRows = [
        // KITI_RYSIAI_SU_JA
        ...(data.rysiaiSuJa || []).map((r) => ({
            irasoTipas: "KITI_RYSIAI_SU_JA",
            jarKodas: r.jaKodas,
            deklaracija: data.accessUuid,
            vardas: data.teikejas?.vardas || null,
            pavarde: data.teikejas?.pavarde || null,
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
            pateikimoData: data.pateikimoData,
        })),

        // SUTUOKTINIO_DARBOVIETE
        ...(data.sutuoktinioDarbovietes || []).flatMap((d) =>
            (d.pareigos || []).map((p) => ({
                irasoTipas: "SUTUOKTINIO_DARBOVIETE",
                jarKodas: d.jaKodas || d.jarKodas,
                deklaracija: data.accessUuid,
                susijusioAsmensVardas: data.teikejas?.vardas || null,
                susijusioAsmensPavarde: data.teikejas?.pavarde || null,
                vardas: data.sutuoktinis?.vardas || null,
                pavarde: data.sutuoktinis?.pavarde || null,
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
                pateikimoData: data.pateikimoData,
            })),
        ),

        // DEKLARUOJANCIO_DARBOVIETE
        ...(data.darbovietes || []).flatMap((d) =>
            (d.pareigos || []).map((p) => ({
                irasoTipas: "DEKLARUOJANCIO_DARBOVIETE",
                jarKodas: d.jaKodas || d.jarKodas,
                deklaracija: data.accessUuid,
                vardas: data.teikejas.vardas,
                pavarde: data.teikejas.pavarde,
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
                pateikimoData: data.pateikimoData,
            })),
        ),
    ];

    if (!allRows.length) return true;

    // Delete old juridiniaiRysiai rows
    await postgres.query(
        `DELETE FROM "pinregJuridiniaiRysiai" WHERE "deklaracija" = $1`,
        [data.accessUuid],
    );

    const columns = [
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

    const valuesPlaceholders = allRows
        .map(
            (_, idx) =>
                `(${columns.map((__, i) => `$${idx * columns.length + i + 1}`).join(",")})`,
        )
        .join(",");

    const params = allRows.flatMap((r) => columns.map((c) => r[c] ?? null));

    await postgres.query(
        `INSERT INTO "pinregJuridiniaiRysiai" (${columns
            .map((c) => `"${c}"`)
            .join(",")}) VALUES ${valuesPlaceholders}`,
        params,
    );

    log(`Nuskaityta deklaracija ${deklaracija.uuid}`);
    return true;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await nuskaitytiPinregDeklaracija();
    process.exit(0);
}

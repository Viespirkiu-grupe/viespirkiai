/*
 * Nuskaito privačių interesų deklraracijų duomenis pagal duomenų bazėje esančius UUID
 */

import { postgres } from "../../postgres/postgres.js";
import { spawn } from "child_process";
import { log } from "../../utils/log.js";

/**
 * Nuskaito vieną VTEK deklaraciją iš išorinio šaltinio pagal duomenų bazėje esančius UUID
 * ir įrašo duomenis atgal į duomenų bazę.
 * @returns {Promise<boolean>} Grąžina true, jei buvo nuskaityta deklaracija, false jei nėra daugiau deklaracijų.
 */
export async function nuskaitytiVtekDeklaracija() {
    // Paimame vieną deklaracijos UUID iš duomenų bazės
    let deklaracijaRes = await postgres.query(
        "SELECT * FROM pinreg WHERE nuskaitytas IS NULL LIMIT 1",
    );
    if (deklaracijaRes.rowCount === 0) return false;

    // Sudarome URL
    let deklaracija = deklaracijaRes.rows[0];
    let url = `https://pinreg.vtek.lt/external/deklaracijos/${deklaracija.uuid}/view/viesa`;
    log(url);

    // Atliekame HTTP užklausą naudodami curl
    let data = await new Promise((resolve, reject) => {
        const curl = spawn("curl", [
            "-s",
            "-w",
            "%{http_code}",
            "-o",
            "-",
            url,
        ]);

        let output = "";
        curl.stdout.on("data", (chunk) => {
            output += chunk;
        });

        curl.on("close", async (code) => {
            // Last 3 characters are HTTP status code
            let status = output.slice(-3);
            let body = output.slice(0, -3);

            if (status !== "200") {
                log(
                    `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                );
                await postgres.query(
                    "UPDATE pinreg SET nuskaitytas = -1 WHERE uuid = $1",
                    [deklaracija.uuid],
                );
                return reject(
                    new Error(
                        `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                    ),
                );
            }

            try {
                const data = JSON.parse(body);
                resolve(data);
            } catch (err) {
                reject(err);
            }
        });

        curl.on("error", (err) => {
            reject(err);
        });
    });

    // Apdorojame gautus duomenis
    let asmuo = data.teikejas.vardas + " " + data.teikejas.pavarde;
    let sutuoktinis =
        [data.sutuoktinis?.vardas, data.sutuoktinis?.pavarde]
            .filter(Boolean)
            .join(" ") || null;

    let darbovietesJarKodai = data.darbovietes.map((d) => {
        return d.jaKodas;
    });

    let sutuoktinisDarbovietesJarKodai = [];
    if (data.sutuoktinioDarbovietes) {
        sutuoktinisDarbovietesJarKodai = data.sutuoktinioDarbovietes.map(
            (d) => {
                return d.jaKodas;
            },
        );
    }
    let juridiniaiRysiaiJarKodai = data.rysiaiSuJa.map((d) => {
        return d.jaKodas;
    });
    let pateikimoData = data.pateikimoData;

    // Įrašome duomenis į duomenų bazę
    await postgres.query(
        `UPDATE pinreg SET
            nuskaitytas = 1,
            json = $1,
            asmuo = $2,
            sutuoktinis = $3,
            "darbovietesJar" = $4,
            "sutuoktinisDarbovietesJar" = $5,
            "juridiniaiRysiaiJar" = $6,
            "pateikimoData" = $7
        WHERE uuid = $8`,
        [
            data,
            asmuo,
            sutuoktinis,
            darbovietesJarKodai,
            sutuoktinisDarbovietesJarKodai,
            juridiniaiRysiaiJarKodai,
            pateikimoData,
            deklaracija.uuid,
        ],
    );

    let deklaracijosJson = data;
    const rysiaiSuJaRows = (deklaracijosJson.rysiaiSuJa || []).map((rysys) => ({
        jarKodas: rysys.jaKodas,
        deklaracija: deklaracijosJson.accessUuid,
        pavadinimas: rysys.pavadinimas,
        rysioPradzia: rysys.rysioPradzia,
        rysioPabaiga: rysys.rysioPabaiga || null,
        duomenuSaltinis: rysys.duomenuSaltinis || null,
        registruotaLietuvoje: rysys.registruotaLietuvoje,
        jaTeisinesFormosKodas: rysys.jaTeisinesFormosKodas,
        jaTeisinesFormosPavadinimas: rysys.jaTeisinesFormosPavadinimas,
        uzpildytaAutomatiskai: rysys.uzpildytaAutomatiskai,
        kienoRysys: rysys.kienoRysys,
        pastabos: rysys.pastabos,
        rysioPobudzioPavadinimas: rysys.rysioPobudzioPavadinimas,
        dalyvavimoVpInformacija: rysys.dalyvavimoVpInformacija,
        dalyvaujaViesuosePirkimuose: rysys.dalyvaujaViesuosePirkimuose,
    }));

    // Delete existing rows for this deklaracija
    await postgres.query(
        `DELETE FROM "pinregRysiaiSuJa" WHERE "deklaracija" = $1`,
        [deklaracijosJson.accessUuid],
    );

    // Insert updated rows for rysiaiSuJa
    for (const row of rysiaiSuJaRows) {
        await postgres.query(
            `INSERT INTO "pinregRysiaiSuJa"
                        (
                            "jarKodas", "deklaracija", "pavadinimas", "rysioPradzia", "rysioPabaiga",
                            "duomenuSaltinis", "registruotaLietuvoje", "jaTeisinesFormosKodas",
                            "jaTeisinesFormosPavadinimas", "uzpildytaAutomatiskai", "kienoRysys",
                            "pastabos", "rysioPobudzioPavadinimas", "dalyvavimoVpInformacija",
                            "dalyvaujaViesuosePirkimuose"
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
                row.jarKodas,
                row.deklaracija,
                row.pavadinimas,
                row.rysioPradzia,
                row.rysioPabaiga,
                row.duomenuSaltinis
                    ? JSON.stringify(row.duomenuSaltinis)
                    : null,
                row.registruotaLietuvoje,
                row.jaTeisinesFormosKodas,
                row.jaTeisinesFormosPavadinimas,
                row.uzpildytaAutomatiskai,
                row.kienoRysys,
                row.pastabos,
                row.rysioPobudzioPavadinimas,
                row.dalyvavimoVpInformacija,
                row.dalyvaujaViesuosePirkimuose,
            ],
        );
    }

    const pinregSutuoktinioDarbovietesRows = (
        deklaracijosJson.sutuoktinioDarbovietes || []
    ).flatMap((darboviete) => {
        const uuid = deklaracijosJson.accessUuid;
        const jarKodas = darboviete.jaKodas || darboviete.jarKodas;

        return (darboviete.pareigos || []).map((pareiga) => ({
            jarKodas,
            deklaracija: uuid,
            deklaruojancioVardas: deklaracijosJson.teikejas?.vardas || null,
            deklaruojancioPavarde: deklaracijosJson.teikejas?.pavarde || null,
            sutuoktinioVardas: deklaracijosJson.sutuoktinis?.vardas || null,
            sutuoktinioPavarde: deklaracijosJson.sutuoktinis?.pavarde || null,
            pavadinimas: darboviete.pavadinimas,
            rysioPradzia: darboviete.rysioPradzia,
            darbovietesTipas: darboviete.darbovietesTipas,
            duomenuSaltiniai: darboviete.duomenuSaltiniai || [],
            privaluDeklaruoti: darboviete.privaluDeklaruoti,
            yraJuridinisAsmuo: darboviete.yraJuridinisAsmuo,
            registruotaLietuvoje: darboviete.registruotaLietuvoje,
            uzpildytaAutomatiskai: darboviete.uzpildytaAutomatiskai,
            jaTeisinesFormosPavadinimas: darboviete.jaTeisinesFormosPavadinimas,
            pareigos: pareiga.pareigos,
            teisejoKodas: pareiga.teisejoKodas,
            pareiguTipasPavadinimas: pareiga.pareiguTipasPavadinimas,
        }));
    });

    // Delete existing rows for this deklaracija
    await postgres.query(
        `DELETE FROM "pinregSutuoktiniuDarbovietes" WHERE "deklaracija" = $1`,
        [deklaracijosJson.accessUuid],
    );

    // Insert updated rows for spouse workplaces
    for (const row of pinregSutuoktinioDarbovietesRows) {
        await postgres.query(
            `INSERT INTO "pinregSutuoktiniuDarbovietes"
                        (
                            "jarKodas", "deklaracija", "deklaruojancioVardas", "deklaruojancioPavarde",
                            "sutuoktinioVardas", "sutuoktinioPavarde", "pavadinimas", "rysioPradzia",
                            "darbovietesTipas", "duomenuSaltiniai", "privaluDeklaruoti", "yraJuridinisAsmuo",
                            "registruotaLietuvoje", "uzpildytaAutomatiskai", "jaTeisinesFormosPavadinimas",
                            "pareigos", "teisejoKodas", "pareiguTipasPavadinimas"
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
                row.jarKodas,
                row.deklaracija,
                row.deklaruojancioVardas,
                row.deklaruojancioPavarde,
                row.sutuoktinioVardas,
                row.sutuoktinioPavarde,
                row.pavadinimas,
                row.rysioPradzia,
                row.darbovietesTipas,
                JSON.stringify(row.duomenuSaltiniai),
                row.privaluDeklaruoti,
                row.yraJuridinisAsmuo,
                row.registruotaLietuvoje,
                row.uzpildytaAutomatiskai,
                row.jaTeisinesFormosPavadinimas,
                row.pareigos,
                row.teisejoKodas,
                row.pareiguTipasPavadinimas,
            ],
        );
    }

    const pinregDarbovietesRows = (deklaracijosJson.darbovietes || []).flatMap(
        (darboviete) => {
            const uuid = deklaracijosJson.accessUuid;
            const jarKodas = darboviete.jaKodas || darboviete.jarKodas;

            return (darboviete.pareigos || []).map((pareiga) => ({
                jarKodas,
                deklaracija: uuid,
                vardas: deklaracijosJson.teikejas.vardas,
                pavarde: deklaracijosJson.teikejas.pavarde,
                pavadinimas: darboviete.pavadinimas,
                rysioPradzia: darboviete.rysioPradzia,
                darbovietesTipas: darboviete.darbovietesTipas,
                duomenuSaltiniai: darboviete.duomenuSaltiniai || [],
                privaluDeklaruoti: darboviete.privaluDeklaruoti,
                yraJuridinisAsmuo: darboviete.yraJuridinisAsmuo,
                registruotaLietuvoje: darboviete.registruotaLietuvoje,
                uzpildytaAutomatiskai: darboviete.uzpildytaAutomatiskai,
                jaTeisinesFormosPavadinimas:
                    darboviete.jaTeisinesFormosPavadinimas,
                pareigos: pareiga.pareigos,
                teisejoKodas: pareiga.teisejoKodas,
                pareiguTipasPavadinimas: pareiga.pareiguTipasPavadinimas,
            }));
        },
    );

    // Delete existing rows for this deklaracija
    await postgres.query(
        `DELETE FROM "pinregDarbovietes" WHERE "deklaracija" = $1`,
        [deklaracijosJson.accessUuid],
    );

    // Insert updated rows
    for (const row of pinregDarbovietesRows) {
        await postgres.query(
            `INSERT INTO "pinregDarbovietes"
                        (
                            "jarKodas", "deklaracija", "vardas", "pavarde", "pavadinimas", "rysioPradzia",
                            "darbovietesTipas", "duomenuSaltiniai", "privaluDeklaruoti", "yraJuridinisAsmuo",
                            "registruotaLietuvoje", "uzpildytaAutomatiskai", "jaTeisinesFormosPavadinimas",
                            "pareigos", "teisejoKodas", "pareiguTipasPavadinimas"
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
                row.jarKodas,
                row.deklaracija,
                row.vardas,
                row.pavarde,
                row.pavadinimas,
                row.rysioPradzia,
                row.darbovietesTipas,
                JSON.stringify(row.duomenuSaltiniai),
                row.privaluDeklaruoti,
                row.yraJuridinisAsmuo,
                row.registruotaLietuvoje,
                row.uzpildytaAutomatiskai,
                row.jaTeisinesFormosPavadinimas,
                row.pareigos,
                row.teisejoKodas,
                row.pareiguTipasPavadinimas,
            ],
        );
    }

    log(`Nuskaityta deklaracija ${deklaracija.uuid} t.y. ${asmuo}`);
    return true;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await nuskaitytiVtekDeklaracija();
    process.exit(0);
}

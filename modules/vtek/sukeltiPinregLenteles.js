import { postgres } from "../../postgres/postgres.js";

let count = 0;
async function sukeltiPinregLenteles() {
    let lastUuid = "00000000-0000-0000-0000-000000000000";

    while (true) {
        const res = await postgres.query(
            `
            SELECT *
            FROM pinreg
            WHERE uuid > $1
            ORDER BY uuid
            LIMIT 1000
            `,
            [lastUuid],
        );

        if (res.rows.length === 0) break;
        let deklaracijos = res.rows.map((row) => {
            if (row.json) {
                return row.json;
            }
            return null;
        });

        // Remove nulls
        deklaracijos = deklaracijos.filter((item) => item !== null);

        for (const deklaracija of deklaracijos) {
            count++;
            console.log(deklaracija.accessUuid, count);

            const rysiaiSuJaRows = (deklaracija.rysiaiSuJa || []).map(
                (rysys) => ({
                    jarKodas: rysys.jaKodas,
                    deklaracija: deklaracija.accessUuid,
                    pavadinimas: rysys.pavadinimas,
                    rysioPradzia: rysys.rysioPradzia,
                    rysioPabaiga: rysys.rysioPabaiga || null,
                    duomenuSaltinis: rysys.duomenuSaltinis || null,
                    registruotaLietuvoje: rysys.registruotaLietuvoje,
                    jaTeisinesFormosKodas: rysys.jaTeisinesFormosKodas,
                    jaTeisinesFormosPavadinimas:
                        rysys.jaTeisinesFormosPavadinimas,
                    uzpildytaAutomatiskai: rysys.uzpildytaAutomatiskai,
                    kienoRysys: rysys.kienoRysys,
                    pastabos: rysys.pastabos,
                    rysioPobudzioPavadinimas: rysys.rysioPobudzioPavadinimas,
                    dalyvavimoVpInformacija: rysys.dalyvavimoVpInformacija,
                    dalyvaujaViesuosePirkimuose:
                        rysys.dalyvaujaViesuosePirkimuose,
                    pateikimoData: deklaracija.pateikimoData,
                }),
            );

            // Delete existing rows for this deklaracija
            await postgres.query(
                `DELETE FROM "pinregRysiaiSuJa" WHERE "deklaracija" = $1`,
                [deklaracija.accessUuid],
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
                        "dalyvaujaViesuosePirkimuose", "pateikimoData"
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, $16)`,
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
                        row.pateikimoData,
                    ],
                );
            }

            const pinregSutuoktinioDarbovietesRows = (
                deklaracija.sutuoktinioDarbovietes || []
            ).flatMap((darboviete) => {
                const uuid = deklaracija.accessUuid;
                const jarKodas = darboviete.jaKodas || darboviete.jarKodas;

                return (darboviete.pareigos || []).map((pareiga) => ({
                    jarKodas,
                    deklaracija: uuid,
                    deklaruojancioVardas: deklaracija.teikejas?.vardas || null,
                    deklaruojancioPavarde:
                        deklaracija.teikejas?.pavarde || null,
                    sutuoktinioVardas: deklaracija.sutuoktinis?.vardas || null,
                    sutuoktinioPavarde:
                        deklaracija.sutuoktinis?.pavarde || null,
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
                    pateikimoData: deklaracija.pateikimoData,
                }));
            });

            // Delete existing rows for this deklaracija
            await postgres.query(
                `DELETE FROM "pinregSutuoktiniuDarbovietes" WHERE "deklaracija" = $1`,
                [deklaracija.accessUuid],
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
                        "pareigos", "teisejoKodas", "pareiguTipasPavadinimas", "pateikimoData"
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
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
                        row.pateikimoData,
                    ],
                );
            }

            const pinregDarbovietesRows = (
                deklaracija.darbovietes || []
            ).flatMap((darboviete) => {
                const uuid = deklaracija.accessUuid;
                const jarKodas = darboviete.jaKodas || darboviete.jarKodas;

                return (darboviete.pareigos || []).map((pareiga) => ({
                    jarKodas,
                    deklaracija: uuid,
                    vardas: deklaracija.teikejas.vardas,
                    pavarde: deklaracija.teikejas.pavarde,
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
                    pateikimoData: deklaracija.pateikimoData,
                }));
            });

            // Delete existing rows for this deklaracija
            await postgres.query(
                `DELETE FROM "pinregDarbovietes" WHERE "deklaracija" = $1`,
                [deklaracija.accessUuid],
            );

            // Insert updated rows
            for (const row of pinregDarbovietesRows) {
                await postgres.query(
                    `INSERT INTO "pinregDarbovietes"
                    (
                        "jarKodas", "deklaracija", "vardas", "pavarde", "pavadinimas", "rysioPradzia",
                        "darbovietesTipas", "duomenuSaltiniai", "privaluDeklaruoti", "yraJuridinisAsmuo",
                        "registruotaLietuvoje", "uzpildytaAutomatiskai", "jaTeisinesFormosPavadinimas",
                        "pareigos", "teisejoKodas", "pareiguTipasPavadinimas", "pateikimoData"
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
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
                        row.pateikimoData,
                    ],
                );
            }
        }

        lastUuid = res.rows[res.rows.length - 1].uuid;
    }
}

await sukeltiPinregLenteles();
postgres.end();

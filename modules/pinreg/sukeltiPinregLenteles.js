import { postgres } from "../../postgres/postgres.js";
import PQueue from "p-queue";

const queue = new PQueue({ concurrency: 32 });

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

        await Promise.all(
            deklaracijos.map((deklaracija) =>
                queue.add(async () => {
                    count++;
                    console.log(deklaracija.accessUuid, count);

                    // Delete old entries for this declaration
                    await postgres.query(
                        `DELETE FROM "pinregJuridiniaiRysiai" WHERE "deklaracija" = $1`,
                        [deklaracija.accessUuid],
                    );

                    // Merge all rows into one array
                    const allRows = [
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
                            jaTeisinesFormosPavadinimas:
                                r.jaTeisinesFormosPavadinimas,
                            uzpildytaAutomatiskai: r.uzpildytaAutomatiskai,
                            kienoRysys: r.kienoRysys,
                            pastabos: r.pastabos,
                            rysioPobudzioPavadinimas:
                                r.rysioPobudzioPavadinimas,
                            dalyvavimoVpInformacija: r.dalyvavimoVpInformacija,
                            dalyvaujaViesuosePirkimuose:
                                r.dalyvaujaViesuosePirkimuose,
                            susijusioAsmensVardas: null,
                            susijusioAsmensPavarde: null,
                            pareigos: null,
                            teisejoKodas: null,
                            darbovietesTipas: null,
                            pateikimoData: deklaracija.pateikimoData,
                        })),

                        // SUTUOKTINIO_DARBOVIETE
                        ...(deklaracija.sutuoktinioDarbovietes || []).flatMap(
                            (d) =>
                                (d.pareigos || []).map((p) => ({
                                    irasoTipas: "SUTUOKTINIO_DARBOVIETE",
                                    jarKodas: d.jaKodas || d.jarKodas,
                                    deklaracija: deklaracija.accessUuid,
                                    susijusioAsmensVardas:
                                        deklaracija.teikejas?.vardas || null,
                                    susijusioAsmensPavarde:
                                        deklaracija.teikejas?.pavarde || null,
                                    vardas:
                                        deklaracija.sutuoktinis?.vardas || null,
                                    pavarde:
                                        deklaracija.sutuoktinis?.pavarde ||
                                        null,
                                    pavadinimas: d.pavadinimas,
                                    rysioPradzia: d.rysioPradzia,
                                    rysioPabaiga: null,
                                    duomenuSaltinis: JSON.stringify(
                                        d.duomenuSaltiniai || [],
                                    ),
                                    registruotaLietuvoje:
                                        d.registruotaLietuvoje,
                                    uzpildytaAutomatiskai:
                                        d.uzpildytaAutomatiskai,
                                    jaTeisinesFormosPavadinimas:
                                        d.jaTeisinesFormosPavadinimas,
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
                                vardas: deklaracija.teikejas.vardas,
                                pavarde: deklaracija.teikejas.pavarde,
                                pavadinimas: d.pavadinimas,
                                rysioPradzia: d.rysioPradzia,
                                rysioPabaiga: null,
                                duomenuSaltinis: JSON.stringify(
                                    d.duomenuSaltiniai || [],
                                ),
                                registruotaLietuvoje: d.registruotaLietuvoje,
                                uzpildytaAutomatiskai: d.uzpildytaAutomatiskai,
                                jaTeisinesFormosPavadinimas:
                                    d.jaTeisinesFormosPavadinimas,
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

                    if (allRows.length) {
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
                                    `(${columns
                                        .map(
                                            (__, i) =>
                                                `$${idx * columns.length + i + 1}`,
                                        )
                                        .join(",")})`,
                            )
                            .join(",");

                        const params = allRows.flatMap((r) =>
                            columns.map((c) => r[c] ?? null),
                        );

                        await postgres.query(
                            `INSERT INTO "pinregJuridiniaiRysiai" (${columns
                                .map((c) => `"${c}"`)
                                .join(",")}) VALUES ${valuesPlaceholders}`,
                            params,
                        );
                    }
                }),
            ),
        );

        lastUuid = res.rows[res.rows.length - 1].uuid;
    }
}

await sukeltiPinregLenteles();
postgres.end();

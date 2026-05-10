import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

export async function perkeltiFailus(from, to, kiekis = 1) {
    for (let i = 0; i < kiekis; i++) {
        const failasRes = await postgres.query(
            `SELECT * FROM "failai" WHERE "saugojama" = $1 AND parsiustas = 1 AND dydis > 0 LIMIT 1;`,
            [from],
        );

        const failas = failasRes.rows[0];

        if (!failas) {
            log(`Nėra daugiau failų perkelti iš "${from}" į "${to}".`);
            break;
        }

        log(`Parsiunčiamas: ${failas.id} (${failas.pavadinimas})`);

        const dezeToRes = await postgres.query(
            `SELECT * FROM dezes WHERE pavadinimas = $1`,
            [to],
        );

        if (dezeToRes.rows.length === 0) {
            throw new Error("Nėra dėžių parsisiuntimui.");
        }

        const dezeTo = dezeToRes.rows[0];

        const dezeFromRes = await postgres.query(
            `SELECT * FROM dezes WHERE pavadinimas = $1`,
            [from],
        );

        if (dezeFromRes.rows.length === 0) {
            throw new Error("Nėra dėžių iš kurių parsisiųsti.");
        }

        const dezeFrom = dezeFromRes.rows[0];

        try {
            let url = `https://failai.viespirkiai.org/${failas.id}`;

            log(url);

            let response = await fetch(`${dezeTo.url}/download-url`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": dezeTo.apiKey,
                },
                body: JSON.stringify({
                    url,
                }),
            });

            var { md5 } = await response.json();

            if (!response.ok || !md5) {
                throw new Error("Nepavyko gauti failo.");
            }

            // Ištryname failą iš senos dėžės
            const fileUrl = `${dezeFrom.url}/file/${failas.md5}.${failas.extension}`;
            let deleteResponse = await fetch(fileUrl, {
                headers: {
                    "x-api-key": dezeFrom.apiKey,
                },
                method: "DELETE",
            });

            if (!deleteResponse.ok) {
                console.warn(
                    "Nepavyko ištrinti seno failo:",
                    await deleteResponse.text(),
                );
                throw new Error("Nepavyko ištrinti seno failo.");
            }

            log(md5);

            // Atnaujiname informaciją apie failą
            await postgres.query(
                "UPDATE failai SET saugojama = $1 WHERE md5 = $2 AND saugojama = $3",
                [dezeTo.pavadinimas, md5, dezeFrom.pavadinimas],
            );

            // Atnaujiname viešdėžių dydžius
            // Atnaujiname dėžės dydį
            let usedFromReq = await fetch(`${dezeFrom.url}/storage-usage`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": dezeFrom.apiKey,
                },
            });
            let { totalSizeBytes: totalSizeBytesFrom } =
                await usedFromReq.json();

            await postgres.query("UPDATE dezes SET used = $1 WHERE id = $2", [
                totalSizeBytesFrom,
                dezeFrom.id,
            ]);

            let usedToReq = await fetch(`${dezeTo.url}/storage-usage`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": dezeTo.apiKey,
                },
            });
            let { totalSizeBytes: totalSizeBytesTo } = await usedToReq.json();

            await postgres.query("UPDATE dezes SET used = $1 WHERE id = $2", [
                totalSizeBytesTo,
                dezeTo.id,
            ]);

            log(`Failas ${failas.id} perkeltas į dėžę "${dezeTo.pavadinimas}"`);
        } catch (error) {
            console.error("Klaida parsisiunčiant failą:", error);
            throw error;
        }
    }
}

//await perkeltiFailus("saint", "kiaurasTekinis",  1);

// Take in arguments from command line, all 3 (3rd is optional)

const args = process.argv.slice(2);

if (args.length < 2) {
    log("Naudojimas: node perkeltiFailus.js <iš_dėžės> <į_dėžę> [kiekis]");
    process.exit(1);
}

const from = args[0];
const to = args[1];
const kiekis = args[2] ? parseInt(args[2], 10) : 1;

perkeltiFailus(from, to, kiekis)
    .then(() => {
        log("Viskas baigta.");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Klaida:", error);
        process.exit(1);
    });

import { postgres } from "../../postgres/postgres.js";
import {
    WINDOW_COUNT_SQL,
    splitWindowCount,
} from "../../utils/windowCount.js";

export async function gautiPinregDeklaracijasPagalJarKoda(
    jarKodas,
    options = {},
) {
    let limit = options.limit ? Number(options.limit) : null;

    // Kiekvienam įrašo tipui – viena užklausa; bendras kiekis paimamas lango
    // funkcija toje pačioje užklausoje (anksčiau buvo atskiras COUNT(*)).
    // `irasoTipas` rašomas literalu (reikšmės – fiksuotos, ne iš vartotojo), nes
    // daliniai indeksai (`WHERE "irasoTipas" = '...'`) pritaikomi tik tada, kai
    // sąlyga matoma planavimo metu.
    const pagalTipa = (irasoTipas) =>
        postgres.query(
            `SELECT *, ${WINDOW_COUNT_SQL} FROM public."pinregJuridiniaiRysiai"
           WHERE "jarKodas" = $1
           AND "irasoTipas" = '${irasoTipas}'
           ORDER BY "pateikimoData" DESC
           ${limit ? "LIMIT $2" : ""}`,
            limit ? [jarKodas, limit] : [jarKodas],
        );

    const [darbovietesQuery, rysiaiQuery, sutuoktiniuQuery] = await Promise.all(
        [
            pagalTipa("DEKLARUOJANCIO_DARBOVIETE"),
            pagalTipa("KITI_RYSIAI_SU_JA"),
            pagalTipa("SUTUOKTINIO_DARBOVIETE"),
        ],
    );

    const { rows: darbovietesRows, viso: darbovietesCount } = splitWindowCount(
        darbovietesQuery.rows,
    );
    const { rows: rysiaiRows, viso: rysiaiCount } = splitWindowCount(
        rysiaiQuery.rows,
    );
    const { rows: sutuoktiniuRows, viso: sutuoktiniuCount } = splitWindowCount(
        sutuoktiniuQuery.rows,
    );

    // Prepare result arrays
    let darbovietes = [];
    let sutuoktinioDarbovietes = [];
    let rysiaiSuJa = [];

    // Helper to title-case and censor names
    function formatName(name) {
        if (!name) return null;

        // Title case
        const titleCased = name
            .toLowerCase()
            .split(" ")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");

        // Censor except first and last letter
        return titleCased
            .split(" ")
            .map((w) =>
                w.length <= 2
                    ? w
                    : w.charAt(0) +
                      "*".repeat(w.length - 2) +
                      w.charAt(w.length - 1),
            )
            .join(" ");
    }

    // Process pinregDarbovietes data
    try {
        darbovietesRows.forEach((row) => {
            const asmuo = formatName(
                `${row.vardas || ""} ${row.pavarde || ""}`.trim(),
            );

            darbovietes.push({
                ...row,
                uuid: row.deklaracija,
                asmuo,
                pateikimoData: row.pateikimoData,
            });
        });
    } catch (e) {
        console.error("Error processing darbovietesRows:", e);
    }

    // Process pinregSutuoktiniuDarbovietes data
    sutuoktiniuRows.forEach((row) => {
        const deklaruojancioVardas =
            row.deklaruojancioVardas || row.susijusioAsmensVardas || "";
        const deklaruojancioPavarde =
            row.deklaruojancioPavarde || row.susijusioAsmensPavarde || "";
        const sutuoktinioVardas = row.sutuoktinioVardas || row.vardas || "";
        const sutuoktinioPavarde =
            row.sutuoktinioPavarde || row.pavarde || "";

        const deklaruojancio = formatName(
            `${deklaruojancioVardas} ${deklaruojancioPavarde}`.trim(),
        );
        const sutuoktinio = formatName(
            `${sutuoktinioVardas} ${sutuoktinioPavarde}`.trim(),
        );

        sutuoktinioDarbovietes.push({
            ...row,
            uuid: row.deklaracija,
            asmuo: deklaruojancio,
            sutuoktinis: sutuoktinio,
            pateikimoData: row.pateikimoData,
        });
    });

    // Process pinregRysiaiSuJa data
    rysiaiRows.forEach((row) => {
        const asmuo = formatName(
            `${row.vardas || "-"} ${row.pavarde || "-"}`.trim(),
        );
        rysiaiSuJa.push({
            ...row,
            uuid: row.deklaracija,
            asmuo,
            pateikimoData: row.pateikimoData,
        });
    });

    return {
        darbovietes,
        sutuoktinioDarbovietes,
        rysiaiSuJa,
        counts: {
            darbovietes: darbovietesCount,
            sutuoktiniuDarbovietes: sutuoktiniuCount,
            rysiaiSuJa: rysiaiCount,
        },
        total: darbovietesCount + sutuoktiniuCount + rysiaiCount,
        rows:
            darbovietes.length +
            sutuoktinioDarbovietes.length +
            rysiaiSuJa.length,
        limit: limit,
    };
}

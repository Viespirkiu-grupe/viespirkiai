import { postgres } from "../../postgres/postgres.js";

export async function gautiPinregDeklaracijasPagalJarKoda(
    jarKodas,
    options = {},
) {
    let limit = options.limit ? Number(options.limit) : null;

    const [
        darbovietesQuery,
        darbovietesCountsQuery,
        rysiaiQuery,
        rysiaiCountsQuery,
        sutuoktiniuQuery,
        sutuoktiniuCountsQuery,
    ] = await Promise.all([
        // 1. Deklaruojancio darbovietes data
        postgres.query(
            `SELECT * FROM public."pinregJuridiniaiRysiai"
           WHERE "jarKodas" = $1
           AND "irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'
           ORDER BY "pateikimoData" DESC
           ${limit ? "LIMIT $2" : ""}`,
            limit ? [jarKodas, limit] : [jarKodas],
        ),
        // 2. Deklaruojancio darbovietes count
        postgres.query(
            `SELECT COUNT(*)::int AS "count" FROM public."pinregJuridiniaiRysiai"
           WHERE "jarKodas" = $1
           AND "irasoTipas" = 'DEKLARUOJANCIO_DARBOVIETE'`,
            [jarKodas],
        ),
        // 3. Kiti rysiai su JA data
        postgres.query(
            `SELECT * FROM public."pinregJuridiniaiRysiai"
           WHERE "jarKodas" = $1
           AND "irasoTipas" = 'KITI_RYSIAI_SU_JA'
           ORDER BY "pateikimoData" DESC
           ${limit ? "LIMIT $2" : ""}`,
            limit ? [jarKodas, limit] : [jarKodas],
        ),
        // 4. Kiti rysiai su JA count
        postgres.query(
            `SELECT COUNT(*)::int AS "count" FROM public."pinregJuridiniaiRysiai"
           WHERE "jarKodas" = $1
           AND "irasoTipas" = 'KITI_RYSIAI_SU_JA'`,
            [jarKodas],
        ),
        // 5. Sutuoktinio darbovietes data
        postgres.query(
            `SELECT * FROM public."pinregJuridiniaiRysiai"
           WHERE "jarKodas" = $1
           AND "irasoTipas" = 'SUTUOKTINIO_DARBOVIETE'
           ORDER BY "pateikimoData" DESC
           ${limit ? "LIMIT $2" : ""}`,
            limit ? [jarKodas, limit] : [jarKodas],
        ),
        // 6. Sutuoktinio darbovietes count
        postgres.query(
            `SELECT COUNT(*)::int AS "count" FROM public."pinregJuridiniaiRysiai"
           WHERE "jarKodas" = $1
           AND "irasoTipas" = 'SUTUOKTINIO_DARBOVIETE'`,
            [jarKodas],
        ),
    ]);

    const darbovietesRows = darbovietesQuery.rows;
    const darbovietesCounts = darbovietesCountsQuery.rows;
    const rysiaiRows = rysiaiQuery.rows;

    const rysiaiCounts = rysiaiCountsQuery.rows;
    const sutuoktiniuRows = sutuoktiniuQuery.rows;
    const sutuoktiniuCounts = sutuoktiniuCountsQuery.rows;

    const rysiaiCount =
        rysiaiCounts.length > 0 ? Number(rysiaiCounts[0].count) : 0;
    const darbovietesCount =
        darbovietesCounts.length > 0 ? Number(darbovietesCounts[0].count) : 0;
    const sutuoktiniuCount =
        sutuoktiniuCounts.length > 0 ? Number(sutuoktiniuCounts[0].count) : 0;

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

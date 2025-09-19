import { postgres } from "../../postgres/postgres.js";

export async function gautiDarboGrafikaPagalSutarciuRedagavima(jarKodas) {
    const { rows: pagalValandas } = await postgres.query(
        `WITH hours AS (
            SELECT generate_series(0,23) AS hour
        )
        SELECT
            h.hour,
            COALESCE(COUNT(s."sutartiesUnikalusId"), 0) AS contracts_count
        FROM hours h
        LEFT JOIN sutartys s
            ON EXTRACT(HOUR FROM s."paskutinioRedagavimoData") = h.hour
            AND s."perkanciosiosOrganizacijosKodas" = $1
        GROUP BY h.hour
        ORDER BY h.hour;
`,
        [jarKodas],
    );

    const { rows: pagalSavaitesDienas } = await postgres.query(
        `WITH days AS (
        SELECT 1 AS dow, 'Pirmadienis' AS day_name
        UNION ALL SELECT 2, 'Antradienis'
        UNION ALL SELECT 3, 'Trečiadienis'
        UNION ALL SELECT 4, 'Ketvirtadienis'
        UNION ALL SELECT 5, 'Penktadienis'
        UNION ALL SELECT 6, 'Šeštadienis'
        UNION ALL SELECT 7, 'Sekmadienis'
    )
    SELECT
        d.day_name,
        COALESCE(COUNT(s."sutartiesUnikalusId"), 0) AS contracts_count
    FROM days d
    LEFT JOIN sutartys s
        ON EXTRACT(ISODOW FROM s."paskutinioRedagavimoData") = d.dow
        AND s."perkanciosiosOrganizacijosKodas" = $1
    GROUP BY d.dow, d.day_name
    ORDER BY d.dow;`,
        [jarKodas],
    );

    let turiPirkimu = false;

    if (pagalValandas.length > 0) {
        const totalContracts = pagalValandas.reduce(
            (sum, row) => sum + parseInt(row.contracts_count, 10),
            0,
        );
        turiPirkimu = totalContracts > 0;
    }

    return {
        pagalValandas,
        pagalSavaitesDienas,
        turiPirkimu,
    };
}

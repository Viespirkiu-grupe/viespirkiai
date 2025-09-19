import { postgres } from "../../postgres/postgres.js";

/**
 * Atnaujina statistikos duomenis ir įrašo į DB.
 * @returns {Promise<void>}
 */
export async function atnaujintiStatistika() {
    // Lentelės
    let statistika = {
        failai: {
            dydziai: {},
            kiekiai: {},
        },
    };

    const lentelesRes = await postgres.query(
        `SELECT
          s.relname AS "tableName",
          pg_table_size(s.relid) AS "dataSize",
          pg_indexes_size(s.relid) AS "indexSize",
          pg_total_relation_size(s.relid) AS "totalSize",
          st.n_live_tup AS "approxRowCount"
        FROM pg_catalog.pg_statio_user_tables s
        JOIN pg_catalog.pg_stat_user_tables st ON s.relid = st.relid
        ORDER BY s.relname ASC;`,
    );

    statistika.lenteles = lentelesRes.rows;

    statistika.lenteles.push({
        tableName: "Iš viso",
        dataSize: statistika.lenteles.reduce((a, b) => {
            const size = parseFloat(b.dataSize);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
        indexSize: statistika.lenteles.reduce((a, b) => {
            const size = parseFloat(b.indexSize);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
        totalSize: statistika.lenteles.reduce((a, b) => {
            const size = parseFloat(b.totalSize);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
        approxRowCount: statistika.lenteles.reduce((a, b) => {
            const size = parseInt(b.approxRowCount, 10);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
    });

    // Failai
    const [visiRes, parsiustiRes, klaidaRes, dydisRes] = await Promise.all([
        postgres.query("SELECT COUNT(*) AS total FROM failai;"),
        postgres.query(
            "SELECT COUNT(*) AS total FROM failai WHERE parsiustas = 1;",
        ),
        postgres.query(
            "SELECT COUNT(*) AS total FROM failai WHERE parsiustas = -1;",
        ),
        postgres.query(
            "SELECT SUM(dydis) AS total FROM failai WHERE parsiustas = 1;",
        ),
    ]);

    // PostgreSQL returns rows as .rows array
    const visiKiekis = parseInt(visiRes.rows[0].total, 10);
    const parsiustiKiekis = parseInt(parsiustiRes.rows[0].total, 10);
    const klaidaKiekis = parseInt(klaidaRes.rows[0].total, 10);
    const neparsiustiKiekis = visiKiekis - parsiustiKiekis - klaidaKiekis;

    const parsiustiDydis = parseFloat(dydisRes.rows[0].total) || 0;
    const vidutinisDydis =
        parsiustiKiekis > 0 ? parsiustiDydis / parsiustiKiekis : 0;
    const visuDydis = vidutinisDydis * visiKiekis;
    const neparsiustiDydis = visuDydis - parsiustiDydis;
    const klaidaDydis = vidutinisDydis * klaidaKiekis;

    statistika.failai.kiekiai = {
        visi: visiKiekis,
        parsiusti: parsiustiKiekis,
        klaida: klaidaKiekis,
        neparsiusti: neparsiustiKiekis,
    };

    statistika.failai.dydziai = {
        visi: parseFloat(visuDydis),
        parsiusti: parseFloat(parsiustiDydis),
        klaida: parseFloat(klaidaDydis),
        neparsiusti: parseFloat(neparsiustiDydis),
    };

    // Failų nuskaitymas
    let nuskaitymoVersijaRes = await postgres.query(
        `SELECT
            CASE
                WHEN nuskaitytas = -1 THEN 'Klaida'
                WHEN nuskaitytas IS NULL THEN 'Nenuskaityta'
                ELSE nuskaitytas::text
            END AS nuskaitytas_status,
            COUNT(*) AS row_count,
            ROUND( COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2 ) AS percent
        FROM public.failai
        GROUP BY nuskaitytas_status
        ORDER BY nuskaitytas_status;`,
    );

    let likoNuskaityti = await postgres.query(`SELECT COUNT(*)
                FROM failai
                WHERE (nuskaitytas IS NULL OR nuskaitytas < 3)
                  AND (nuskaitytas IS NULL OR nuskaitytas >= 0)
                  AND parsiustas = 1
                  AND extension = 'pdf';`);

    statistika.nuskaitymas = {
        pagalVersija: [],
        likoNuskaityti: parseInt(likoNuskaityti.rows[0].count, 10) || 0,
    };

    let zodziuSkaiciusRes = await postgres.query(
        `SELECT SUM("zodziuSkaicius") FROM failai;`,
    );

    let zodziuVidurkisRes = await postgres.query(
        `SELECT AVG("zodziuSkaicius") FROM failai WHERE "zodziuSkaicius" IS NOT NULL;`,
    );

    let zodziuVidurkisNeNulis = await postgres.query(
        `SELECT AVG("zodziuSkaicius") FROM failai WHERE "zodziuSkaicius" > 0;`,
    );

    let nulioZodziuFailuKiekis = await postgres.query(
        `SELECT COUNT(*) FROM failai WHERE "zodziuSkaicius" = 0;`,
    );

    let failuSuZodziaisDalis = await postgres.query(`
      SELECT
          100.0 * COUNT(*) / (SELECT COUNT(*) FROM failai) AS percentage
      FROM failai
      WHERE "zodziuSkaicius" > 0;`);

    statistika.nuskaitymas.zodziuSkaicius =
        parseInt(zodziuSkaiciusRes.rows[0].sum, 10) || 0;

    statistika.nuskaitymas.zodziai = {
        total: parseInt(zodziuSkaiciusRes.rows[0].sum, 10) || 0,
        failaiBeZodziu: parseInt(nulioZodziuFailuKiekis.rows[0].count, 10) || 0,
        vidurkis: parseFloat(zodziuVidurkisRes.rows[0].avg, 10) || 0,
        vidurkisNeNulis: parseFloat(zodziuVidurkisNeNulis.rows[0].avg, 10) || 0,
        failuSuZodziaisDalis:
            parseFloat(failuSuZodziaisDalis.rows[0].percentage, 10) || 0,
    };

    for (let row of nuskaitymoVersijaRes.rows) {
        statistika.nuskaitymas.pagalVersija.push({
            status: row.nuskaitytas_status,
            kiekis: parseInt(row.row_count, 10),
            procentai: row.percent,
        });
    }

    // TOP extension
    let topExtensionRes = await postgres.query(
        `SELECT
            LOWER(extension) AS ext,
            COUNT(*) AS row_count,
            ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS percent
        FROM public.failai
        WHERE extension IS NOT NULL
        GROUP BY LOWER(extension)
        ORDER BY row_count DESC
        LIMIT 10;`,
    );

    statistika.topExtension = topExtensionRes.rows;

    statistika.atnaujinta = new Date();

    await postgres.query(
        `INSERT INTO statistika (timestamp, data)
             VALUES ($1, $2)`,
        [statistika.atnaujinta, statistika],
    );
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await atnaujintiStatistika();
    process.exit(0);
}

import { postgres } from "../../postgres/postgres.js";

export async function gautiSodrosDuomenis(jarKodas) {
    const { rows: sodraRezultatai } = await postgres.query(
        `SELECT
             m.kodas,
             m."jarKodas",
             p.pavadinimas,
             sv.pavadinimas AS savivaldybe,
             e.kodas AS "ekonominesVeiklosKodas",
             e.pavadinimas AS "ekonominesVeiklosPavadinimas",
             m."vidutinisAtlyginimas",
             m."vidutinisAtlyginimas2",
             m.draustieji,
             m.draustieji2,
             m."imokuSuma",
             to_char(m.data, 'YYYY-MM') AS data
         FROM sodra."menesiniai" m
         LEFT JOIN sodra."pavadinimai" p  ON p.id  = m."pavadinimasId"
         LEFT JOIN sodra."savivaldybes" sv ON sv.id = m."savivaldybeId"
         LEFT JOIN sodra."evrk" e          ON e.id  = m."evrkId"
         WHERE m."jarKodas" = $1::integer
         ORDER BY m.data ASC`,
        [jarKodas],
    );

    let sodra;
    if (sodraRezultatai.length > 0) {
        const pirmas = sodraRezultatai.at(-1);

        const naudojamiNaujausi = [
            "kodas",
            "jarKodas",
            "pavadinimas",
            "savivaldybe",
            "ekonominesVeiklosKodas",
            "ekonominesVeiklosPavadinimas",
            "vidutinisAtlyginimas",
            "vidutinisAtlyginimas2",
            "draustieji",
            "draustieji2",
            "imokuSuma",
        ];

        sodra = Object.fromEntries(
            naudojamiNaujausi.map((key) => [key, pirmas[key]]),
        );

        sodra.data = pirmas.data;

        sodra.bendrasDraustujuSkaicius = pirmas.draustieji + pirmas.draustieji2;

        if (sodra.bendrasDraustujuSkaicius > 0) {
            sodra.bendrasVidutinisAtlyginimas =
                (pirmas.vidutinisAtlyginimas * pirmas.draustieji +
                    pirmas.vidutinisAtlyginimas2 * pirmas.draustieji2) /
                sodra.bendrasDraustujuSkaicius;

            sodra.atlyginimuIslaidos = parseFloat(
                (
                    sodra.bendrasVidutinisAtlyginimas *
                    sodra.bendrasDraustujuSkaicius
                ).toFixed(2),
            );
        } else {
            sodra.bendrasVidutinisAtlyginimas = undefined;
            sodra.atlyginimuIslaidos = undefined;
        }

        sodra.duomenys = sodraRezultatai.map((row) => ({
            data: row.data,
            vidutinisAtlyginimas: row.vidutinisAtlyginimas,
            draustieji: row.draustieji,
            vidutinisAtlyginimas2: row.vidutinisAtlyginimas2,
            draustieji2: row.draustieji2,
            imokuSuma: row.imokuSuma,
        }));

        // Loop over data and check for null values
        sodra.turejoDraustuju = sodra.duomenys.some(
            (row) => row.draustieji > 0,
        );

        sodra.turejoDraustuju2 = sodra.duomenys.some(
            (row) => row.draustieji2 > 0,
        );

        sodra.turejoAtlyginimu = sodra.duomenys.some(
            (row) => row.vidutinisAtlyginimas > 0,
        );

        sodra.turejoAtlyginimu2 = sodra.duomenys.some(
            (row) => row.vidutinisAtlyginimas2 > 0,
        );
    }

    return sodra;
}

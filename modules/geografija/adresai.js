import { postgres } from "../../postgres/postgres.js";

/**
 * Looks up coordinates for a Lithuanian address using the AR database tables.
 *
 * @param {string} raw - Raw address string e.g. "Vilnius, Savanorių pr. 178, LT-03154"
 * @returns {Promise<{ location: [number, number] } | undefined>}
 */
export async function getAddressCoords(raw) {
    if (!raw.trim()) return undefined;

    const normalized = raw.replace(/(\d+)\s+K\d+/g, "$1");
    const parts = normalized.split(/,\s*/);

    async function getCenterByName(name) {
        const { rows: r0 } = await postgres.query(
            `SELECT ST_Y(ST_Centroid("geometrija"::geometry)) AS lat,
               ST_X(ST_Centroid("geometrija"::geometry)) AS lon
        FROM "arGyvenvietesRibos"
        WHERE "pavadinimas" ILIKE $1
        LIMIT 1`,
            [`${name.trim()}%`],
        );
        if (r0.length) return { location: [r0[0].lat, r0[0].lon] };

        const { rows: r1 } = await postgres.query(
            `SELECT ST_Y(ST_Centroid("geometrija"::geometry)) AS lat,
               ST_X(ST_Centroid("geometrija"::geometry)) AS lon
        FROM "arGyvenvietesRibos" gyv
        JOIN "gyvenamosVietoves" gv ON gyv."pavadinimas" ILIKE gv."pavadinimasK" || '%'
        WHERE gv."pavadinimas" ILIKE $1
        LIMIT 1`,
            [`${name.trim()}%`],
        );
        if (r1.length) return { location: [r1[0].lat, r1[0].lon] };

        const { rows: r2 } = await postgres.query(
            `SELECT ST_Y(ST_Centroid("geometrija"::geometry)) AS lat,
               ST_X(ST_Centroid("geometrija"::geometry)) AS lon
        FROM "arSavivaldybes"
        WHERE "pavadinimas" ILIKE $1
        LIMIT 1`,
            [`${name.trim()}%`],
        );
        if (r2.length) return { location: [r2[0].lat, r2[0].lon] };

        return undefined;
    }

    const savMatch = raw.match(
        /^(.+?)\s+(?:miesto\s+)?savivaldybės\s+teritorija$/i,
    );
    if (savMatch) return getCenterByName(savMatch[1]);

    let city, street, nr;
    for (let i = parts.length - 1; i >= 1; i--) {
        // Allow apartment suffixes like -R53, -K3, -12A etc.
        const streetMatch = parts[i].match(
            /^(.+?)\s+(\d+[A-Za-z]?)(?:-[A-Za-z]?\d+[A-Za-z]?)?\s*$/,
        );
        if (streetMatch && !parts[i].match(/^LT-\d{5}$/i)) {
            street = streetMatch[1];
            nr = streetMatch[2];
            city = parts[i - 1];
            break;
        }
    }

    if (!street || !nr) {
        const lastPart = parts[parts.length - 1];
        const placeName = lastPart
            .replace(/\s*(r\.\s*sav\.|sav\.|sen\.|mstl\.).*$/i, "")
            .trim();
        if (placeName) return getCenterByName(placeName);
        return undefined;
    }

    if (street.match(/\bk\.\s*$/i)) {
        return getCenterByName(street);
    }

    const postcode = normalized.match(/LT-(\d{5})/i)?.[1];
    const cityIsVillage = city?.match(/\bk\.\s*$/i);

    const streetVariants = [street.trim()];
    const fullNameMatch = street.match(
        /^([A-ZÁČĘĖĮŠŲŪŽ][a-záčęėįšųūž]+(?:\s+[A-ZÁČĘĖĮŠŲŪŽ][a-záčęėįšųūž]+)*)\s+(g\.|pr\.|al\.|pl\.|tak\.|kel\.|skg\.|a\.)$/,
    );
    if (fullNameMatch) {
        const words = fullNameMatch[1].split(/\s+/);
        const suffix = fullNameMatch[2];
        if (words.length >= 2) {
            streetVariants.push(
                `${words[0][0]}. ${words.slice(1).join(" ")} ${suffix}`,
            );
            for (const word of words) {
                const v = `${word} ${suffix}`;
                if (!streetVariants.includes(v)) streetVariants.push(v);
            }
        }
    }

    for (const streetVariant of streetVariants) {
        // City via gyvenamosVietoves (towns/cities)
        if (!cityIsVillage && city) {
            const { rows } = await postgres.query(
                `SELECT ST_X(a."geometrija"::geometry) AS lon,
                 ST_Y(a."geometrija"::geometry) AS lat
          FROM "arPastataiSklypaiAdresai" p
          JOIN "arAdresai" a ON a."kodas" = p."kodas"
          JOIN "arGatves" g ON g."kodas" = p."gatKodas"
          JOIN "arGyvenvietesRibos" gyv ON gyv."kodas" = g."gyvKodas"
          JOIN "gyvenamosVietoves" gv ON gyv."pavadinimas" ILIKE gv."pavadinimasK" || '%'
          WHERE p."nr" = $1
            AND g."pavadinimas" ILIKE $2
            AND gv."pavadinimas" ILIKE $3
          LIMIT 1`,
                [nr, `${streetVariant}%`, `${city.trim()}%`],
            );
            if (rows.length) return { location: [rows[0].lat, rows[0].lon] };
        }

        // Village city — match directly against arGyvenvietesRibos pavadinimas
        if (cityIsVillage && city) {
            const { rows } = await postgres.query(
                `SELECT ST_X(a."geometrija"::geometry) AS lon,
                 ST_Y(a."geometrija"::geometry) AS lat
          FROM "arPastataiSklypaiAdresai" p
          JOIN "arAdresai" a ON a."kodas" = p."kodas"
          JOIN "arGatves" g ON g."kodas" = p."gatKodas"
          JOIN "arGyvenvietesRibos" gyv ON gyv."kodas" = g."gyvKodas"
          WHERE p."nr" = $1
            AND g."pavadinimas" ILIKE $2
            AND gyv."pavadinimas" ILIKE $3
          LIMIT 1`,
                [nr, `${streetVariant}%`, `${city.trim()}%`],
            );
            if (rows.length) return { location: [rows[0].lat, rows[0].lon] };
        }

        // Postcode fallback
        if (postcode) {
            const { rows } = await postgres.query(
                `SELECT ST_X(a."geometrija"::geometry) AS lon,
                 ST_Y(a."geometrija"::geometry) AS lat
          FROM "arPastataiSklypaiAdresai" p
          JOIN "arAdresai" a ON a."kodas" = p."kodas"
          JOIN "arGatves" g ON g."kodas" = p."gatKodas"
          WHERE p."nr" = $1
            AND p."pastoKodas" = $2
            AND g."pavadinimas" ILIKE $3
          LIMIT 1`,
                [nr, `LT-${postcode}`, `${streetVariant}%`],
            );
            if (rows.length) return { location: [rows[0].lat, rows[0].lon] };
        }

        // No postcode, no village — city + street + nr
        if (!postcode && !cityIsVillage && city) {
            const { rows } = await postgres.query(
                `SELECT ST_X(a."geometrija"::geometry) AS lon,
                 ST_Y(a."geometrija"::geometry) AS lat
          FROM "arPastataiSklypaiAdresai" p
          JOIN "arAdresai" a ON a."kodas" = p."kodas"
          JOIN "arGatves" g ON g."kodas" = p."gatKodas"
          JOIN "arGyvenvietesRibos" gyv ON gyv."kodas" = g."gyvKodas"
          JOIN "gyvenamosVietoves" gv ON gyv."pavadinimas" ILIKE gv."pavadinimasK" || '%'
          WHERE p."nr" = $1
            AND g."pavadinimas" ILIKE $2
            AND gv."pavadinimas" ILIKE $3
          LIMIT 1`,
                [nr, `${streetVariant}%`, `${city.trim()}%`],
            );
            if (rows.length) return { location: [rows[0].lat, rows[0].lon] };
        }
    }

    return undefined;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const arg = process.argv[2];

    if (arg === "--test") {
        const { rows } = await postgres.query(
            `SELECT "adresas" FROM "jarCsv"
           WHERE "adresas" IS NOT NULL
           ORDER BY RANDOM()
           LIMIT 1000`,
        );

        let found = 0;
        let notFound = 0;

        for (const { adresas } of rows) {
            const result = await getAddressCoords(adresas);
            if (result) {
                found++;
                console.log(`✓ ${adresas}`);
                console.log(
                    `  https://www.openstreetmap.org/?mlat=${result.location[0]}&mlon=${result.location[1]}#map=17/${result.location[0]}/${result.location[1]}`,
                );
            } else {
                notFound++;
                const normalized = adresas.replace(/(\d+)\s+K\d+/g, "$1");
                const parts = normalized.split(/,\s*/);

                let city, street, nr;
                for (let i = parts.length - 1; i >= 1; i--) {
                    const streetMatch = parts[i].match(
                        /^(.+?)\s+(\d+[A-Za-z]?)(?:-\d+[A-Za-z]?)?\s*$/,
                    );
                    if (streetMatch && !parts[i].match(/^LT-\d{5}$/i)) {
                        street = streetMatch[1];
                        nr = streetMatch[2];
                        city = parts[i - 1];
                        break;
                    }
                }

                console.log(`✗ ${adresas}`);
                console.log(`  parts: ${JSON.stringify(parts)}`);
                console.log(`  → city="${city}" street="${street}" nr="${nr}"`);
            }
        }

        console.log(
            `\n  found: ${found}/${rows.length}, not found: ${notFound}/${rows.length}`,
        );
    } else {
        const address = arg;

        if (!address) {
            console.error("Usage: node adresai.js <address>");
            console.error("       node adresai.js --test");
            process.exit(1);
        }

        const result = await getAddressCoords(address);

        if (result) {
            console.log(`✓ ${address}`);
            console.log(`  lat: ${result.location[0]}`);
            console.log(`  lon: ${result.location[1]}`);
            console.log(
                `  https://www.openstreetmap.org/?mlat=${result.location[0]}&mlon=${result.location[1]}#map=17/${result.location[0]}/${result.location[1]}`,
            );
        } else {
            console.log(`✗ Not found: ${address}`);
        }
    }

    await postgres.end();
}

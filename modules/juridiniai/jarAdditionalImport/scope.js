export async function previousImport(file, db) {
    const { rows } = await db.query(
        `SELECT "etag", "lastModified", "dydis" AS "size", "sha256",
                "eiluciuSkaicius", "formavimoData"
         FROM "rcJar"."rcImportai"
         WHERE "saltinioFailas" = $1`,
        [file],
    );
    return rows[0] ?? null;
}

function sourceDataset(source) {
    if (source.kind === "finansai") return `finansai:${source.ataskaitosTipas}`;
    if (source.kind === "zymos") return `zymos:${source.zymosTipas}:${source.intervalas}`;
    return source.kind;
}

export async function saveImportMetadata(client, source, metadata, scanned, formavimoData) {
    await client.query(
        `INSERT INTO "rcJar"."rcImportai" AS old
            ("saltinioFailas", "rinkinys", "saltinioMetai", "etag",
             "lastModified", "dydis", "sha256", "eiluciuSkaicius",
             "formavimoData", "importuota")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT ("saltinioFailas") DO UPDATE SET
             "rinkinys" = EXCLUDED."rinkinys",
             "saltinioMetai" = EXCLUDED."saltinioMetai",
             "etag" = EXCLUDED."etag",
             "lastModified" = EXCLUDED."lastModified",
             "dydis" = EXCLUDED."dydis",
             "sha256" = EXCLUDED."sha256",
             "eiluciuSkaicius" = EXCLUDED."eiluciuSkaicius",
             "formavimoData" = EXCLUDED."formavimoData",
             "importuota" = now()`,
        [source.file, sourceDataset(source), source.saltinioMetai ?? null,
            metadata.etag, metadata.lastModified, metadata.size, metadata.sha256,
            scanned, formavimoData],
    );
}

export async function deleteSourceScope(client, source) {
    switch (source.kind) {
        case "finansai":
            await client.query(
                `DELETE FROM "rcJar"."finansinesAtaskaitos"
                 WHERE "ataskaitosTipas" = (
                     SELECT "id" FROM "rcJar"."finansiniuAtaskaituTipai"
                     WHERE "kodas" = $1
                 ) AND "saltinioMetai" = $2`,
                [source.ataskaitosTipas, source.saltinioMetai],
            );
            break;
        case "anuliavimai":
            await client.query(`DELETE FROM "rcJar"."finansiniuAtaskaituAnuliavimai"`);
            break;
        case "velavimai":
            await client.query(`DELETE FROM "rcJar"."finansiniuAtaskaituVelavimai"`);
            break;
        case "nepateikimai":
            await client.query(`DELETE FROM "rcJar"."finansiniuAtaskaituNepateikimai"`);
            break;
        case "zymos":
            await client.query(
                `DELETE FROM "rcJar"."zymuStatusai"
                 WHERE "zymosTipas" = $1
                   AND ("statusasIki" IS NULL) = $2`,
                [source.zymosTipas, source.intervalas === "aktyvus"],
            );
            break;
        case "savanoryste":
            await client.query(`DELETE FROM "rcJar"."savanoryste"`);
            break;
        case "jangis":
            await client.query(`DELETE FROM "rcJar"."jangisTeikimai"`);
            break;
        case "jadisSarasai":
            await client.query(`DELETE FROM jadis."dalyviuSarasai"`);
            break;
        case "jadisDalyviai":
            await client.query(`DELETE FROM jadis."dalyviuSkaiciai"`);
            break;
        case "jadisValstybe":
            await client.query(`DELETE FROM jadis."valstybesDalyviai"`);
            break;
        case "dokumentai":
            if (source.nuoMetu) {
                await client.query(
                    `DELETE FROM "rcJar"."dokumentai"
                     WHERE "dokumentoRegistravimoData" >= make_date($1, 1, 1)`,
                    [source.saltinioMetai],
                );
            } else {
                await client.query(
                    `DELETE FROM "rcJar"."dokumentai"
                     WHERE "dokumentoRegistravimoData" >= make_date($1, 1, 1)
                       AND "dokumentoRegistravimoData" < make_date($1 + 1, 1, 1)`,
                    [source.saltinioMetai],
                );
            }
            break;
        default:
            throw new Error(`Nežinomas RC rinkinys: ${source.kind}`);
    }
}


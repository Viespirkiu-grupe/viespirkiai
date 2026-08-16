export async function previousImport(file, db) {
    const { rows } = await db.query(
        `SELECT "etag", "lastModified", "dydis" AS "size", "sha256",
                "eiluciuSkaicius", "formavimoData"
         FROM public."jarRcImportai"
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
        `INSERT INTO public."jarRcImportai" AS old
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
                `DELETE FROM public."jarFinansinesAtaskaitos"
                 WHERE "ataskaitosTipas" = (
                     SELECT "id" FROM public."jarFinansiniuAtaskaituTipai"
                     WHERE "kodas" = $1
                 ) AND "saltinioMetai" = $2`,
                [source.ataskaitosTipas, source.saltinioMetai],
            );
            break;
        case "anuliavimai":
            await client.query(`DELETE FROM public."jarFinansiniuAtaskaituAnuliavimai"`);
            break;
        case "velavimai":
            await client.query(`DELETE FROM public."jarFinansiniuAtaskaituVelavimai"`);
            break;
        case "nepateikimai":
            await client.query(`DELETE FROM public."jarFinansiniuAtaskaituNepateikimai"`);
            break;
        case "zymos":
            await client.query(
                `DELETE FROM public."jarZymuStatusai"
                 WHERE "zymosTipas" = $1
                   AND ("statusasIki" IS NULL) = $2`,
                [source.zymosTipas, source.intervalas === "aktyvus"],
            );
            break;
        case "savanoryste":
            await client.query(`DELETE FROM public."jarSavanoryste"`);
            break;
        case "jangis":
            await client.query(`DELETE FROM public."jarJangisTeikimai"`);
            break;
        case "dokumentai":
            if (source.nuoMetu) {
                await client.query(
                    `DELETE FROM public."jarDokumentai"
                     WHERE "dokumentoRegistravimoData" >= make_date($1, 1, 1)`,
                    [source.saltinioMetai],
                );
            } else {
                await client.query(
                    `DELETE FROM public."jarDokumentai"
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


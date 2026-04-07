import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

export async function deleteFile(id) {
    const query = `SELECT * FROM failai WHERE id = $1 LIMIT 1`;
    const values = [id];
    const res = await postgres.query(query, values);
    if (res.rows.length === 0) {
        throw new Error("File not found");
    }
    const file = res.rows[0];
    const failaiDezesRes = await postgres.query(
        `SELECT * FROM "failaiDezes" WHERE md5 = $1;`,
        [file.md5],
    );
    const failaiDezes = failaiDezesRes.rows;

    for (let failaiDeze of failaiDezes) {
        const dezeRes = await postgres.query(
            `
        SELECT d.*, a."apiKey"
        FROM dezes d
        JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
        WHERE d.pavadinimas = $1
        LIMIT 1
        `,
            [failaiDeze.deze],
        );
        const deze = dezeRes.rows[0];

        if (!deze) continue;

        const url = `${deze.url}/file/${file.md5}.${file.extension}`;
        const apiKey = deze.apiKey;

        log(url);

        await fetch(url, {
            method: "DELETE",
            headers: {
                "x-api-key": apiKey,
            },
        });

        log(`Deleted file from deze: ${deze.pavadinimas}`);

        // Delete it from failaiDezes table
        await postgres.query(
            `DELETE FROM "failaiDezes" WHERE md5 = $1 AND deze = $2;`,
            [file.md5, failaiDeze.deze],
        );
    }


    // Finally, delete the file record from failai table
    await postgres.query(`DELETE FROM failai WHERE id = $1;`, [id]);
    log(`Deleted file record with id: ${id}`);
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    // take first argument as the id
    const id = process.argv[2];

    if (!id) {
        console.error("Please provide a file id");
        process.exit(1);
    }

    await deleteFile(id);
    await postgres.end();
}

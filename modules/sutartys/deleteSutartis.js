import { postgres } from "../../postgres/postgres.js";
import { client } from "../../typesense/typesense.js";
import { deleteFile } from "../failai/deleteFile.js";

async function cvpIsDeleteSutartis(id) {
    // Check if sutartis exists in sutartys table
    const sutartis = await postgres.query(
        `SELECT * FROM sutartys WHERE "sutartiesUnikalusId" = $1`,
        [id],
    );

    if (!sutartis) {
        console.log(`Sutartis with id ${id} does not exist in sutartys table.`);
        return;
    }

    // Find all files associated with the sutartis
    // table failai either dokId = sutartiesUnikalusId OR saltinis = 'sutartys' and saltinioId = sutartiesUnikalusId
    const filesRes = await postgres.query(
        `SELECT * FROM failai WHERE "dokId" = $1 OR ("saltinis" = 'sutartys' AND "saltinioId" = $1::text)`,
        [id],
    );

    const files = filesRes.rows;
    if (files.length === 0) {
        console.log(`No files associated with sutartis id ${id}.`);
    }

    for (const file of files) {
        console.log(
            `Deleting file with id ${file.id} associated with sutartis id ${id}.`,
        );
        await deleteFile(file.id);
    }

    // Finally, delete the sutartis record
    await postgres.query(
        `DELETE FROM sutartys WHERE "sutartiesUnikalusId" = $1`,
        [id],
    );

    // Delete it from Typesense as well
    try {
        await client.collections("sutartys").documents(id).delete();
        console.log(`Deleted sutartis with id ${id} from Typesense.`);
    } catch (error) {
        console.error(
            `Error deleting sutartis with id ${id} from Typesense:`,
            error,
        );
    }

    console.log(`Deleted sutartis with id ${id} from sutartys table.`);
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    // take first argument as the id
    const id = process.argv[2];

    if (!id) {
        console.error("Please provide a sutartiesUnikalusId");
        process.exit(1);
    }

    await cvpIsDeleteSutartis(id);
    await postgres.end();
}

import { postgres } from "../../postgres/postgres.js";
import QueryStream from "pg-query-stream";
import fs from "fs/promises";

// Export all rows in the "sutartys" table as jsonl, stream it to the given filename
async function exportSutartysToJsonl(filename) {
    const client = await postgres.connect();
    try {
        const query = new QueryStream("SELECT row_to_json(t) FROM sutartys t");
        const stream = client.query(query);
        const fileHandle = await fs.open(filename, "w");

        let rowCount = 0;
        for await (const row of stream) {
            await fileHandle.write(`${JSON.stringify(row.row_to_json)}\n`);
            rowCount++;
            if (rowCount % 1000 == 0) {
                console.log(`Exported ${rowCount} rows...`);
            }
        }

        await fileHandle.close();
        console.log(`Exported sutartys to ${filename}`);
    } finally {
        client.release();
    }
}

// Usage example
exportSutartysToJsonl("sutartys_export.jsonl").catch(console.error);

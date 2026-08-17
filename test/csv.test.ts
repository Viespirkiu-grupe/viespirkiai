import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCSV } from "../utils/csv.js";

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) =>
        rm(path, { recursive: true, force: true })));
});

async function fixture(content: string) {
    const directory = await mkdtemp(join(tmpdir(), "csv-test-"));
    directories.push(directory);
    const path = join(directory, "fixture.csv");
    await writeFile(path, content, "utf8");
    return path;
}

describe("parseCSV", () => {
    it("nepraranda eilučių, kai vartotojas tarp eilučių laukia", async () => {
        const rows = Array.from({ length: 20_000 }, (_, index) =>
            `${index}|Reikšmė ${index}`).join("\n");
        const path = await fixture(`id|name\n${rows}\n`);
        let count = 0;
        let last: Record<string, string | null> | null = null;
        for await (const row of parseCSV(path)) {
            count++;
            last = row as Record<string, string | null>;
            if (count % 1_000 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 2));
            }
        }
        expect(count).toBe(20_000);
        expect(last).toEqual({ id: "19999", name: "Reikšmė 19999" });
    });

    it("palaiko kablelio skirtuką, escaped kabutes ir daugiaeilį lauką", async () => {
        const path = await fixture(
            'id,name,description\r\n1,"UAB ""Testas""","pirma\r\nantra"\r\n',
        );
        const rows = [];
        for await (const row of parseCSV(path)) rows.push(row);
        expect(rows).toEqual([{
            id: "1",
            name: 'UAB "Testas"',
            description: "pirma\nantra",
        }]);
    });
});

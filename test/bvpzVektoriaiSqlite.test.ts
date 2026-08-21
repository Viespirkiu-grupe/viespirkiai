import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    createBvpzBeVektoriausReader,
    createBvpzVektoriuWriter,
    getBvpzCounts,
    getBvpzSuVektoriais,
    openBvpzVektoriaiSqlite,
    prepareModel,
    syncBvpzRows,
} from "../modules/vector/bvpzVektoriaiSqlite.js";
import { vecToBlob } from "../modules/vector/vektoriai.js";

const dirs: string[] = [];

function openTestDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvpz-vektoriai-"));
    dirs.push(dir);
    return openBvpzVektoriaiSqlite({ dbPath: path.join(dir, "test.sqlite") });
}

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("BVPŽ vektorių SQLite", () => {
    it("sinchronizuojant išsaugo nepakeistą, nunulina pakeistą ir pašalina dingusį vektorių", () => {
        const db = openTestDb();
        syncBvpzRows(db, [
            { mask: "03", code: "03000000", checksum: "1", pavadinimas: "Žemės ūkis" },
            { mask: "45", code: "45000000", checksum: "7", pavadinimas: "Statybos darbai" },
        ]);
        createBvpzVektoriuWriter(db).updateMany([
            { mask: "03", blob: vecToBlob([1, 0]) },
            { mask: "45", blob: vecToBlob([0, 1]) },
        ]);

        syncBvpzRows(db, [
            { mask: "03", code: "03000000", checksum: "1", pavadinimas: "Žemės ūkis" },
            { mask: "72", code: "72000000", checksum: "5", pavadinimas: "IT paslaugos" },
        ]);

        expect(getBvpzCounts(db)).toEqual({ visi: 2, suVektorium: 1 });
        expect(getBvpzSuVektoriais(db).map((row: any) => row.mask)).toEqual(["03"]);
        expect(createBvpzBeVektoriausReader(db, { batch: 10 })()?.map((row: any) => row.mask)).toEqual(["72"]);
        db.close();
    });

    it("pakeitus modelį išvalo visus vektorius", () => {
        const db = openTestDb();
        syncBvpzRows(db, [
            { mask: "45", code: "45000000", checksum: "7", pavadinimas: "Statybos darbai" },
        ]);
        prepareModel(db, "modelis-a");
        createBvpzVektoriuWriter(db).updateMany([{ mask: "45", blob: vecToBlob([1, 0]) }]);

        expect(prepareModel(db, "modelis-b")).toEqual({ previous: "modelis-a", reset: true });
        expect(getBvpzCounts(db).suVektorium).toBe(0);
        db.close();
    });
});

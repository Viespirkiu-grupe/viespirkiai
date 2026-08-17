import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import config from "../utils/config.js";
import {
  openESeimasSidecar, readESeimasSidecar, readESeimasSidecarMany,
  readResponse, saveResponse,
} from "../modules/eSeimas/eSeimasSidecar.js";

let tempDir: string | null = null;
const original = config.sidecarDir;
afterEach(() => {
  if (original === undefined) delete config.sidecarDir; else config.sidecarDir = original;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("e-Seimas SQLite sidecar", () => {
  it("uses its own database, strips volatile fields and supports batch reads", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eseimas-sidecar-"));
    config.sidecarDir = tempDir;
    const db = openESeimasSidecar();
    const payload = { id: "ABC", official_text: { text: "Aktas" }, fetched_at: "volatile", raw_page_html: "raw" };
    const md5 = saveResponse(db, payload);

    expect(fs.existsSync(path.join(tempDir, "eSeimas.sqlite"))).toBe(true);
    expect(readResponse(db, md5)).toEqual({ id: "ABC", official_text: { text: "Aktas" } });
    expect(await readESeimasSidecar(md5)).toEqual(readResponse(db, md5));
    const many = await readESeimasSidecarMany([md5, "0".repeat(32)]);
    expect([...many.keys()]).toEqual([md5]);
    db.close();
  });
});

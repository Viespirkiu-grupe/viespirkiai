// Commit'o hash'o nustatymas be `git` binary'o – užtenka perskaityti kelis
// failus iš `.git`. Reikalinga ir build metu (scripts/writeBuildInfo.mjs
// container'yje, kur git'o nėra), ir runtime metu (src/lib/buildInfo.ts).
import fs from "node:fs";
import path from "node:path";

const HASH_RE = /^[0-9a-f]{7,40}$/i;

/** Aplinkos kintamieji, kuriuose gali būti paduotas hash'as. */
const ENV_KEYS = ["GIT_COMMIT", "GIT_SHA", "SOURCE_COMMIT"];

function normalize(value) {
    const trimmed = value?.trim();
    return trimmed && HASH_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Hash'as iš aplinkos kintamųjų (CI / `--build-arg` / `.env`). */
export function commitFromEnv(env = process.env) {
    for (const key of ENV_KEYS) {
        const commit = normalize(env[key]);
        if (commit) return commit;
    }
    return null;
}

function readFile(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
}

/** `.git` katalogas; worktree/submodule atveju `.git` yra failas su nuoroda. */
function resolveGitDir(root) {
    const dotGit = path.join(root, ".git");
    let stat;
    try {
        stat = fs.statSync(dotGit);
    } catch {
        return null;
    }
    if (stat.isDirectory()) return dotGit;

    const pointer = readFile(dotGit)?.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    if (!pointer) return null;
    return path.resolve(root, pointer);
}

/**
 * Hash'as tiesiai iš `.git` (HEAD → refs/… → packed-refs).
 * @param {string} [root] repozitorijos šaknis
 */
export function commitFromGitDir(root = process.cwd()) {
    const gitDir = resolveGitDir(root);
    if (!gitDir) return null;

    const head = readFile(path.join(gitDir, "HEAD"))?.trim();
    if (!head) return null;

    // Detached HEAD – faile iškart guli hash'as.
    const detached = normalize(head);
    if (detached) return detached;

    const ref = head.match(/^ref:\s*(.+)$/)?.[1]?.trim();
    if (!ref) return null;

    const loose = normalize(readFile(path.join(gitDir, ref))?.trim() ?? "");
    if (loose) return loose;

    // Supakuotos nuorodos (`git gc` sutraukia refs/ į vieną failą).
    const packed = readFile(path.join(gitDir, "packed-refs"));
    const packedHash = packed
        ?.split("\n")
        .find((line) => line.endsWith(` ${ref}`))
        ?.split(" ")[0];
    return normalize(packedHash ?? "");
}

/** Aplinkos kintamasis turi pirmenybę, toliau – `.git`. */
export function resolveCommit(root = process.cwd(), env = process.env) {
    return commitFromEnv(env) ?? commitFromGitDir(root);
}

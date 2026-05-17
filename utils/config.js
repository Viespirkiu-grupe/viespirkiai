import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

let config = {};

async function fileExists(filePath) {
    return fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
}

async function findConfigPath(startDir) {
    let currentDir = path.resolve(startDir);

    while (true) {
        const candidate = path.join(currentDir, "config.js");
        if (await fileExists(candidate)) return candidate;

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) return null;
        currentDir = parentDir;
    }
}

const configPath =
    (await findConfigPath(process.cwd())) ||
    (await findConfigPath(moduleDir)) ||
    null;

if (configPath) {
    try {
        const imported = await import(pathToFileURL(configPath).href);
        config = imported.default || imported;
    } catch (error) {
        console.error("Error loading config:", error);
    }
}

global.CONFIG = config;

export default config;

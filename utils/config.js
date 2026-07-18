import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { normalizeConfig } from "./configSchema.js";
import { loadEnvFile, configFromEnv } from "./configEnv.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// Įkeliam `.env` (jei toks yra) prieš skaitant konfigūraciją, kad aplinkos
// kintamieji galėtų perrašyti `config.js` reikšmes (arba jį pakeisti visiškai).
loadEnvFile(process.cwd()) || loadEnvFile(moduleDir);

/** @type {import("./config.js").Config} */
let config = normalizeConfig({});

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

let fileConfig = {};
if (configPath) {
    try {
        const imported = await import(pathToFileURL(configPath).href);
        fileConfig = imported.default || imported;
    } catch (error) {
        console.error("Error loading config:", error);
    }
}

// Aplinkos kintamieji (iš `.env` arba tikros aplinkos) perrašo `config.js`.
config = normalizeConfig({ ...fileConfig, ...configFromEnv() });

global.CONFIG = config;

export default config;

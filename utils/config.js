import { normalizeConfig } from "./configSchema.js";
import { loadEnvFile, configFromEnv } from "./configEnv.js";
import path from "path";
import { fileURLToPath } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// Įkeliam `.env` (jei toks yra) prieš skaitant konfigūraciją. Konfigūracija
// sudaroma TIK iš aplinkos kintamųjų (`.env` arba tikros aplinkos) – atskiro
// `config.js` failo nebenaudojam.
loadEnvFile(process.cwd()) || loadEnvFile(moduleDir);

/** @type {import("./config.js").Config} */
const config = normalizeConfig(configFromEnv());

global.CONFIG = config;

export default config;

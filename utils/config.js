import fs from "fs/promises";
import path from "path";

const configPath = path.join(process.cwd(), "config.js");

let config = {};

if (
    await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false)
) {
    try {
        const imported = await import(configPath);
        config = imported.default || imported;
    } catch (error) {
        console.error("Error loading config:", error);
    }
}

global.CONFIG = config;

export default config;

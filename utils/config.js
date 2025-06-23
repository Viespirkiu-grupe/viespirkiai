import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '..', 'config.js');
let config = {};

if (await fs.access(configPath).then(() => true).catch(() => false)) {
    try {
        let imported = await import(configPath);
        config = imported.default || imported;
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

export default config;
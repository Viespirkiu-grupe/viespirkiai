import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const configPath = path.join(process.cwd(), 'config.js');

if (!process.env.PORT) {
  const hasConfig = await fs.access(configPath).then(() => true).catch(() => false);

  if (hasConfig) {
    try {
      const imported = await import(pathToFileURL(configPath).href);
      const config = imported.default || imported;
      const port = Number(config?.port);

      if (Number.isFinite(port) && port > 0) {
        process.env.PORT = String(port);
      }
    } catch (error) {
      console.error('Error loading runtime config for server start:', error);
    }
  }
}

await import('./dist/server/entry.mjs');

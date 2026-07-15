import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const configPath = path.join(process.cwd(), 'config.js');

if (!process.env.PORT) {
  const hasConfig = await fs.promises.access(configPath).then(() => true).catch(() => false);

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

// Astro standalone handlerį paleidžiame patys, kad prie to paties HTTP serverio
// ir porto galėtume prijungti WebSocket `upgrade` užklausas.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('./dist/server/entry.mjs');
const { attachSutartysExportWebSocket } = await import('./dist/server/exportWebSocket.mjs');
const server = process.env.SERVER_CERT_PATH && process.env.SERVER_KEY_PATH
  ? https.createServer({
      cert: fs.readFileSync(process.env.SERVER_CERT_PATH),
      key: fs.readFileSync(process.env.SERVER_KEY_PATH),
    }, handler)
  : http.createServer(handler);

attachSutartysExportWebSocket(server);

const port = Number(process.env.PORT) || 9019;
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

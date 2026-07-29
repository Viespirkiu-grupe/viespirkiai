import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { envFlag, logNodeRequest } from './requestLog.mjs';

// Konfigūracija imama TIK iš aplinkos kintamųjų (`.env` arba tikros aplinkos).
// Runtime image'e utils/ nėra, tad naudojam įmontuotą process.loadEnvFile ir
// esamų kintamųjų NEperrašom.
const envPath = path.join(process.cwd(), '.env');
if (await fs.promises.access(envPath).then(() => true).catch(() => false)) {
  const snapshot = { ...process.env };
  const preexisting = new Set(Object.keys(process.env));
  try {
    process.loadEnvFile(envPath);
    for (const key of preexisting) process.env[key] = snapshot[key];
  } catch (error) {
    console.error('Error loading .env file:', error);
  }
}

// Astro standalone handlerį paleidžiame patys, kad prie to paties HTTP serverio
// ir porto galėtume prijungti WebSocket `upgrade` užklausas.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('./dist/server/entry.mjs');
const { attachSutartysExportWebSocket } = await import('./dist/server/exportWebSocket.mjs');
const logRequests = envFlag(process.env.LOG_REQUESTS);
const requestHandler = logRequests
  ? (request, response) => {
      logNodeRequest(request);
      return handler(request, response);
    }
  : handler;
const server = process.env.SERVER_CERT_PATH && process.env.SERVER_KEY_PATH
  ? https.createServer({
      cert: fs.readFileSync(process.env.SERVER_CERT_PATH),
      key: fs.readFileSync(process.env.SERVER_KEY_PATH),
    }, requestHandler)
  : http.createServer(requestHandler);

if (logRequests) server.on('upgrade', logNodeRequest);
attachSutartysExportWebSocket(server);

const port = Number(process.env.PORT) || 9019;
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

// Graceful shutdown – kitaip Node kaip PID 1 ignoruoja SIGTERM ir Docker laukia
// visą stop grace period (10 s) prieš SIGKILL.
const shutdown = (signal) => {
  console.log(`${signal} gautas – uždaromas serveris...`);
  server.close(() => process.exit(0));
  // WebSocket / keep-alive jungtys neleistų server.close() užbaigti iškart.
  server.closeAllConnections?.();
  // Kraštutinis fallback, jei kažkas vis tiek kabo.
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

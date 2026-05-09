import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, 'dist/client');

const { handler } = await import('./dist/server/entry.mjs');

const IMMUTABLE = 'public, max-age=31536000, immutable';

const app = express();

app.use(express.static(clientDist, {
  setHeaders(res, filePath) {
    if (filePath.includes('/assets/') || filePath.includes('/fontai/')) {
      res.setHeader('Cache-Control', IMMUTABLE);
    }
  },
}));

app.use((req, res) => handler(req, res));

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${config.port}`);
});

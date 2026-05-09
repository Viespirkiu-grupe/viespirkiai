import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'middleware' }),
  security: { checkOrigin: false },
  server: {
    port: config.port,
    host: '0.0.0.0',
  },
  vite: {
    resolve: {
      alias: {
        '@': root,
        '@design-system': path.join(root, 'src/design-system'),
      },
    },
    server: {
      allowedHosts: ['localhost', 'viespirkiai.org', '.viespirkiai.org'],
    },
    plugins: [
      tailwindcss(),
      {
        name: 'immutable-cache',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url?.split('?')[0];
            if (url?.startsWith('/fontai/')) {
              const orig = res.setHeader.bind(res);
              res.setHeader = (name, value) => {
                if (name.toLowerCase() === 'cache-control') return res;
                return orig(name, value);
              };
              orig('Cache-Control', 'public, max-age=31536000, immutable');
            }
            next();
          });
        },
      },
    ],
  },
});

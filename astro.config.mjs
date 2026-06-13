import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Per build (npm run build) public/ NEkopijuojamas į dist/client (kad nedubliuotų
  // ~34MB). Vietoj kopijos po build'o sukuriami symlink'ai (scripts/linkPublic.mjs),
  // tad standalone serveris statinius failus ima tiesiai iš public/.
  // Dev metu (astro dev) public/ tiekiamas kaip įprasta.
  publicDir: process.env.ASTRO_NO_PUBLIC_COPY ? './.nopublic' : './public',
  // A custom fetch-based hover prefetch is loaded by Layout.astro because
  // Firefox may ignore the low-priority <link rel="prefetch"> Astro creates.
  prefetch: false,
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

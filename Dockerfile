# Astro SSR (standalone) frontend.
#
# Statoma dviem etapais: `builder` paleidžia `npm run build` (astro build +
# linkPublic), o galutinis `runtime` image'as turi TIK node_modules + dist/ +
# start-server.mjs. Konfigūracija paduodama per .env (env_file compose.yml),
# o public/, modules/ ir /flashas duomenų katalogai primontuojami runtime metu.
#
# Reikia BuildKit (numatytas moderniame Docker; CI nustatyti DOCKER_BUILDKIT=1)
# dėl `--mount=type=cache` npm cache mount'ų.

# ---- deps: TIK produkcinės priklausomybės (be devDependencies) ----
FROM node:24-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---- builder: pilnos priklausomybės + build ----
FROM node:24-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Šaltinis (config.js build'ui nereikia – astro.config.mjs jo neimportuoja)
COPY . .
RUN npm run build

# ---- runtime-base: sisteminis Chromium (brangus apt sluoksnis, keičiasi retai) ----
# Atskirtas nuo galutinio runtime, kad apt-get sluoksnis būtų cache'inamas
# nepriklausomai nuo dist/ pokyčių.
FROM node:24-slim AS runtime-base
# Sisteminis Chromium OG paveikslėlių atvaizdavimui (utils/openGraphImage.js
# per puppeteer.launch()). Puppeteer nukreipiamas į jį, nes savo Chromium
# nesisiuntė (PUPPETEER_SKIP_DOWNLOAD=1).
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# ---- runtime ----
FROM runtime-base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Produkcinės priklausomybės iš deps (be typescript/vitest/tailwind/astro-check),
# statinis build'as iš builder'io. Konfigūracija per .env; public / modules
# montuojami per compose.
# --link: šie sluoksniai nepriklauso nuo bazinio image'o, tad BuildKit juos
# perpanaudoja tarp build'ų (net kai keičiasi runtime-base) ir greičiau eksportuoja.
COPY --link --from=deps /app/node_modules ./node_modules
COPY --link --from=builder /app/dist ./dist
COPY --link --from=builder /app/start-server.mjs ./

# Prievadą nustato start-server.mjs iš .env PORT (numatytas 9019). network_mode: host,
# tad EXPOSE tik informacinis.
EXPOSE 9019

CMD ["node", "start-server.mjs"]

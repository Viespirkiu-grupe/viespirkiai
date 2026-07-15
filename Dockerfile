# Astro SSR (standalone) frontend.
#
# Statoma dviem etapais: `builder` paleidžia `npm run build` (astro build +
# linkPublic), o galutinis `runtime` image'as turi TIK node_modules + dist/ +
# start-server.mjs. config.js, public/, modules/ ir /flashas duomenų katalogai
# NEkopijuojami – jie primontuojami per compose.yml runtime metu.

# ---- deps: TIK produkcinės priklausomybės (be devDependencies) ----
FROM node:24-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- builder: pilnos priklausomybės + build ----
FROM node:24-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

# Šaltinis + config.js (config.js reikia BUILD metu, nes jį importuoja
# astro.config.mjs; į runtime image'ą jis nepatenka)
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Sisteminis Chromium OG paveikslėlių atvaizdavimui (utils/openGraphImage.js
# per puppeteer.launch()). Puppeteer nukreipiamas į jį, nes savo Chromium
# nesisiuntė (PUPPETEER_SKIP_DOWNLOAD=1).
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Produkcinės priklausomybės iš deps (be typescript/vitest/tailwind/astro-check),
# statinis build'as ir WebSocket eksporto priklausomybės. config.js / public /
# modules montuojami per compose, bet modules kopija paliekama ir image'e.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/start-server.mjs ./
COPY --from=builder /app/modules ./modules
COPY --from=builder /app/postgres ./postgres
COPY --from=builder /app/quickwit ./quickwit
COPY --from=builder /app/utils ./utils

# Prievadą nustato start-server.mjs iš config.js (9019). network_mode: host,
# tad EXPOSE tik informacinis.
EXPOSE 9019

CMD ["node", "start-server.mjs"]

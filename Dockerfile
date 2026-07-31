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
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---- builder: pilnos priklausomybės + build ----
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Šaltinis (config.js build'ui nereikia – astro.config.mjs jo neimportuoja)
COPY . .
RUN npm run build

# ---- runtime ----
# OG paveikslėliai generuojami satori + resvg (utils/openGraphImage.js) —
# naršyklės nebereikia, tad ir sisteminio Chromium sluoksnio nebėra.
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Produkcinės priklausomybės iš deps (be typescript/vitest/tailwind/astro-check),
# statinis build'as iš builder'io. Konfigūracija per .env; public / modules
# montuojami per compose.
# --link: šie sluoksniai nepriklauso nuo bazinio image'o, tad BuildKit juos
# perpanaudoja tarp build'ų ir greičiau eksportuoja.
COPY --link --from=deps /app/node_modules ./node_modules
COPY --link --from=builder /app/dist ./dist
COPY --link --from=builder /app/start-server.mjs ./
COPY --link --from=builder /app/requestLog.mjs ./
# Šriftai ir logotipas OG generavimui — openGraphImage.js juos skaito iš
# src/assets santykinai nuo cwd (/app) runtime metu.
COPY --link --from=builder /app/src/assets/fontai ./src/assets/fontai
COPY --link --from=builder /app/src/assets/branding ./src/assets/branding

# Paleistos versijos commit'as – rodomas footer'yje (src/lib/buildInfo.ts).
# `.git` neįeina į build kontekstą, tad hash'as paduodamas iš išorės:
# CI – `--build-arg GIT_COMMIT=${{ github.sha }}`, lokaliai –
# `GIT_COMMIT=$(git rev-parse HEAD) docker compose build`. Nenustačius footer'is
# versijos eilutės nerodo. Laikoma paskutiniuose sluoksniuose, kad kiekvienas
# naujas hash'as neperstatytų COPY sluoksnių.
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT

# Prievadą nustato start-server.mjs iš .env PORT (numatytas 9019). network_mode: host,
# tad EXPOSE tik informacinis.
EXPOSE 9019

CMD ["node", "start-server.mjs"]

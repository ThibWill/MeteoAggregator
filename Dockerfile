# MeteoAggregator — batch/CLI app (Node 20 ESM, run via tsx).
# The app talks to PostGIS over the network only; no build output is emitted
# (tsx runs the TypeScript directly), so devDependencies (tsx, prisma) stay in
# the final image.

FROM node:20-slim AS deps
WORKDIR /app
# Prisma engines need openssl at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# Generate the Prisma client for this image's platform.
RUN npx prisma generate

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]
# Batch app: override per task, e.g. `docker compose run --rm app npm run seed`.
CMD ["npm", "run", "daily"]

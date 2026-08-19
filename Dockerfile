# Marine Scheduler — container image for Cloud Run.
#
# Two stages. The builder installs everything and produces the Vite client bundle
# plus the esbuild server bundle; the runtime carries only production dependencies
# and the build output.
#
# Why production deps are still needed at runtime: the server bundle is built with
# esbuild's --packages=external, so express, drizzle, postgres and the HiGHS WASM
# solver are required from node_modules rather than inlined.

# ---- build ------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# npm ci --omit=dev needs the lockfile; nothing else from the source tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# Migrations are replayed at startup, so the SQL has to ship with the image.
COPY --from=build /app/drizzle ./drizzle

# Cloud Run injects PORT; the server reads it via the validated config.
ENV PORT=8080
EXPOSE 8080

# Run unprivileged. The node image ships a `node` user.
USER node

CMD ["node", "dist/server.cjs"]

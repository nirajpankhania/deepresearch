# One image, two Cloud Run services. The entrypoint switches on ROLE=api|worker.
#
# The API and the worker share the shared package, the Firestore client and the
# logging setup, and they are always deployed from the same commit. Building two
# images would mean two builds and two chances for them to drift, for no benefit:
# they still scale and authenticate independently, because that is a property of
# the Cloud Run service, not of the image.

# ---------------------------------------------------------------------------
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Manifests only, so a dependency install is cached independently of source
# changes — which is most rebuilds.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/

# ---------------------------------------------------------------------------
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm --filter @deepresearch/shared --filter @deepresearch/api --filter @deepresearch/worker build

# ---------------------------------------------------------------------------
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The prod-deps stage is already exactly the runtime layout — manifests plus
# production node_modules, including pnpm's workspace symlinks. Copying it whole
# keeps those symlinks intact; copying per-package would not, and packages that
# happen to have no dependencies of their own get no node_modules directory at
# all, which makes an explicit per-package COPY fail.
COPY --from=prod-deps /app ./

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY scripts/docker-entrypoint.sh /usr/local/bin/entrypoint

RUN chmod +x /usr/local/bin/entrypoint && chown -R node:node /app
USER node

# Overridden by Cloud Run, which always injects PORT.
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint"]

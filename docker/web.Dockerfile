# LabForge web app (production build). Build context is the repository root.
FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY . .
# The API-types step needs a running API; nothing imports its output.
RUN pnpm install --frozen-lockfile --ignore-scripts
# next.config.ts bakes the proxy target into the build.
ARG LABFORGE_API_URL=http://api:8000
ENV LABFORGE_API_URL=${LABFORGE_API_URL} NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @labforge/web build

FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

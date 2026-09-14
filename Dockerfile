FROM node:22-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/

RUN npm ci

# Rebuild the source code
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SITE_URL=https://gapssa.es
ARG SITE_NOINDEX=false
ARG PAYLOAD_SECRET=dummy-payload-secret-min-32-chars-for-build
ARG DATABASE_URL_CMS=postgresql://gapssa_apps:dummy@apps-db:5432/gapssa_cms
ARG DATABASE_URL_AUTH=postgresql://gapssa_apps:dummy@apps-db:5432/gapssa_auth
ARG DATABASE_URL_BOOKING=postgresql://gapssa_apps:dummy@apps-db:5432/gapssa_booking

ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV SITE_NOINDEX=$SITE_NOINDEX
ENV PAYLOAD_SECRET=$PAYLOAD_SECRET
ENV DATABASE_URL_CMS=$DATABASE_URL_CMS
ENV DATABASE_URL_AUTH=$DATABASE_URL_AUTH
ENV DATABASE_URL_BOOKING=$DATABASE_URL_BOOKING
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build -w @gapssa/web

# Production runner image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/packages/contracts ./packages/contracts

USER nextjs

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@gapssa/web"]

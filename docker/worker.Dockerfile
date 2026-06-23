FROM node:22-alpine AS base

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
RUN corepack enable pnpm && pnpm i --frozen-lockfile

COPY . .

RUN corepack enable pnpm
RUN pnpm --filter @ovpn/worker build

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker

USER worker

ENV NODE_ENV production

CMD ["node", "apps/worker/dist/index.js"]

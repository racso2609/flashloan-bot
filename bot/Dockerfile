FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY . .

RUN mkdir -p logs

ENV NODE_ENV=production

CMD ["node", "src/index.js", "arbitrum"]

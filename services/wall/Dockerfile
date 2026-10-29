FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY observability ./observability
COPY packages ./packages
COPY services ./services

RUN npm ci && npm run build \
  && mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/data
ENV AGENT_URL=http://poster-agent:4001

USER node
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-sqlite", "services/wall/dist/server.js"]

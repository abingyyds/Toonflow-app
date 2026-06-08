FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com/ && \
    corepack enable && \
    corepack prepare pnpm@11.4.0 --activate && \
    pnpm config set registry https://registry.npmmirror.com/

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV npm_config_electron_skip_binary_download=true

# Copy the repository contents into the image and install all dependencies
COPY . .

# Install with the package manager declared by the upstream 1.1.8 package.json.
RUN pnpm install --frozen-lockfile && \
    pnpm run build && \
    cp data/serve/app.js /app/server.js && \
    mkdir -p /app/data-seed && \
    cp -a data/. /app/data-seed/. && \
    pnpm prune --prod --yes && \
    pnpm store prune

ENV NODE_ENV=prod
ENV PORT=10588

EXPOSE 10588

ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "/app/server.js"]

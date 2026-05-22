# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
# A skeleton /data owned by the distroless nonroot UID (65532). Docker
# initialises a freshly-created named volume from the image's contents
# at the same path, so this step is what makes the default `docker run`
# work without the user having to chown anything.
RUN mkdir -p /opt/data-skeleton && chown -R 65532:65532 /opt/data-skeleton

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps" \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/itsmypassword.db

COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/package.json ./package.json
COPY --chown=nonroot:nonroot migrations ./migrations
COPY --from=build --chown=nonroot:nonroot /opt/data-skeleton /data

USER nonroot
EXPOSE 8080 8081
VOLUME ["/data"]

CMD ["dist/index.js"]

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/game-server/package.json apps/game-server/package.json
COPY apps/portal/package.json apps/portal/package.json
RUN npm install
RUN mkdir -p /opt/workspace-node_modules \
  && cp -a node_modules/. /opt/workspace-node_modules/ \
  && sha256sum package-lock.json | cut -d' ' -f1 > /opt/workspace-node_modules/.zo-image-install-stamp

COPY . .
RUN rm -rf apps/game-server/dist \
  && npm run build -w @zo/game-server

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/game-server/package.json apps/game-server/package.json
COPY apps/portal/package.json apps/portal/package.json
RUN npm install --omit=dev

COPY . .
COPY --from=build /app/apps/game-server/dist ./apps/game-server/dist

ENV NODE_ENV=production
EXPOSE 7777

CMD ["npm", "run", "start", "-w", "@zo/game-server"]

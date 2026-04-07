FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/portal/package.json apps/portal/package.json
COPY apps/game-server/package.json apps/game-server/package.json
RUN npm install
RUN mkdir -p /opt/workspace-node_modules \
  && cp -a node_modules/. /opt/workspace-node_modules/ \
  && sha256sum package-lock.json | cut -d' ' -f1 > /opt/workspace-node_modules/.zo-image-install-stamp

COPY . .
RUN npm run build -w @zo/portal

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/portal/package.json apps/portal/package.json
COPY apps/game-server/package.json apps/game-server/package.json
RUN npm install --omit=dev

COPY . .
COPY --from=build /app/apps/portal/.next ./apps/portal/.next

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@zo/portal"]

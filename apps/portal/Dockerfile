FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/portal/package.json apps/portal/package.json
COPY apps/game-server/package.json apps/game-server/package.json
RUN npm install

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

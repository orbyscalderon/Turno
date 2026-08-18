# Imagen de producción del backend de Turno.
# Debian slim (no alpine): Prisma detecta OpenSSL 3 correctamente y carga su motor sin problemas.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
EXPOSE 4000
# Aplica migraciones, crea el superadmin si procede (no fatal) y arranca.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/bootstrap-admin.js; node dist/server.js"]

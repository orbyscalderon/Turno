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
# `prisma` (CLI) está en dependencies, no en devDependencies, porque el arranque
# aplica las migraciones: con --omit=dev npx tendría que descargarlo en caliente.
RUN npm ci --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY openapi.yaml ./openapi.yaml

# Directorio de subidas con permisos para el usuario sin privilegios.
# (En producción lo normal es STORAGE_PROVIDER=s3 o un volumen montado aquí.)
RUN mkdir -p /app/uploads && chown -R node:node /app

# No ejecutar como root: si alguien logra escapar del proceso, no es administrador.
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `exec` al final es importante: sin él, el proceso 1 sería `sh`, que NO reenvía
# SIGTERM a node, así que el cierre ordenado (terminar peticiones en curso y
# soltar la base de datos) nunca se ejecutaba en los despliegues.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/bootstrap-admin.js; exec node dist/server.js"]

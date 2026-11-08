# Build del frontend y servido con nginx.
FROM node:22-alpine AS build
WORKDIR /app

# Variables de Vite: se inyectan EN EL BUILD (no en tiempo de ejecución), así
# que llegan como argumentos de construcción.
ARG VITE_API_URL=""
ARG VITE_STRIPE_PUBLISHABLE_KEY=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

# MeteoAggregator — web front end (Vite + React + Leaflet).
# Multi-stage: build the static bundle with Node, then serve it with nginx.
# nginx also proxies /api/* to the `api` service (see nginx.conf), so the
# browser makes same-origin calls and VITE_API_BASE_URL stays empty.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Empty base URL => the browser calls same-origin /api, which nginx proxies.
ENV VITE_API_BASE_URL=""
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

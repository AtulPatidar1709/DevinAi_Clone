FROM oven/bun:1.3-slim AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN bun install --frozen-lockfile

COPY apps/frontend apps/frontend

ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN cd apps/frontend && bun run build

# Nothing runs at runtime for this image — it exists purely so
# docker-compose can copy /app/apps/frontend/dist out via a volume.
# See the `frontend-builder` service in docker-compose.yml.
FROM busybox
COPY --from=build /app/apps/frontend/dist /dist
CMD ["sh", "-c", "cp -r /dist/* /output/ && echo 'Frontend build copied to /output'"]

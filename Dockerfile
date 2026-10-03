# syntax=docker/dockerfile:1
#
# 웹(next start)과 알림 worker 가 같은 이미지를 쓴다. 실행 명령만 compose 에서 나눈다.
# worker 가 tsx 로 TypeScript 를 직접 실행하므로 devDependencies 를 런타임에 남겨 둔다.
#
# @libsql/client 는 플랫폼별 네이티브 바이너리를 쓰므로 반드시 배포 대상과 같은
# 아키텍처에서 빌드할 것(서버에서 직접 build 하거나 --platform linux/amd64).

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATABASE_URL=file:/app/data/campus.db
COPY --from=build --chown=node:node /app ./
# lib/db.ts 가 데이터 디렉터리를 0700 으로 만들고 소유권을 요구하므로 node 사용자 소유로 둔다.
# named volume 은 처음 생성될 때 이 디렉터리의 소유권을 물려받는다.
RUN mkdir -p /app/data && chown node:node /app/data && chmod 0700 /app/data
USER node
EXPOSE 3000
# package.json 의 start 는 127.0.0.1 에 바인딩해 컨테이너 밖에서 닿지 않으므로 직접 실행한다.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

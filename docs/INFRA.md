# 배포 런북 — knowverse.net

서버 한 대에 Docker Compose로 세 개의 컨테이너를 띄웁니다.

| 서비스 | 역할 |
|---|---|
| `web` | Next.js (화면 + API) |
| `worker` | 알림 처리. **앱 내 알림도 worker가 처리하므로 꺼지면 알림이 안 뜹니다.** |
| `caddy` | HTTPS 자동 인증서, Basic Auth |

`web`과 `worker`는 `campus-data` 볼륨의 SQLite 파일 하나(`/app/data/campus.db`)를 공유합니다.

> Vercel은 쓰지 않습니다. 상주 worker 프로세스와 로컬 SQLite 파일이 필요해서 서버리스에서는 동작하지 않습니다.

## 1. 준비

- Linux 서버 1대 (x86_64 권장, 1 vCPU / 1GB 이상), Docker + Compose 플러그인 설치
- 방화벽에서 80, 443(TCP/UDP) 개방
- DNS: `knowverse.net`, `www.knowverse.net`의 A 레코드를 서버 IP로 설정

DNS 반영 확인:

```bash
dig +short knowverse.net
```

## 2. 최초 배포

```bash
git clone https://github.com/siu717/ai-builder.git
cd ai-builder
cp .env.example .env
```

`.env`를 채웁니다.

```bash
ANTHROPIC_API_KEY=sk-ant-...
APP_URL=https://knowverse.net
# TELEGRAM_* 는 텔레그램 알림을 쓸 때만

# Caddy Basic Auth — 데모용 공용 계정
BASIC_AUTH_USER=team
BASIC_AUTH_HASH='<아래 명령으로 만든 해시>'
```

비밀번호 해시 만들기 (해시에 `$`가 들어가므로 `.env`에는 **작은따옴표로 감싸서** 넣어야 합니다):

```bash
docker run --rm caddy:2 caddy hash-password --plaintext '데모비밀번호'
```

`DATABASE_URL`은 compose가 `file:/app/data/campus.db`로 덮어쓰므로 `.env` 값은 무시됩니다.

실행:

```bash
docker compose up -d --build
docker compose ps          # web 이 healthy, worker·caddy 가 running 이면 정상
```

브라우저에서 `https://knowverse.net` 접속 → Basic Auth 로그인 → 화면 확인.

## 3. 업데이트

```bash
git pull
docker compose up -d --build
```

DB는 볼륨에 있으므로 재배포해도 유지됩니다.

## 4. 운영

| 할 일 | 명령 |
|---|---|
| 로그 보기 | `docker compose logs -f web worker` |
| 알림이 안 뜰 때 | `docker compose ps worker`로 worker가 살아 있는지 확인 |
| DB 백업 | `docker compose exec web sh -c 'cp /app/data/campus.db /app/data/backup-$(date +%H%M).db'` |
| DB 파일 꺼내기 | `docker compose cp web:/app/data/campus.db ./campus.db` |
| Basic Auth 해제 (공개 시연) | `Caddyfile`의 `basic_auth { ... }` 블록 삭제 → `docker compose restart caddy` |
| 전체 중지 | `docker compose down` (볼륨은 유지, `-v`를 붙이면 **DB 삭제**) |

## 5. 알아둘 점

- **로그인이 없습니다.** 접속자 전원이 같은 프로필·일정·텔레그램 설정을 공유하고, AI 호출 비용도 발생시킬 수 있습니다. Basic Auth를 푸는 건 데모 중에만 하세요.
- **빌드 아키텍처**: `@libsql/client`는 네이티브 바이너리를 쓰므로 Apple Silicon 맥에서 빌드한 이미지를 x86 서버로 옮기면 실행되지 않습니다. 서버에서 `--build`로 빌드하거나 `docker build --platform linux/amd64`를 쓰세요.
- **AI 모델**: `.env.example`의 기본값은 `ANTHROPIC_MODEL=claude-sonnet-4-6`입니다. 바꾸려면 `.env`에서 이 값만 수정하면 됩니다.

## 6. CI

`.github/workflows/ci.yml`이 PR과 `main` push마다 typecheck → (있으면) 단위 테스트 → `next build` → Docker 이미지 빌드를 실행합니다. 배포는 자동으로 하지 않습니다.

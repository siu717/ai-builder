#!/usr/bin/env bash
# 이 맥에서 앱을 띄우고 Cloudflare 무료 터널로 공개 HTTPS 주소(https://….trycloudflare.com)를 만든다.
# 계정·도메인·서버가 필요 없다. 대신 이 맥이 켜져 있고 스크립트가 도는 동안만 열려 있으며,
# 실행할 때마다 주소가 바뀐다.
#
# 준비: brew install cloudflared
#       .env.local 에 BASIC_AUTH_USER, BASIC_AUTH_PASSWORD
# 실행: ./scripts/share-public.sh        종료: Ctrl+C
#
# 공개 서버는 DB 하나(기본 data/public-demo.db)만 쓴다. 설정·API 키·텔레그램이 재시작 후에도
# 그대로 남아야 하므로 방문자별 DB(anonymous) 모드는 쓰지 않고, 시작할 때마다 DB 를 백업한다.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
LOG_DIR="data/share"
mkdir -p "$LOG_DIR"

if [ "${PUBLIC_ACCESS_MODE:-private}" != private ]; then
  echo "공개 서버는 DB 하나만 씁니다. PUBLIC_ACCESS_MODE=${PUBLIC_ACCESS_MODE} 는 지원하지 않습니다." >&2; exit 1
fi
export PUBLIC_ACCESS_MODE=private

# 모든 접속자가 같은 DB 를 쓰므로 사이트 비밀번호 없이는 공개하지 않는다.
if ! node --env-file-if-exists=.env.local -e 'process.exit(process.env.BASIC_AUTH_USER?.trim() && process.env.BASIC_AUTH_PASSWORD ? 0 : 1)'; then
  echo ".env.local 에 BASIC_AUTH_USER 와 BASIC_AUTH_PASSWORD 를 설정하세요." >&2; exit 1
fi

# 없는 경로를 열면 SQLite 가 빈 DB 를 만들어 저장된 설정이 사라진 것처럼 보인다. 최초 1회만 PUBLIC_DB_INIT=1 로 새로 만든다.
DB_PATH="$(pwd)/data/public-demo.db"
[ -n "${PUBLIC_DATABASE_URL:-}" ] && DB_PATH="${PUBLIC_DATABASE_URL#file:}"
if [ ! -s "$DB_PATH" ] && [ "${PUBLIC_DB_INIT:-}" != 1 ]; then
  echo "공개 DB 가 없습니다: $DB_PATH" >&2
  echo "경로를 확인하세요. 처음 만드는 경우에만 PUBLIC_DB_INIT=1 을 붙여 실행합니다." >&2; exit 1
fi
if [ -s "$DB_PATH" ]; then
  command -v sqlite3 >/dev/null || { echo "백업에 sqlite3 가 필요합니다." >&2; exit 1; }
  BACKUP="data/backups/pre-start-$(date +%Y%m%d-%H%M%S).db"
  mkdir -p data/backups && chmod 700 data/backups
  sqlite3 "$DB_PATH" ".backup '$BACKUP'" && chmod 600 "$BACKUP"
  echo "DB 백업: $BACKUP"
fi

command -v cloudflared >/dev/null || { echo "cloudflared 가 없습니다: brew install cloudflared" >&2; exit 1; }

pids=()
cleanup() { [ ${#pids[@]} -gt 0 ] && kill "${pids[@]}" 2>/dev/null; true; }
trap cleanup EXIT INT TERM

# 터널 주소를 먼저 받아야 APP_URL 을 정할 수 있다(쓰기 API 가 Host·Origin 을 APP_URL 과 비교한다).
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > "$LOG_DIR/tunnel.log" 2>&1 &
pids+=($!)
URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "터널 주소를 받지 못했습니다. $LOG_DIR/tunnel.log 를 확인하세요." >&2; exit 1; }

# 로컬 개발용 DB(data/campus.db)와 섞이지 않도록 공개용 DB 를 따로 쓴다.
export APP_URL="$URL"
export DATABASE_URL="file:$DB_PATH"

npm run build > "$LOG_DIR/build.log" 2>&1 || { echo "빌드 실패: $LOG_DIR/build.log" >&2; exit 1; }
node_modules/.bin/next start -H 127.0.0.1 -p "$PORT" > "$LOG_DIR/web.log" 2>&1 &
pids+=($!)
# 앱 내 알림도 worker 가 처리하므로 같이 띄운다.
node --env-file-if-exists=.env.local --import tsx server/worker.ts > "$LOG_DIR/worker.log" 2>&1 &
pids+=($!)

ready=0
for _ in $(seq 1 60); do
  if PORT="$PORT" node --env-file-if-exists=.env.local -e 'const headers={};if(process.env.BASIC_AUTH_USER&&process.env.BASIC_AUTH_PASSWORD)headers.Authorization="Basic "+Buffer.from(process.env.BASIC_AUTH_USER+":"+process.env.BASIC_AUTH_PASSWORD).toString("base64");fetch("http://127.0.0.1:"+process.env.PORT+"/api/health",{headers,signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" -eq 1 ] || { echo "서버가 준비되지 않았습니다. $LOG_DIR/web.log 를 확인하세요." >&2; exit 1; }

echo ""
echo "공개 주소: $URL"
echo "로그: $LOG_DIR/   종료: Ctrl+C"
wait

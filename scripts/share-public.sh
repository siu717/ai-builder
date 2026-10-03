#!/usr/bin/env bash
# 이 맥에서 앱을 띄우고 Cloudflare 무료 터널로 공개 HTTPS 주소(https://….trycloudflare.com)를 만든다.
# 계정·도메인·서버가 필요 없다. 대신 이 맥이 켜져 있고 스크립트가 도는 동안만 열려 있으며,
# 실행할 때마다 주소가 바뀐다.
#
# 준비: brew install cloudflared
#       .env.local 에 BASIC_AUTH_USER, BASIC_AUTH_PASSWORD (그리고 쓸 거면 ANTHROPIC_API_KEY)
# 실행: ./scripts/share-public.sh        종료: Ctrl+C
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
LOG_DIR="data/share"
mkdir -p "$LOG_DIR"

command -v cloudflared >/dev/null || { echo "cloudflared 가 없습니다: brew install cloudflared" >&2; exit 1; }

# 로그인이 없는 앱이라 접속자 전원이 같은 데이터를 공유한다. 비밀번호 없이는 공개하지 않는다.
has() { [ -n "${!1:-}" ] || grep -qE "^$1=.+" .env.local 2>/dev/null; }
if ! has BASIC_AUTH_USER || ! has BASIC_AUTH_PASSWORD; then
  echo ".env.local 에 BASIC_AUTH_USER 와 BASIC_AUTH_PASSWORD 를 설정하세요." >&2; exit 1
fi

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
export DATABASE_URL="${PUBLIC_DATABASE_URL:-file:data/public.db}"

npm run build > "$LOG_DIR/build.log" 2>&1 || { echo "빌드 실패: $LOG_DIR/build.log" >&2; exit 1; }
node_modules/.bin/next start -H 127.0.0.1 -p "$PORT" > "$LOG_DIR/web.log" 2>&1 &
pids+=($!)
# 앱 내 알림도 worker 가 처리하므로 같이 띄운다.
node --env-file-if-exists=.env.local --import tsx server/worker.ts > "$LOG_DIR/worker.log" 2>&1 &
pids+=($!)

for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/favicon.ico" && break; sleep 1; done

echo ""
echo "공개 주소: $URL"
echo "로그: $LOG_DIR/   종료: Ctrl+C"
wait

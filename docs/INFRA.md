# 배포 런북

> **knowverse.net / www.knowverse.net 은 노우버스 회사 사이트입니다.** 캠퍼스 비서는 반드시 별도 주소(`campus.knowverse.net` 또는 터널 주소)로만 공개합니다.

앱에는 로그인이 없어 접속자 전원이 같은 프로필·일정·텔레그램 설정을 공유하고 AI 호출 비용도 발생시킬 수 있습니다. 그래서 공개할 때는 항상 사이트 비밀번호(`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`)를 켭니다. 두 값이 모두 있으면 `proxy.ts`가 모든 요청에 비밀번호를 요구하고, 없으면(로컬 개발) 꺼집니다.

| 방법 | 비용 | 주소 | 언제 |
|---|---|---|---|
| A. Cloudflare 터널 | 무료, 계정 불필요 | `https://….trycloudflare.com` (실행마다 바뀜) | 지금 바로 공개, 데모 |
| B. 서버 + Docker | 서버 비용 | `https://campus.knowverse.net` | 상시 운영 |

## A. Cloudflare 터널로 바로 공개 (무료)

이 맥에서 앱을 실행하고 Cloudflare의 무료 터널로 공개 HTTPS 주소를 받습니다. 맥이 켜져 있고 스크립트가 도는 동안만 열려 있습니다.

```bash
brew install cloudflared            # 최초 1회
```

`.env.local`에 다음을 넣습니다(커밋되지 않음).

```bash
BASIC_AUTH_USER=team
BASIC_AUTH_PASSWORD=<팀에 공유할 비밀번호>
ANTHROPIC_API_KEY=sk-ant-...        # 선택: 배포 후 설정 화면에서 저장해도 됨
```

실행:

```bash
./scripts/share-public.sh
```

`공개 주소: https://….trycloudflare.com`이 출력되면 그 주소로 접속해 비밀번호를 입력합니다. `Ctrl+C`로 종료합니다.

- 공개용 데이터는 `data/public.db`에 따로 저장돼 로컬 개발 데이터와 섞이지 않습니다.
- 로그는 `data/share/`(tunnel, build, web, worker)에 남습니다.
- 다시 실행하면 주소가 바뀝니다. `APP_URL`은 스크립트가 자동으로 맞춥니다.
- 맥이 잠자기에 들어가면 끊깁니다. 데모 중에는 `caffeinate -dims`를 함께 켜 두세요.

## B. campus.knowverse.net 서버 배포

### 준비

- 서버 SSH 접속, Docker + Compose 플러그인
- Route 53에 `campus.knowverse.net` A 레코드 → 서버 IP
- 기존 knowverse 서버(64.110.103.146)는 **nginx가 80·443을 쓰고 있어** Caddy를 띄울 수 없습니다. 그 서버라면 아래 "nginx 서버에 올릴 때"를 따릅니다.

### 실행

```bash
git clone https://github.com/siu717/ai-builder.git && cd ai-builder
git switch main
cp .env.example .env
```

`.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
APP_URL=https://campus.knowverse.net
BASIC_AUTH_USER=team
BASIC_AUTH_PASSWORD=<팀에 공유할 비밀번호>
```

`APP_URL`이 정확해야 합니다. 쓰기 API는 localhost이거나 Host·Origin이 `APP_URL`과 일치하는 요청만 받으므로, 틀리면 화면은 떠도 저장·AI 분석이 403으로 실패합니다. `APP_URL`·`BASIC_AUTH_*`가 비어 있으면 compose가 시작을 거부합니다.

Anthropic 키는 배포 후 **설정 → AI 분석 설정**에서도 저장·교체·삭제할 수 있습니다. UI 저장값이 환경변수보다 우선하며 웹 서버를 재시작하지 않아도 다음 분석에 반영됩니다. SQLite 본 파일과 WAL·SHM 보조 파일은 `0600`, 컨테이너의 데이터 디렉터리는 `0700`으로 보관합니다.

```bash
docker compose up -d --build
docker compose ps                    # web healthy, worker·caddy running
```

웹 상태 확인은 컨테이너의 사이트 암호로 `/api/state`에 인증해 실행합니다. 비밀번호 보호가 켜진 상태에서도 worker가 정상 시작할 수 있어야 합니다.

### nginx 서버에 올릴 때 (기존 knowverse 서버)

Caddy를 빼고 web을 서버 로컬 포트로만 엽니다.

```bash
docker compose up -d --build web worker
```

`docker-compose.yml`의 web에 `ports: ["127.0.0.1:3100:3000"]`를 추가한 뒤, `/etc/nginx/sites-available/campus.knowverse.net`:

```nginx
server {
    server_name campus.knowverse.net;
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    listen 80;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/campus.knowverse.net /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d campus.knowverse.net   # HTTPS 인증서
```

`proxy_set_header Host $host`가 있어야 앱이 Host를 `campus.knowverse.net`으로 받아 `APP_URL`과 맞출 수 있습니다. 기존 `knowverse.net` / `www` 서버 블록은 건드리지 않습니다.

### 운영

| 할 일 | 명령 |
|---|---|
| 업데이트 | `git pull && docker compose up -d --build` |
| 로그 | `docker compose logs -f web worker` |
| 알림이 안 뜰 때 | `docker compose ps worker` — 앱 내 알림도 worker가 처리합니다 |
| DB 꺼내기 | `docker compose cp web:/app/data/campus.db ./campus.db` |
| 중지 | `docker compose down` (`-v`를 붙이면 **DB 삭제**) |

- `@libsql/client`는 네이티브 바이너리를 쓰므로 서버에서 직접 `--build`하거나 `docker build --platform linux/amd64`를 씁니다.
- AI 모델은 `.env`의 `ANTHROPIC_MODEL`로 바꿉니다.

## CI

`.github/workflows/ci.yml`이 PR과 `main` push마다 typecheck → 단위 테스트 → `next build` → Docker 이미지 빌드를 실행합니다. 배포는 자동으로 하지 않습니다.

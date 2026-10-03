# 로컬 실행 런북 (Windows · Mac)

내 컴퓨터에서 앱을 띄우는 방법과, 막혔을 때 원인을 찾는 순서입니다. 배포는 [INFRA.md](INFRA.md), 시연 순서는 [DEMO.md](DEMO.md)에 있습니다.

## 한눈에 보기

| 항목 | 값 |
|---|---|
| 필요 환경 | Node.js 22.9 이상, npm |
| 실행 | `npm run dev` (웹 서버와 알림 워커를 함께 실행) |
| 주소 | `http://127.0.0.1:3000` |
| 설정 파일 | `.env.local` (`.env.example`을 복사해서 만듦) |
| 데이터 | `data/campus.db`, `data/campus.db-wal`, `data/campus.db-shm` 세 파일이 한 벌 |
| 종료 | 실행한 터미널에서 `Ctrl+C` |

## 처음 실행

Windows (PowerShell):

```powershell
git clone https://github.com/siu717/ai-builder.git
cd ai-builder
npm install
Copy-Item .env.example .env.local
npm run dev
```

Mac · Linux · Git Bash:

```bash
git clone https://github.com/siu717/ai-builder.git
cd ai-builder
npm install
cp .env.example .env.local
npm run dev
```

터미널에 아래 두 줄이 모두 보이면 정상입니다.

```
[reminders] 캠퍼스 비서 알림 워커 실행 중 (5초 간격)
[web] ✓ Ready in …
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다.

- `.env.local`이 없어도 실행됩니다. 그때는 `[reminders] .env.local not found. Continuing without it.`가 한 줄 나옵니다.
- AI 분석을 쓰려면 `.env.local`의 `ANTHROPIC_API_KEY=` 뒤에 키를 넣고 다시 실행합니다. 키가 없으면 **샘플 분석**과 **샘플 컨설팅**만 동작합니다.
- 다른 포트로 띄우려면 `PORT`를 지정합니다.

| 셸 | 명령 |
|---|---|
| PowerShell | `$env:PORT = "3100"; npm run dev` |
| cmd | `set "PORT=3100" && npm run dev` (따옴표가 없으면 값 뒤에 공백이 붙습니다) |
| Mac · Git Bash | `PORT=3100 npm run dev` |

## 프로세스 구조

`npm run dev`는 두 프로세스를 띄웁니다. 둘은 같은 SQLite 파일을 함께 씁니다.

| 이름 | 하는 일 | 따로 실행 |
|---|---|---|
| `web` | 화면과 API (Next.js) | `npm run dev:web` |
| `reminders` | 예약된 알림을 5초마다 확인해 발송 처리 | `npm run worker` |

- **앱 내 알림도 워커가 처리합니다.** 워커가 꺼져 있으면 알림은 `예약됨` 상태로 남습니다.
- 화면은 5초마다 상태를 다시 읽어 새로 발송된 알림을 화면 아래에 띄우고, 권한이 있으면 브라우저 알림도 보냅니다. 그래서 알림은 예약 시각보다 최대 10초쯤 늦게 보일 수 있습니다.
- 둘 중 하나가 죽으면 나머지도 함께 종료됩니다(`concurrently -k`). 터미널 마지막 줄에서 어느 쪽이 먼저 끝났는지 확인합니다.
- `.env.example`의 `REMINDER_POLL_MS`는 현재 코드에서 읽지 않습니다. 워커 주기는 5초로 고정되어 있습니다.

## 문제 해결

### 포트가 이미 사용 중

다른 프로그램이 3000번을 쓰고 있으면 Next.js가 다음 빈 포트로 옮겨 뜨고 이렇게 알려 줍니다.

```
Port 3000 is in use by process 12345, using available port 3001 instead.
```

터미널에 찍힌 `Local:` 주소로 접속하면 됩니다. 3000번을 비우려면:

| 환경 | 누가 쓰는지 확인 | 종료 |
|---|---|---|
| PowerShell | `Get-NetTCPConnection -LocalPort 3000 -State Listen` | `taskkill /PID <PID> /T /F` |
| cmd | `netstat -ano \| findstr :3000` | `taskkill /PID <PID> /T /F` |
| Mac | `lsof -i :3000` | `kill <PID>` |

### Another next dev server is already running

```
⨯ Another next dev server is already running.
- Local:        http://127.0.0.1:3000
- PID:          12345
```

Next.js 16은 프로젝트 폴더마다 개발 서버를 하나만 허용합니다(`.next/dev/lock`). **포트를 바꿔도 같은 폴더에서는 두 번째 개발 서버가 뜨지 않습니다.** 이미 떠 있는 서버를 쓰거나, 안내된 PID를 종료한 뒤 다시 실행합니다.

브라우저 테스트(`npm run test:e2e`)도 개발 서버를 직접 띄우므로, 실행 전에 `npm run dev`를 종료해야 합니다.

### 403 같은 앱에서 보낸 요청만 허용됩니다

저장·분석 요청은 화면을 연 주소와 요청 주소가 같을 때만 받습니다. 다음 순서로 확인합니다.

1. 주소창이 `http://127.0.0.1:<포트>` 또는 `http://localhost:<포트>`인지 봅니다. 둘 다 되지만, 한 탭 안에서 섞이면 안 됩니다.
2. 터널이나 배포 주소로 접속했다면 `.env.local`의 `APP_URL`을 그 주소와 **정확히** 같게 맞추고(`https://`, 호스트, 포트까지) 다시 실행합니다.
3. 다른 PC나 휴대폰에서 `http://<내 IP>:3000`으로는 접속할 수 없습니다. 서버가 `127.0.0.1`에만 열려 있습니다.
4. curl 등으로 직접 호출할 때는 `Origin` 헤더를 빼거나 서버 주소와 같게 보냅니다.

확인한 동작(서버 `127.0.0.1:3100`, `APP_URL=http://127.0.0.1:3100`):

| 요청 | 결과 |
|---|---|
| `Origin: http://127.0.0.1:3100` | 허용 |
| `Origin` 헤더 없음 | 허용 |
| `http://localhost:3100`으로 접속 + `Origin: http://localhost:3100` | 허용 |
| `Origin: http://localhost:3100`인데 요청은 `127.0.0.1:3100`으로 | 403 |
| 다른 포트(`http://127.0.0.1:3000`)나 다른 사이트의 `Origin`, `Origin: null` | 403 |
| `Sec-Fetch-Site: cross-site` 또는 `same-site` | 403 |
| `Host` 헤더가 로컬 주소도 `APP_URL`도 아님 | 403 |

### 알림이 오지 않는다

1. **설정** 화면 맨 아래 `예약 알림 서버`가 **실행 중**인지 봅니다. `연결 대기`면 워커가 2분 넘게 응답이 없는 것입니다.
2. 터미널에 `[reminders] 캠퍼스 비서 알림 워커 실행 중`이 있는지, `[reminders] … exited with code 1`로 끝나지 않았는지 봅니다.
3. `npm run dev:web`이나 `next dev`만 실행했다면 워커가 없습니다. 다른 터미널에서 `npm run worker`를 실행합니다.
4. 웹과 워커가 같은 DB를 보는지 확인합니다. 두 프로세스의 `DATABASE_URL`이 다르거나, 서로 다른 폴더에서 실행하면 상대 경로(`file:data/campus.db`)가 다른 파일을 가리킵니다.

워커를 다시 켜면 밀린 알림은 첫 주기에 바로 발송 처리됩니다. 완료하거나 삭제한 일정의 알림은 발송되지 않습니다.

### 브라우저 알림이 뜨지 않는다

- **설정 → 브라우저 알림**의 권한이 `허용됨`인지 봅니다. `요청 전`이면 **알림 권한 요청**, `거부됨`이면 주소창 왼쪽의 사이트 설정에서 알림을 허용한 뒤 새로고침합니다.
- **테스트 알림 보내기**를 눌러도 안 보이면 Windows의 **설정 → 시스템 → 알림**에서 브라우저 알림이 켜져 있는지, 방해 금지가 꺼져 있는지 확인합니다.
- 브라우저 알림은 앱 탭이 열려 있어야 옵니다. 탭을 닫았다가 다시 열면 놓친 알림은 **알림** 화면에만 나옵니다.
- 권한이 없어도 화면 아래의 앱 내 알림은 항상 나옵니다.

### AI 분석이 안 된다

- `AI 연결 대기`로 보이고 **분석**을 누르면 "AI 분석을 사용하려면 서버의 ANTHROPIC_API_KEY를 설정해 주세요"가 나오면 키가 없는 것입니다.
- `.env.local`을 고친 뒤에는 `npm run dev`를 다시 실행해야 반영됩니다.
- 키를 넣는 다른 방법과 모델 설정은 [README의 AI 분석](../README.md#ai-분석)을 봅니다.

### DB 파일을 지울 수 없다 · database is locked

- Windows에서 `data/campus.db`를 지우거나 옮길 때 "다른 프로세스가 사용 중"(EBUSY)이 나오면 서버나 워커가 아직 떠 있는 것입니다. `npm run dev`를 종료한 뒤 다시 시도합니다. 그래도 안 되면 남은 `node.exe`를 찾아 종료합니다.

  ```powershell
  Get-CimInstance Win32_Process -Filter "name='node.exe'" | Select-Object ProcessId, CommandLine
  ```

- `database is locked`는 다른 프로그램이 DB에 쓰기 잠금을 5초 넘게 잡고 있을 때 납니다. DB 뷰어를 열어 두었다면 닫고, 프로젝트를 OneDrive 같은 동기화 폴더나 네트워크 드라이브에 두지 않습니다. 이 오류는 검증 중에 재현되지 않았습니다. 웹과 워커가 동시에 쓰는 상황은 정상 동작했습니다.

### 데이터 초기화와 백업

최근 데이터는 `campus.db`가 아니라 `campus.db-wal`에 들어 있는 경우가 많습니다. 검증 중에 본 파일은 4KB, WAL은 3MB였습니다. **`campus.db`만 복사하면 데이터가 빠집니다.**

- 초기화: 서버를 종료하고 세 파일을 모두 지운 뒤 다시 실행합니다. 표는 자동으로 만들어집니다.
- 백업: 서버를 종료하고 세 파일을 함께 복사합니다.

| 환경 | 초기화 |
|---|---|
| PowerShell | `Remove-Item data\campus.db*` |
| Mac · Git Bash | `rm data/campus.db*` |

### Windows 경로와 셸

- PowerShell에서 `npm`이 "이 시스템에서 스크립트를 실행할 수 없으므로 npm.ps1 파일을 로드할 수 없습니다"로 막히면 `npm.cmd run dev`처럼 `npm.cmd`를 쓰거나, cmd 또는 Git Bash에서 실행합니다.
- 명령은 항상 프로젝트 폴더에서 실행합니다. `DATABASE_URL`의 상대 경로는 명령을 실행한 폴더 기준입니다.
- `DATABASE_URL`에 절대 경로를 쓸 때는 `file:C:/work/campus.db`처럼 슬래시(`/`)로 적습니다.
- 한글이나 공백이 들어간 폴더에서는 확인하지 않았습니다. 설치나 실행이 이상하면 `C:\dev\ai-builder`처럼 짧은 영문 경로로 옮겨 봅니다. 경로 길이 250자까지는 빌드와 실행을 확인했습니다.
- Windows에는 Unix 파일 권한(`0600`)이 적용되지 않습니다. `data/` 폴더의 텔레그램 토큰과 API 키는 Windows 계정 권한으로만 보호되므로, 여럿이 쓰는 PC에서는 주의합니다.
- Git의 줄바꿈 변환(`core.autocrlf=true`)은 켜져 있어도 됩니다. 테스트용 예시 파일을 CRLF로 바꿔 실행해도 결과가 같았습니다.
- 서버를 종료했는데 포트가 계속 잡혀 있으면 [포트가 이미 사용 중](#포트가-이미-사용-중)의 방법으로 남은 프로세스를 종료합니다.

### 브라우저 테스트 (Playwright)

```bash
npm run test:e2e
```

- 테스트는 `3200` 포트에 서버를 직접 띄우고 `data/e2e.db`를 씁니다. 실행 전에 같은 폴더의 `npm run dev`를 종료합니다.
- 브라우저가 없다는 오류가 나오면 한 번 내려받습니다: `npx playwright install chromium`
- 내려받지 않고 설치된 Chrome이나 Edge로 실행할 수도 있습니다.

| 셸 | 명령 |
|---|---|
| PowerShell | `$env:E2E_BROWSER_CHANNEL = "chrome"; npm run test:e2e` |
| Mac · Git Bash | `E2E_BROWSER_CHANNEL=chrome npm run test:e2e` |

`chrome` 대신 `msedge`를 넣으면 Edge로 실행합니다.

## 검증 기록

2026-10-03, Windows 11 Home · Node 24.15.0 · npm 11.12.1 · Git Bash / PowerShell 5.1. API 키와 텔레그램 설정 없이 확인했습니다.

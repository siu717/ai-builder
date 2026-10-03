# 실시간 장학금·채용 공고 소스

장학금·취업 정보 화면의 "실시간 공고"는 아래 소스를 서버에서 직접 읽어 온다(`lib/sources/**`, `GET /api/opportunities/live?kind=scholarship|job&q=`).
모든 조사는 2026-10-03에 로그인 없이, 읽기 전용 GET으로만 했다.

## 1. 조사 결과 요약

| 소스 | 종류 | 주소 | 로그인/키 | 판정 | 비고 |
| --- | --- | --- | --- | --- | --- |
| 국민대 장학공지 (`kmu-scholarship`) | 장학 | `kookmin.ac.kr/user/kmuNews/notice/7/index.do` | 불필요 | 가능 (구현) | 기존 `getNotices("scholarship")` 재사용, 1~2쪽 |
| 한국장학재단 공지 (`kosaf`) | 장학 | `kosaf.go.kr/ko/notice.do?ctgrId1=0000000002` | 불필요 | 가능 (구현) | HTML 표. 페이지가 약 1.2MB로 큼 |
| 드림스폰 (`dreamspon`) | 장학 | `dreamspon.com/scholarship/list.html` | 불필요 | 가능 (구현) | 목록은 공개. `Cache-Control: no-cache` 헤더가 붙은 요청은 연결을 끊음 |
| 원티드 (`wanted`) | 채용 | `wanted.co.kr/api/v4/jobs?country=kr&job_sort=job.latest_order&years=0&limit=40` | 불필요 | 가능 (구현) | 공개 JSON. `query=`로 검색 가능. 등록일 없음 |
| 링커리어 (`linkareer`) | 채용 | `api.linkareer.com/graphql` (`activities`, `activityTypeID:5`) | 불필요 | 가능 (구현) | GET `?query=`. 인트로스펙션은 막혀 있음 |
| 국민대 교내·교외 채용 (`kmu-job`) | 채용 | `kookmin.ac.kr/user/kmuNews/notice/{10,11}/index.do` | 불필요 | 가능 (구현) | 게시판 번호: 10 교내채용, 11 교외채용 |
| 잡알리오 (`alio`) | 채용 | `job.alio.go.kr/recruit.do` | 불필요 | 가능 (구현) | 공공기관 채용. HTML 표, 첫 쪽 10건 |
| 사람인 (`saramin`) | 채용 | `oapi.saramin.co.kr/job-search` | API 키 | 키 필요 (어댑터 구현) | 목록 HTML은 200으로 열리지만(약 2.5MB) 공식 API가 있으므로 크롤링하지 않고 API만 사용 |
| 고용24·워크넷 (`work24`) | 채용 | `work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do` | API 키 | 키 필요 (어댑터 구현) | 공개 검색 화면은 스크립트·세션 기반이라 크롤링하지 않음 |
| 한국장학재단 학자금지원정보 (`kosaf-api`) | 장학 | `api.odcloud.kr/api/15028252/v1/uddi:…` | 공공데이터포털 키 | 키 필요 (어댑터 구현) | 데이터셋 15028252 "한국장학재단_학자금지원정보(대학생)_20260910" |
| 온통청년 청년정책 (`youthcenter`) | 장학·지원 | `youthcenter.go.kr/go/ythip/getPlcy` | API 키 | 키 필요 (어댑터 구현) | 공개 검색 화면은 내부 XHR로 목록을 그려 키 없는 엔드포인트가 없음 |
| 잡코리아 | 채용 | `jobkorea.co.kr/recruit/joblist` | - | 불가 (제외) | 목록 HTML은 200으로 열리지만 키 없는 공개 API를 찾지 못했고 약관 확인 없이 수집하지 않기로 함 |
| 서울장학재단 | 장학 | `hissf.or.kr` | - | 불가 (제외) | 조사 시점에 연결 자체가 되지 않음(응답 없음) |

국민대 공지 게시판 번호(참고): 1 전체, 2 대학입학, 3 대학원입학, 4 학사, 5 행정, 6 특강, 7 장학, 8 사회봉사, 9 공모·행사, 10 교내채용, 11 교외채용.

링커리어 `activityTypeID`(참고): 1 대외활동, 2 동아리, 3 공모전, 5 채용(인턴·신입 포함), 6 교육. 지금은 5만 쓴다.

## 2. 동작 방식

- `lib/sources/index.ts` `getLiveOpportunities(kind, profile, { query, limit })`
  - 종류가 맞는 소스를 `Promise.allSettled`로 동시에 부른다. 소스마다 8초 제한.
  - 소스별·검색어별 10분 메모리 캐시. 장애가 나면 마지막 성공 결과를 보여 준다(키가 없을 때는 제외).
  - 한 소스가 실패해도 응답 전체는 성공이며, `sources[]`에 `ok:false`와 한국어 오류가 담긴다.
  - 마감이 지난 공고는 뺀다. ID(`${sourceId}-${externalId}`)로 중복을 지우고, 매칭 점수 → 등록일 순으로 정렬해 최대 60건.
  - 검색어(`q`)는 원티드·사람인·고용24·온통청년에는 그대로 전달하고, 나머지는 받은 목록에서 제목·기관·태그로 거른다.
- 마감일(`date`)은 **원본이 밝힌 값만** 쓴다.
  - API 필드(원티드 `due_time`, 링커리어 `recruitCloseAt`, 잡알리오 마감일 열 등).
  - 드림스폰은 목록에 `D-5`만 있어 조회일(서울) + 남은 일수로 바꾼다.
  - 공지 제목에 적힌 날짜: `(~10/18)`, `~10/7 오전 11시`, `10월 20일까지`, `마감: 10/20` (`lib/sources/deadline.ts`). 연도가 없으면 작성일의 연도를 쓰고, 작성일보다 30일 넘게 앞서면 다음 해로 본다. 적혀 있지 않으면 `null`이고 화면에는 "마감 확인 필요"로 나온다.
  - 링커리어는 상시 채용에도 연말(12/31 23:59) 같은 마감값을 넣는 경우가 있다. 원본 값을 그대로 보여 주므로 원문 확인이 필요하다.
- 매칭(`lib/sources/match.ts`)은 프로필의 관심 분야·전공·경력 단어가 제목/태그/설명에 있는지 보는 휴리스틱이다(0~100). 지원 자격 판정이 아니다.
- `GET /api/opportunities/live/text?sourceId=kmu-scholarship|kmu-job&externalId=글번호`는 국민대 공지 본문을 돌려주며, 화면의 "AI로 조건 분석"(기존 국민대 공지 분석 창)에 쓰인다.

## 3. 제한과 주의

- 요청 빈도: 소스당 10분에 한 번(캐시)만 원본을 부른다. 새로고침 버튼도 캐시 안에서는 원본을 다시 부르지 않는다.
- 로그인이 필요한 정보(원티드 지원 현황, 링커리어 스크랩, 드림스폰 맞춤 장학금 등)는 가져오지 않는다. 로그인·폼 제출은 하지 않는다.
- 원티드·링커리어는 문서화되지 않은 공개 엔드포인트라 예고 없이 바뀔 수 있다. 응답 모양이 달라지면 해당 소스만 "실패"로 표시된다. 서비스 약관을 확인하고, 발표·시연 이후 계속 운영하려면 공식 제휴/API(사람인·고용24 등)로 바꾸는 것을 권한다.
- 한국장학재단·잡알리오·국민대는 공개 게시판 HTML을 읽으므로 화면 구조가 바뀌면 파서(`lib/sources/html-sources.ts`, `lib/kookmin/notices.ts`)를 고쳐야 한다.
- 공고 상세(자격 요건·제출 서류)는 가져오지 않는다. 카드의 "원문 보기"로 새 탭에서 연다.
- API 키는 서버 환경 변수로만 읽고, 로그·오류 메시지·클라이언트로 가는 URL에 넣지 않는다(응답 URL에 키 비슷한 쿼리가 있으면 지운다).

## 4. API 키를 받아 켜는 소스

`.env.local`에 값을 넣고 서버를 다시 시작하면 된다. 키가 없으면 화면의 소스 칩에 "키 필요"로만 표시된다.

### 4.1 사람인 — `SARAMIN_API_KEY`

1. https://oapi.saramin.co.kr 접속 → 사람인 계정으로 로그인 → "API 키 발급" 신청(이용 목적 입력).
2. 승인 소요 시간: 확인 필요. 일일 호출 한도가 있다(기본 500회 수준, 확인 필요).
3. 확인: `curl -s -H "Accept: application/json" "https://oapi.saramin.co.kr/job-search?access-key=$SARAMIN_API_KEY&keywords=인턴&count=1"` → `{"jobs":{"count":1,…,"job":[…]}}`이 오면 정상. `{"code":…,"message":…}`이면 키 오류.
4. 어댑터: `lib/sources/keyed.ts` `saraminSource` (`job_type=1,4` 정규직·인턴, `sort=pd`, 검색어는 `keywords`). `close-type`이 접수마감일(1)일 때만 마감일로 쓴다.

### 4.2 공공데이터포털 한국장학재단 — `DATA_GO_KR_SERVICE_KEY` (+ 선택 `KOSAF_API_URL`)

1. https://www.data.go.kr/data/15028252/fileData.do → "오픈API" 탭 → 활용신청. 마이페이지에서 일반 인증키(Encoding/Decoding)를 확인한다. 둘 중 아무 값이나 넣어도 된다.
2. 승인: 파일데이터 API는 대개 신청 즉시 자동 승인(확인 필요). 키가 게이트웨이에 반영되는 데 시간이 걸릴 수 있다.
3. 확인(Encoding 키 기준): `curl -s "https://api.odcloud.kr/api/15028252/v1/uddi:8678d609-2cc1-4c28-bf49-f5f77a43a2f2?page=1&perPage=1&serviceKey=$DATA_GO_KR_SERVICE_KEY"` → `{"currentCount":1,"data":[{"상품명":…}]}`.
4. 데이터가 새 판으로 갱신되면 `uddi:` 뒤 값이 바뀐다. 포털의 Swagger 화면(`infuser.odcloud.kr/oas/docs?namespace=15028252/v1`)에 나온 새 주소를 `KOSAF_API_URL`에 넣는다(쿼리 제외). 404가 나오면 이 경우다.
5. 어댑터: `kosafApiSource`. 열 이름(`상품명`, `운영기관명`, `모집시작일`, `모집종료일`, `성적기준 상세내용` …)은 공백 유무와 상관없이 읽는다. 기본 주소의 열 이름은 키 없이 실제 응답으로 확인하지 못했다.

### 4.3 고용24(워크넷) 채용정보 — `WORK24_API_KEY` (+ 선택 `WORK24_API_URL`)

1. https://www.work24.go.kr → 로그인 → OpenAPI 메뉴 → 인증키 신청(채용정보).
2. 승인 소요 시간·신청 자격: 확인 필요(개인 신청이 가능한지 신청 화면에서 확인할 것).
3. 확인: `curl -s "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do?authKey=$WORK24_API_KEY&callTp=L&returnType=XML&startPage=1&display=1"` → `<wantedRoot><total>…`이 오면 정상.
4. 어댑터: `work24Source` (`career=N` 신입, 검색어는 `keyword`, XML을 정규식으로 파싱). 엔드포인트가 다르면 `WORK24_API_URL`로 바꾼다.

### 4.4 온통청년 청년정책 — `YOUTHCENTER_API_KEY` (+ 선택 `YOUTHCENTER_API_URL`)

1. https://www.youthcenter.go.kr → 로그인 → OpenAPI 안내 → 인증키 신청.
2. 승인 소요 시간: 확인 필요.
3. 확인: `curl -s "https://www.youthcenter.go.kr/go/ythip/getPlcy?apiKeyNm=$YOUTHCENTER_API_KEY&pageNum=1&pageSize=1&rtnType=json"` → `{"resultCode":200,"result":{"youthPolicyList":[…]}}`.
4. 어댑터: `youthcenterSource`. 검색어가 없으면 정책명에 "장학"이 들어간 정책을 받는다. 신청 기간(`aplyYmd`)의 마지막 종료일을 마감일로 쓴다. 장학금 화면에 표시된다.

키를 넣은 뒤 앱에서 확인: `curl -s "http://127.0.0.1:3000/api/opportunities/live?kind=job" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).sources))"` → 해당 소스가 `ok: true`.

> 키가 필요한 4개 어댑터는 공개 문서의 응답 형식에 맞춘 손 fixture로만 테스트했다(`tests/sources.test.ts`). 실제 키로 한 번 호출해 필드 이름을 확인해야 한다.

## 5. 소스를 추가하려면

1. `lib/sources/<이름>.ts`에 순수 파서 `parseX(payload)`와 `OpportunitySource`(`id`, `name`, `kind`, `fetch(ctx)`)를 만든다. 항목은 `liveItem({...})`으로 만든다. 키가 필요하면 `requiresKey`와 `requireKey(ctx, "ENV_NAME")`을 쓴다.
2. `lib/sources/index.ts`의 `SOURCES`에 추가한다.
3. 실제 응답을 잘라 `tests/fixtures/sources/`에 넣고 `tests/sources.test.ts`에 파서 테스트를 추가한다.

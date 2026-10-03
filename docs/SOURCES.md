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
| 잡코리아 | 채용 | `jobkorea.co.kr/recruit/joblist` | - | 불가 (제외) | 목록 HTML은 200으로 열리지만 키 없는 공개 API를 찾지 못했고 약관 확인 없이 수집하지 않기로 함 |
| 서울장학재단 | 장학 | `hissf.or.kr` | - | 불가 (제외) | 조사 시점에 연결 자체가 되지 않음(응답 없음) |

국민대 공지 게시판 번호(참고): 1 전체, 2 대학입학, 3 대학원입학, 4 학사, 5 행정, 6 특강, 7 장학, 8 사회봉사, 9 공모·행사, 10 교내채용, 11 교외채용.

링커리어 `activityTypeID`(참고): 1 대외활동, 2 동아리, 3 공모전, 5 채용(인턴·신입 포함), 6 교육. 지금은 5만 쓴다.

## 2. 동작 방식

- `lib/sources/index.ts` `getLiveOpportunities(kind, profile, { query, limit })`
  - 종류가 맞는 소스를 `Promise.allSettled`로 동시에 부른다. 소스마다 8초 제한.
  - 소스별·검색어별 10분 메모리 캐시. 장애가 나면 마지막 성공 결과를 보여 준다.
  - 한 소스가 실패해도 응답 전체는 성공이며, `sources[]`에 `ok:false`와 한국어 오류가 담긴다.
  - 마감이 지난 공고는 뺀다. ID(`${sourceId}-${externalId}`)로 중복을 지우고, 매칭 점수 → 등록일 순으로 정렬해 최대 60건.
  - 검색어(`q`)는 원티드에는 그대로 전달하고, 나머지는 받은 목록에서 제목·기관·태그로 거른다.
- 마감일(`date`)은 **원본이 밝힌 값만** 쓴다.
  - API 필드(원티드 `due_time`, 링커리어 `recruitCloseAt` 등).
  - 드림스폰은 목록에 `D-5`만 있어 조회일(서울) + 남은 일수로 바꾼다.
  - 공지 제목에 적힌 날짜: `(~10/18)`, `~10/7 오전 11시`, `10월 20일까지`, `마감: 10/20` (`lib/sources/deadline.ts`). 연도가 없으면 작성일의 연도를 쓰고, 작성일보다 30일 넘게 앞서면 다음 해로 본다. 적혀 있지 않으면 `null`이고 화면에는 "마감 확인 필요"로 나온다.
  - 링커리어는 상시 채용에도 연말(12/31 23:59) 같은 마감값을 넣는 경우가 있다. 원본 값을 그대로 보여 주므로 원문 확인이 필요하다.
- 매칭(`lib/sources/match.ts`)은 프로필의 관심 분야·전공·경력 단어가 제목/태그/설명에 있는지 보는 휴리스틱이다(0~100). 지원 자격 판정이 아니다.
- `GET /api/opportunities/live/text?sourceId=kmu-scholarship|kmu-job&externalId=글번호`는 국민대 공지 본문을 돌려준다(화면에서는 아직 쓰지 않는다).

## 3. 제한과 주의

- 요청 빈도: 소스당 10분에 한 번(캐시)만 원본을 부른다. 새로고침 버튼도 캐시 안에서는 원본을 다시 부르지 않는다.
- 로그인이 필요한 정보(원티드 지원 현황, 링커리어 스크랩, 드림스폰 맞춤 장학금 등)는 가져오지 않는다. 로그인·폼 제출은 하지 않는다.
- 원티드·링커리어는 문서화되지 않은 공개 엔드포인트라 예고 없이 바뀔 수 있다. 응답 모양이 달라지면 해당 소스만 "실패"로 표시된다. 서비스 약관을 확인하고, 발표·시연 이후 계속 운영하려면 공식 제휴/API로 바꾸는 것을 권한다.
- 한국장학재단·드림스폰·국민대는 공개 게시판 HTML을 읽으므로 화면 구조가 바뀌면 파서(`lib/sources/html-sources.ts`, `lib/kookmin/notices.ts`)를 고쳐야 한다.
- 공고 상세(자격 요건·제출 서류)는 가져오지 않는다. 카드의 "원문 보기"로 새 탭에서 연다.

## 4. 공공데이터포털

공공데이터포털 장학금·공공기관 채용·시험일정은 lib/public-data.ts(조제이) 참고. 이 문서의 소스는 모두 키 없이 동작한다.

## 5. 소스를 추가하려면

1. `lib/sources/<이름>.ts`에 순수 파서 `parseX(payload)`와 `OpportunitySource`(`id`, `name`, `kind`, `fetch(ctx)`)를 만든다. 항목은 `liveItem({...})`으로 만든다.
2. `lib/sources/index.ts`의 `SOURCES`에 추가한다.
3. 실제 응답을 잘라 `tests/fixtures/sources/`에 넣고 `tests/sources.test.ts`에 파서 테스트를 추가한다.

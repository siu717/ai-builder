# KMU80 UI — 참십 디자인 기준

시안: `docs/design/kmu80-mockup.png` (오늘·장학금·시작·아이덴티티 4장).
토큰: `app/styles/tokens.css` — 색·글자·간격은 반드시 토큰 변수로.

## 원칙 (사람 디자이너 느낌, AI 템플릿 느낌 금지)
1. **KMU Blue 단색 면** — 헤더(68px)·주요 버튼·오늘(D-DAY) 블록. 그라데이션, 글로우, 컬러 그림자 금지.
2. **카드 대신 괘선** — 목록은 위 2px `--line-strong`, 행 사이 1px `--line`. 둥근 흰 카드 + 회색 테두리 남발 금지. 둥근 그림자 상자는 팝오버·모달·토스트에만(`--shadow-pop`).
3. **큰 숫자 하나로 위계** — D-day·날짜·카운트는 `--font-num`(Bebas Neue) 크게. 나머지는 조용히.
4. **글자는 Pretendard 하나** — 제목 700, 본문 400/500. `--font-brand`(80주년 해옹체)는 워드마크·슬로건만. 명조(성곡체) 화면 사용 금지.
5. **가독성 바닥** — 최소 13px(`--text-xs`), 본문 15px. 보조 글자 `--ink-3` 이상(흐린 회색·반투명 글자 금지). `word-break: keep-all`.
6. **상태색** — 충족 `--met`+체크 아이콘, 불충족 `--ink`+X 아이콘, 확인 필요는 `--check` 노랑 **채움**(가장 눈에 띄게). 색만으로 구분하지 않는다(아이콘·글자 병기).
7. **종류색** — 장학금 Light Green, 채용/면접 Orange, 취업 준비 Green, 과제 Sky, 학사 Blue. 점/막대(dot)는 `--kind-*-dot`, 글자는 `--kind-*-ink`.
8. **D-day 단계** — 지남 `--due-overdue`(검정 채움 블록), 오늘 `--due-today`(파랑 채움 "D-DAY"), D-1~2 `--due-near`(주황 숫자), D-3~7 `--ink`, 그 이후 `--ink-4`.
9. **eCampus 버릇** — 1px 원형 아이콘 버튼(완료 체크·이동 화살표), 활성 탭은 아래 2~3px 밑줄, 입력창 radius 8px.
10. **접근성** — 터치 타깃 44px, 포커스 링 `--kmu-blue`, 대비 4.5:1.

참십 로고는 `public/brand/chamsip-*.svg`(엠블럼·꽃머리)와 `app/icon.svg`(파비콘)이다. 十 모양 네 꽃잎은 종류색(과제·채용·취업 준비·장학금), 가운데 노란 체크는 "참"이다. 로고 그림은 원칙 1의 그라데이션 금지에서 제외하고, 상단바 같은 작은 자리에는 얼굴 없는 `chamsip-mark.svg`를 쓴다.

80주년 엠블럼(`public/brand/kmu80-shield-*.svg`)과 해옹체는 학교 자산이다. 대외 배포 전 브랜딩디자인센터 사용 기준 확인.

## 글꼴 라이선스
- Pretendard (`public/fonts/Pretendard-*.subset.woff2`) — SIL OFL 1.1
- Bebas Neue (`public/fonts/BebasNeue-Regular.woff2`) — SIL OFL 1.1
- KMU80 해옹체 (`public/fonts/KMU80HaeongSans.otf`) — 국민대학교 배포, CC BY-ND (변형 금지·출처 표시)


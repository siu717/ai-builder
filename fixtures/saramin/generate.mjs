// Generates fixtures/saramin/*.json — deterministic (fixed seed + fixed base date).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
const BASE = Date.parse("2026-10-03T00:00:00+09:00");
const DAY = 86_400_000;

let seed = 20261003;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const sample = (list, n) => [...list].sort(() => rand() - 0.5).slice(0, n);

function kst(ms, endOfDay = false) {
  const d = new Date(ms + 9 * 3600_000);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return endOfDay ? `${date}T23:59:59+0900` : `${date}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+0900`;
}
const ts = (iso) => String(Math.floor(Date.parse(iso.replace(/(\d{2})(\d{2})$/, "$1:$2")) / 1000));

const PROFILE = {
  name: "한지우",
  year: "3",
  major: "소프트웨어학부 (국민대학교 소프트웨어융합대학)",
  gpa: "3.82",
  gpaScale: "4.5",
  interests: "백엔드 개발, 데이터 엔지니어링, LLM 기반 AI 서비스, 클라우드",
  experience: [
    "국민대학교 소프트웨어학부 3학년 재학 중 (2027년 8월 졸업 예정, 서울 성북구 거주).",
    "Java·Spring Boot로 교내 동아리 출석·회비 관리 API를 만들고 AWS EC2와 RDS에 배포했습니다 (팀 4명, 백엔드 담당).",
    "Python·FastAPI와 Claude API로 강의 공지 요약 챗봇을 만들어 학과 디스코드에서 한 학기 동안 운영했습니다.",
    "캡스톤디자인에서 React·TypeScript 프론트엔드와 PostgreSQL 스키마 설계를 맡았습니다.",
    "SQLD 취득, TOEIC 860. Git·GitHub Actions로 협업과 CI를 경험했습니다.",
    "아직 인턴 경력은 없으며 2027년 상반기 인턴 또는 정규직 전환형 인턴을 찾고 있습니다.",
  ].join("\n"),
};

// 회사명은 모두 가상이며 앱의 기존 샘플 규칙대로 "(샘플)"을 붙인다.
const COMPANY_HEADS = ["누리", "솔빛", "온새", "하람", "다온", "가람", "새봄", "라온", "미르", "별하", "윤슬", "해든", "나래", "로아", "시루", "단비", "이음", "마루", "푸른결", "도담"];
const COMPANY_TAILS = ["데이터랩", "소프트", "테크", "네트웍스", "에이아이", "클라우드", "모빌리티", "커머스", "핀테크", "헬스케어", "게임즈", "스튜디오", "시스템즈", "랩스", "파트너스"];

const INDUSTRIES = {
  si: { code: "301", name: "솔루션·SI·ERP·CRM" },
  web: { code: "302", name: "웹에이전시" },
  shop: { code: "304", name: "쇼핑몰·오픈마켓" },
  portal: { code: "305", name: "포털·인터넷·컨텐츠" },
  mobile: { code: "306", name: "네트워크·통신·모바일" },
  security: { code: "308", name: "정보보안·백신" },
  game: { code: "314", name: "게임·애니메이션" },
  fin: { code: "403", name: "핀테크·결제·PG" },
  auto: { code: "608", name: "자동차·부품" },
  health: { code: "703", name: "의료·제약·바이오" },
};

const MID = {
  it: { code: "2", name: "IT개발·데이터" },
  plan: { code: "16", name: "기획·전략" },
  mkt: { code: "14", name: "마케팅·홍보·조사" },
  design: { code: "15", name: "디자인" },
  biz: { code: "4", name: "회계·세무·재무" },
  hr: { code: "5", name: "인사·노무·HRD" },
  sales: { code: "18", name: "영업·판매·무역" },
};

// weight = 대략적인 공고 수 비중 (합계 100)
const ROLES = [
  { weight: 12, mid: "it", title: "백엔드 개발", codes: [["84", "백엔드/서버개발"]], skills: ["Java", "Spring Boot", "Kotlin", "Node.js", "MySQL", "AWS", "Redis", "JPA"], industries: ["si", "portal", "shop", "fin"] },
  { weight: 7, mid: "it", title: "프론트엔드 개발", codes: [["92", "프론트엔드"], ["87", "웹개발"]], skills: ["React", "TypeScript", "Next.js", "JavaScript", "웹접근성", "Vue.js"], industries: ["web", "portal", "shop"] },
  { weight: 4, mid: "it", title: "풀스택 개발", codes: [["84", "백엔드/서버개발"], ["92", "프론트엔드"]], skills: ["React", "Node.js", "TypeScript", "PostgreSQL", "Docker"], industries: ["web", "si"] },
  { weight: 4, mid: "it", title: "Android 앱 개발", codes: [["86", "앱개발"], ["229", "Android"]], skills: ["Kotlin", "Android", "Jetpack Compose", "Git"], industries: ["mobile", "portal"] },
  { weight: 3, mid: "it", title: "iOS 앱 개발", codes: [["86", "앱개발"], ["230", "iOS"]], skills: ["Swift", "SwiftUI", "iOS", "Git"], industries: ["mobile", "fin"] },
  { weight: 4, mid: "it", title: "클라우드·DevOps 엔지니어", codes: [["91", "DevOps"], ["2246", "클라우드"]], skills: ["AWS", "Kubernetes", "Docker", "Terraform", "Linux", "CI/CD"], industries: ["si", "portal"] },
  { weight: 2, mid: "it", title: "QA 엔지니어", codes: [["94", "QA/테스터"]], skills: ["테스트자동화", "Selenium", "Jira", "Python"], industries: ["game", "shop"] },
  { weight: 2, mid: "it", title: "정보보안 엔지니어", codes: [["95", "보안"]], skills: ["정보보안", "모의해킹", "Linux", "네트워크"], industries: ["security"] },
  { weight: 2, mid: "it", title: "게임 클라이언트 개발", codes: [["90", "게임개발"]], skills: ["Unity", "C#", "Unreal", "C++"], industries: ["game"] },
  { weight: 3, mid: "it", title: "자율주행 SW 개발", codes: [["88", "임베디드"], ["2232", "AI/ML"]], skills: ["C++", "ROS", "Python", "Linux", "자율주행"], industries: ["auto"] },
  { weight: 5, mid: "it", title: "데이터 엔지니어", codes: [["2234", "데이터엔지니어"]], skills: ["Python", "SQL", "Spark", "Airflow", "Kafka", "BigQuery"], industries: ["portal", "shop", "fin"] },
  { weight: 5, mid: "it", title: "데이터 분석", codes: [["2236", "데이터분석가"]], skills: ["SQL", "Python", "Tableau", "통계", "A/B 테스트"], industries: ["shop", "portal", "fin", "health"] },
  { weight: 5, mid: "it", title: "머신러닝 엔지니어", codes: [["2232", "AI/ML"]], skills: ["Python", "PyTorch", "머신러닝", "딥러닝", "MLOps"], industries: ["portal", "health", "si"] },
  { weight: 5, mid: "it", title: "LLM 서비스 개발", codes: [["2232", "AI/ML"], ["84", "백엔드/서버개발"]], skills: ["LLM", "Python", "RAG", "FastAPI", "프롬프트엔지니어링", "벡터DB"], industries: ["portal", "si", "fin"] },
  { weight: 6, mid: "plan", title: "서비스 기획", codes: [["170", "서비스기획"]], skills: ["서비스기획", "Figma", "데이터분석", "UX"], industries: ["portal", "shop", "fin"] },
  { weight: 4, mid: "plan", title: "프로덕트 매니저(PM)", codes: [["171", "PM/PO"]], skills: ["PM", "애자일", "Jira", "SQL"], industries: ["portal", "si", "fin"] },
  { weight: 2, mid: "plan", title: "사업기획", codes: [["165", "사업기획"]], skills: ["사업기획", "시장조사", "엑셀", "PPT"], industries: ["auto", "health"] },
  { weight: 5, mid: "design", title: "UX/UI 디자인", codes: [["150", "UI/UX디자인"]], skills: ["Figma", "UX리서치", "디자인시스템", "프로토타이핑"], industries: ["web", "portal", "fin"] },
  { weight: 3, mid: "design", title: "프로덕트 디자인", codes: [["151", "프로덕트디자인"]], skills: ["Figma", "모바일UI", "인터랙션"], industries: ["shop", "mobile"] },
  { weight: 2, mid: "design", title: "BX 디자인", codes: [["152", "브랜드디자인"]], skills: ["브랜딩", "Illustrator", "Photoshop"], industries: ["shop", "health"] },
  { weight: 4, mid: "mkt", title: "퍼포먼스 마케팅", codes: [["140", "퍼포먼스마케팅"]], skills: ["GA4", "광고운영", "데이터분석", "SQL"], industries: ["shop", "fin"] },
  { weight: 3, mid: "mkt", title: "콘텐츠 마케팅", codes: [["141", "콘텐츠마케팅"]], skills: ["SNS", "카피라이팅", "영상편집"], industries: ["shop", "game", "health"] },
  { weight: 2, mid: "mkt", title: "그로스 마케팅", codes: [["142", "그로스해킹"]], skills: ["그로스해킹", "A/B 테스트", "SQL", "Amplitude"], industries: ["portal", "fin"] },
  { weight: 2, mid: "biz", title: "재무회계", codes: [["31", "재무회계"]], skills: ["회계", "엑셀", "ERP", "전산회계"], industries: ["si", "auto"] },
  { weight: 2, mid: "hr", title: "인사(HR)", codes: [["51", "인사담당자"]], skills: ["채용", "HRD", "노무"], industries: ["portal", "health"] },
  { weight: 2, mid: "sales", title: "해외영업", codes: [["181", "해외영업"]], skills: ["영어", "무역", "B2B영업", "중국어"], industries: ["auto", "health"] },
];

// Saramin job-type 코드
const JOB_TYPES = {
  regular: { code: "1", name: "정규직" },
  contract: { code: "2", name: "계약직" },
  intern: { code: "4", name: "인턴직" },
  internConvert: { code: "11", name: "인턴직 (정규직 전환가능)" },
  military: { code: "20", name: "전문연구요원" },
};
const EDU = {
  any: { code: "0", name: "학력무관" },
  college4: { code: "3", name: "대학교졸업(4년)" },
  college4Plus: { code: "8", name: "대학교졸업(4년)이상" },
  master: { code: "9", name: "석사졸업이상" },
};
const LOCATIONS = [
  ["101010", "강남구"], ["101150", "서초구"], ["101180", "송파구"], ["101130", "마포구"], ["101160", "성동구"],
  ["101200", "영등포구"], ["101070", "구로구"], ["101080", "금천구"], ["101240", "중구"], ["101230", "종로구"],
  ["101170", "성북구"], ["101140", "서대문구"], ["101210", "용산구"],
].map(([code, gu]) => ({ code, name: `서울 &gt; ${gu}` }));
const SALARY = {
  company: { code: "0", name: "회사내규에 따름" },
  interview: { code: "99", name: "면접후 결정" },
  ranges: [
    { code: "11", name: "3,000~3,200만원" }, { code: "12", name: "3,200~3,400만원" }, { code: "13", name: "3,400~3,600만원" },
    { code: "14", name: "3,600~3,800만원" }, { code: "15", name: "3,800~4,000만원" }, { code: "16", name: "4,000~5,000만원" },
  ],
};
const CLOSE = {
  deadline: { code: "1", name: "접수마감일" },
  untilHired: { code: "2", name: "채용시" },
  always: { code: "3", name: "상시" },
  rolling: { code: "4", name: "수시" },
};

function hiringShape(role) {
  const r = rand();
  // 학생 매칭 신호를 다양하게: 인턴·전환형(재학생 가능) / 신입(졸업 요건) / 경력(불일치)
  if (r < 0.32) return { kind: "intern", type: JOB_TYPES.intern, exp: { code: 1, min: 0, max: 0, name: "신입" }, edu: pick([EDU.any, EDU.any, EDU.college4Plus]), label: "체험형 인턴" };
  if (r < 0.55) return { kind: "internConvert", type: JOB_TYPES.internConvert, exp: { code: 1, min: 0, max: 0, name: "신입" }, edu: pick([EDU.any, EDU.college4Plus]), label: "채용연계형 인턴" };
  if (r < 0.80) return { kind: "newgrad", type: role.mid === "it" && rand() < 0.15 ? JOB_TYPES.military : JOB_TYPES.regular, exp: { code: 1, min: 0, max: 0, name: "신입" }, edu: pick([EDU.college4, EDU.college4Plus]), label: "신입" };
  if (r < 0.90) {
    const min = int(1, 3);
    return { kind: "mixed", type: JOB_TYPES.regular, exp: { code: 3, min: 0, max: min + 2, name: `신입·경력 ${min + 2}년↓` }, edu: EDU.college4Plus, label: "신입/경력" };
  }
  const min = int(2, 5);
  return { kind: "career", type: pick([JOB_TYPES.regular, JOB_TYPES.contract]), exp: { code: 2, min, max: min + int(2, 5), name: `경력 ${min}년↑` }, edu: role.title.includes("머신러닝") ? EDU.master : EDU.college4Plus, label: "경력" };
}

function titleFor(role, shape, half) {
  const seasonal = shape.kind === "intern" || shape.kind === "internConvert" || shape.kind === "newgrad";
  const prefix = seasonal && rand() < 0.6 ? `[${half}] ` : "";
  const suffix = { intern: `${role.title} 체험형 인턴 모집`, internConvert: `${role.title} 채용연계형 인턴 (정규직 전환)`, newgrad: `${role.title} 신입 공채`, mixed: `${role.title} 신입/경력 채용`, career: `${role.title} 경력직 채용` }[shape.kind];
  return prefix + suffix;
}

function buildJobs() {
  const roles = ROLES.flatMap((role) => Array.from({ length: role.weight }, () => role));
  const usedNames = new Set();
  const companyName = () => {
    let name;
    do name = `${pick(COMPANY_HEADS)}${pick(COMPANY_TAILS)}`; while (usedNames.has(name) && usedNames.size < 250);
    usedNames.add(name);
    return `${name} (샘플)`;
  };

  return sample(roles, roles.length).map((role, index) => {
    const id = String(990_000_001 + index);
    const shape = hiringShape(role);
    const expired = index % 20 === 19; // 5건은 이미 마감 → active 0
    const postedMs = BASE - (expired ? int(40, 60) : int(0, 30)) * DAY + int(9, 18) * 3600_000;
    const close = expired ? CLOSE.deadline : pick([CLOSE.deadline, CLOSE.deadline, CLOSE.deadline, CLOSE.deadline, CLOSE.untilHired, CLOSE.always, CLOSE.rolling]);
    const expiresMs = expired ? BASE - int(1, 10) * DAY
      : close === CLOSE.deadline ? Math.max(postedMs + 7 * DAY, BASE + int(2, 45) * DAY)
      : postedMs + int(60, 90) * DAY;
    const posting = kst(postedMs);
    const expiration = kst(expiresMs, true);
    const modified = kst(postedMs + int(0, 5) * DAY);
    const salary = shape.kind === "intern" || shape.kind === "internConvert" ? pick([SALARY.company, SALARY.company, SALARY.interview])
      : shape.kind === "career" ? pick([SALARY.interview, ...SALARY.ranges.slice(3)])
      : pick([SALARY.company, ...SALARY.ranges.slice(0, 4)]);
    const skills = sample(role.skills, Math.min(role.skills.length, int(3, 5)));
    const half = postedMs < BASE - 20 * DAY ? "2026 하반기" : "2027 상반기";

    return {
      url: `https://example.com/saramin-dummy/jobs/relay/view?rec_idx=${id}`,
      active: expired ? 0 : 1,
      company: { detail: { href: `https://example.com/saramin-dummy/company/${id}`, name: companyName() } },
      position: {
        title: titleFor(role, shape, half),
        industry: INDUSTRIES[pick(role.industries)],
        location: pick(LOCATIONS),
        "job-type": shape.type,
        "job-mid-code": MID[role.mid],
        "job-code": { code: role.codes.map(([code]) => code).join(","), name: role.codes.map(([, name]) => name).join(",") },
        "experience-level": shape.exp,
        "required-education-level": shape.edu,
      },
      keyword: [...role.codes.map(([, name]) => name), ...skills].join(","),
      salary,
      id,
      "posting-timestamp": ts(posting),
      "posting-date": posting,
      "modification-timestamp": ts(modified),
      "opening-timestamp": ts(posting),
      "expiration-timestamp": ts(expiration),
      "expiration-date": expiration,
      "close-type": close,
      "read-cnt": String(int(40, 4200)),
      "apply-cnt": String(int(0, 180)),
    };
  });
}

const jobs = buildJobs();
if (jobs.length !== 100) throw new Error(`expected 100 jobs, got ${jobs.length}`);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "student-profile.json"), JSON.stringify(PROFILE, null, 2) + "\n");
writeFileSync(join(OUT, "job-search.json"), JSON.stringify({ jobs: { count: jobs.length, start: 0, total: String(jobs.length), job: jobs } }, null, 2) + "\n");
console.log(`wrote ${jobs.length} jobs to ${OUT}`);

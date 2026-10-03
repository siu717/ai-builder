import type { EligibilityCondition, Opportunity, Profile } from "./contracts";

export { TASK_SAMPLE, COACH_JOB_SAMPLE, COACH_RESUME_SAMPLE } from "./contracts";

type Requirement =
  | { field: "year"; label: string; minimum: number; maximum: number; preferred?: boolean }
  | { field: "major" | "experience"; label: string; keywords: string[]; preferred?: boolean }
  | { field: "gpa"; label: string; minimum: number; scale: number; preferred?: boolean }
  | { field: "unprovided"; label: string; preferred?: boolean };

interface CatalogDefinition {
  id: string;
  kind: "scholarship" | "job";
  title: string;
  organization: string;
  description: string;
  daysUntil: number;
  time: string | null;
  amount: string;
  tags: string[];
  documents: string[];
  requirements: Requirement[];
  interests: string[];
}

const DEFINITIONS: CatalogDefinition[] = [
  {
    id: "sample-scholarship-growth",
    kind: "scholarship",
    title: "성장지원 장학금",
    organization: "캠퍼스 장학재단 (샘플)",
    description: "학업과 진로 준비를 병행하는 재학생을 위한 생활비 지원입니다.",
    daysUntil: 7,
    time: "18:00",
    amount: "100만 원",
    tags: ["생활비", "2~4학년"],
    documents: ["재학증명서", "성적증명서", "활동계획서"],
    requirements: [
      { field: "year", label: "재학 중인 2~4학년", minimum: 2, maximum: 4 },
      { field: "gpa", label: "학점 3.0 / 4.5 이상", minimum: 3, scale: 4.5 },
    ],
    interests: [],
  },
  {
    id: "sample-scholarship-software",
    kind: "scholarship",
    title: "소프트웨어 인재 장학금",
    organization: "미래인재 지원센터 (샘플)",
    description: "컴퓨터·소프트웨어 전공 학생의 프로젝트 활동을 지원합니다.",
    daysUntil: 12,
    time: null,
    amount: "150만 원",
    tags: ["전공", "프로젝트"],
    documents: ["성적증명서", "프로젝트 소개서"],
    requirements: [
      { field: "major", label: "컴퓨터·소프트웨어 관련 전공", keywords: ["컴퓨터", "소프트웨어", "전산", "컴공"] },
      { field: "gpa", label: "학점 3.5 / 4.5 이상", minimum: 3.5, scale: 4.5 },
    ],
    interests: ["개발", "프론트엔드", "백엔드", "소프트웨어"],
  },
  {
    id: "sample-scholarship-opportunity",
    kind: "scholarship",
    title: "기회균형 장학금",
    organization: "학생성장 재단 (샘플)",
    description: "경제적 지원이 필요한 재학생의 학업 지속을 돕습니다.",
    daysUntil: 18,
    time: "17:00",
    amount: "200만 원",
    tags: ["생활비", "소득 확인"],
    documents: ["재학증명서", "학자금 지원구간 확인서"],
    requirements: [
      { field: "year", label: "재학 중인 1~4학년", minimum: 1, maximum: 4 },
      { field: "unprovided", label: "학자금 지원구간 4구간 이하" },
    ],
    interests: [],
  },
  {
    id: "sample-job-frontend",
    kind: "job",
    title: "프론트엔드 인턴",
    organization: "캠퍼스랩 (샘플)",
    description: "학생용 웹 서비스의 화면과 접근성을 개선하는 인턴입니다.",
    daysUntil: 9,
    time: "18:00",
    amount: "보수 확인 필요",
    tags: ["프론트엔드", "인턴", "React"],
    documents: ["이력서", "프로젝트 포트폴리오"],
    requirements: [
      { field: "year", label: "재학 중인 3~4학년", minimum: 3, maximum: 4 },
      { field: "experience", label: "JavaScript 기초", keywords: ["JavaScript", "자바스크립트"] },
      { field: "experience", label: "React 프로젝트 경험", keywords: ["React", "리액트"], preferred: true },
    ],
    interests: ["프론트엔드", "frontend", "웹 개발"],
  },
  {
    id: "sample-job-data",
    kind: "job",
    title: "데이터 분석 인턴",
    organization: "데이터브릿지 (샘플)",
    description: "서비스 지표를 정리하고 사용자 행동을 분석합니다.",
    daysUntil: 15,
    time: null,
    amount: "보수 확인 필요",
    tags: ["데이터", "인턴", "SQL"],
    documents: ["이력서", "분석 프로젝트 소개서"],
    requirements: [
      { field: "year", label: "재학 중인 2~4학년", minimum: 2, maximum: 4 },
      { field: "experience", label: "SQL 사용 경험", keywords: ["SQL"] },
      { field: "experience", label: "Python 분석 경험", keywords: ["Python", "파이썬"], preferred: true },
    ],
    interests: ["데이터", "분석", "data"],
  },
  {
    id: "sample-job-product",
    kind: "job",
    title: "서비스 기획 신입",
    organization: "그린서비스 (샘플)",
    description: "사용자 조사와 기능 설계를 통해 새로운 서비스를 기획합니다.",
    daysUntil: 21,
    time: "17:00",
    amount: "보수 확인 필요",
    tags: ["기획", "신입", "사용자 조사"],
    documents: ["이력서", "자기소개서"],
    requirements: [
      { field: "year", label: "4학년 재학생", minimum: 4, maximum: 4 },
      { field: "unprovided", label: "입사 예정일 이전 졸업 가능" },
      { field: "experience", label: "사용자 조사 또는 기획 프로젝트 경험", keywords: ["사용자 조사", "기획"], preferred: true },
    ],
    interests: ["기획", "프로덕트", "product", "pm"],
  },
];

export function seoulToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function evaluate(requirement: Requirement, profile: Profile): EligibilityCondition {
  const label = `${requirement.preferred ? "우대" : "필수"}: ${requirement.label}`;
  const result = (status: EligibilityCondition["status"], reason: string): EligibilityCondition => ({
    label, status, reason: `공고 근거: "${requirement.label}". ${reason}`,
  });
  if (requirement.field === "unprovided") {
    return result("unknown", "현재 프로필에 이 정보가 없어 증빙 또는 공고 원문 확인이 필요합니다.");
  }
  if (requirement.field === "year") {
    const match = profile.year.trim().match(/^([1-6])(?:\s*학년)?$/);
    if (!match) return result("unknown", "현재 재학 학년을 입력해 주세요.");
    const year = Number(match[1]);
    return result(year >= requirement.minimum && year <= requirement.maximum ? "met" : "unmet", `입력한 학년은 ${year}학년입니다.`);
  }
  if (requirement.field === "gpa") {
    const gpa = profile.gpa.trim() === "" ? NaN : Number(profile.gpa);
    const scale = profile.gpaScale.trim() === "" ? NaN : Number(profile.gpaScale);
    if (!Number.isFinite(gpa) || !Number.isFinite(scale) || gpa < 0 || gpa > scale || scale <= 0) {
      return result("unknown", "학점과 만점 기준을 함께 입력해 주세요.");
    }
    if (scale !== requirement.scale) {
      return result("unknown", `입력한 만점 ${scale}와 공고 만점 ${requirement.scale}가 다릅니다. 공고가 인정하는 환산 기준을 확인해 주세요.`);
    }
    return result(gpa >= requirement.minimum ? "met" : "unmet", `입력한 학점은 ${gpa} / ${scale}입니다.`);
  }
  const value = profile[requirement.field].trim();
  if (!value) return result("unknown", requirement.field === "major" ? "전공을 입력해 주세요." : "보유 역량과 경력을 입력해 주세요.");
  const matched = requirement.keywords.find((word) => value.toLowerCase().includes(word.toLowerCase()));
  if (requirement.field === "major") {
    return result(matched ? "met" : "unmet", matched ? `입력한 전공에 "${matched}"가 포함됩니다.` : `입력한 전공 "${value}"는 명시된 관련 전공에 해당하지 않습니다. 복수전공·인정 전공은 원문을 확인해 주세요.`);
  }
  if (matched) {
    const sentences = value.split(/[.!?\n;]/);
    const evidence = sentences.filter((sentence) => sentence.toLowerCase().includes(matched.toLowerCase()));
    const explicitlyAbsent = evidence.every((sentence) => /없|미보유|미경험|못|no experience|without/i.test(sentence));
    return result(explicitlyAbsent ? "unmet" : "met", explicitlyAbsent ? `프로필에서 "${matched}" 경험이 없다고 명시했습니다.` : `프로필에 "${matched}" 역량 또는 경험이 명시되어 있습니다. 증빙은 지원 전에 확인해 주세요.`);
  }
  return result("unknown", "입력한 경력에 해당 역량이 명시되지 않았습니다. 미기재만으로 경험이 없다고 판단하지 않습니다.");
}

export function eligibilitySummary(conditions: EligibilityCondition[]): "met" | "unmet" | "unknown" {
  const required = conditions.filter((condition) => !condition.label.startsWith("우대:"));
  if (required.some((condition) => condition.status === "unmet")) return "unmet";
  if (!required.length || required.some((condition) => condition.status === "unknown")) return "unknown";
  return "met";
}

export function getCatalog(profile: Profile, now = new Date()): Opportunity[] {
  const today = seoulToday(now);
  return DEFINITIONS.map((definition) => {
    const date = addCalendarDays(today, definition.daysUntil);
    const conditions = definition.requirements.map((requirement) => evaluate(requirement, profile));
    const overall = eligibilitySummary(conditions);
    const requirementSummary = overall === "met" ? "필수 조건을 충족합니다. 선발 확정을 의미하지 않습니다." : overall === "unmet" ? "충족하지 못한 필수 조건이 있습니다." : "필수 조건 중 확인할 정보가 있습니다.";
    const interest = definition.interests.find((word) => profile.interests.toLowerCase().includes(word.toLowerCase()));
    const fit = definition.kind === "job"
      ? interest ? `관심 직무 "${interest}"와 연결되는 공고입니다. ` : profile.interests.trim() ? "관심 직무와 직접 연결되는 키워드가 없습니다. 직무 내용을 확인해 주세요. " : "관심 직무를 입력하면 직무 적합성을 비교할 수 있습니다. "
      : interest ? `관심 분야 "${interest}"와 관련된 장학금입니다. ` : "";
    const requirements = definition.requirements.map((requirement) => `${requirement.preferred ? "우대" : "필수"}: ${requirement.label}`).join("\n");
    const originalText = `[샘플 공고: 실제 모집 정보가 아닙니다]\n${definition.organization}\n${definition.title}\n${definition.description}\n${requirements}\n${definition.kind === "scholarship" ? "지원 금액" : "보수"}: ${definition.amount}\n신청 마감: ${date}${definition.time ? ` ${definition.time} (Asia/Seoul)` : " (시간 미기재)"}\n제출 서류: ${definition.documents.join(", ")}\n면접 일시는 명시되지 않았습니다.`;
    return {
      id: definition.id, kind: definition.kind, title: definition.title,
      organization: definition.organization, description: definition.description,
      date, time: definition.time, amount: definition.amount, tags: [...definition.tags],
      source: "팀에서 준비한 샘플 공고", originalText, documents: [...definition.documents],
      conditions, recommendation: `${fit}${requirementSummary}`, isSample: true,
    };
  });
}

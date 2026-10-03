import type { LiveOpportunity, Profile } from "../contracts";

export interface MatchResult {
  matchScore: number;
  matchReason: string;
}

const STOPWORDS = new Set([
  "경험", "프로젝트", "관심", "직무", "분야", "전공", "학과", "학부", "및", "등", "관련", "기초", "활용", "사용", "가능", "보유",
  "있습니다", "했습니다", "입니다", "합니다", "으로", "에서", "the", "and", "with", "for", "team", "팀", "구현", "제작", "진행", "협업", "참여",
]);

// 같은 뜻으로 쓰이는 표기. 프로필 단어가 왼쪽 묶음에 있으면 같은 묶음의 표기도 찾는다.
const SYNONYMS: string[][] = [
  ["프론트엔드", "frontend", "front-end", "front end"],
  ["백엔드", "backend", "back-end", "서버"],
  ["데이터", "data"],
  ["개발자", "developer", "engineer", "엔지니어"],
  ["소프트웨어", "software", "sw"],
  ["디자인", "디자이너", "design", "designer", "ux", "ui"],
  ["마케팅", "마케터", "marketing", "marketer"],
  ["기획", "pm", "po", "product", "프로덕트"],
  ["인공지능", "ai", "머신러닝", "ml", "딥러닝"],
  ["리액트", "react"],
  ["파이썬", "python"],
  ["자바스크립트", "javascript"],
];

const ENTRY = /인턴|신입|intern|entry|junior|주니어|체험형|채용연계|졸업예정/i;
const SENIOR = /시니어|senior|lead|리드|팀장|경력\s*\d|\d+\s*년\s*이상|경력직/i;

export function tokenize(text: string): string[] {
  const tokens = text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[\s,./·;:()[\]{}|!?"'’“”~+&]+/)
    .map((token) => token.replace(/(?:입니다|했습니다|합니다|으로|에서|이며|하고|을|를|은|는|이|가|와|과|의|로|에)$/u, ""))
    .filter((token) => token.length >= 2 || /^(?:ai|ui|ux|pm|po|qa|hr)$/.test(token))
    .filter((token) => !STOPWORDS.has(token) && !/^\d+$/.test(token));
  return [...new Set(tokens)];
}

/** 전공 이름에서 `학과`·`학부`·`전공`·`공학`을 떼어 핵심 단어를 만든다. */
export function majorTokens(major: string): string[] {
  const out = new Set<string>();
  for (const token of tokenize(major)) {
    const stem = token.replace(/(?:학과|학부|전공|과)$/u, "");
    if (stem.length >= 2) out.add(stem);
    const core = stem.replace(/공학$/u, "");
    if (core.length >= 2) out.add(core);
  }
  return [...out];
}

function variants(token: string): string[] {
  const group = SYNONYMS.find((entry) => entry.includes(token));
  return group ? [token, ...group.filter((entry) => entry !== token)] : [token];
}

function includesWord(haystack: string, word: string): boolean {
  // 짧은 영문 약어(ai, pm …)는 단어 경계가 있어야 일치로 본다.
  if (/^[a-z]{2,3}$/.test(word)) return new RegExp(`(?<![a-z])${word}(?![a-z])`).test(haystack);
  return haystack.includes(word);
}

function firstHit(tokens: string[], haystack: string): string | null {
  for (const token of tokens) if (variants(token).some((word) => includesWord(haystack, word))) return token;
  return null;
}

/** 프로필과 공고 글자를 비교한 휴리스틱 점수(0~100)와 한국어 근거. 자격 판정이 아니다. */
export function scoreOpportunity(item: Pick<LiveOpportunity, "kind" | "title" | "tags" | "description" | "organization"> & { date?: string | null }, profile: Profile): MatchResult {
  const title = item.title.normalize("NFKC").toLowerCase();
  const rest = `${item.tags.join(" ")} ${item.description} ${item.organization}`.normalize("NFKC").toLowerCase();
  const reasons: string[] = [];
  let score = 20;

  const interests = tokenize(profile.interests);
  const interestLabel = item.kind === "job" ? "관심 직무" : "관심 분야";
  const titleInterest = firstHit(interests, title);
  const restInterest = titleInterest ? null : firstHit(interests, rest);
  if (titleInterest) {
    score += 40;
    reasons.push(`${interestLabel} "${titleInterest}"와 일치`);
  } else if (restInterest) {
    score += 25;
    reasons.push(`${interestLabel} "${restInterest}"와 관련`);
  }

  const major = firstHit(majorTokens(profile.major), `${title} ${rest}`);
  if (major) {
    score += 20;
    reasons.push(`전공 "${major}" 관련`);
  }

  const skill = firstHit(tokenize(profile.experience).filter((token) => token !== titleInterest && token !== restInterest), `${title} ${rest}`);
  if (skill) {
    score += 15;
    reasons.push(`보유 역량 "${skill}" 관련`);
  }

  if (item.kind === "job") {
    if (ENTRY.test(`${title} ${rest}`)) {
      score += 15;
      if (reasons.length < 2) reasons.push("인턴·신입 대상 공고");
    } else if (SENIOR.test(title)) score -= 15;
  } else if (/장학/.test(title)) {
    score += 10;
  }

  // 마감일이 명시된 공고는 바로 일정으로 옮길 수 있어 조금 앞에 둔다.
  if (item.date) score += 5;

  return { matchScore: Math.max(0, Math.min(100, score)), matchReason: reasons.slice(0, 2).join(" · ") };
}

import type { LiveOpportunity } from "../contracts";

export interface SourceContext {
  /** 사용자가 입력한 검색어. 없으면 빈 문자열. */
  query: string;
  now: Date;
  fetcher?: typeof fetch;
  /** 테스트에서 환경 변수를 바꿔 끼울 때 쓴다. 기본은 process.env. */
  env?: Record<string, string | undefined>;
}

export interface OpportunitySource {
  id: string;
  name: string;
  kind: "scholarship" | "job";
  /** 필요한 환경 변수 이름. 값이 없으면 fetch가 MissingKeyError를 던진다. */
  requiresKey?: string;
  /** 원본 서비스가 검색어를 직접 받는 소스. 아니면 index가 받은 목록을 걸러 낸다. */
  nativeQuery?: boolean;
  fetch(ctx: SourceContext): Promise<LiveOpportunity[]>;
}

export class MissingKeyError extends Error {
  constructor(public readonly envName: string) {
    super("missing api key");
    this.name = "MissingKeyError";
  }
}

export function envValue(ctx: SourceContext, name: string): string {
  return ((ctx.env ?? process.env)[name] || "").trim();
}

export function requireKey(ctx: SourceContext, name: string): string {
  const value = envValue(ctx, name);
  if (!value) throw new MissingKeyError(name);
  return value;
}

type Draft = Pick<LiveOpportunity, "kind" | "title" | "organization" | "url" | "sourceId" | "sourceName"> &
  Partial<Pick<LiveOpportunity, "description" | "date" | "time" | "postedAt" | "tags">> & { externalId: string };

/** 소스 모듈이 공통 형태를 만들 때 쓴다. 매칭 점수는 index에서 채운다. */
export function liveItem(draft: Draft): LiveOpportunity {
  const tags = [...new Set((draft.tags ?? []).map((tag) => tag.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 6);
  return {
    id: `${draft.sourceId}-${draft.externalId}`,
    kind: draft.kind,
    title: draft.title.replace(/\s+/g, " ").trim(),
    organization: draft.organization.replace(/\s+/g, " ").trim(),
    description: (draft.description ?? "").trim().slice(0, 600),
    date: draft.date ?? null,
    time: draft.time ?? null,
    postedAt: draft.postedAt ?? null,
    tags,
    url: draft.url,
    sourceId: draft.sourceId,
    sourceName: draft.sourceName,
    matchReason: "",
    matchScore: 0,
    isSample: false,
  };
}

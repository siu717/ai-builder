export interface LiveOpportunity {
  id: string;
  kind: "scholarship" | "job";
  title: string;
  organization: string;
  description: string;
  date: string | null;
  time: string | null;
  postedAt: string | null;
  tags: string[];
  url: string;
  sourceId: string;
  sourceName: string;
  matchReason: string;
  matchScore: number;
  isSample: false;
}

export interface LiveSourceStatus {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  error: string | null;
}

export interface LiveOpportunityResponse {
  items: LiveOpportunity[];
  sources: LiveSourceStatus[];
  fetchedAt: string;
}

export interface SourceContext {
  /** 사용자가 입력한 검색어. 없으면 빈 문자열. */
  query: string;
  now: Date;
  fetcher?: typeof fetch;
}

export interface OpportunitySource {
  id: string;
  name: string;
  kind: "scholarship" | "job";
  /** 원본 서비스가 검색어를 직접 받는 소스. 아니면 index가 받은 목록을 걸러 낸다. */
  nativeQuery?: boolean;
  fetch(ctx: SourceContext): Promise<LiveOpportunity[]>;
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

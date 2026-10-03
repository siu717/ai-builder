import type { Profile } from "../contracts";
import { TtlCache } from "../kookmin/http";
import { seoulParts } from "../kookmin/text";
import { dreamsponSource, kosafNoticeSource } from "./html-sources";
import { SOURCE_TIMEOUT_MS } from "./http";
import { kookminJobSource, kookminScholarshipSource } from "./kookmin";
import { linkareerSource } from "./linkareer";
import { scoreOpportunity } from "./match";
import type { LiveOpportunity, LiveOpportunityResponse, LiveSourceStatus, OpportunitySource } from "./types";
import { wantedSource } from "./wanted";

export const SOURCES: OpportunitySource[] = [
  // 모두 키 없이 동작한다. 공공데이터포털(장학금·공공기관 채용)은 lib/public-data.ts가 맡는다.
  kookminScholarshipSource, kosafNoticeSource, dreamsponSource,
  wantedSource, linkareerSource, kookminJobSource,
];

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_ITEMS = 60;
const TIMEOUT_ERROR = "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
const FETCH_ERROR = "공고를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";

const cache = new TtlCache<LiveOpportunity[]>(CACHE_TTL_MS, 200);

export function clearLiveCache(): void {
  cache.clear();
}

export interface LiveOptions {
  query?: string;
  limit?: number;
  now?: Date;
  fetcher?: typeof fetch;
  /** 테스트용. 기본은 등록된 전체 소스. */
  sources?: OpportunitySource[];
  timeoutMs?: number;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error("source failed")); },
    );
  });
}

function matchesQuery(item: LiveOpportunity, query: string): boolean {
  const haystack = `${item.title} ${item.organization} ${item.tags.join(" ")} ${item.description}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

export async function getLiveOpportunities(kind: "scholarship" | "job", profile: Profile, options: LiveOptions = {}): Promise<LiveOpportunityResponse> {
  const now = options.now ?? new Date();
  const query = (options.query ?? "").trim().slice(0, 80);
  const limit = Math.max(1, Math.min(options.limit ?? MAX_ITEMS, MAX_ITEMS));
  const today = seoulParts(now).date;
  const sources = (options.sources ?? SOURCES).filter((source) => source.kind === kind);

  const settled = await Promise.allSettled(sources.map(async (source) => {
    const sourceQuery = source.nativeQuery ? query : "";
    const key = `${source.id}:${sourceQuery}`;
    let items = cache.fresh(key, now.getTime());
    if (!items) {
      try {
        items = await withTimeout(source.fetch({ query: sourceQuery, now, fetcher: options.fetcher }), options.timeoutMs ?? SOURCE_TIMEOUT_MS);
        cache.set(key, items, now.getTime());
      } catch (error) {
        // 장애가 나면 마지막 성공 결과를 보여 준다.
        const stale = cache.stale(key);
        if (!stale) throw error;
        items = stale;
      }
    }
    return query && !source.nativeQuery ? items.filter((item) => matchesQuery(item, query)) : items;
  }));

  const statuses: LiveSourceStatus[] = [];
  const merged = new Map<string, LiveOpportunity>();
  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "rejected") {
      const error = result.reason instanceof TimeoutError || (result.reason instanceof Error && /timeout/i.test(result.reason.message)) ? TIMEOUT_ERROR : FETCH_ERROR;
      statuses.push({ id: source.id, name: source.name, ok: false, count: 0, error });
      return;
    }
    let count = 0;
    for (const item of result.value) {
      // 마감이 지난 공고와 다른 종류로 잘못 온 항목은 보여 주지 않는다.
      if (item.kind !== kind || (item.date && item.date < today) || merged.has(item.id)) continue;
      merged.set(item.id, { ...item, ...scoreOpportunity(item, profile) });
      count += 1;
    }
    statuses.push({ id: source.id, name: source.name, ok: true, count, error: null });
  });

  const items = [...merged.values()]
    .sort((a, b) => b.matchScore - a.matchScore || (b.postedAt ?? "").localeCompare(a.postedAt ?? "") || a.id.localeCompare(b.id))
    .slice(0, limit);
  return { items, sources: statuses, fetchedAt: now.toISOString() };
}

export type { LiveOpportunity, LiveOpportunityResponse, LiveSourceStatus } from "./types";

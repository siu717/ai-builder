import type { LiveOpportunity } from "../contracts";
import { normalizeDate } from "./deadline";
import { getJson, list, record, str } from "./http";
import { liveItem, type OpportunitySource } from "./types";

const ID = "wanted";
const NAME = "원티드";

/** 원티드 공개 목록 JSON(`/api/v4/jobs`)을 읽는다. 등록일은 응답에 없어 postedAt은 null이다. */
export function parseWanted(payload: unknown): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const entry of list(record(payload).data)) {
    const job = record(entry);
    const id = str(job.id);
    const title = str(job.position);
    if (!/^\d+$/.test(id) || !title || job.hidden === true || (job.status && job.status !== "active")) continue;
    const company = record(job.company);
    const address = record(job.address);
    const from = typeof job.annual_from === "number" ? job.annual_from : null;
    const to = typeof job.annual_to === "number" ? job.annual_to : null;
    const career = from === null ? "" : from === 0 ? (to && to > 0 ? `신입~경력 ${to}년` : "신입") : `경력 ${from}${to && to > from ? `~${to}` : ""}년`;
    // 상세 주소(건물 이름 등)는 매칭 점수에 섞이지 않도록 시·구까지만 쓴다.
    const place = [str(address.location), str(address.district)].filter(Boolean).join(" ");
    items.push(liveItem({
      sourceId: ID, sourceName: NAME, kind: "job", externalId: id,
      title,
      organization: str(company.name) || "회사명 확인 필요",
      description: [str(company.industry_name), place, career].filter(Boolean).join(" · "),
      date: normalizeDate(str(job.due_time)),
      tags: [from === 0 ? "신입 가능" : "", str(address.location), str(company.industry_name)],
      url: `https://www.wanted.co.kr/wd/${id}`,
    }));
  }
  return items;
}

export const wantedSource: OpportunitySource = {
  id: ID, name: NAME, kind: "job", nativeQuery: true,
  async fetch(ctx) {
    const params = new URLSearchParams({ country: "kr", job_sort: "job.latest_order", years: "0", limit: "40" });
    if (ctx.query) params.set("query", ctx.query);
    return parseWanted(await getJson(`https://www.wanted.co.kr/api/v4/jobs?${params}`, ctx));
  },
};

import type { LiveOpportunity } from "../contracts";
import { fromEpoch } from "./deadline";
import { getJson, list, record, str } from "./http";
import { liveItem, type OpportunitySource } from "./types";

const ID = "linkareer";
const NAME = "링커리어";
const JOB_TYPES: Record<string, string> = { INTERN: "인턴", NEW: "신입", EXPERIENCED: "경력", CONTRACT: "계약직" };

// activityTypeID 5 = 채용(인턴·신입 포함). 2026-10-03 확인: 1 대외활동, 2 동아리, 3 공모전, 6 교육.
const QUERY = "{activities(filterBy:{status:OPEN,activityTypeID:5},orderBy:{field:CREATED_AT,direction:DESC},pagination:{page:1,pageSize:40}){nodes{id title organizationName recruitCloseAt createdAt jobTypes regions{name} categories{name}}}}";

/** 링커리어 공개 GraphQL `activities` 응답을 읽는다. */
export function parseLinkareer(payload: unknown): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const entry of list(record(record(record(payload).data).activities).nodes)) {
    const node = record(entry);
    const id = str(node.id);
    const title = str(node.title);
    if (!/^\d+$/.test(id) || !title) continue;
    const close = fromEpoch(node.recruitCloseAt);
    const jobTypes = list(node.jobTypes).map((value) => JOB_TYPES[str(value)] || "").filter(Boolean);
    const regions = list(node.regions).map((value) => str(record(value).name)).filter(Boolean);
    const categories = list(node.categories).map((value) => str(record(value).name)).filter((name) => name && name !== "전체");
    items.push(liveItem({
      sourceId: ID, sourceName: NAME, kind: "job", externalId: id,
      title,
      organization: str(node.organizationName) || "기관명 확인 필요",
      description: [jobTypes.join("·"), categories.join(", "), regions.join(", ")].filter(Boolean).join(" · "),
      date: close?.date ?? null,
      time: close?.time ?? null,
      postedAt: fromEpoch(node.createdAt)?.date ?? null,
      tags: [...jobTypes, ...categories.slice(0, 2), ...regions.slice(0, 1)],
      url: `https://linkareer.com/activity/${id}`,
    }));
  }
  return items;
}

export const linkareerSource: OpportunitySource = {
  id: ID, name: NAME, kind: "job",
  async fetch(ctx) {
    const payload = await getJson(`https://api.linkareer.com/graphql?query=${encodeURIComponent(QUERY)}`, ctx);
    if (list(record(payload).errors).length) throw new Error("linkareer graphql error");
    return parseLinkareer(payload);
  },
};

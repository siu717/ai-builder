import type { KookminNotice } from "../contracts";
import { KMU_ORIGIN } from "../kookmin/http";
import { getNotices, parseNoticeList } from "../kookmin/notices";
import { extractDeadline } from "./deadline";
import { getText } from "./http";
import { liveItem, type LiveOpportunity, type OpportunitySource } from "./types";

export const KMU_SCHOLARSHIP_ID = "kmu-scholarship";
export const KMU_JOB_ID = "kmu-job";

// 국민대 공지 게시판 번호(2026-10-03 확인): 10 교내채용, 11 교외채용.
const JOB_BOARDS = [
  { number: "11", label: "교외채용" },
  { number: "10", label: "교내채용" },
];

/** 국민대 장학공지 목록 → 실시간 장학 항목. 마감일은 제목에 적힌 경우에만 채운다. */
export function noticesToScholarships(notices: KookminNotice[]): LiveOpportunity[] {
  return notices.map((notice) => {
    const postedAt = notice.date || null;
    const deadline = extractDeadline(notice.title, postedAt);
    return liveItem({
      sourceId: KMU_SCHOLARSHIP_ID, sourceName: "국민대 장학공지", kind: "scholarship", externalId: notice.articleNo,
      title: notice.title, organization: "국민대학교", description: "",
      date: deadline.date, time: deadline.time, postedAt, tags: ["교내 공지"], url: notice.url,
    });
  });
}

/** 국민대 교내·교외 채용 게시판 목록 HTML → 실시간 채용 항목. */
export function parseKookminJobs(html: string, boardNumber: string, label: string): LiveOpportunity[] {
  return parseNoticeList(html, "general").map((notice) => {
    const postedAt = notice.date || null;
    const deadline = extractDeadline(notice.title, postedAt);
    return liveItem({
      sourceId: KMU_JOB_ID, sourceName: "국민대 채용공지", kind: "job", externalId: notice.articleNo,
      title: notice.title, organization: `국민대학교 ${label} 공지`, description: "",
      date: deadline.date, time: deadline.time, postedAt, tags: [label],
      url: `${KMU_ORIGIN}/user/kmuNews/notice/${boardNumber}/${notice.articleNo}/view.do`,
    });
  });
}

export const kookminScholarshipSource: OpportunitySource = {
  id: KMU_SCHOLARSHIP_ID, name: "국민대 장학공지", kind: "scholarship",
  async fetch(ctx) {
    const pages = await Promise.all([1, 2].map((page) => getNotices("scholarship", page, { now: ctx.now, fetcher: ctx.fetcher }).catch((error: unknown) => {
      if (page === 1) throw error;
      return { items: [] as KookminNotice[] };
    })));
    return noticesToScholarships(pages.flatMap((page) => page.items));
  },
};

export const kookminJobSource: OpportunitySource = {
  id: KMU_JOB_ID, name: "국민대 채용공지", kind: "job",
  async fetch(ctx) {
    const results = await Promise.allSettled(JOB_BOARDS.map(async (board) =>
      parseKookminJobs(await getText(`${KMU_ORIGIN}/user/kmuNews/notice/${board.number}/index.do`, ctx), board.number, board.label)));
    const items = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (!items.length && results.every((result) => result.status === "rejected")) throw new Error("kookmin job boards failed");
    return items;
  },
};

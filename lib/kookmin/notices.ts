import type { KookminBoard, KookminNotice, KookminNoticeDetail } from "../contracts";
import { RouteError } from "../http";
import { fetchText, KMU_ORIGIN, TtlCache } from "./http";
import { formatDate, htmlToText, inlineText, isValidDate, truncate } from "./text";

const NOTICE_ERROR = "국민대 공지사항을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
const NOTICE_NOT_FOUND = "공지 글을 찾을 수 없습니다.";
const NOTICE_TTL_MS = 5 * 60 * 1000;
export const NOTICE_TEXT_LIMIT = 20_000;
export const NOTICE_MAX_PAGE = 500;

// 일반공지(전체) 목록에는 게시판 번호가 없고, 글마다 원래 게시판 번호(4, 6, 7, 9, 10 …)가 붙어 있다.
const BOARD_NUMBERS: Record<KookminBoard, string | null> = { academic: "4", scholarship: "7", general: null };
// 상세 페이지는 경로의 게시판 번호와 상관없이 글 번호로 열린다(2026-10-03 확인). 번호를 모를 때만 쓴다.
const FALLBACK_BOARD_NUMBER = "4";

export interface NoticeListResponse {
  items: KookminNotice[];
  board: KookminBoard;
  page: number;
  hasMore: boolean;
  fetchedAt: string;
}

export function isKookminBoard(value: unknown): value is KookminBoard {
  return value === "academic" || value === "scholarship" || value === "general";
}

export function noticeListUrl(board: KookminBoard, page = 1): string {
  const number = BOARD_NUMBERS[board];
  const base = `${KMU_ORIGIN}/user/kmuNews/notice/${number ? `${number}/` : ""}index.do`;
  return page > 1 ? `${base}?currentPageNo=${page}` : base;
}

export function noticeDetailUrl(boardNumber: string, articleNo: string): string {
  return `${KMU_ORIGIN}/user/kmuNews/notice/${boardNumber}/${articleNo}/view.do`;
}

function isoDate(text: string): string {
  const match = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/.exec(text);
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isValidDate(year, month, day) ? formatDate(year, month, day) : "";
}

/**
 * 공지 목록에서 글 번호·제목·작성일을 읽는다.
 * 상단 고정 글(`li.notice`)은 목록에 작성일이 없어 `date`가 빈 문자열이다.
 */
export function parseNoticeList(html: string, board: KookminBoard): KookminNotice[] {
  const items = new Map<string, KookminNotice>();
  const anchors = /<a\b[^>]*href=["']([^"']*\/user\/kmuNews\/notice\/(?:(\d{1,6})\/)?(\d{1,12})\/view\.do[^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const anchor of html.matchAll(anchors)) {
    const [, , boardNumber, articleNo, body] = anchor;
    const titleHtml = /<p\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/p\s*>/i.exec(body);
    const title = inlineText(titleHtml ? titleHtml[1] : body);
    if (!title) continue;
    // 제목 안의 날짜를 작성일로 잘못 읽지 않도록 정보 영역에서만 찾는다.
    const meta = /class=["'][^"']*board_etc[^"']*["'][^>]*>([\s\S]*)/i.exec(body)?.[1] ?? (titleHtml ? body.replace(titleHtml[0], " ") : "");
    const date = isoDate(inlineText(meta));
    const existing = items.get(articleNo);
    if (existing) {
      // 고정 글이 일반 목록에도 다시 나오면 작성일만 채운다.
      if (!existing.date && date) existing.date = date;
      continue;
    }
    items.set(articleNo, {
      id: `kmu-notice-${board}-${articleNo}`,
      board,
      articleNo,
      title,
      date,
      url: noticeDetailUrl(boardNumber || BOARD_NUMBERS[board] || FALLBACK_BOARD_NUMBER, articleNo),
    });
  }
  return [...items.values()];
}

/** `페이지 1 / 41` 표시에서 현재 쪽과 전체 쪽수를 읽는다. */
export function parseNoticePaging(html: string): { page: number; totalPages: number } | null {
  const match = /페이지(?:&nbsp;|\s)*<span[^>]*>\s*(\d+)\s*\/\s*(\d+)\s*<\/span>/i.exec(html);
  return match ? { page: Number(match[1]), totalPages: Number(match[2]) } : null;
}

export interface ParsedNoticeDetail {
  title: string;
  date: string;
  text: string;
}

/** 공지 상세에서 제목·작성일·본문 텍스트를 읽는다. 본문 영역이 없으면 null(없는 글)이다. */
export function parseNoticeDetail(html: string): ParsedNoticeDetail | null {
  const titleHtml = /<p\b[^>]*class=["'][^"']*view_tit[^"']*["'][^>]*>([\s\S]*?)<\/p\s*>/i.exec(html);
  const opening = /<div\b[^>]*class=["'][^"']*view_inner[^"']*["'][^>]*>/i.exec(html) || /<div\b[^>]*class=["'][^"']*view_cont[^"']*["'][^>]*>/i.exec(html);
  if (!titleHtml && !opening) return null;
  let body = "";
  if (opening) {
    const rest = html.slice(opening.index + opening[0].length);
    // 본문 뒤에는 이전·다음 글, 목록 버튼, 안내 문구가 이어진다.
    const end = rest.search(/<div\b[^>]*class=["'][^"']*(?:view_bottom|btn_wrap|info_guide_wrap)|<\/form\s*>|<!--\s*\/\/\s*content\s*-->/i);
    body = end >= 0 ? rest.slice(0, end) : rest;
  }
  const meta = /class=["'][^"']*view_top[^"']*["'][^>]*>([\s\S]*?)class=["'][^"']*view_cont/i.exec(html)?.[1] ?? "";
  const written = /작성일\s*(\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})/.exec(inlineText(meta));
  return {
    title: titleHtml ? inlineText(titleHtml[1]) : "",
    date: written ? isoDate(written[1]) : isoDate(inlineText(meta.replace(titleHtml?.[0] ?? "", " "))),
    text: truncate(htmlToText(body), NOTICE_TEXT_LIMIT),
  };
}

const listCache = new TtlCache<NoticeListResponse>(NOTICE_TTL_MS, 100);
const detailCache = new TtlCache<KookminNoticeDetail>(NOTICE_TTL_MS, 200);

export function clearNoticeCache(): void {
  listCache.clear();
  detailCache.clear();
}

export interface NoticeOptions {
  now?: Date;
  fetcher?: typeof fetch;
}

export async function getNotices(board: KookminBoard, page = 1, options: NoticeOptions = {}): Promise<NoticeListResponse> {
  const now = options.now ?? new Date();
  const key = `${board}:${page}`;
  const hit = listCache.fresh(key, now.getTime());
  if (hit) return hit;
  try {
    const response = await fetchText(noticeListUrl(board, page), { fetcher: options.fetcher });
    const items = parseNoticeList(response.text, board);
    const paging = parseNoticePaging(response.text);
    if (!items.length && !paging && !/board_list/.test(response.text)) throw new Error("notice layout changed");
    // 범위를 넘는 쪽을 요청하면 사이트가 다른 쪽을 대신 보여 줄 수 있어 빈 목록으로 돌려준다.
    const beyond = paging !== null && (page > paging.totalPages || paging.page !== page);
    const value: NoticeListResponse = {
      items: beyond ? [] : items,
      board,
      page,
      hasMore: paging ? !beyond && page < paging.totalPages : items.length >= 10,
      fetchedAt: now.toISOString(),
    };
    listCache.set(key, value, now.getTime());
    return value;
  } catch {
    const stale = listCache.stale(key);
    if (stale) return stale;
    throw new RouteError(502, NOTICE_ERROR);
  }
}

/** 목록에서 이미 본 글이면 원래 게시판 번호가 들어 있는 주소를 그대로 쓴다. */
function knownNotice(board: KookminBoard, articleNo: string): KookminNotice | undefined {
  for (const list of listCache.values()) {
    if (list.board !== board) continue;
    const found = list.items.find((item) => item.articleNo === articleNo);
    if (found) return found;
  }
  return undefined;
}

export async function getNoticeDetail(board: KookminBoard, articleNo: string, options: NoticeOptions = {}): Promise<KookminNoticeDetail> {
  const now = options.now ?? new Date();
  const key = `${board}:${articleNo}`;
  const hit = detailCache.fresh(key, now.getTime());
  if (hit) return hit;
  const listed = knownNotice(board, articleNo);
  const url = listed?.url ?? noticeDetailUrl(BOARD_NUMBERS[board] || FALLBACK_BOARD_NUMBER, articleNo);
  let parsed: ParsedNoticeDetail | null;
  try {
    parsed = parseNoticeDetail((await fetchText(url, { fetcher: options.fetcher })).text);
  } catch {
    const stale = detailCache.stale(key);
    if (stale) return stale;
    throw new RouteError(502, NOTICE_ERROR);
  }
  // 없는 글 번호도 200으로 응답하지만 본문 영역이 없다.
  if (!parsed || (!parsed.title && !parsed.text)) throw new RouteError(404, NOTICE_NOT_FOUND);
  const item: KookminNoticeDetail = {
    id: `kmu-notice-${board}-${articleNo}`,
    board,
    articleNo,
    title: parsed.title || listed?.title || "제목 없는 공지",
    date: parsed.date || listed?.date || "",
    url,
    text: parsed.text,
  };
  detailCache.set(key, item, now.getTime());
  return item;
}

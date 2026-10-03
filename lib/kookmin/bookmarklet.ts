// eCampus 북마클릿과 그 결과(URL 해시)를 다루는 모듈.
// 화면(클라이언트)에서도 불러오므로 node 모듈을 쓰지 않는다.
import { z } from "zod";
import type { BookmarkletPayload } from "../contracts";
import { DUE_SUFFIX_SOURCE } from "./text";

export const BOOKMARKLET_HASH_KEY = "kmu-import";
export const BOOKMARKLET_MAX_ITEMS = 200;
const ECAMPUS_HOST = "ecampus.kookmin.ac.kr";
const MAX_ENCODED_LENGTH = 200_000;
// 북마클릿이 해시에 싣는 최대 길이. 브라우저 주소 길이 제한보다 충분히 작게 잡는다.
const MAX_HASH_LENGTH = 60_000;

export class BookmarkletPayloadError extends Error {
  constructor() {
    super("eCampus에서 보낸 데이터를 읽지 못했습니다. eCampus에서 북마클릿을 다시 실행해 주세요.");
    this.name = "BookmarkletPayloadError";
  }
}

function ecampusUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === ECAMPUS_HOST ? url.href : null;
  } catch {
    return null;
  }
}

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
});

const assignmentSchema = z.object({
  uid: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(200),
  course: z.string().trim().max(200).nullable().transform((value) => value || null),
  date: calendarDate,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  description: z.string().max(2000).nullable().transform((value) => value || null),
  // 해시는 누구나 만들어 보낼 수 있다. eCampus가 아닌 링크는 버린다.
  url: z.string().max(2000).nullable().transform(ecampusUrl),
});

export const bookmarkletPayloadSchema = z.object({
  v: z.literal(1),
  source: z.literal("ecampus-bookmarklet"),
  exportedAt: z.string().min(1).max(40).refine((value) => Number.isFinite(new Date(value).getTime())),
  items: z.array(assignmentSchema).max(BOOKMARKLET_MAX_ITEMS),
});

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** 북마클릿과 같은 방식(UTF-8 → base64url)으로 payload를 인코딩한다. */
export function encodeBookmarkletPayload(payload: BookmarkletPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

/** `location.hash`에서 북마클릿 값만 꺼낸다. 북마클릿 해시가 아니면 null. */
export function readBookmarkletHash(hash: string): string | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  const prefix = `${BOOKMARKLET_HASH_KEY}=`;
  return value.startsWith(prefix) ? value.slice(prefix.length).split("&")[0] : null;
}

/**
 * 해시 값(base64url)을 payload로 되돌린다. `#kmu-import=…` 전체를 넘겨도 된다.
 * 형식이 다르면 BookmarkletPayloadError를 던진다.
 */
export function decodeBookmarkletPayload(hashValue: string): BookmarkletPayload {
  const value = (readBookmarkletHash(hashValue.trim()) ?? hashValue.trim().replace(/^#/, "")).trim();
  // 패딩(=)은 끝에 두 글자까지만 받는다. 누구나 만들 수 있는 값이라 느린 정규식 입력을 미리 막는다.
  if (!value || value.length > MAX_ENCODED_LENGTH || !/^[A-Za-z0-9_\-+/]+={0,2}$/.test(value)) throw new BookmarkletPayloadError();
  let json: unknown;
  try {
    json = JSON.parse(fromBase64Url(value));
  } catch {
    throw new BookmarkletPayloadError();
  }
  const parsed = bookmarkletPayloadSchema.safeParse(json);
  if (!parsed.success) throw new BookmarkletPayloadError();
  return parsed.data;
}

function normalizeOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("북마클릿을 만들 앱 주소가 올바르지 않습니다.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("북마클릿을 만들 앱 주소가 올바르지 않습니다.");
  return url.origin;
}

// 읽기 쉬운 원본. 줄 앞뒤 공백을 지우고 이어 붙이기만 하므로
// 모든 문장은 세미콜론으로 끝내고 `//` 주석과 백틱은 쓰지 않는다.
function bookmarkletSource(appOrigin: string): string {
  return String.raw`(()=>{
  const APP = ${JSON.stringify(appOrigin)};
  const HOST = ${JSON.stringify(ECAMPUS_HOST)};
  const KEY = ${JSON.stringify(BOOKMARKLET_HASH_KEY)};
  const LOGIN = "eCampus에 로그인한 뒤 다시 실행해 주세요.";
  const say = (message) => { alert("[캠퍼스 비서] " + message); };
  const run = async () => {
    if (location.hostname !== HOST) {
      say("국민대 eCampus(" + HOST + ")에 로그인한 화면에서 실행해 주세요.");
      return;
    }
    const cfg = window.M && window.M.cfg;
    if (!cfg || !cfg.sesskey) {
      say(LOGIN);
      return;
    }
    const root = cfg.wwwroot || location.origin;
    const pad = (value) => (value < 10 ? "0" : "") + value;
    const kst = (seconds) => {
      const d = new Date((seconds + 32400) * 1000);
      return {
        date: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()),
        time: pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes())
      };
    };
    const plain = (html) => {
      const area = document.createElement("textarea");
      area.innerHTML = String(html || "");
      return area.value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    };
    const suffix = new RegExp(${JSON.stringify(DUE_SUFFIX_SOURCE)}, "i");
    const clean = (text) => {
      const title = plain(text);
      return (title.replace(suffix, "").trim() || title).slice(0, 200);
    };
    const link = (value) => {
      try {
        const url = new URL(value, root);
        return url.protocol === "https:" && url.hostname === HOST ? url.href.slice(0, 2000) : null;
      } catch (error) {
        return null;
      }
    };
    let items = [];
    const seen = {};
    const add = (id, title, course, date, time, url) => {
      const uid = id + "@" + HOST;
      if (!id || !title || !date || seen[uid]) {
        return;
      }
      seen[uid] = true;
      items.push({ uid: uid, title: title, course: course || null, date: date, time: time, description: null, url: url });
    };
    try {
      const method = "core_calendar_get_action_events_by_timesort";
      const response = await fetch(root + "/lib/ajax/service.php?sesskey=" + encodeURIComponent(cfg.sesskey) + "&info=" + method, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ index: 0, methodname: method, args: { limitnum: 50, timesortfrom: Math.floor(Date.now() / 1000) } }])
      });
      const result = await response.json();
      const failure = result && result[0] && result[0].error ? result[0].exception || {} : null;
      if (failure && /requires?login/i.test(String(failure.errorcode))) {
        say(LOGIN);
        return;
      }
      if (!result || !result[0] || failure || !result[0].data || !Array.isArray(result[0].data.events)) {
        throw new Error("ajax");
      }
      result[0].data.events.forEach((event) => {
        const seconds = Number(event.timesort || event.timestart);
        if (!seconds) {
          return;
        }
        const when = kst(seconds);
        const course = event.course ? plain(event.course.fullname || event.course.shortname).slice(0, 200) : "";
        add(event.id, clean(event.name), course, when.date, when.time, link((event.action && event.action.url) || event.url));
      });
    } catch (error) {
      items = [];
      const page = await fetch(root + "/calendar/view.php?view=upcoming", { credentials: "same-origin" });
      if (page.redirected && /\/login\//.test(String(page.url))) {
        say(LOGIN);
        return;
      }
      const doc = new DOMParser().parseFromString(await page.text(), "text/html");
      doc.querySelectorAll("[data-event-id], .event").forEach((node) => {
        const heading = node.querySelector(".name, h3");
        const day = node.querySelector("a[href*='view=day']");
        const stamp = day ? /[?&]time=(\d+)/.exec(day.getAttribute("href") || "") : null;
        if (!stamp) {
          return;
        }
        const row = day.closest(".row, .description") || node;
        const clock = /(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec((row.textContent || "").replace(/\s+/g, " "));
        let time = null;
        if (clock) {
          const mark = (clock[1] || clock[4] || "").toUpperCase();
          let hour = Number(clock[2]);
          if ((mark === "PM" || mark === "오후") && hour < 12) {
            hour += 12;
          }
          if ((mark === "AM" || mark === "오전") && hour === 12) {
            hour = 0;
          }
          if (hour < 24) {
            time = pad(hour) + ":" + clock[3];
          }
        }
        const courseLink = node.querySelector("a[href*='/course/view.php']");
        const moduleLink = node.querySelector("a[href*='/mod/']");
        add(
          node.getAttribute("data-event-id"),
          clean(node.getAttribute("data-event-title") || (heading ? heading.textContent : "")),
          courseLink ? plain(courseLink.textContent).slice(0, 200) : "",
          kst(Number(stamp[1])).date,
          time,
          moduleLink ? link(moduleLink.getAttribute("href")) : null
        );
      });
    }
    if (!items.length) {
      say("앞으로 예정된 과제·일정을 찾지 못했습니다.");
      return;
    }
    const encode = (list) => {
      const json = JSON.stringify({ v: 1, source: "ecampus-bookmarklet", exportedAt: new Date().toISOString(), items: list });
      return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    let data = encode(items);
    while (data.length > ${MAX_HASH_LENGTH} && items.length > 1) {
      items.pop();
      data = encode(items);
    }
    const target = APP + "/#" + KEY + "=" + data;
    const opened = window.open(target, "_blank");
    if (opened) {
      opened.opener = null;
    } else {
      location.href = target;
    }
  };
  run().catch(() => {
    say("과제 일정을 가져오지 못했습니다. eCampus에 로그인되어 있는지 확인한 뒤 다시 실행해 주세요.");
  });
})();`;
}

/** 북마클릿 본문(JS 코드). 앱 주소만 넣어 만든 자체 완결 코드이며 외부 스크립트를 부르지 않는다. */
export function buildBookmarkletCode(origin: string): string {
  return bookmarkletSource(normalizeOrigin(origin)).split("\n").map((line) => line.trim()).filter(Boolean).join("");
}

/**
 * 북마크바에 끌어다 놓을 `javascript:` 주소.
 * 브라우저는 실행 전에 퍼센트 인코딩을 풀기 때문에 한글·따옴표·`%`·`#`은 인코딩해 둔다.
 */
export function buildBookmarklet(origin: string): string {
  const encoded = encodeURIComponent(buildBookmarkletCode(origin))
    .replace(/%(3D|3E|7B|7D|3B|2C|3A|2F|5B|5D|2B|7C|3F|24|40)/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return `javascript:${encoded}`;
}

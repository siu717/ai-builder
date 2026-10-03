import { z } from "zod";
import type { EcampusAssignment } from "../contracts";
import { RouteError } from "../http";
import { fetchText } from "./http";
import { IcsFormatError, parseIcs } from "./ics";

export const ECAMPUS_HOST = "ecampus.kookmin.ac.kr";
export const ECAMPUS_EXPORT_PATH = "/calendar/export_execute.php";

const INVALID_URL = "주소 형식이 올바르지 않습니다. eCampus 달력 내보내기 URL을 그대로 붙여 넣어 주세요.";
const NOT_ECAMPUS = "국민대 eCampus 달력 내보내기 주소가 아닙니다. https://ecampus.kookmin.ac.kr/calendar/export_execute.php 로 시작하는 URL만 사용할 수 있습니다.";
const FETCH_FAILED = "eCampus 달력을 가져오지 못했습니다. 로그인이 필요하거나 만료된 링크일 수 있습니다. eCampus에서 달력 내보내기 URL을 다시 만들어 주세요.";
const NOT_ICS = "ICS(iCalendar) 형식이 아닙니다. BEGIN:VCALENDAR로 시작하는 달력 내용을 붙여 넣어 주세요.";
const ONE_INPUT = "eCampus 달력 URL과 ICS 내용 중 하나만 입력해주세요.";

export const ecampusPreviewSchema = z.object({
  url: z.string().trim().min(1, ONE_INPUT).max(2000, INVALID_URL).optional(),
  ics: z.string().min(1, ONE_INPUT).max(2_000_000, "ICS 내용이 너무 깁니다.").optional(),
}).strict().refine((input) => (input.url === undefined) !== (input.ics === undefined), ONE_INPUT);

export interface EcampusPreview {
  items: EcampusAssignment[];
  calendarName: string | null;
  fetchedAt: string;
}

/**
 * SSRF 방어. https, 정확한 eCampus 호스트, 달력 내보내기 경로만 허용하고
 * 확인한 구성요소로 주소를 다시 조립한다.
 */
export function normalizeEcampusExportUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new RouteError(400, INVALID_URL);
  }
  const allowed = url.protocol === "https:"
    && url.hostname === ECAMPUS_HOST
    && url.port === ""
    && !url.username
    && !url.password
    && url.pathname === ECAMPUS_EXPORT_PATH
    && Boolean(url.searchParams.get("userid"))
    && Boolean(url.searchParams.get("authtoken"));
  if (!allowed) throw new RouteError(400, NOT_ECAMPUS);
  return `https://${ECAMPUS_HOST}${ECAMPUS_EXPORT_PATH}${url.search}`;
}

function parseCalendar(text: string, status: number, message: string): Omit<EcampusPreview, "fetchedAt"> {
  try {
    return parseIcs(text);
  } catch (error) {
    if (error instanceof IcsFormatError) throw new RouteError(status, message);
    throw error;
  }
}

export interface EcampusPreviewOptions {
  now?: Date;
  fetcher?: typeof fetch;
}

/**
 * 개인 달력 URL 또는 붙여 넣은 ICS에서 과제 목록을 미리 본다.
 * URL과 토큰은 저장하지도, 로그에 남기지도, 캐시하지도 않는다.
 */
export async function previewEcampus(input: unknown, options: EcampusPreviewOptions = {}): Promise<EcampusPreview> {
  const checked = ecampusPreviewSchema.safeParse(input);
  if (!checked.success) {
    const message = checked.error.issues[0]?.message || "";
    // 형식 오류는 zod 기본 문구(영문)라서 한국어 안내로 바꾼다.
    throw new RouteError(400, /[가-힣]/.test(message) ? message : ONE_INPUT);
  }
  const parsed = checked.data;
  const fetchedAt = (options.now ?? new Date()).toISOString();
  if (parsed.ics !== undefined) return { ...parseCalendar(parsed.ics, 400, NOT_ICS), fetchedAt };
  const target = normalizeEcampusExportUrl(parsed.url ?? "");
  let text: string;
  try {
    // 리디렉션은 따라가지 않는다. 로그인 화면이나 다른 호스트로 넘어가는 응답은 실패로 본다.
    text = (await fetchText(target, { accept: "text/calendar, text/plain;q=0.8", timeoutMs: 15_000, maxBytes: 2_000_000, redirect: "manual", fetcher: options.fetcher })).text;
  } catch {
    throw new RouteError(502, FETCH_FAILED);
  }
  // 토큰이 틀리면 eCampus는 200과 함께 `Invalid authentication`이라는 글자만 돌려준다.
  return { ...parseCalendar(text, 502, FETCH_FAILED), fetchedAt };
}

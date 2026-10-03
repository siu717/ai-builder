import { loadEnvConfig } from "@next/env";
import { closeDatabase, getSharedDatabase } from "../lib/db";
import { processDueReminders } from "../lib/reminder-worker";
import { forEachAnonymousDatabase, isAnonymousPublicMode, processAnonymousReminders } from "../lib/anonymous-session";
import { collectScholarships, getNotices, syncScholarshipEvents } from "../lib/scholarships";

loadEnvConfig(process.cwd());

let stopping = false;
let wake: (() => void) | undefined;
let collection: Promise<unknown> | undefined;
let lastSync = 0;
// 자동 등록은 1분마다 맞춘다. 공지 수집 주기(30분)는 collection_state가 관리한다.
const SYNC_INTERVAL_MS = 60_000;

async function scholarships() {
  const shared = await getSharedDatabase();
  // 수집은 1분 이상 걸릴 수 있어 알림 처리를 막지 않도록 따로 진행한다.
  if (process.env.SCHOLARSHIP_CRAWLER_ENABLED !== "false" && !collection) {
    collection = collectScholarships({ database: shared })
      .catch(() => console.error("국민대 장학공지 수집에 실패했습니다. 다음 주기에 재시도합니다."))
      .finally(() => { collection = undefined; });
  }
  if (Date.now() - lastSync < SYNC_INTERVAL_MS) return;
  lastSync = Date.now();
  const notices = await getNotices(shared);
  if (isAnonymousPublicMode()) await forEachAnonymousDatabase((database) => syncScholarshipEvents(notices, database));
  else await syncScholarshipEvents(notices, shared);
}

function stop() {
  stopping = true;
  wake?.();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main() {
  console.info("캠퍼스 비서 알림 워커 실행 중 (5초 간격) · 국민대 장학공지 30분 간격 수집");
  while (!stopping) {
    try {
      if (isAnonymousPublicMode()) await processAnonymousReminders();
      else await processDueReminders();
    } catch {
      console.error("알림 워커가 처리에 실패했습니다. 다음 주기에 재시도합니다.");
    }
    try {
      await scholarships();
    } catch {
      console.error("장학공지 자동 등록에 실패했습니다. 다음 주기에 재시도합니다.");
    }
    if (!stopping) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { wake = undefined; resolve(); }, 5000);
        wake = () => { clearTimeout(timeout); wake = undefined; resolve(); };
      });
    }
  }
  await collection;
  await closeDatabase();
}

void main().catch(() => {
  console.error("알림 워커를 종료했습니다.");
  process.exitCode = 1;
});

import { loadEnvConfig } from "@next/env";
import { closeDatabase } from "../lib/db";
import { processDueReminders } from "../lib/reminder-worker";
import { isAnonymousPublicMode, processAnonymousReminders } from "../lib/anonymous-session";

loadEnvConfig(process.cwd());

let stopping = false;
let wake: (() => void) | undefined;

function stop() {
  stopping = true;
  wake?.();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main() {
  console.info("캠퍼스 비서 알림 워커 실행 중 (5초 간격)");
  while (!stopping) {
    try {
      if (isAnonymousPublicMode()) await processAnonymousReminders();
      else await processDueReminders();
    } catch {
      console.error("알림 워커가 처리에 실패했습니다. 다음 주기에 재시도합니다.");
    }
    if (!stopping) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { wake = undefined; resolve(); }, 5000);
        wake = () => { clearTimeout(timeout); wake = undefined; resolve(); };
      });
    }
  }
  await closeDatabase();
}

void main().catch(() => {
  console.error("알림 워커를 종료했습니다.");
  process.exitCode = 1;
});

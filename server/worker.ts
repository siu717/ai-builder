import { loadEnvConfig } from "@next/env";
import { closeDatabase } from "../lib/db";
import { processDueReminders } from "../lib/reminder-worker";
import { syncAllSources } from "../lib/import-store";

loadEnvConfig(process.cwd());

let stopping = false;
let importing: Promise<void> | null = null;
let lastImportCheck = 0;

// 수집은 네트워크를 기다리므로 알림 처리와 별도로 돌린다. 주기는 IMPORT_INTERVAL_MINUTES(기본 6시간).
function syncImports() {
  if (importing || Date.now() - lastImportCheck < 60_000) return;
  lastImportCheck = Date.now();
  importing = syncAllSources({ onlyDue: true })
    .then((results) => {
      for (const result of results) {
        console.info(result.error ? `자동 수집 실패 · ${result.name}: ${result.error}` : `자동 수집 · ${result.name}: ${result.found}건, 일정 ${result.added}건 등록`);
      }
    })
    .catch(() => console.error("자동 수집에 실패했습니다. 다음 주기에 재시도합니다."))
    .finally(() => { importing = null; });
}
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
      await processDueReminders();
      syncImports();
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
  await importing;
  await closeDatabase();
}

void main().catch(() => {
  console.error("알림 워커를 종료했습니다.");
  process.exitCode = 1;
});

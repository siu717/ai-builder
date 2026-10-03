import { loadEnvConfig } from "@next/env";
import { closeDatabase } from "../lib/db";
import { collectScholarships } from "../lib/scholarships";
loadEnvConfig(process.cwd());
async function main() {
  try {
    const result = await collectScholarships();
    console.info(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally { await closeDatabase(); }
}
void main().catch(() => { console.error("장학공지 수집을 시작하지 못했습니다."); process.exitCode = 1; });

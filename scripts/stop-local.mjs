import { stopRecordedServices } from "./local-service-record.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run") || args.filter((arg) => arg === "--dry-run").length > 1) {
  console.error("用法：npm run stop:all [-- --dry-run]");
  process.exitCode = 2;
} else {
  const result = await stopRecordedServices({ dryRun: args.includes("--dry-run") });
  if (result.stopped.length === 0) console.log("没有发现经身份核验的本项目进程。");
  else if (args.includes("--dry-run")) console.log(`将关闭 ${result.stopped.map(({ name, pid, port }) => `${name} (PID ${pid}, 端口 ${port})`).join("、")}。`);
  else console.log(`已关闭 ${result.stopped.map(({ name }) => name).join("、")}。`);
  if (result.skipped.length) console.warn(`已安全清理 ${result.skipped.length} 条过期或身份不匹配的记录，未向这些 PID 发送信号。`);
}

// `pnpm home:check`：校验家目录结构是否符合交互 harness 协议（只读）。
import { checkHome } from "./home-check.ts";
import { resolveHome } from "./home.ts";

const home = resolveHome();
const report = await checkHome(home);
console.log(`家目录：${home}（检查 ${report.checked} 个结构单元）`);
for (const warning of report.warnings) console.log(`  警告  ${warning}`);
for (const error of report.errors) console.log(`  错误  ${error}`);
if (report.errors.length === 0) {
  console.log("结构符合协议。");
} else {
  console.log(`不符合协议：${report.errors.length} 处错误。`);
  process.exit(1);
}

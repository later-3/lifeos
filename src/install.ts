// `pnpm home:install` 的命令行入口：只做安装与报告——安装是安装，启动是启动（main.ts 只校验）。
// 单独成文件的原因：home.ts 会被打进 dist/server.mjs，CLI 逻辑放库里会在打包后守卫失效、跟着服务启动执行。
import { installHome, resolveHome } from "./home.ts";

const home = resolveHome();
try {
  const result = await installHome(process.cwd(), home);
  if (result.status === "exists") {
    console.error(`家目录已存在，安装未做任何改动：${home}`);
    console.error("若要重新安装，请先自行确认并清理该目录后重试。");
    process.exit(1);
  }
  console.log(`家目录已安装：${home}（模板 ${".lifeos"}/，共 ${result.items.length} 项）`);
  for (const item of result.items) console.log(`  ${item.path}`);
} catch (error) {
  console.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// Prism 语言 grammar 的类型声明（`prismjs/components/*` 没有官方类型）。
//
// 依据：difit `src/types/prism-components.d.ts` 同样的做法——这些文件是**副作用注册**
// （import 之后往 `Prism.languages` 上挂 grammar），没有可用的导出类型，
// 声明成 `unknown` 比到处 `any` 诚实（本项目禁止 any，`pnpm typecheck` 会拦）。
declare module "prismjs/components/*" {
  const value: unknown;
  export = value;
}

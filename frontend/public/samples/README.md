# 示例图（S1 内容流桩卡用）

这 12 张是**桩卡里的图片**，不是用户数据，也不是产品素材。

## 为什么是下载进仓库的文件，而不是运行时外链

1. **视觉基线会锁坏**：外链图带随机性时，截图基线每次都不一样（`test:visual` / `test:ui` 全红）。
2. **离线 / CI 会红**：断网环境下卡片没有图，断言 `naturalWidth > 0` 直接失败。
3. **同 origin 无跨域**：避免 CORS 与 `crossorigin` 属性差异导致的 canvas/尺寸读取问题。
4. **换图不被浏览器缓存钉住**：文件名固定、内容固定 → 缓存命中是**好事**；
   若用外链，imgix 之类的 URL 参数一变就换图，基线随之漂。

## 来源与规格

- 来源：**Lorem Picsum 固定 id**（`https://picsum.photos/id/<n>/800/450.jpg`），
  id 与文件名一一对应，全部 **800×450（16:9）**、总计 **860 KB（≤1MB）**；
- 文件名固定（`mountains.jpg` / `canyon.jpg` / `forest.jpg` / `lake.jpg` / `bird.jpg` /
  `dog.jpg` / `waterfall.jpg` / `night.jpg` / `peaks.jpg` / `valley.jpg` / `beach.jpg` / `snow.jpg`），
  `workbench-fixtures.ts` 的 `media[].url` 直接指向 `/samples/<name>.jpg`；
- 16:9 与卡片契约 §4 的 `aspect-ratio: 16/9` 同比例，**不需要再看图片原始尺寸**去算布局。

## 什么时候删

S2 接入真接口（`GET /api/feed`）后，这些图随 `workbench-fixtures.ts` 的桩一起删
（`grep -rn "public/samples" frontend/` 应归零）。

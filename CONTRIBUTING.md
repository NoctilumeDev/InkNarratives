# Contributing

InkNarratives 目前处于个人设计实验阶段。参与前请同时阅读 [社区行为准则](./CODE_OF_CONDUCT.md)。提交修改时，请保持每次变更的目的单一，并说明它解决的是内容、结构、视觉、交互、可访问性、发布还是文档问题。

## 基本约束

- 页面语言使用 `zh-CN`，文件编码使用 UTF-8。
- 不为统一而强行抽象。只有两个以上页面出现稳定、同语义的共享实现时，才考虑提取公共代码。
- 不引入仅用于装饰的远程依赖、字体 CDN 或不可追溯素材。
- 动效必须尊重 `prefers-reduced-motion`。
- 新增人物事实、年表、引文或作品归属时，应在页面或配套文档中注明来源。
- 视觉实验不得破坏键盘操作、可读对比度、语义标题层级和移动端布局。
- `<main>` 或显式 `data-content-revision-scope` 内的可读正文发生实质变化时，必须同步更新 `content-revised`、展厅日期和 `docs/content-revisions.json`；只改 CSS、JavaScript、注释、部署或 URL 时不得冒进正文修订日期。

## 本地检查

```powershell
node scripts/verify-repository.mjs
```

此外应至少在一个桌面视口和一个窄屏视口中打开修改后的页面，并检查控制台、键盘焦点、横向溢出与减少动效模式。

提交 Pull Request 时，请列出实际执行的命令、视口与结果，并明确哪些事实没有验证。不要把视觉完成度写成内容已经校勘，也不要把 Prototype 扩大为生产模板或数字人文定稿。

# InkNarratives / 墨叙

中文文学主题的交互叙事前端实验集。五件作品各自保留独立的视觉语法，由一个克制的在线展厅负责索引，而不是被压成同一套模板。

> **Status: Prototype.** 页面可以运行，但不是组件库、生产模板或已经完成学术校勘的数字人文成果。

合并到 `main` 并完成 GitHub Pages 部署后，可从 [墨叙在线展厅](https://noctilumedev.github.io/InkNarratives/) 进入全部作品。

## 作品

| 作品 | 方向 | 稳定入口 | 当前阶段 |
| --- | --- | --- | --- |
| 暗室·藏书 | 暗室空间、灯光与滚动显影 | [`works/darkroom/`](./works/darkroom/) | 空间交互实验 |
| 乐章集 | 《乐章集》式柳永人物长页 | [`works/liuyong/`](./works/liuyong/) | 结构原型 |
| 苏轼生平全记录 | 生平、作品与章节化长文 | [`works/sushi/`](./works/sushi/) | 内容主参考 |
| 空山见王维 | 山水意象与人物编年 | [`works/wangwei/`](./works/wangwei/) | 编辑设计实验 |
| 夜航船 | 夜航、宣纸与连续场景 | [`works/night-voyage/`](./works/night-voyage/) | 滚动叙事实验 |

原有的 `暗室.html`、`柳永.html`、`苏轼.html`、`王维.html`、`长卷.html` 继续作为兼容入口，自动转向上述稳定英文路径，避免已有书签断链。

## 设计与工程边界

- 中文标题、正文和界面文案是作品的一部分，不需要改成英文。
- 五件作品仍是独立、零依赖的 HTML 页面；统一展厅不向作品注入共享运行时。
- 共享层只承担目录、公开 URL、预览图和发布，不抹平每件作品自己的视觉节奏。
- 人物生平与作品内容仍需补齐资料来源、编辑说明和事实核验；视觉完整度不等于内容可靠性。
- 展厅预览图来自作品在本地浏览器中的真实渲染，不是重新绘制的封面。

## 本地运行

在仓库根目录启动任意静态文件服务器：

```powershell
python -m http.server 8080
```

访问 `http://localhost:8080/` 查看展厅，也可直接打开任意 `works/*/index.html`。直接使用 `file://` 打开作品通常也能运行，但静态服务器更接近 GitHub Pages 的路径与资源行为。

## 正文修订时间

展签上的“正文修订”不是 HTML 文件的最后修改时间。它只在作品 `<main>` 内的可读文本发生实质变化时推进；CSS、JavaScript、响应式、部署和 URL 修复不改变该日期。

仓库通过规范化后的正文 SHA-256 同时校验作品元数据、展厅日期与修订清单，防止样式维护误写内容历史，也防止正文改动漏记日期。完整规则见 [正文修订时间契约](./docs/content-revision-policy.md)，机器可读基线见 [`docs/content-revisions.json`](./docs/content-revisions.json)。

## 质量门禁

运行：

```powershell
node scripts/verify-repository.mjs
```

校验覆盖：

- 展厅、404、五件作品、预览图、稳定路径和旧入口是否完整；
- HTML 基础语义、标题层级、重复 ID、内联事件与本地链接；
- 页面是否偷偷引入远程运行依赖；
- 正文修订日期与规范化文本指纹是否一致；
- GitHub Pages 发布所需文件是否齐备。

2026-08-08 的桌面端 `1440x960` 与移动端 `390x844` 基线见 [质量基线](./docs/quality-baseline.md)，后续文章结构见 [编辑骨架](./docs/editorial-structure.md)。自动化结果不能替代键盘、屏幕阅读器、动效舒适度和内容事实的人工验收。

## 发布

`.github/workflows/pages.yml` 只发布展厅、404、兼容入口、作品与静态资源。每次 `main` 更新先执行仓库校验，通过后才上传不可变 Pages artifact 并部署；仓库文档、脚本和内部配置不会混入公开站点。

## 贡献与许可

修改前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。代码与仓库原创内容按 [Apache License 2.0](./LICENSE) 发布；引用的古典文学原文仍归属于其原作者及相应公共领域来源。

# mo-book

记录 Mo（一个最小的 AI 编程助手）从零搭建过程的电子书。
主题：**如何一步一步搭建属于自己的 code agent**——不依赖 LangChain / Vercel AI SDK，
只用 TypeScript、Node.js 和原生 fetch。

## 文件

| 文件 | 说明 |
| --- | --- |
| `manuscript.md` | 书稿（Markdown 源文件，可读、可版本化、可在 GitHub 直接看） |
| `lib/book.mjs` | 共享 Markdown 解析（EPUB 与网页站共用） |
| `build.mjs` | 构建脚本：Markdown → XHTML → EPUB（零依赖，用 macOS 自带 `zip`） |
| `build-site.mjs` | 构建脚本：生成 `docs/` 静态阅读站（GitHub Pages） |
| `docs/` | 生成的在线阅读站（GitHub Pages 发布源） |
| `build/mo-book.epub` | 生成的电子书，可直接导入 Apple Books / Kindle / 其他阅读器 |

## 在线阅读

**https://abupeiyong.github.io/mo-book/**（GitHub Pages，自动从 `main` 分支的 `docs/` 发布）

## 构建

```bash
node build.mjs        # 重新生成 build/mo-book.epub
node build-site.mjs   # 重新生成 docs/ 在线阅读站
```

## 内容结构

1. 前言：为什么你要亲手写一个 agent
2. 第 1 章 全景：一个 code agent 的最小组成
3. 第 2 章 Milestone 1：跑通最小 agent loop（model / tools / agent / CLI）
4. 第 3 章 Milestone 2：让 agent 可控地修改自己的代码（edit_file / search_files / 路径边界 / 自修改实录）
5. 第 4 章 经验与教训（双人审查、测试盲区、安全边界诚实声明）
6. 附录 A：完整代码 · 附录 B：命令与验收清单

## 素材来源

- 代码仓库：[github.com/abupeiyong/mo](https://github.com/abupeiyong/mo)（Milestone 1 + 2）
- 书稿中的代码与真实仓库保持同步；附录 A 为里程碑 2 完成时的全量源码

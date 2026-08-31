# 从零搭建你自己的 Code Agent

## Mo 开发实录：一个最小 AI 编程助手的两步诞生记

——不依赖 LangChain、不依赖 Vercel AI SDK，只用 TypeScript、Node.js 和原生 fetch，
从第一行代码开始，理解并掌控 agent 的核心循环。

---

**peiyong · 2026**

---

# 前言：为什么你要亲手写一个 agent

如果你正在读这本书，大概率你已经在用 Claude Code、Codex、Cursor 或类似的 AI 编程助手。
它们很强大，但对你来说是一个黑盒：提示词是怎么拼的？工具是怎么调用的？循环是怎么终止的？
为什么它会突然犯低级错误？

**亲手写一个最小的 agent，是理解这一切的最好方式。**

Mo 是一个只有几百行 TypeScript 的小项目，目标是：

- 理解并掌控 agent 核心循环，而不是依赖 LangChain 这类框架
- 保持足够小，让一个人能在一次坐下读完整个代码库
- 不引入任何 agent 框架、不引入任何运行时依赖
- 最终让 Mo 能够修改自己的源代码

本书记录 Mo 两个里程碑的完整开发过程。**Milestone 1** 是让最小工具调用循环跑通：
CLI 接收 prompt → 发给 OpenAI 兼容 API → 模型调用工具 → 本地执行 → 结果回填 →
循环直到模型给出最终答案。**Milestone 2** 是可控的自修改：给 Mo 加上"定位代码"
（search_files）和"精确修改代码"（edit_file）的能力，并让路径边界、唯一匹配语义
和测试保证它不会乱改东西。

在开发过程中发生了很多值得写下来的事：模型在自修改时引入了 ESM 的坑又自己修好、
审查者发现了一个真实的符号链接逃逸漏洞、"测试全绿但入口是坏的"这类经典盲区。
这些故事比任何框架教程都更能教会你 agent 工程。

本书不是理论书。每一章都对应真实存在的代码，附录里有完整的源码。
你可以一边读一边把代码跑起来。

---

# 第 1 章 全景：一个 code agent 的最小组成

在写任何代码之前，先想清楚：一个 AI 编程助手，最小需要哪些零件？

## 1.1 核心循环

所有 agent 框架的本质都是同一个循环：

```text
用户 prompt
    ↓
模型
    ↓
有工具调用？
 ┌── 是 → 执行工具 → 结果追加回消息 → 再问模型
 │
 └── 否 → 打印最终答案 → 退出
```

看起来简单，但每一步都有值得琢磨的细节：

- **模型**：怎么调用？用什么协议？怎么把工具定义发给它？
- **工具**：模型发来"调用请求"，本地怎么执行？参数怎么校验？失败怎么办？
- **循环**：工具结果怎么回填给模型？消息历史怎么维护？什么时候终止？怎么防止死循环？
- **边界**：用户输入怎么进来？最终答案怎么出去？API 地址、密钥、模型名怎么配置？

## 1.2 四个零件

我们把 Mo 拆成四个文件，每个文件一个职责：

| 文件 | 职责 |
| --- | --- |
| `src/model.ts` | 唯一知道 HTTP 和协议的地方：用原生 fetch 调 `/chat/completions` |
| `src/tools/` | 工具注册表 + 每个工具的实现：模型看到什么、本地执行什么 |
| `src/agent.ts` | 核心循环：维护消息历史，决定何时继续、何时终止 |
| `src/index.ts` | CLI 边界：读环境变量和命令行参数，打印最终答案 |

## 1.3 关键决策

Mo 一开始就定下的约束，每一个都是为了"保持小、可读、无框架"：

1. **OpenAI 兼容协议**。几乎所有模型厂商（OpenAI、DeepSeek、GLM、本地 Ollama……）
   都提供 OpenAI 兼容的 `/chat/completions` 接口。只认这一个协议，端点可配置，
   以后想换模型只需要改环境变量。
2. **原生 `fetch`**。Node 18+ 内置 fetch，不需要 axios。
3. **零运行时依赖**。`package.json` 的 devDependencies 只有
   `typescript`、`tsx`、`@types/node`。
4. **TypeScript + strict**。类型就是文档，尤其对于"模型返回的 JSON 是字符串"这种
   最容易出错的地方。
5. **工具失败返回文本，而不是抛异常**。模型需要看到错误来修正自己，
   抛异常会中断整个任务。

---

# 第 2 章 Milestone 1：跑通最小 agent loop

## 2.1 目标与验收

Milestone 1 的最小可用版本要满足：

1. 从命令行接受用户 prompt
2. 发送给 OpenAI 兼容的 LLM API
3. 让模型可以调用工具
4. 支持三个初始工具：`read_file`、`write_file`、`run_shell`
5. 本地执行工具调用
6. 把工具结果回填给模型
7. 循环直到模型返回最终文本
8. 把最终答案打印到终端

验收命令长这样：

```bash
MO_API_KEY=... \
MO_BASE_URL=https://api.example.com/v1 \
MO_MODEL=some-model \
npm run dev -- "read package.json and tell me the project name"
```

## 2.2 项目结构

```text
mo/
├── src/
│   ├── index.ts          # CLI 入口
│   ├── agent.ts          # 核心循环
│   ├── model.ts          # OpenAI 兼容客户端
│   └── tools/
│       ├── index.ts      # 工具注册表 + 分发器
│       ├── read-file.ts  # read_file
│       ├── write-file.ts # write_file
│       └── run-shell.ts  # run_shell
├── package.json
├── tsconfig.json
└── README.md
```

整个代码库约 250 行。这个规模是刻意为之：一个人应该能一次读完。

## 2.3 `model.ts`：用原生 fetch 说 OpenAI 的话

先定义类型，再写函数。类型先行是因为 agent 的数据流很容易出错：

```ts
// 模型看到的世界：一个工具 = OpenAI "function" 格式的 JSON Schema
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// 模型发出的调用请求：参数以 JSON 字符串形式到达
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// 消息历史上允许出现的四种角色
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
```

注意 `arguments: string`——模型返回的工具参数是 **JSON 字符串**，
执行前要自己 `JSON.parse`，这是 agent 工程里最常见的坑之一。

配置从环境变量读，三个：`MO_API_KEY`、`MO_BASE_URL`、`MO_MODEL`：

```ts
export function configFromEnv(): ModelConfig {
  return {
    apiKey: requireEnv("MO_API_KEY"),
    baseUrl: requireEnv("MO_BASE_URL").replace(/\/+$/, ""),
    model: requireEnv("MO_MODEL"),
  };
}
```

`chat()` 是唯一的 HTTP 入口：

```ts
export async function chat(
  config: ModelConfig,
  messages: Message[],
  tools: ToolDefinition[],
): Promise<AssistantMessage> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages, tools }),
  });

  if (!response.ok) {
    throw new Error(`Model API error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const message = data.choices[0]?.message;
  if (!message) {
    throw new Error("Model API returned no choices");
  }

  // 只保留我们认识的字段，回传时历史保持干净
  return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls };
}
```

两个容易被忽略的设计点：

- **`content: null` 的表示**。模型要调用工具时，`content` 通常为 `null`。
  我们把它归一化成 `string | null`，循环里据此判断"这轮是工具调用还是最终答案"。
- **只保留认识的字段**。不同厂商会在响应里塞各种额外字段，
  回传时只带 `content` 和 `tool_calls`，避免污染消息历史。

## 2.4 `tools`：工具 = "定义 + 执行"

每个工具是一个对象，一半给模型看（JSON Schema），一半在本地跑（函数）：

```ts
export type Tool = {
  definition: ToolDefinition;          // 模型看到的
  execute: (args: Record<string, unknown>) => Promise<string>;  // 本地执行的
};
```

以 `read_file` 为例：

```ts
export const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file and return its full contents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the workspace root." },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const path = args.path;
    if (typeof path !== "string") {
      throw new Error("read_file: 'path' must be a string");
    }
    return readFile(path, "utf8");
  },
};
```

`write_file` 会创建父目录并覆盖写入；`run_shell` 用 `child_process.exec`
执行命令，把退出码、stdout、stderr 一并返回。注意 `run_shell` 的失败处理：

```ts
return new Promise((resolve) => {
  exec(command, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
    // 非零退出码以文本返回给模型，而不是抛异常
    const exitCode = error ? (error.code ?? "unknown") : 0;
    resolve(`exit code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  });
});
```

`tools/index.ts` 是注册表 + 分发器。agent 循环只和它对话，从不直接碰工具：

```ts
const tools: Tool[] = [readFileTool, writeFileTool, runShellTool];

export const toolDefinitions: ToolDefinition[] = tools.map((tool) => tool.definition);

export async function executeTool(name: string, rawArgs: string): Promise<string> {
  const tool = tools.find((t) => t.definition.function.name === name);
  if (!tool) {
    return `Error: unknown tool "${name}"`;   // 未知工具也返回文本
  }
  try {
    const args = (rawArgs.trim() === "" ? {} : JSON.parse(rawArgs)) as Record<string, unknown>;
    return await tool.execute(args);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
```

**"失败返回文本而不是抛异常"** 是贯穿全书的设计哲学：
agent 的容错不靠 try/catch 兜底，而靠"把错误信息喂回给模型，让它自己修正"。

## 2.5 `agent.ts`：核心循环

循环本身只有三十多行：

```ts
export async function runAgent(config: ModelConfig, prompt: string): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const reply = await chat(config, messages, toolDefinitions);
    messages.push(reply);

    // 没有工具调用 → 这就是最终答案
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      if (reply.content === null) {
        throw new Error("Model returned neither tool calls nor a final text response");
      }
      return reply.content;
    }

    // 执行每个工具调用，把结果作为 "tool" 消息追加，然后回到循环顶部
    for (const call of reply.tool_calls) {
      console.error(`[tool] ${call.function.name} ${call.function.arguments}`);
      const result = await executeTool(call.function.name, call.function.arguments);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent stopped after ${MAX_TURNS} turns without a final answer`);
}
```

要点：

- **`MAX_TURNS = 50`**：防一个糊涂模型无限循环烧钱。这是最小成本保护。
- **`tool_call_id` 回填**：OpenAI 协议要求每条 `tool` 消息带上对应的调用 ID，
  否则模型无法把结果关联到调用。这是最容易写错、又必须正确的地方。
- **一次可能有多条 tool_calls**：模型一轮可以并行要多个工具，逐个执行即可
  （milestone 2 明确选择保持顺序执行，确定性优先于并行优化）。
- **工具痕迹打 stderr**：`console.error` 让 stdout 只输出最终答案，
  方便用户管道化使用。

## 2.6 `index.ts`：CLI 边界

```ts
const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('Usage: npm run dev -- "<prompt>"');
  process.exit(1);
}

try {
  const answer = await runAgent(configFromEnv(), prompt);
  console.log(answer);
} catch (error) {
  console.error(`mo: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
```

（`--version` 选项是 milestone 2 的产物，见 3.7 节的实录。）

## 2.7 端到端验证：一个 mock 服务器

没有真实 API key 也能验证循环吗？能。写一个假的 OpenAI 兼容服务器，
用脚本模拟模型行为：

- 第一次收到请求（最后一条是 user 消息）→ 返回一个 `read_file("package.json")` 工具调用
- 第二次收到请求（最后一条是 tool 消息）→ 返回最终答案

跑一遍 `npm run dev -- "read package.json and tell me the project name"`，
观察消息序列是否正确变成了 `system → user → assistant(tool_calls) → tool → assistant(final)`。

这个技巧贯穿整个开发：**没有真模型也能验证协议正确性**。
Milestone 2 的自修改验收则是反过来——用真模型，但让它改自己的代码。

## 2.8 里程碑 1 的验收结果

- `npm run typecheck`、`npm run build` 通过，零错误
- mock 端到端：工具调用被正确执行，结果按 `tool_call_id` 回填，
  最终答案打印，退出码 0
- 未知工具、非零退出码都作为文本返回给模型，不崩溃
- 缺环境变量 / 无 prompt 时给出清晰错误，退出码 1

第一个里程碑到此完成。Mo 现在是一个能读文件、写文件、跑命令并汇报结果的最小 agent。
但它还不能"改好自己的代码"——`write_file` 会盲目覆盖整个文件，模型找不到代码在哪，
也没有任何测试保护。这正是 Milestone 2 要解决的。

---

# 第 3 章 Milestone 2：让 agent 可控地修改自己的代码

## 3.1 为什么"改自己的代码"这么难

Milestone 1 的 review 发现三个 P1 问题：

1. **`write_file` 不适合修改现有代码**。它会无条件覆盖整个文件。
   模型只要漏掉一段原文件内容，文件就被静默破坏。修改应该是"精确替换"，
   而不是"整文件重写"。
2. **文件工具没有工作区边界**。schema 允许绝对路径，模型可以读写工作目录之外的文件。
3. **缺少定位能力**。模型要么猜路径整文件读取，要么靠 `run_shell` 调外部搜索命令。
   它需要一个原生的 `search_files`。
4. **修改工具没有自动测试**。精确编辑和路径边界都是不可逆写入，
   不能只靠 typecheck。

Milestone 2 的解决方案：新增 `edit_file`（唯一匹配才替换）、`search_files`（字面搜索）、
`path.ts`（统一路径边界），并给它们加上 `node:test` 测试。

## 3.2 路径边界：让工具留在工作区内

`src/tools/path.ts` 是这次最重要的安全代码。它的任务是：
**所有文件工具传入的路径，都必须解析到工作区内**。

```ts
import { lstat, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** 工作区根 = Mo 启动时所在的目录 */
export const workspaceRoot = realpathSync(process.cwd());

function isInsideWorkspace(absolutePath: string): boolean {
  const rel = relative(workspaceRoot, absolutePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
```

为什么不能只做字符串前缀检查？因为**符号链接**。一个工作区内的符号链接
可以指向工作区外的文件。字符串 `path.resolve()` 算出来路径在工作区内，
但 `fs` 实际读写的是链接指向的地方。所以规则是：

- **已存在的目标**：先 `realpath`（跟随所有符号链接）再验证归属。
- **新文件**（可能不存在）：验证"最近的已存在祖先目录"的 realpath 归属，
  防止通过符号链接目录逃逸。
- **悬空的符号链接**：存在但无法 `realpath`（目标不存在）——直接拒绝，
  因为 `writeFile` 会跟随它把文件创建到链接指向的地方。

```ts
export async function resolveWritePath(path: string): Promise<string> {
  const resolved = resolve(workspaceRoot, path);
  if (!isInsideWorkspace(resolved)) {
    throw outsideWorkspaceError(path);
  }

  let existing = resolved;
  while (true) {
    try {
      await lstat(existing);
    } catch {
      // 不存在 → 继续往父目录找最近的已存在祖先
      const parent = dirname(existing);
      if (parent === existing) throw outsideWorkspaceError(path);
      existing = parent;
      continue;
    }
    try {
      const real = await realpath(existing);
      if (!isInsideWorkspace(real)) throw outsideWorkspaceError(path);
      return resolved;
    } catch {
      // 存在但无法解析（如悬空符号链接）：视为不安全，writeFile 会跟随它写出去
      throw outsideWorkspaceError(path);
    }
  }
}
```

**重要**：这份代码的注释里写着 "This is not a sandbox"。路径边界只约束文件工具；
`run_shell` 仍然可以访问任何当前用户有权限的地方。安全边界不能靠局部工具约束
建立——那需要完整的权限系统，不属于本里程碑。诚实地说清楚边界，
比假装安全更重要。

## 3.3 `edit_file`：唯一匹配才替换

`edit_file(path, old_text, new_text)` 的语义：

- `old_text` 必须是非空字符串
- 必须在文件中**恰好出现一次**才允许替换
- 出现零次：拒绝，提示"读文件后传入精确文本"
- 出现多次：拒绝，提示"包含更多上下文以唯一匹配"
- 零次或多次时，文件内容和 mtime 都不得改变

实现上有一个值得注意的细节——**不要用 `String.replace`**：

```ts
const first = content.indexOf(oldText);
if (first === -1) {
  throw new Error(`edit_file: old_text was not found in ${path}; read the file and pass the exact existing text`);
}
if (content.indexOf(oldText, first + 1) !== -1) {
  throw new Error(`edit_file: old_text appears more than once in ${path}; include more surrounding context so it matches exactly once`);
}

// 用 slice 拼接而不是 replace：
// replace 会把 new_text 里的 $1、$$ 等当模式替换符处理，导致内容被悄悄改写
const updated = content.slice(0, first) + newText + content.slice(first + oldText.length);
await writeFile(resolved, updated, "utf8");
```

如果目标文本包含 `$`，`String.replace` 会把它解释成替换模式——
这是又一个"测试全绿但结果是坏的"的坑。slice 拼接没有这个问题。

## 3.4 `search_files`：让模型先找再看

`search_files(query, path?)`：

- `query` 必须是非空字符串，**只支持字面匹配，不支持正则**
- `path` 可选，默认工作区根，且必须在工作区内
- 递归搜索 UTF-8 文本文件
- 默认跳过 `.git`、`node_modules`、`dist`
- 输出格式 `path:line:content`
- 最多 200 条匹配，超出时明确标注截断
- 无匹配时返回明确文本而不是异常

实现用纯 TypeScript 递归遍历（不依赖 `rg`/`grep`，也不新增依赖）：

```ts
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist"]);
const MAX_MATCHES = 200;
```

遍历时按文件名排序保证输出确定性；检测 NUL 字节跳过二进制文件；
符号链接既不是目录也不是文件（`Dirent.isDirectory()` 和 `isFile()` 都为 false），
天然被跳过。

**为什么第一版不做正则？** 字面匹配的语义简单、无性能陷阱、无 ReDoS 风险。
能力边界是刻意的：先做对，再做全。

## 3.5 系统提示：约束行为而不是堆功能

Milestone 2 对系统提示只增加四条行为约束：

```text
When changing code:
- Use search_files and read_file to look at the real code before editing.
- Prefer edit_file when changing existing files.
- Use write_file only to create new files or for a deliberate full-file replacement.
- After making changes, run the project's existing typecheck, test and build commands.
```

注意：**没有**加 planning mode、权限交互、记忆或 context compaction。
行为约束应该放在提示词里，机制复杂度应该尽量少加。

## 3.6 测试：用 Node 内置 test runner 给不可逆操作上保险

项目选择 `node:test`（Node 内置测试框架）+ `tsx` 执行，零新增依赖：

```json
"test": "tsx --test test/tools.test.ts"
```

测试覆盖验收清单的每一项：

- 搜索返回匹配和正确行号
- 搜索跳过 `node_modules`、`.git`、`dist`
- 唯一匹配被成功替换
- 零匹配不写文件（断言内容和 mtime 都不变）
- 多匹配不写文件（同上）
- `../` 路径被拒绝
- 指向工作区外的符号链接被拒绝
- （审查者补充）通过悬空符号链接向外部写文件被拒绝

测试用临时 fixture 目录（`tmp/tools-test-fixtures/`）在测试内创建和清理，
绝不触碰真实的 `src/` 文件。

## 3.7 验收实录：Mo 给自己加 `--version`

验收标准是让 Mo 完成一次真实的自我修改。在干净的工作树里运行：

```bash
npm run dev -- "Inspect package.json and the relevant source files.
Add a --version CLI option that prints the package version.
Use search_files and read_file before editing, use edit_file for existing files,
then run npm run typecheck, npm test, and npm run build. Keep the change minimal."
```

**第一轮**，Mo 的操作序列堪称教科书：

```text
[tool] search_files {"query":"version","path":"package.json"}
[tool] read_file {"path":"package.json"}
[tool] search_files {"query":"process.argv","path":"src"}
[tool] edit_file {"path":"src/index.ts", ...}      ← 插入了 --version 分支
[tool] run_shell {"command": "npm run typecheck"}
[tool] run_shell {"command": "npm test"}
[tool] run_shell {"command": "npm run build"}
```

全部通过。但验收命令 `npm run dev -- --version` 崩溃了：
`ERR_AMBIGUOUS_MODULE_SYNTAX`。

**为什么 typecheck/test/build 全绿，运行时却炸了？**

Mo 插入的代码是 `console.log(require('../package.json').version)`，
但项目是 ESM（`"type": "module"`），运行时根本没有 `require`。
三个检查为什么都没拦住？

- `typecheck` 没拦住：`@types/node` 声明了全局 `require`，类型上"合法"
- `npm test` 没拦住：测试只测工具函数，不加载 CLI 入口 `src/index.ts`
- `npm run build` 没拦住：`tsc` 编译通过

**经典盲区：测试覆盖不到入口。** 模型能通过"项目自带的检查"，不代表功能正确——
检查本身就是模型写完的代码的一部分，而检查恰好覆盖不到 CLI 入口。

**第二轮**，把崩溃信息喂回给 Mo：

```bash
npm run dev -- "You introduced a bug in src/index.ts: the --version branch calls
require('../package.json'), but this project is ESM, so 'npm run dev -- --version'
crashes with ERR_AMBIGUOUS_MODULE_SYNTAX. Fix it without require — use node:fs
readFileSync and JSON.parse. Use read_file first, use edit_file, then run
typecheck/test/build. Keep the change minimal."
```

Mo 这次 `read_file → edit_file` 精准替换了一行：

```ts
console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
```

然后 `npm run dev -- --version` 正确输出 `0.1.0`，diff 只有 8 行新增、1 行删除。

**这个故事说明三件事：**

1. 自修改循环真的能工作：定位 → 读取 → 精确编辑 → 验证，全程真实工具调用
2. 失败会以文本形式回到模型，模型能基于错误信息自我修正——这正是
   "失败返回文本而不是抛异常"设计的意义
3. 工具链的验证要覆盖到真实入口。`npm test` 绿 ≠ 程序对。

## 3.8 审查者发现：悬空符号链接逃逸

实现完成后，独立的审查 agent（Codex）尝试攻破路径边界，发现了一个真实漏洞：

1. 在工作区内创建一个**悬空的符号链接**，指向工作区外一个不存在的文件
2. 对这条链接调用 `write_file`
3. 原实现：`lstat` 成功（链接存在）→ 目标"不存在"→ 走新文件分支验证父目录
   → 父目录在工作区内 → 通过 → `writeFile` 跟随链接把文件写到了工作区外！

修复：`realpath` 失败（存在但无法解析）即拒绝。补了回归测试。

**这个案例的教学意义**：路径安全检查的难点在于"文件系统是动态的"——
同一个路径在不同时刻可以是文件、链接、或不存在。每一层都要问：
"这一步之后，fs 到底会碰哪里？"

---

# 第 4 章 经验与教训

两个里程碑做完，沉淀下来几条原则。

## 4.1 失败要返回给模型，而不是抛给上层

工具调用失败（未知工具、非法 JSON、命令非零退出）都以文本形式成为
`tool` 消息。模型看到错误、调整策略、重试。这是 agent 容错的核心机制。
抛异常中断循环只适用于"框架本身坏了"（比如模型返回了无法解析的响应）。

## 4.2 双人审查真的能抓到 bug

同一个实现让两个不同的 agent 各看一遍（Claude Code 实现，Codex 审查），
审查者从"攻击者"角度写出了真实的逃逸路径。人肉 code review 的价值
在 agent 开发中同样成立，而且换个模型视角更容易跳出实现者的思维定式。

## 4.3 测试要覆盖真实入口

"typecheck/test/build 全绿但功能是坏的"在本项目真实发生过。
如果验收命令是 `npm run dev -- --version`，测试就应该包含加载 CLI 入口的冒烟测试。
模型的自我验证倾向于"跑项目提供的检查"，所以项目的检查必须真的能代表正确性。

## 4.4 诚实声明安全边界

`path.ts` 的注释写着 "This is not a sandbox"。`run_shell` 可以访问任何地方，
所以文件工具限制不构成完整安全边界。假装有沙箱比没有沙箱更危险。
安全边界要么完整实现，要么明确声明并让用户知情。

## 4.5 最小化的艺术

两个里程碑都没有实现：TUI、MCP、记忆、子 agent、规划模式、权限系统、
上下文压缩。每一件都是"以后可能会需要"，但没有一件是"现在最小可用的必经之路"。
里程碑 2 完成后的指令是：**停下来评估真实使用体验**，不要急着堆功能。

---

# 附录 A：完整代码

以下是里程碑 2 完成时的全部源码（约 700 行）。完整仓库在
`github.com/abupeiyong/mo`。

## A.1 `src/model.ts`

```ts
// Thin client for an OpenAI-compatible "chat completions" API, using native fetch.
// This is the only place that knows about HTTP or the wire format.

export type ModelConfig = {
  apiKey: string;
  baseUrl: string; // e.g. https://api.example.com/v1
  model: string;
};

/** A tool as advertised to the model (OpenAI "function" tool format). */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema for the arguments
  };
};

/** A tool invocation requested by the model. Arguments arrive as a JSON string. */
export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
};

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

type ChatCompletionResponse = {
  choices: { message: AssistantMessage }[];
};

/** Read MO_API_KEY, MO_BASE_URL and MO_MODEL from the environment. */
export function configFromEnv(): ModelConfig {
  return {
    apiKey: requireEnv("MO_API_KEY"),
    baseUrl: requireEnv("MO_BASE_URL").replace(/\/+$/, ""),
    model: requireEnv("MO_MODEL"),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Send the conversation to the model and return its next message. */
export async function chat(
  config: ModelConfig,
  messages: Message[],
  tools: ToolDefinition[],
): Promise<AssistantMessage> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages, tools }),
  });

  if (!response.ok) {
    throw new Error(`Model API error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const message = data.choices[0]?.message;
  if (!message) {
    throw new Error("Model API returned no choices");
  }

  // Keep only the fields we understand so the history stays clean when sent back.
  return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls };
}
```

## A.2 `src/agent.ts`

```ts
// The agent loop: prompt -> model -> (tool calls -> results -> model)* -> final text.

import { chat, type Message, type ModelConfig } from "./model.js";
import { executeTool, toolDefinitions } from "./tools/index.js";

const SYSTEM_PROMPT = `You are Mo, a minimal AI coding assistant running in the user's terminal.
You can search, read, edit and write files and run shell commands in the current working directory using the provided tools.
Use tools to look at real files and outputs instead of guessing. When the task is done, reply with a concise final answer.
When changing code:
- Use search_files and read_file to look at the real code before editing.
- Prefer edit_file when changing existing files.
- Use write_file only to create new files or for a deliberate full-file replacement.
- After making changes, run the project's existing typecheck, test and build commands.`;

/** Safety cap so a confused model cannot loop (and bill) forever. */
const MAX_TURNS = 50;

export async function runAgent(config: ModelConfig, prompt: string): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const reply = await chat(config, messages, toolDefinitions);
    messages.push(reply);

    // No tool calls -> this is the final answer.
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      if (reply.content === null) {
        throw new Error("Model returned neither tool calls nor a final text response");
      }
      return reply.content;
    }

    // Execute every requested tool and append each result as a "tool" message,
    // then go around the loop so the model can see the results.
    for (const call of reply.tool_calls) {
      console.error(`[tool] ${call.function.name} ${call.function.arguments}`);
      const result = await executeTool(call.function.name, call.function.arguments);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new Error(`Agent stopped after ${MAX_TURNS} turns without a final answer`);
}
```

## A.3 `src/index.ts`

```ts
#!/usr/bin/env node
// Mo CLI entry point. Run directly: `mo "<prompt>"` (global install),
// or from source: `npm run dev -- "<prompt>"`.

import { readFileSync, existsSync } from "node:fs";
import { runAgent } from "./agent.js";
import { configFromEnv } from "./model.js";

// When run as a globally installed binary there is no --env-file flag, so
// load a .env from the current directory if one exists. Never overrides
// variables that are already set in the environment.
const envPath = ".env";
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  process.exit(0);
}

const prompt = args.join(" ").trim();
if (!prompt) {
  console.error('Usage: mo "<prompt>"');
  process.exit(1);
}

try {
  const answer = await runAgent(configFromEnv(), prompt);
  console.log(answer);
} catch (error) {
  console.error(`mo: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
```

## A.4 `src/tools/index.ts`

```ts
// Tool registry and dispatcher. The agent loop only ever talks to this file.

import type { ToolDefinition } from "../model.js";
import { readFileTool } from "./read-file.js";
import { runShellTool } from "./run-shell.js";
import { writeFileTool } from "./write-file.js";
import { editFileTool } from "./edit-file.js";
import { searchFilesTool } from "./search-files.js";

/** A tool = what the model sees (definition) + what runs locally (execute). */
export type Tool = {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

const tools: Tool[] = [readFileTool, writeFileTool, runShellTool, editFileTool, searchFilesTool];

/** Definitions in the shape the chat completions API expects. */
export const toolDefinitions: ToolDefinition[] = tools.map((tool) => tool.definition);

/**
 * Run a tool by name with its JSON-encoded arguments.
 * Failures are returned as text (not thrown) so the model can read and react to them.
 */
export async function executeTool(name: string, rawArgs: string): Promise<string> {
  const tool = tools.find((t) => t.definition.function.name === name);
  if (!tool) {
    return `Error: unknown tool "${name}"`;
  }

  try {
    const args = (rawArgs.trim() === "" ? {} : JSON.parse(rawArgs)) as Record<string, unknown>;
    return await tool.execute(args);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
```

## A.5 `src/tools/path.ts`

```ts
// Workspace path boundary. Every file tool resolves model-supplied paths here
// so containment logic lives in one place. This is not a sandbox: run_shell can
// still touch anything the user can.

import { lstat, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** Workspace root = the working directory when Mo started. */
export const workspaceRoot = realpathSync(process.cwd());

function isInsideWorkspace(absolutePath: string): boolean {
  const rel = relative(workspaceRoot, absolutePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function outsideWorkspaceError(path: string): Error {
  return new Error(`path "${path}" is outside the workspace; paths must stay inside the working directory Mo was started in`);
}

/**
 * Resolve a path that must already exist (read_file, edit_file, search_files).
 * Symlinks are followed via realpath before the containment check, so a link
 * inside the workspace cannot point outside it.
 */
export async function resolveExistingPath(path: string): Promise<string> {
  const resolved = resolve(workspaceRoot, path);
  if (!isInsideWorkspace(resolved)) {
    throw outsideWorkspaceError(path);
  }

  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    throw new Error(`file not found: "${path}"`);
  }
  if (!isInsideWorkspace(real)) {
    throw outsideWorkspaceError(path);
  }
  return real;
}

/**
 * Resolve a path that may not exist yet (write_file). The nearest existing
 * ancestor (or the target itself, if it exists) is realpath'd before the
 * containment check, so a symlinked directory cannot escape the workspace.
 */
export async function resolveWritePath(path: string): Promise<string> {
  const resolved = resolve(workspaceRoot, path);
  if (!isInsideWorkspace(resolved)) {
    throw outsideWorkspaceError(path);
  }

  let existing = resolved;
  while (true) {
    try {
      await lstat(existing);
    } catch {
      // Does not exist yet; try the parent next.
      const parent = dirname(existing);
      if (parent === existing) {
        throw outsideWorkspaceError(path);
      }
      existing = parent;
      continue;
    }

    let real: string;
    try {
      real = await realpath(existing);
    } catch {
      // An entry exists but cannot be resolved (for example, a dangling
      // symlink). Treat it as unsafe instead of falling back to its parent:
      // writeFile would follow that symlink and could create a file outside.
      throw outsideWorkspaceError(path);
    }
    if (!isInsideWorkspace(real)) {
      throw outsideWorkspaceError(path);
    }
    return resolved;
  }
}
```

## A.6 `src/tools/read-file.ts`

```ts
import { readFile } from "node:fs/promises";
import type { Tool } from "./index.js";
import { resolveExistingPath } from "./path.js";

export const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file and return its full contents.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the workspace root. Must stay inside the workspace.",
          },
        },
        required: ["path"],
      },
    },
  },

  async execute(args) {
    const path = args.path;
    if (typeof path !== "string") {
      throw new Error("read_file: 'path' must be a string");
    }
    return readFile(await resolveExistingPath(path), "utf8");
  },
};
```

## A.7 `src/tools/write-file.ts`

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "./index.js";
import { resolveWritePath } from "./path.js";

export const writeFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write text to a file, replacing any existing content. Creates the file and parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the workspace root. Must stay inside the workspace.",
          },
          content: {
            type: "string",
            description: "The full text content to write.",
          },
        },
        required: ["path", "content"],
      },
    },
  },

  async execute(args) {
    const { path, content } = args;
    if (typeof path !== "string" || typeof content !== "string") {
      throw new Error("write_file: 'path' and 'content' must be strings");
    }
    const resolved = await resolveWritePath(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf8");
    return `Wrote ${content.length} characters to ${path}`;
  },
};
```

## A.8 `src/tools/run-shell.ts`

```ts
import { exec } from "node:child_process";
import type { Tool } from "./index.js";

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export const runShellTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Run a shell command in the current working directory and return its exit code, stdout and stderr. " +
        `Commands are killed after ${TIMEOUT_MS / 1000} seconds.`,
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run, e.g. `ls -la` or `npm test`.",
          },
        },
        required: ["command"],
      },
    },
  },

  execute(args) {
    const command = args.command;
    if (typeof command !== "string") {
      throw new Error("run_shell: 'command' must be a string");
    }

    return new Promise((resolve) => {
      exec(command, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
        // A non-zero exit is reported to the model as text, not thrown as an error.
        const exitCode = error ? (error.code ?? "unknown") : 0;
        const timedOut = error?.killed ? ` (killed after ${TIMEOUT_MS / 1000}s timeout)` : "";
        resolve(`exit code: ${exitCode}${timedOut}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      });
    });
  },
};
```

## A.9 `src/tools/edit-file.ts`

```ts
import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./index.js";
import { resolveExistingPath } from "./path.js";

export const editFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace one exact occurrence of old_text with new_text in an existing file inside the workspace. " +
        "Fails without touching the file if old_text is not found or appears more than once.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to an existing file, relative to the workspace root.",
          },
          old_text: {
            type: "string",
            description: "Exact existing text to replace; must appear exactly once in the file.",
          },
          new_text: {
            type: "string",
            description: "The replacement text.",
          },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },

  async execute(args) {
    const { path, old_text: oldText, new_text: newText } = args;
    if (typeof path !== "string" || typeof oldText !== "string" || typeof newText !== "string") {
      throw new Error("edit_file: 'path', 'old_text' and 'new_text' must be strings");
    }
    if (oldText === "") {
      throw new Error("edit_file: 'old_text' must not be empty");
    }

    const resolved = await resolveExistingPath(path);
    const content = await readFile(resolved, "utf8");

    const first = content.indexOf(oldText);
    if (first === -1) {
      throw new Error(`edit_file: old_text was not found in ${path}; read the file and pass the exact existing text`);
    }
    if (content.indexOf(oldText, first + 1) !== -1) {
      throw new Error(
        `edit_file: old_text appears more than once in ${path}; include more surrounding context so it matches exactly once`,
      );
    }

    const updated = content.slice(0, first) + newText + content.slice(first + oldText.length);
    await writeFile(resolved, updated, "utf8");
    return `Edited ${path}: replaced ${oldText.length} characters with ${newText.length} characters`;
  },
};
```

## A.10 `src/tools/search-files.ts`

```ts
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool } from "./index.js";
import { resolveExistingPath, workspaceRoot } from "./path.js";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist"]);
const MAX_MATCHES = 200;

export const searchFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search UTF-8 text files recursively for a literal string (no regex). " +
        `Returns matches as path:line:content, at most ${MAX_MATCHES}. Skips .git, node_modules and dist.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Literal text to search for. Not a regex.",
          },
          path: {
            type: "string",
            description:
              "Directory (or file) to search, relative to the workspace root. Defaults to the workspace root.",
          },
        },
        required: ["query"],
      },
    },
  },

  async execute(args) {
    const { query, path } = args;
    if (typeof query !== "string" || query === "") {
      throw new Error("search_files: 'query' must be a non-empty string");
    }
    if (path !== undefined && typeof path !== "string") {
      throw new Error("search_files: 'path' must be a string");
    }

    const root = await resolveExistingPath(path ?? ".");
    const matches: string[] = [];
    let truncated = false;

    const searchFile = async (filePath: string): Promise<void> => {
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        return; // unreadable file; skip
      }
      if (content.includes("\u0000")) {
        return; // binary file; skip
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, "");
        if (!line.includes(query)) {
          continue;
        }
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          return;
        }
        matches.push(`${relative(workspaceRoot, filePath)}:${i + 1}:${line}`);
      }
    };

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (truncated) {
          return;
        }
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) {
            await walk(entryPath);
          }
        } else if (entry.isFile()) {
          await searchFile(entryPath); // symlinks are neither, so they are skipped
        }
      }
    };

    if ((await stat(root)).isDirectory()) {
      await walk(root);
    } else {
      await searchFile(root);
    }

    if (matches.length === 0) {
      return `No matches found for "${query}"`;
    }
    const output = matches.join("\n");
    return truncated ? `${output}\n(truncated: showing the first ${MAX_MATCHES} matches)` : output;
  },
};
```

## A.11 `test/tools.test.ts`（测试要点）

测试使用 Node 内置 `node:test`，通过 `tsx` 执行。要点：

- 直接调用 `executeTool`（工具名 + JSON 字符串参数），同时覆盖了注册表和
  "失败返回文本"契约
- fixture 放在工作区内的 `tmp/tools-test-fixtures/`，测试结束在 `after()` 中清理
- 一个 mkdtemp 目录放在工作区外，用于构造符号链接逃逸场景
- 对"零匹配 / 多匹配不写文件"的断言同时检查内容**和 mtime** 未变

---

# 附录 B：命令与验收清单

## B.1 环境变量

| 变量 | 含义 | 示例 |
| --- | --- | --- |
| `MO_API_KEY` | 发送在 `Authorization: Bearer` 头的密钥 | `sk-...` |
| `MO_BASE_URL` | OpenAI 兼容 API 根地址（不含尾部斜杠） | `https://api.openai.com/v1` |
| `MO_MODEL` | 模型名 | `gpt-4o-mini` |

## B.2 常用命令

```bash
npm install                 # 安装 devDependencies（typescript / tsx / @types/node）
npm run dev -- "<prompt>"   # 从源码运行（自动加载 .env）
npm run typecheck           # tsc --noEmit
npm test                    # node:test 测试
npm run build               # 编译到 dist/
npm run start -- "<prompt>" # 运行编译产物
npm link && mo "<prompt>"   # 全局安装并运行
```

## B.3 里程碑验收清单

Milestone 1：

- [ ] 命令行接受 prompt，调用 OpenAI 兼容 API
- [ ] 三个工具（read_file / write_file / run_shell）可被模型调用并本地执行
- [ ] 工具结果按 tool_call_id 回填，循环直到最终答案
- [ ] typecheck / build 通过；缺失环境变量时报错清晰

Milestone 2：

- [ ] search_files：字面搜索、跳过 .git/node_modules/dist、200 条上限、path:line:content
- [ ] edit_file：唯一匹配才替换；零/多次匹配不写文件（内容和 mtime 不变）
- [ ] 路径边界：../ 拒绝、工作区外绝对路径拒绝、符号链接逃逸拒绝、悬空符号链接拒绝
- [ ] 系统提示包含四条行为约束
- [ ] npm test 覆盖以上全部场景
- [ ] 自修改验收：`npm run dev -- --version` 输出 0.1.0，diff 最小

---

# 后记：下一步

里程碑 2 完成后的建议是：先真实使用 Mo 一段时间，感受 `search_files` / `edit_file`
的手感，再决定要不要做：

- 会话记忆（跨任务上下文）
- 更完整的权限系统（取代"诚实的非沙箱"声明）
- TUI（终端界面）
- 多 agent 协作
- API 请求的超时与重试（当前没有）

每一件都值得做，但每一件都要在"最小可用"之后才做。

*—— 感谢 Claude Code 与 Codex 作为开发与审查伙伴，也感谢 Mo 自己改掉了自己写下的 bug。*

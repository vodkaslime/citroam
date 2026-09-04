# citroam

citroam 是一块安静、快速、本地优先的生活与工作待办画布。想到什么就先放上去，之后拖一拖、改一改、做完它。使用 Tauri v2、React 和 TypeScript 构建。

```text
丢进画布 → 随手维护 → 完成
```

## 产品规格

- [规格索引](./specs/README.md)
- [产品需求](./specs/product-requirements.md)
- [产品设计](./specs/product-design.md)

## 产品方向

- 一个本地 Workspace，由随手页和按日期即时派生的画布页组成，不使用收件箱、Today、计划等永久一级列表。
- 想法与临时待办统一为 Card，只写一句话就能创建。
- Card 可以自由拖动、编辑、完成和恢复。
- Area 完全可选，只表达用户自己的空间范围。
- 保留 `#今天`、`#明天`、`!高`、`!中`、`!低` 的轻量快速语法。
- 搜索、撤销和本地保存是安全基础，不增加使用流程。
- 普通捕获与直接操作始终本地、确定性，不经过模型。
- 对话 Agent 是画布上的原生操作层；通过标题栏工具入口打开后覆盖当前画布，处理明确请求后仍回到原位置，不增加第三个一级视图。它不主动整理、规划、催促或评价，普通本地操作也不依赖 Agent。
- 应用设置统一管理外观、DeepSeek 模型 / Harness 路径与本地数据；API Key 只保存在系统 Keychain，不进入 Workspace 或备份。
- 不引入自动整理、复杂项目管理或要求用户学习的新工作流。

## 运行

```bash
pnpm install
pnpm tauri dev
```

### 配置真实 Agent

Agent 使用本机可访问的 DeepSeek Harness SDK。先在 `deepseek-harness` 构建可运行产物，然后启动 citroam，在标题栏打开“设置”→“Agent”，填写 API Key、模型名称和 Harness 路径，点击“保存并测试”：

```bash
cd /path/to/deepseek-harness
pnpm build:lib:host   # 生成 apps/cli/lib 与各 package/lib

cd /Users/jiachen/workspace/citroam
pnpm tauri dev
```

没有配置 Harness 或 API Key 时，画布、总览、捕获、拖动、搜索、完成和撤销仍可离线使用；只有用户实际发送对话请求时，该请求会显示失败且不修改 Workspace。API Key 不要写入仓库、环境以外的普通配置文件或产品备份。开发环境仍可用 `CITROAM_HARNESS_ROOT`、`CITROAM_DEEPSEEK_MODEL` 与 `DEEPSEEK_API_KEY` 作为首次启动回退；一旦在设置中保存，应用配置优先。Harness 默认使用 App 进程专属的临时运行目录，并在退出时清理；如需保留或审查日志，可设置 `CITROAM_HARNESS_HOME` 指向自己的目录。

只运行前端：

```bash
pnpm dev
```

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
cd src-tauri && cargo check
```

## 项目结构

```text
src/
  domain/          Card、Canvas、Area 与旧数据迁移模型
  data/            Tauri Store 与浏览器存储适配
  settings/        应用设置面板与 Agent 配置仓库
  agent/           Agent policy、Harness bridge 与测试替身
  canvas/          画布渲染、时段几何与手势会话
  App.tsx          桌面产品界面与交互
  styles.css       语义色彩、布局和明暗主题
src-tauri/
  capabilities/    Tauri 权限
  icons/           应用图标和平台派生资源
  src/             Rust 宿主、settings 配置模块与 harness sidecar 桥
```

Workspace 默认保存在当前设备的 Tauri 应用数据目录中。普通捕获、编辑、拖动、搜索、完成与本地备份不依赖账号、网络或模型服务；画布内 Agent 面板通过 Tauri 按需启动真实 DeepSeek Harness sidecar，只发送完成当前请求所需的最小 Card 上下文。Harness 未构建、密钥缺失、网络失败或返回无效意图时，该次请求不改变画布，核心本地功能继续可用。Harness 运行日志与对话短历史不写入 Workspace、备份或永久聊天档案。

为保证从早期 `notes` 版本升级时本地任务仍可读取，bundle identifier、Store 文件名和 localStorage key 暂时保留为内部兼容标识；它们不再作为用户可见品牌使用。

## 当前产品基线

- 默认打开今天，像翻书一样浏览前后日期；空日期不会创建持久对象。
- 在日期页或随手页创建、拖动、编辑、完成和恢复 Card。
- 从已经平移很远的随手页首次进入日期页时使用安全的日期场景视口；已访问日期页恢复自己的会话视口，不把远处现场带入新页面。
- 日期页平移或窗口收窄后，新建、异页捕获、总览捕获与跨日移动的 Card 仍会进入目标页可见现场；必要时只做最小视口移动，不重排已有 Card，也不打断捕获所在视图。
- 日期页用随时、上午、下午、晚上四个柔性围栏表达时间；Card 仍可停在围栏外。
- 只在随手页使用可选 Area 做轻量空间整理，或完全不整理。
- 通过总览、搜索、“看全本页”和撤销找回内容与误操作。
- 自动保存到本机，并在保存失败时保留内容、提供重试。
- 无损读取早期 `notes` Task 数据并生成稳定画布位置。
- 原生应用与 Web favicon 复用同一 citroam 图标源。

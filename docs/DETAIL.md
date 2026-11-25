# 千问 AI 平台（dsh-qianwen）

把 [platform.qianwenai.com](https://platform.qianwenai.com) 的两条计费通道接进 DeepSeek Harness。

## 它做什么

- **Provider 对接**：`qianwen-token-plan`（`token-plan.maas.qianwenaiapi.com`）与 `qianwen`（`maas.qianwenaiapi.com`）两条 OpenAI 兼容路由由插件自己注册（`ctx.llm.registerAdapter` + `registerConfigurableProviders`），不是写进 `llm-pi-ai` 的配置文档。适配器复用宿主的 `PiAiAdapter`，模型对象由插件按千问目录构造，计费、重试、图像输入与缓存标记沿用既有实现。
- **这两条路由删不掉也改不了**：目录声明里的 `settingsPath` 是空数组，宿主的模型页据此认定「这条不是配置文档里的一行」，因此只给查看与填 Key，没有编辑/删除按钮，改 `apiKeyEnv` 也不会影响路由本身。旧版本写进 `llm-pi-ai` 的两条路线在启动时会被摘掉。
- **模型目录与按通道定价**：从官方 CLI 读全量目录，只保留「文本进、文本出」的模型。价格列跟着模式 tab 走：Token Plan 侧显示 Credits/1M（由目录单价 ×100 换算，1 Credit = 0.01 元，系数由平台文档的计费示例回算得出，平台没有公开的 Credits 字段，界面上写明了公式）；按量付费侧直接显示平台报价 ¥/1M。倍率列已删——它依赖一个人为基准，基准选得不合心意就整表失真，不如直接看绝对价。
- **目录可选启用（按通道分开）**：Token Plan 与按量付费各有自己的停用黑名单（`tokenPlanDisabledModels` / `paygDisabledModels`），页面按这两个通道分成两个 tab，套餐额度、Provider 对接、模型目录都跟着 tab 走——同一模型可以只在按量侧启用。默认两份清单都是空的，所以平台新上的模型会自动出现在两条通道。模型表每行一个勾选框（作用于当前 tab 的通道），配合标签筛选可以「只留筛出的 N 个」，也有「全不选」一次清空当前通道；停用的模型不进模型选择器，也不进该路由的模型集合。勾选是本地即时的，改动攒 500ms 合并成一次写入（服务端等配置提交后立即返回，不再回传整份状态、也不再重写目录文件），切 tab 前会先把攒着的改动落盘。
- **标签筛选**：能力桶（文本 / 多模态 / 音频 / 思考 / 第三方）与系列（`qwen4`、`qwen3.8`、`kimi`、`vanchin` …）都由目录行推导，不另维护名单：能力来自 `input`/`output`/`vision`/`reasoning`，系列来自 id（斜杠前的 vendor，或品牌加版本号）。
- **默认思考强度**：`defaultThinkingEffort` 可把两条通道的起始档位钉在关/低/中/高；留空则用「记住」的档位。记住的来源是会话事件 `request/header`：只有用户在模型选择器里明确选过（`adapterDefaults.reasoningEffort !== true`）的档位才会被记成该通道的默认值，写进 `<dataDir>/effort.json`，重启后仍在。路由级默认档位不会把模型搞崩：适配器在把请求交给宿主前先问这个模型支持哪些档位，不支持就降到它能接受的那一档（有「关」就关，否则取最低档），而不是抛 `UNSUPPORTED_REASONING_EFFORT`——一条路由里同时有思考模型和非思考模型，宿主原生的写法会让后者每次请求都失败。
- **剩余额度**：`subscription status` 给出套餐档位、用量百分比与重置时间，`billing balance summary` 给出账户余额，`usage summary` 给出免费额度与按量消费。额度出现在两处：设置页的完整视图，以及侧边栏左下角设置按钮上方的一行额度条（点开是明细与刷新）。
- **两条通道各自的 Key**：Token Plan（`sk-sp-` 开头）与按量付费（`sk-ws-` 开头）是两个 Key，插件把它们分别写进凭据服务（`.credentials.yaml` 的 `QIANWEN_TOKEN_PLAN_API_KEY` / `QIANWEN_PAYG_API_KEY`），保存后下一次模型调用即生效，不需要重启。Key 只影响真正调用模型；模型目录、定价、额度走的是 CLI 的管理接口，登录态就够。
- **插件内登录**：官方 CLI 的 device flow 分两段（`--init-only` 返回授权链接、`--complete` 轮询结果），设置页把这两段串起来，用户不必在终端敲命令。
- **思考模式开关与档位**：给每个推理模型声明 `thinkingLevelMap` 与 `compat.thinkingFormat: qwen`，qwen4 系列额外带上 `reasoning_effort` 与 `thinking_budget`。平台文档对 qwen4-max 写明默认 `reasoning_effort=high`、`thinking_budget=131072`，其余模型按「开/关」暴露。
- **设置与插件的接线**：十个字段（CLI 路径、两个 Key 变量名、思考模式、默认思考强度、是否记住选择器档位、目录刷新与额度刷新间隔、两条通道各自的停用模型清单）都是 `volatile`，配置写在 profile 的配置文档里，所以宿主的设置页与本插件页面看的是同一份数据，任一处修改都会立刻重建模型集合（`settings/document-updated` 去抖 250ms）。学到档位落 `<dataDir>/effort.json`，不进配置文档——那是每次选档位都会变的运行态，写成配置会让 profile 文档频繁重写。
- **模型目录的刷新节奏**：额度轮询默认每 10 分钟一次，模型目录默认每 6 小时才重建一次（`catalogRefreshMinutes`，可在设置页改）。目录写盘后重启也读得到，所以冷启动不必等 CLI；想立刻拿到平台新上的模型，点目录卡上的「重建目录」。

## 它不做什么

- 不自己写流式协议，也不复刻平台的签名 RPC（数据接口是阿里云式签名调用，直接复用官方 CLI）。
- 不在插件配置文件里落明文 Key：路由里的 `apiKeyEnv` 只是引用名，密钥交给 DSH 的凭据服务（`~/.dsh/.credentials.yaml`）保管。
- 不把两条路由写进 `llm-pi-ai` 的配置文档：那份文档是模型页的财产，写进去就等于给了它删改的权力。

## 已知限制

- **登录有效期固定 48 小时**：device flow 拿到的令牌带 `expires_at`（实测 48h），CLI 没有 refresh token，`auth login` 也没有 TTL 参数，所以插件无法延长。设置页显示剩余时间、临期（<6h）提示与「重新登录」入口；过期后模型调用会被上游拒绝，需要重新授权一次。
- **额度浮层挂在 frame 层**：侧栏 footer 有 `overflow` 裁剪，弹层若用 `absolute` 贴着按钮画会被切掉，所以面板注册在 `shell.overlay` 上、按按钮的 rect 做 fixed 定位。
- **目录里没有图片/视频生成模型**：平台只提供「文本进、文本出」的对话模型（130 个里图片输出仅 1 个、视频输出 0 个），所以标签里没有「图片生成/视频生成」这两类，多模态指的是能读图片与视频，不是能生成。
- **学到的档位按通道记，不按模型记**：宿主把默认档位挂在适配器 profile 上，插件无法给单个模型设默认值，所以两条通道各有一个记忆值。

## 依赖

- 官方 CLI：`npm i -g @qianwenai/qianwen-cli`（也可以在设置页点「安装 CLI」，插件会装到自己的数据目录里，不动全局 npm）。
- 一次登录：设置页点「登录千问账号」，把弹出的授权链接在浏览器里确认即可，不需要终端。

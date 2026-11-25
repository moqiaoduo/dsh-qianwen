# dsh-qianwen（千问 AI 平台）

把 [platform.qianwenai.com](https://platform.qianwenai.com) 的 Token Plan 与按量付费两条通道接进 DeepSeek Harness：注册两条 OpenAI 兼容 provider 路由、提供模型目录与按通道定价、查询剩余额度，并控制思考模式档位。

## 功能

- **双通道 provider**：`qianwen-token-plan` 与 `qianwen` 由插件自行注册，不写进 `llm-pi-ai` 的配置文档；两条路由各有自己的 Key，分别存入 DSH 凭据服务。
- **模型目录与定价**：从官方 CLI 读取全量目录，只保留文本进/文本出的模型；Token Plan 侧显示 Credits/1M，按量付费侧显示 ¥/1M。
- **按通道管理模型**：两条通道各有停用黑名单，页面分 tab 展示，支持标签筛选与批量勾选；停用的模型不进模型选择器。
- **额度与登录**：设置页与侧边栏额度条显示套餐档位、用量、余额与免费额度；插件内通过 CLI device flow 登录，无需终端。
- **思考档位**：可设置默认思考强度（关/低/中/高）；档位按通道记忆，重启后保留，不兼容的模型自动降级而非报错。

完整说明（配置字段、实现细节、已知限制）见 [docs/DETAIL.md](docs/DETAIL.md)。

## 安装

发布到 npm 后：

```sh
dsh plugin --profile web add dsh-qianwen
```

未发布时可在 Web GUI 的 **Plugins → Add plugin** 选择本目录安装。要求 DSH `>=0.2.2-rc.5`。

## 前置条件

- 官方 CLI：`npm i -g @qianwenai/qianwen-cli`（也可在设置页点「安装 CLI」，装到插件数据目录，不动全局 npm）。
- 一次千问账号登录：在设置页点「登录千问账号」，在浏览器确认授权链接即可。

## 已知限制

- 登录令牌有效期固定 48 小时且无 refresh token，过期后需在设置页重新登录。
- 目录只含文本进/文本出的对话模型，不含图片/视频生成模型。
- 默认思考强度按通道记忆，不按单个模型记忆。

## 索引

仓库根的 `market-index.json` 是一份 DSH format 1 索引样例；自建索引源时在「插件 → 发现 → 索引源」添加其托管 URL 即可。

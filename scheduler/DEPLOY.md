# LabWiki 按需访问系统 · 部署指南

## 架构概览

```
学弟学妹 → apply.html → Cloudflare Worker → Railway API
                ↑              │
                │     GET /status (轮询)     │
                └────────────────────────────┘
                
LabWiki 页面 → POST /heartbeat (每30秒) → Cloudflare Worker
                                               │
                              Cron 每2分钟检查心跳 → 超时5分钟删除服务
```

## 前置条件

1. 已有 Railway 账号 + 项目（含 PostgreSQL 数据库）
2. 已有 GitHub 仓库 `evo453/labwiki`
3. 注册一个 Cloudflare 账号：https://dash.cloudflare.com/sign-up（免费）

## 第一步：获取 Railway API Token

1. 打开 https://railway.com/account → 点 **API Tokens**
2. 点 **Create Token**，名称填 `labwiki-scheduler`
3. 权限勾选：全部（或至少勾选 Service、Deployment、Project 的读写权限）
4. 复制生成的 Token，保存好（只显示一次）

## 第二步：部署 Cloudflare Worker

### 方式 A：通过 Cloudflare 网页部署（推荐，最简单）

1. 打开 https://dash.cloudflare.com/
2. 左侧菜单 → **Workers & Pages** → **创建应用程序** → **创建 Worker**
3. 给 Worker 起个名字（如 `labwiki-scheduler`），点 **部署**
4. 点 **编辑代码**，把 `scheduler/worker.js` 的内容全部粘贴进去
5. 点右上角 **部署**

接下来配置：

6. 点 **设置** → **变量** → **添加环境变量**：
   - 变量名：`RAILWAY_API_TOKEN`
   - 值：第一步获取的 Token
   - 点 **加密** → **保存**

7. 创建 KV 命名空间：
   - 左侧菜单 → **Workers & Pages** → **KV**
   - 点 **创建命名空间**，名称填 `LABWIKI_STATE` → **添加**
   - 回到 Worker 页面 → **设置** → **绑定** → **添加** → **KV 命名空间**
   - 变量名：`LABWIKI_STATE`，选择刚创建的 `LABWIKI_STATE`

8. 配置定时触发器：
   - Worker 页面 → **设置** → **触发器** → **添加 Cron 触发器**
   - Cron 表达式：`*/2 * * * *`（每 2 分钟执行一次）

9. 记下 Worker 的 URL（如 `https://labwiki-scheduler.xxxx.workers.dev`）

### 方式 B：通过命令行部署

```bash
# 安装 wrangler
npm install -g wrangler

# 登录
wrangler login

# 创建 KV 命名空间
wrangler kv:namespace create "LABWIKI_STATE"
# 复制返回的 id，填入 wrangler.toml 的 YOUR_KV_NAMESPACE_ID

# 设置密钥
wrangler secret put RAILWAY_API_TOKEN

# 部署
cd scheduler
wrangler deploy
```

## 第三步：更新代码中的调度器地址

部署 Worker 后，会得到一个 URL 类似：`https://labwiki-scheduler.xxxx.workers.dev`

需要把这个 URL 填到两个文件里：

### `apply.html` 中（第 134 行附近）
```javascript
const SCHEDULER_URL = 'https://labwiki-scheduler.YOUR_SUBDOMAIN.workers.dev';
```
改成你的实际 Worker URL

### `index.html` 中（倒数第 6 行附近）
```javascript
var HB_URL = 'https://labwiki-scheduler.YOUR_SUBDOMAIN.workers.dev/heartbeat';
```
改成你的实际 Worker URL + `/heartbeat`

## 第四步：部署申请页面

将 `apply.html` 部署到 CloudStudio 或其他静态托管服务：

1. 打开 https://studio.cloudstudio.work
2. 新建沙箱 → 上传 `apply.html`
3. 拿到公网地址，分享给学弟学妹

## 第五步：推送更新到 GitHub

```bash
cd labwiki-v3-clean
git add -A
git commit -m "添加按需访问系统（调度器 + 心跳）"
git push origin main
```

Railway 不会自动部署（LabWiki 服务已删除），下次有人申请时会自动创建。

## 测试

1. 打开 `apply.html` 的公网地址
2. 点「申请访问」
3. 等待 1-2 分钟
4. 看到「知识库已就绪」→ 点「进入知识库」
5. 在知识库页面等 2-3 分钟不操作
6. 等 5 分钟后，Railway 项目中的 LabWiki 服务应被自动删除

## 费用

| 组件 | 费用 |
|------|------|
| Cloudflare Worker | 免费（10 万次/天） |
| Cloudflare KV | 免费（1GB 存储 + 1000 万次读/天） |
| Railway（按需） | 只在有人使用时计费，闲置时删掉 |
| Railway PostgreSQL | ~$1-2/月（一直在线） |
| CloudStudio（申请页） | 免费 |

总成本：每月约 ¥7-14（PostgreSQL 闲置费），访问期间额外按小时计。

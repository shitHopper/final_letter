# 绝笔信 (Final Letter)

> 关注人身安全的定时打卡应用 —— 定期确认安好，超时自动送达遗书。

[![技术栈](https://img.shields.io/badge/技术栈-Express%20%2B%20React%20%2B%20SQLite-blue)](#)
[![许可证](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 目录

- [产品概述](#产品概述)
- [核心机制：双阶段打卡](#核心机制双阶段打卡)
- [功能模块](#功能模块)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [API 概览](#api-概览)
- [部署](#部署)
- [设计文档](#设计文档)

---

## 产品概述

**绝笔信**是一款关注用户人身安全的移动 Web 应用。用户设定打卡周期，通过定期打卡确认自身安好；若超时未打卡，系统将按阶段自动通知紧急联系人，并最终将预写的遗书按选定的推送方式送达。

**适用场景**：独居人群、高风险职业从业者、户外探险者、心理健康关注者等需要定期报平安的人群。

**底部导航栏四大模块**：打卡 · 写信 · 社区 · 个人

---

## 核心机制：双阶段打卡

### 第一阶段：预警期限（Alert Phase）

```
用户正常打卡周期，状态为 alert
├── 按时打卡 → 重置倒计时，可选择通知联系人「我还安好」
└── 超时未打卡 → 自动向紧急联系人发送求救信息，进入推送期限
```

### 第二阶段：推送期限（Push Phase / 宽限期）

```
预警超时后的缓冲期，状态为 push
├── 打卡 → 通知联系人「我已回来」，回退到预警期限
└── 超时未打卡 → 将所有未发送的遗书按各自推送方式送达
```

### 期限设置

| 期限 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| 预警期限 | 1–7 天 | 3 天 | 正常打卡周期 |
| 推送期限 | 1–7 天 | 3 天 | 预警超时后的宽限期 |

---

## 功能模块

### 1. 打卡（Check-in）

- 双阶段倒计时实时显示（预警/推送阶段不同 UI 风格）
- 推送期限 UI 更紧迫（橙/红色主题，超时警告）
- 一键打卡
- 打卡后弹出通知面板：可勾选联系人、编辑自定义消息（最多 500 字）、选择发送或跳过
- 预警/推送期限双滑块灵活设置
- 附近心理咨询机构查询（高德地图 API）
- 心理健康援助热线速查
- 轮播温暖语录

### 2. 写信（Letters）

- 遗书 CRUD（创建、查看、编辑、删除）
- 标题最多 100 字，内容最多 10000 字
- 四种推送方式：
  1. 电子邮件（阿里云邮件推送）
  2. 手机短信（预留接口）
  3. 实体邮信（预留接口）
  4. 公开到社区
- 可选密码保护（服务端 scrypt 哈希，4–16 位）
- 编辑时可清除密码保护
- 信件访问 Token 机制（验证密码后发放 5 分钟有效 Token，持久化到数据库）
- 区分公开/私密信件展示

### 3. 社区（Community）

- 图文帖子发布（最多 1000 字，最多 9 张图片）
- 点赞/取消点赞
- 嵌套评论（最多 300 字，支持回复 @被回复人）
- 帖子/评论删除（带确认弹窗）
- 点击头像/昵称查看用户公开信息卡片
- 图片上传（前端压缩 + 服务端校验）

### 4. 个人（Profile）

- 个人资料编辑（昵称 ≤50 字，签名 ≤200 字，性别）
- 头像上传
- 邮箱显示/绑定/更换（验证码验证）
- 修改密码（需旧密码确认，修改后所有已登录设备强制下线）
- 紧急联系人管理（CRUD，称呼 ≤50 字，联系方式 ≤200 字，支持邮件/短信通知方式）
- 打卡统计展示

### 安全特性

- JWT 认证（httpOnly Cookie，含 tokenVersion，动态 SameSite 策略）
- 密码修改/重置自动递增 token_version，使所有已有 JWT 失效
- CSRF 防护：状态变更请求（POST/PUT/DELETE）校验 Origin/Referer 请求头
- 服务端 scrypt 密码哈希（16 字节随机盐）
- 邮箱验证码机制（6 位数字，5 分钟有效，最多 5 次尝试，60 秒发送间隔，每日 10 次上限）
- 两步注册流程（先发验证码，再验证注册）
- 全端点输入长度校验（防止恶意超长输入）
- 内容安全策略（CSP）响应头
- XSS 防护（HTML 邮件模板 escapeHtml）
- 图片上传校验（扩展名白名单，SVG 拦截，MIME 类型检查，5MB 限制）
- API 频率限制（登录/注册 10次/15分钟，改密 5次/15分钟）
- 信件访问 Token 重放保护（持久化到 `letter_verify_tokens` 表，服务重启不丢失）

---

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│                    客户端                             │
│         React 19 + Vite 8 SPA (移动端适配)            │
│           Tab 路由 (打卡/写信/社区/个人)                │
└─────────────────┬────────────────────────────────────┘
                  │ /api, /uploads
                  ▼
┌──────────────────────────────────────────────────────┐
│                   Express.js 服务端                    │
│  ┌──────────┬──────────┬──────────┬──────────────┐  │
│  │  Auth    │ Letters  │  Posts   │  Contacts    │  │
│  │  JWT     │  CRUD    │  社区     │  紧急联系人    │  │
│  │  验证码   │  Token   │  评论     │  通知         │  │
│  └──────────┴──────────┴──────────┴──────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │  Scheduler (每 5 分钟，递归 setTimeout)        │   │
│  │  · 检查预警超时 → 通知联系人 → 切换 push 状态    │   │
│  │  · 检查推送超时 → 重查状态 → 发送遗书           │   │
│  │  · 清理过期验证码和信件验证 token                │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  sql.js (SQLite 内存数据库)                     │   │
│  │  · 500ms 节流持久化到 juebixin.db               │   │
│  │  · 关键写入立即同步 (runCritical)               │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 当前技术栈（Demo / 原型阶段）

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + Vite 8 | SPA with Tab state routing |
| 后端 | Express.js 4 | RESTful API |
| 数据库 | sql.js (SQLite) | 内存数据库 + 文件持久化 |
| 认证 | JWT + httpOnly Cookie | scrypt 密码哈希 + token_version |
| 邮件 | nodemailer + 阿里云 SMTP | Resend 备选 |
| 存储 | 服务端文件系统 | Multer 图片上传 |

### 正式落地技术选型（方案 A：快速启动型）

| 层级 | 技术 |
|------|------|
| 前端 | Flutter |
| 后端 | NestJS + PostgreSQL |
| 邮件推送 | Resend / 阿里云邮件推送 |
| 短信推送 | 阿里云短信 |
| 实体邮信 | 二期实现 |
| 部署 | Docker + 云服务器（阿里云/腾讯云） |

---

## 项目结构

```
jue_bi_xin_project/
├── backend/                    # Express.js 后端
│   ├── server.js              # API 路由与业务逻辑
│   ├── db.js                  # 数据库初始化、Schema 与持久化
│   ├── db-helpers.js          # 共享数据库辅助函数
│   ├── scheduler.js           # 后台定时任务（检查超时、发送遗书）
│   ├── package.json
│   ├── .env                   # 环境变量（不提交到 Git）
│   └── uploads/               # 图片上传目录
├── frontend/                   # React SPA 前端
│   ├── src/
│   │   ├── App.jsx            # 根组件（路由、认证流程、Tab 导航）
│   │   ├── App.css            # 全局样式（CSS 自定义属性主题）
│   │   ├── api.js             # 共享 API 工具（Cookie 认证、401 自动登出）
│   │   ├── utils.js           # 共享工具函数（parseUTC 等）
│   │   ├── main.jsx           # 入口文件
│   │   └── pages/
│   │       ├── Checkin.jsx   # 打卡页（倒计时、通知面板、附近诊所、热线）
│   │       ├── Letters.jsx   # 写信页（CRUD、密码验证、推送方式选择）
│   │       ├── Community.jsx # 社区页（帖子、点赞、评论、用户卡片）
│   │       └── Profile.jsx   # 个人页（资料、头像、邮箱、密码、联系人）
│   ├── package.json
│   └── vite.config.js
├── CLAUDE.md                   # Claude Code 开发指南
├── REQUIREMENTS.md             # 产品需求文档
├── TECH_COMPARISON.md          # 技术方案对比
└── README.md                   # 本文件
```

---

## 快速开始

### 前提条件

- Node.js 18+
- npm 9+

### 1. 克隆项目

```bash
git clone https://gitee.com/shithopper/final-letter.git
cd final-letter
```

### 2. 配置后端环境变量

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，设置以下必填项：

| 变量 | 必填 | 说明 |
|------|------|------|
| `JWT_SECRET` | ✅ | JWT 签名密钥，建议随机生成 64 字符以上 |
| `AMAP_KEY` | - | 高德地图 API Key，缺省时使用内置诊所数据 |
| `SMTP_HOST` | - | 邮件服务器地址（默认阿里云） |
| `SMTP_PORT` | - | 邮件端口（默认 465） |
| `SMTP_USER` | - | 邮件用户名，缺省时邮件以模拟模式运行 |
| `SMTP_PASS` | - | 邮件密码 |
| `MAIL_FROM` | - | 发件人地址 |

### 3. 安装依赖

```bash
# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

### 4. 启动开发环境

启动两个终端：

```bash
# 终端 1：启动后端（端口 3000）
cd backend
npm run dev

# 终端 2：启动前端（端口 5173，自动代理到后端）
cd frontend
npm run dev
```

浏览器打开 `http://localhost:5173` 即可访问。

### 5. 生产构建

```bash
# 构建前端
cd frontend
npm run build

# 启动后端（自动托管前端静态文件）
cd ../backend
npm start
```

---

## 环境变量

<details>
<summary>展开查看完整列表</summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JWT_SECRET` | (必填) | JWT 签名密钥 |
| `AMAP_KEY` | (可选) | 高德地图 Web 服务 Key |
| `SMTP_HOST` | `smtpdm.aliyun.com` | SMTP 服务器 |
| `SMTP_PORT` | `465` | SMTP 端口 |
| `SMTP_USER` | (可选) | SMTP 认证用户 |
| `SMTP_PASS` | (可选) | SMTP 认证密码 |
| `MAIL_FROM` | `绝笔信 <noreply@yourdomain.com>` | 发件人 |
| `CORS_ORIGINS` | `http://localhost:5173,...` | 允许的 CORS 源（逗号分隔） |
| `PORT` | `3000` | 后端监听端口 |

</details>

---

## API 概览

### 认证 (`/api/auth`)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册第一步（发送验证码） | - |
| POST | `/api/auth/register/verify` | 注册第二步（验证码通过后创建用户） | - |
| POST | `/api/auth/login` | 登录（昵称或邮箱） | - |
| POST | `/api/auth/logout` | 登出 | JWT |
| GET | `/api/auth/me` | 当前用户信息 | JWT |
| POST | `/api/auth/set-password` | 强制设置密码 | JWT |
| POST | `/api/auth/send-code` | 发送邮箱验证码 | - |
| POST | `/api/auth/bind-email` | 绑定/更换邮箱 | JWT |
| POST | `/api/auth/reset-password-request` | 请求密码重置 | - |
| POST | `/api/auth/reset-password` | 重置密码 | - |

### 用户 (`/api/users`)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/users/me` | 完整个人信息 | JWT |
| PUT | `/api/users/me` | 更新个人资料 | JWT |
| POST | `/api/users/me/avatar` | 上传头像 | JWT |
| POST | `/api/users/me/change-password` | 修改密码（旧密码确认，token_version+1） | JWT |
| GET | `/api/users/:id` | 查看其他用户公开信息 | JWT |

### 信件 (`/api/letters`)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/letters` | 信件列表 | JWT |
| POST | `/api/letters` | 创建信件 | JWT |
| GET | `/api/letters/:id` | 查看信件（需 x-letter-token） | JWT |
| PUT | `/api/letters/:id` | 编辑信件 | JWT |
| DELETE | `/api/letters/:id` | 删除信件 | JWT |
| POST | `/api/letters/:id/verify` | 验证信件密码 | JWT |

### 社区 (`/api/posts`)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/posts` | 帖子列表 | JWT |
| POST | `/api/posts` | 发布帖子 | JWT |
| DELETE | `/api/posts/:id` | 删除帖子 | JWT |
| POST | `/api/posts/:id/like` | 点赞/取消点赞 | JWT |
| GET | `/api/posts/:id/comments` | 评论列表 | JWT |
| POST | `/api/posts/:id/comments` | 发表评论 | JWT |
| DELETE | `/api/comments/:id` | 删除评论 | JWT |

### 其他

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/checkin` | 打卡状态 | JWT |
| POST | `/api/checkin` | 打卡 | JWT |
| POST | `/api/checkin/notify` | 打卡后通知联系人 | JWT |
| PUT | `/api/checkin/interval` | 更新打卡间隔 | JWT |
| GET | `/api/nearby-clinics` | 附近心理诊所 | JWT |
| POST | `/api/upload` | 图片上传 | JWT |

---

## 部署

### 生产环境（Cloudflare Tunnel 内网穿刺）

内网穿刺允许没有公网 IP 的电脑将服务暴露到公网。本项目通过 Cloudflare Named Tunnel 实现，启动后可通过 `juebixin.asia` / `www.juebixin.asia` 访问。

#### 前提条件

- 一个 [Cloudflare](https://cloudflare.com) 账号
- 一个托管在 Cloudflare 的域名（DNS 需在 Cloudflare 解析）
- 安装 `cloudflared` CLI 工具（[下载地址](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)）

#### 首次搭建（新开发者）

```bash
# 1. 登录 Cloudflare
cloudflared tunnel login

# 2. 创建命名隧道
cloudflared tunnel create <隧道名称>

# 3. 编写配置文件 ~/.cloudflared/config.yml
# tunnel: <隧道ID>
# credentials-file: /path/to/<隧道ID>.json
# ingress:
#   - hostname: your-domain.com
#     service: http://localhost:3000
#   - hostname: www.your-domain.com
#     service: http://localhost:3000
#   - service: http_status:404

# 4. 配置 DNS（将域名 CNAME 指向隧道）
cloudflared tunnel route dns <隧道名称> your-domain.com
cloudflared tunnel route dns <隧道名称> www.your-domain.com
```

#### 日常启动三步

```bash
# 1. 构建前端
cd frontend && npm run build

# 2. 启动后端
cd backend && npm run dev

# 3. 启动隧道
cloudflared tunnel run <隧道名称>
```

Tunnel 配置文件的 ingress 规则指向 `http://localhost:3000`。

### HTTPS / 安全

- 后端设置 `trust proxy` 以支持 Cloudflare 反向代理
- Cookie 策略自动检测协议：HTTPS 环境使用 `sameSite=none; secure=true`，HTTP 环境使用 `sameSite=lax; secure=false`
- CSRF 防护：状态变更请求校验 Origin/Referer 请求头
- CSP（内容安全策略）响应头防护

---

## 设计文档

- [产品需求文档](./REQUIREMENTS.md) — 四大模块详细需求
- [技术方案对比](./TECH_COMPARISON.md) — Flutter + NestJS vs 其他方案
- [产品分析](./PRODUCT_ANALYSIS.md) — 竞品分析与定位
- [CLAUDE.md](./CLAUDE.md) — 开发者快速指南（AI 辅助开发用）

---

## 许可证

MIT License

---

## 作者

**shitHopper** — [Gitee](https://gitee.com/shithopper)

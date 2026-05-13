# 绝笔信 — 产品需求文档

## 一、产品概述

**绝笔信**是一款关注用户人身安全的定时打卡应用。用户设定打卡周期，定期确认安好；若超时未打卡，系统将按阶段自动通知紧急联系人，最终送达预写的遗书。应用同时提供社区互助与心理援助资源。

底部导航栏包含四个模块：打卡、写信、社区、个人。

---

## 二、核心业务逻辑：双阶段打卡机制

### 2.1 预警期限（第一阶段）

- 用户正常打卡周期，状态为 `alert`
- 打卡时重置倒计时，可选择向紧急联系人发送「安好信息」
- 超时未打卡 → 自动向所有紧急联系人发送求救信息，进入推送期限

### 2.2 推送期限（第二阶段 / 宽限期）

- 用户超时后的缓冲期，状态为 `push`
- 打卡 → 向联系人发送「已回来」消息，回退到预警期限
- 超时未打卡 → 将未发送的遗书按各自推送方式送达

### 2.3 期限设置

- 预警期限：1-7 天，默认 3 天
- 推送期限：1-7 天，默认 3 天
- 两个期限独立设置，用户可随时调整

### 2.4 倒计时计算

- 预警期限：deadline = alert_started_at + alert_interval_days
- 推送期限：deadline = push_started_at + push_interval_days
- 前端每秒刷新倒计时显示

### 2.5 通知消息模板

| 类型 | 默认内容 | 触发场景 |
|------|---------|---------|
| 安好 (well) | 我还安好，挂念着你，请你放心。 | 预警期限打卡时，用户主动发送 |
| 求救 (sos) | 我可能遇上了麻烦，我可能失联了，请寻找我。 | 预警期限超时，系统自动发送 |
| 回来 (back) | 麻烦解决，我已回来，请你放心。 | 推送期限打卡时，用户主动发送 |

---

## 三、四大功能模块

### 3.1 打卡模块

**功能**：
- 双阶段倒计时显示（预警期限 / 推送期限）
- 推送期限阶段 UI 更紧迫（橙色/红色主题、超时警告）
- 一键打卡按钮
- 打卡成功后弹出通知弹窗（NotifyModal）：
  - 显示联系人列表，可勾选/全选
  - 默认消息预览（安好/回来）
  - 可编辑自定义消息（最多 500 字）
  - 确认发送或跳过
- 预警/推送期限双滑块设置
- 温暖语录轮播（每 15-30 秒随机切换，30 条语录）
- 心理援助热线（全国24小时热线、北京危机干预中心、希望24热线）
- 附近心理咨询机构（基于高德地图 API，定位失败显示默认机构）
- 推送期限超时 + 有未发送遗书时显示红色警告

### 3.2 写信模块

**功能**：
- 遗书 CRUD（创建、查看、编辑、删除）
- 标题最多 100 字，内容最多 10000 字
- 可选信件密码保护（查看时需验证）
- 推送方式：

| 值 | 方式 | 说明 |
|----|------|------|
| 1 | 电子邮件 | 填写邮箱地址，通过 SMTP 发送 |
| 2 | 手机短信 | 填写手机号，目前为模拟 |
| 3 | 实体邮信 | 填写邮寄地址，目前为模拟 |
| 4 | 公开到社区 | 无需填写目标，自动发布到社区 |

- 信件状态：待发送 / 已送达
- 信件密码使用 scrypt 哈希存储，验证有频率限制
- 信件查看需先验证密码，获取 5 分钟有效 Token（x-letter-token header）

### 3.3 社区模块

**功能**：
- 发帖（文字最多 1000 字 + 最多 9 张图片）
- 图片上传（支持 jpg/png/gif/webp，单张 5MB 限制，不允许 SVG）
- 点赞/取消点赞
- 评论与回复（最多 300 字，支持嵌套，显示 @被回复人）
- 删除自己的帖子和评论（带确认弹窗）
- 点击头像/昵称查看用户公开信息卡片
- 遗书推送方式为「公开到社区」时，系统自动发布帖子

### 3.4 个人模块

**功能**：
- 编辑昵称（≤50 字）和个性签名（≤200 字）
- 头像上传
- 性别设置
- 邮箱显示/绑定/更换（通过验证码验证）
- 修改密码（需旧密码确认，修改后所有已登录设备强制下线）
- 打卡信息展示（当前状态、预警/推送期限天数、上次打卡时间、注册时间）
- 紧急联系人管理：
  - 添加联系人（称呼 ≤50 字，联系方式 ≤200 字）
  - 编辑/删除联系人
  - 通知方式：1=邮件、2=短信
- 退出登录

---

## 四、认证体系

### 4.1 注册（两步流程）

1. 用户提交邮箱 + 昵称 + 密码 → 系统发送 6 位验证码到邮箱
2. 用户提交验证码 → 系统创建账号，邮箱标记为已验证，自动登录

- 密码至少 4 位，服务端 scrypt 哈希存储（16 字节随机盐）
- 昵称唯一（数据库唯一索引约束，重复昵称返回 400）
- 邮箱唯一（已验证邮箱不可重复注册）

### 4.2 登录

- 支持昵称或邮箱登录（`account` 参数）
- 邮箱登录要求 email_verified = 1
- JWT 认证，token 存于 httpOnly cookie
- Token 有效期：注册 3 天，登录 7 天
- Cookie SameSite 策略动态适配 HTTP/HTTPS

### 4.3 Token 失效机制（token_version）

- JWT payload 包含 `tokenVersion` 字段
- 用户修改密码、重置密码、强制设置密码时，`users.token_version` 自增
- Auth 中间件每次请求校验 JWT 中的 tokenVersion 与数据库当前值
- 不匹配 → 返回 401，强制重新登录
- 效果：一处改密码，所有设备同时下线

### 4.4 邮箱验证

- 6 位数字验证码，5 分钟有效
- 最多 5 次错误尝试，超出后验证码作废
- 发送频率限制：同一邮箱 60 秒间隔，每日 10 次上限
- 新验证码自动作废同邮箱同类型的旧验证码
- 类型：register（注册）、bind（绑定/更换邮箱）、reset_password（重置密码）

### 4.5 邮箱绑定流程

- 旧账号（email IS NULL）登录后 `/api/auth/me` 返回 `needBindEmail: true`
- 前端显示绑定邮箱页面（类似强制设置密码流程）
- 已绑定邮箱的用户可在个人页面更换邮箱（需验证新邮箱）

### 4.6 密码重置

- 用户提交已注册邮箱 → 发送验证码
- 用户提交验证码 + 新密码 → 重置密码，token_version 自增

### 4.7 强制设置密码

- 旧数据迁移中无密码的账号，登录返回 403 + `needSetPassword: true`
- 前端引导用户设置密码后才能正常使用

---

## 五、安全防护

### 5.1 CSRF 防护

- 状态变更请求（POST/PUT/DELETE）校验 Origin/Referer 请求头
- 与 CORS_ORIGINS 白名单比对，不匹配返回 403
- GET/HEAD/OPTIONS 和无 Origin 的请求（原生 App、curl）放行

### 5.2 输入校验

所有用户输入均有字符长度上限，服务端强制校验：

| 字段 | 上限 | 适用端点 |
|------|------|---------|
| 昵称 | 50 字 | 注册、修改资料 |
| 个性签名 | 200 字 | 修改资料 |
| 信件标题 | 100 字 | 创建/编辑信件 |
| 信件内容 | 10000 字 | 创建/编辑信件 |
| 帖子内容 | 1000 字 | 发帖 |
| 评论内容 | 300 字 | 发评论/回复 |
| 通知自定义消息 | 500 字 | 打卡通知 |
| 联系人称呼 | 50 字 | 添加/编辑联系人 |
| 联系方式 | 200 字 | 添加/编辑联系人 |

### 5.3 其他安全措施

- CSP / X-Frame-Options / X-Content-Type-Options 安全响应头
- 速率限制（注册/登录 10次/15分钟，密码验证 20次/15分钟，改密 5次/15分钟）
- 图片上传过滤（扩展名白名单 .jpg/.jpeg/.png/.gif/.webp，SVG 禁止，MIME 类型检查，5MB 限制）
- 图片 URL 路径白名单校验（必须以 /uploads/ 开头）
- HTML 邮件模板 escapeHtml 防 XSS
- JWT_SECRET 必填，服务端启动时检查
- 信件访问 Token 一次性使用，防重放

---

## 六、联系人体系与遗书推送目标

两套独立的联系体系：

| | 紧急联系人 | 遗书推送目标 |
|--|-----------|------------|
| 管理位置 | 个人页面 | 写信时指定 |
| 作用 | 接收安好/求救/回来通知 | 接收遗书 |
| 通知方式 | 邮件、短信 | 邮件、短信、实体信、社区公开 |
| 人数 | 不限 | 每封信一个目标 |

---

## 七、后端调度器

每 5 分钟执行一次检查，使用递归 `setTimeout`（非 `setInterval`）—— 确保上次执行完成后才启动下一次，防止重叠执行。

**阶段1 — 预警期限超时检测**：
1. 查找 status='alert' 且 alert_started_at + alert_interval_days < now 的用户
2. 向该用户所有紧急联系人发送求救信息
3. 使用事务更新 status='push'，记录 push_started_at = now（WHERE status='alert' 防竞态）

**阶段2 — 推送期限超时检测**：
1. 查找 status='push' 且 push_started_at + push_interval_days < now 的用户
2. 逐个重新查询用户当前状态（第二次竞态防护：防止用户在查询列表后已完成打卡回退到 alert）
3. 状态已变更则跳过，否则查找所有未发送遗书（is_sent=0）
4. 按 push_method 逐封发送：
   - 邮件：通过 SMTP 发送 HTML 邮件
   - 短信/实体信：日志模拟
   - 社区公开：自动创建帖子
5. 发送成功标记 is_sent=1，记录 sent_at（使用 runCritical 立即持久化）

**阶段3 — 清理**：删除过期的邮箱验证码记录。

---

## 八、API 接口清单

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册第一步（发送验证码） |
| POST | /api/auth/register/verify | 注册第二步（验证码 + 创建用户） |
| POST | /api/auth/login | 登录（昵称或邮箱） |
| GET | /api/auth/me | 获取当前用户信息 |
| POST | /api/auth/logout | 退出登录 |
| POST | /api/auth/set-password | 强制设置密码（token_version+1） |
| POST | /api/auth/send-code | 发送邮箱验证码 |
| POST | /api/auth/bind-email | 绑定/更换邮箱 |
| POST | /api/auth/reset-password-request | 请求密码重置 |
| POST | /api/auth/reset-password | 重置密码（token_version+1） |

### 打卡
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/checkin | 获取打卡状态（倒计时、阶段、期限等） |
| POST | /api/checkin | 执行打卡 |
| POST | /api/checkin/notify | 打卡后通知联系人 |
| PUT | /api/checkin/interval | 设置预警/推送期限天数 |

### 写信
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/letters | 列出所有信件 |
| POST | /api/letters | 创建信件 |
| GET | /api/letters/:id | 获取信件详情（需 x-letter-token） |
| PUT | /api/letters/:id | 编辑信件 |
| DELETE | /api/letters/:id | 删除信件 |
| POST | /api/letters/:id/verify | 验证信件密码（返回 accessToken） |

### 社区
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/posts | 获取帖子列表 |
| POST | /api/posts | 发布帖子 |
| DELETE | /api/posts/:id | 删除帖子 |
| POST | /api/posts/:id/like | 点赞/取消点赞 |
| GET | /api/posts/:id/comments | 获取评论列表 |
| POST | /api/posts/:id/comments | 添加评论/回复 |
| DELETE | /api/comments/:id | 删除评论 |

### 个人与联系人
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/users/me | 获取个人信息 |
| PUT | /api/users/me | 编辑个人信息 |
| POST | /api/users/me/avatar | 上传头像 |
| POST | /api/users/me/change-password | 修改密码（token_version+1） |
| GET | /api/users/:id | 查看其他用户公开信息 |
| GET | /api/contacts | 列出紧急联系人 |
| POST | /api/contacts | 添加联系人 |
| PUT | /api/contacts/:id | 编辑联系人 |
| DELETE | /api/contacts/:id | 删除联系人 |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/upload | 上传图片 |
| GET | /api/nearby-clinics | 查询附近心理咨询机构 |

---

## 九、数据库表结构

### users
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | INTEGER PK | 自增 | |
| nickname | TEXT | '匿名用户' | 唯一索引 |
| email | TEXT | NULL | 唯一索引（WHERE email IS NOT NULL） |
| email_verified | INTEGER | 0 | 邮箱是否已验证 |
| signature | TEXT | '' | 个性签名 |
| avatar_url | TEXT | '' | 头像路径 |
| gender | TEXT | '' | 性别 |
| password | TEXT | NULL | scrypt 哈希 |
| force_reset | INTEGER | 0 | 是否需要设置密码 |
| token_version | INTEGER | 0 | JWT 版本号，改密时自增 |
| checkin_interval_days | INTEGER | 3 | 旧字段，保留兼容 |
| alert_interval_days | INTEGER | 3 | 预警期限天数 |
| push_interval_days | INTEGER | 3 | 推送期限天数 |
| status | TEXT | 'alert' | 当前阶段：alert/push |
| alert_started_at | TEXT | | 进入预警期限的时间 |
| push_started_at | TEXT | | 进入推送期限的时间 |
| last_checkin_at | TEXT | | 上次打卡时间 |
| created_at | TEXT | datetime('now') | |

### contacts（紧急联系人）
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | INTEGER PK | 自增 | |
| user_id | INTEGER | | 外键 → users.id |
| name | TEXT | | 联系人称呼 |
| notify_method | INTEGER | | 1=邮件 2=短信 |
| notify_target | TEXT | | 邮箱或手机号 |
| created_at | TEXT | datetime('now') | |

### letters（遗书）
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | INTEGER PK | 自增 | |
| user_id | INTEGER | | 外键 → users.id |
| title | TEXT | | 标题 |
| content | TEXT | | 内容 |
| push_method | INTEGER | | 1=邮件 2=短信 3=实体信 4=社区公开 |
| push_target | TEXT | | 推送目标地址 |
| password | TEXT | NULL | scrypt 哈希，可选 |
| is_sent | INTEGER | 0 | 是否已发送 |
| sent_at | TEXT | NULL | 发送时间 |
| created_at | TEXT | datetime('now') | |
| updated_at | TEXT | datetime('now') | |

### posts（社区帖子）
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | INTEGER PK | 自增 | |
| user_id | INTEGER | | 外键 → users.id |
| content | TEXT | | 帖子内容 |
| image_url | TEXT | '' | JSON 数组，图片路径 |
| likes | INTEGER | 0 | 点赞数 |
| created_at | TEXT | datetime('now') | |

### comments（评论）
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | INTEGER PK | 自增 | |
| post_id | INTEGER | | 外键 → posts.id |
| user_id | INTEGER | | 外键 → users.id |
| content | TEXT | | 评论内容 |
| reply_to_id | INTEGER | NULL | 回复的评论 ID |
| created_at | TEXT | datetime('now') | |

### post_likes（点赞）
| 字段 | 类型 | 说明 |
|------|------|------|
| post_id | INTEGER | 联合主键 |
| user_id | INTEGER | 联合主键 |

### email_verification_codes（邮箱验证码）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| email | TEXT | 邮箱地址 |
| code | TEXT | 6 位数字验证码 |
| type | TEXT | register / bind / reset_password |
| user_id | INTEGER | 关联用户 ID（bind/reset 时使用） |
| attempts | INTEGER | 已尝试次数，默认 0 |
| expires_at | TEXT | 过期时间 |
| created_at | TEXT | datetime('now') |

---

## 十、技术实现

### 当前 Demo 阶段
- 前端：React 19 + Vite 8 SPA
- 后端：Express.js 4 + sql.js（SQLite 内存数据库，持久化到文件）
- 认证：JWT + httpOnly Cookie + token_version 失效机制
- 邮件：阿里云邮件推送（SMTP），无配置时为日志模拟
- 短信/实体信：日志模拟
- 部署：Cloudflare Named Tunnel 内网穿刺

### 正式落地技术选型（方案A）
- 前端：Flutter
- 后端：NestJS + PostgreSQL
- 邮件推送：Resend / 阿里云邮件推送
- 短信推送：阿里云短信
- 实体邮信：二期实现
- 部署：Docker + 云服务器

### 安全措施
- JWT + httpOnly cookie 认证，含 token_version 失效机制
- CSRF 防护（Origin/Referer 请求头校验）
- scrypt 密码哈希
- 全端点输入长度校验
- CSP / X-Frame-Options / X-Content-Type-Options 安全头
- 速率限制（注册登录、密码验证、改密）
- 图片上传过滤（类型、大小、SVG 禁止）
- 图片 URL 路径白名单校验
- 信件访问 Token 一次性使用

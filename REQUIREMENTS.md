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
  - 可编辑自定义消息
  - 确认发送或跳过
- 预警/推送期限双滑块设置
- 温暖语录轮播（每 15-30 秒随机切换，30 条语录）
- 心理援助热线（全国24小时热线、北京危机干预中心、希望24热线）
- 附近心理咨询机构（基于高德地图 API，定位失败显示默认机构）
- 推送期限超时 + 有未发送遗书时显示红色警告

### 3.2 写信模块

**功能**：
- 遗书 CRUD（创建、查看、编辑、删除）
- 每封信件包含：标题、内容、推送方式、推送目标
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

### 3.3 社区模块

**功能**：
- 发帖（文字 + 最多 9 张图片）
- 图片上传（支持 jpg/png/gif/webp，单张 5MB 限制，不允许 SVG）
- 点赞/取消点赞
- 评论与回复（支持嵌套，显示 @被回复人）
- 删除自己的帖子和评论
- 遗书推送方式为「公开到社区」时，系统自动发布帖子

### 3.4 个人模块

**功能**：
- 编辑昵称和个性签名
- 打卡信息展示（当前状态、预警/推送期限天数、上次打卡时间、注册时间）
- 紧急联系人管理：
  - 添加联系人（称呼 + 通知方式 + 联系方式）
  - 编辑/删除联系人
  - 通知方式：1=邮件、2=短信
- 退出登录

---

## 四、认证体系

- 注册：昵称 + 密码（至少4位），昵称唯一
- 登录：昵称 + 密码
- JWT 认证，token 存于 httpOnly cookie，有效期 7 天
- 旧账号无密码时强制设置密码（forceReset 机制）
- 速率限制：注册/登录 15 分钟内最多 10 次，信件密码验证 15 分钟内最多 20 次

---

## 五、联系人体系与遗书推送目标

两套独立的联系体系：

| | 紧急联系人 | 遗书推送目标 |
|--|-----------|------------|
| 管理位置 | 个人页面 | 写信时指定 |
| 作用 | 接收安好/求救/回来通知 | 接收遗书 |
| 通知方式 | 邮件、短信 | 邮件、短信、实体信、社区公开 |
| 人数 | 不限 | 每封信一个目标 |

---

## 六、后端调度器

每 5 分钟执行一次检查：

**阶段1 — 预警期限超时检测**：
1. 查找 status='alert' 且 alert_started_at + alert_interval_days < now 的用户
2. 向该用户所有紧急联系人发送求救信息
3. 更新 status='push'，记录 push_started_at = now

**阶段2 — 推送期限超时检测**：
1. 查找 status='push' 且 push_started_at + push_interval_days < now 的用户
2. 查找该用户所有未发送遗书（is_sent=0）
3. 按 push_method 逐封发送：
   - 邮件：通过 SMTP 发送 HTML 邮件
   - 短信/实体信：日志模拟
   - 社区公开：自动创建帖子
4. 发送成功标记 is_sent=1，记录 sent_at

---

## 七、API 接口清单

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录 |
| GET | /api/auth/me | 获取当前用户信息 |
| POST | /api/auth/logout | 退出登录 |
| POST | /api/auth/set-password | 设置密码（旧账号强制） |

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
| GET | /api/letters/:id | 获取信件详情 |
| PUT | /api/letters/:id | 编辑信件 |
| DELETE | /api/letters/:id | 删除信件 |
| POST | /api/letters/:id/verify | 验证信件密码 |

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

## 八、数据库表结构

### users
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | INTEGER PK | 自增 | |
| nickname | TEXT | '匿名用户' | 唯一 |
| signature | TEXT | '' | 个性签名 |
| password | TEXT | NULL | scrypt 哈希 |
| force_reset | INTEGER | 0 | 是否需要设置密码 |
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

---

## 九、技术实现

### 当前 Demo 阶段
- 前端：React 19 + Vite SPA
- 后端：Express.js + sql.js（SQLite 内存数据库，持久化到文件）
- 邮件：阿里云邮件推送（SMTP），无配置时为日志模拟
- 短信/实体信：日志模拟
- 部署：Cloudflare Quick Tunnel 内网穿刺（需 `--protocol http2`）

### 正式落地技术选型（方案A）
- 前端：Flutter
- 后端：NestJS + PostgreSQL
- 邮件推送：Resend / 阿里云邮件推送
- 短信推送：阿里云短信
- 实体邮信：二期实现
- 部署：Docker + 云服务器

### 安全措施
- JWT + httpOnly cookie 认证
- scrypt 密码哈希
- CSP / X-Frame-Options / X-Content-Type-Options 安全头
- 速率限制（注册登录、密码验证）
- 图片上传过滤（类型、大小、SVG 禁止）
- 图片 URL 路径白名单校验

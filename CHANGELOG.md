# 更新日志

所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

---

## [Unreleased] — 2025-05-14

### 安全加固

- **密码强度提升**：最低位数从 4 位升至 8 位，必须同时包含字母和数字
- **timingSafeEqual 防时序攻击**：验证码比对和信件访问 Token 比对改用 `crypto.timingSafeEqual`，防止时序侧信道攻击
- **信件验证 Token 持久化**：`letter_verify_tokens` 表存入数据库，服务重启不丢失；Token 的增删改查均使用 `runCritical` 立即持久化
- **图片文件魔术字节校验**：上传图片时校验文件头魔数（JPG/PNG/GIF/WEBP），防止伪装扩展名攻击
- **跨验证码累计尝试限制**：30 分钟窗口内同一邮箱+类型累计尝试最多 15 次，超限后清除记录强制等待
- **IP 维度验证码发送限制**：新增 `sendCodeIPLimiter`，每小时每 IP 最多 30 次发送验证码请求
- **社区操作频率限制**：新增 `communityLimiter`，每分钟最多 6 次社区相关操作
- **JWT 仅从 Cookie 获取**：移除 `Authorization: Bearer` 头的 JWT 读取，仅从 httpOnly Cookie 获取，减少 Token 泄露面
- **trust proxy 收紧**：从 `1`（信任第一层代理）改为 `"loopback"`（仅信任本机回环代理）
- **所有关键写入改用 runCritical**：scheduler.js 中验证码清理、Token 清理、社区公开遗书、状态变更等操作均改为立即同步持久化

### 新功能

- **真实姓名字段**：用户可填写真实姓名（用于求救信声明身份），可选填，最多 50 字
- **身份声明增强**：预警→推送阶段通知联系人时，邮件包含身份声明块（姓名 + 注册邮箱），便于联系人确认身份
- **信件密码保护删除需验证**：有密码保护的信件删除时需先输入密码验证
- **联系人删除确认**：紧急联系人删除改为二次确认交互，避免误删
- **前端输入长度校验**：社区帖子 1000 字、评论 300 字、信件标题 100 字、信件内容 10000 字、密码 8-16 位等前端提示
- **联系人数量上限**：最多添加 8 个紧急联系人
- **统一 AlertModal 组件**：Community/Letters/Profile 页面使用一致的弹窗提示替代 `alert()`

### 修复

- **parseUTC 容错**：无效日期字符串返回 `null` 而非 `Invalid Date` 对象
- **信件日期显示**：`parseUTC` 返回 null 时不再调用 `.toLocaleDateString()` 报错
- **预警期限显示**：Profile 页面不再回退到 `checkin_interval_days`（已弃用字段），直接使用 `alert_interval_days`
- **种子数据修复**：默认用户插入语句移除已弃用的 `checkin_interval_days` 字段

### 变更

- **CLAUDE.md 更新**：反映密码策略变更、信件删除需 Token、DB 辅助函数使用规范、XSS 防护说明等
- **验证码清理策略调整**：保留 30 分钟内验证码记录用于累计尝试计数，过期时间从 `expires_at` 改为 `created_at + 30 minutes`

---

## [0.3.0] — 2025-05-13

### 安全加固

- **JWT token_version 失效机制**：密码修改/重置后自动递增 `token_version`，所有已登录设备强制下线
- **CSRF 防护**：POST/PUT/DELETE 请求校验 Origin/Referer 头
- **全端点输入校验**：所有用户输入限制字符长度
- **调度器竞态修复**：使用 `runTransaction` + `WHERE status` 保护状态变更

---

## [0.2.0] — 2025-05-12

### 新功能

- **邮箱绑定与两步注册**：注册需邮箱验证码，已有用户可绑定/更换邮箱
- **密码重置**：通过邮箱验证码重置密码
- **数据写入安全加固**：关键操作使用 `runCritical` 立即持久化

---

## [0.1.0] — 2025-05-07

### 新功能

- 双阶段打卡机制（预警期限 + 推送期限）
- 遗书 CRUD + 密码保护 + 四种推送方式
- 社区（帖子、点赞、嵌套评论）
- 个人资料编辑 + 紧急联系人管理
- Cloudflare Tunnel 部署方案

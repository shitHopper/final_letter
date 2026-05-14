# 安全设计文档

本文档记录「绝笔信」项目的安全设计决策、威胁模型和防护措施。

---

## 威胁模型

| 威胁 | 影响 | 防护措施 |
|------|------|----------|
| 密码暴力破解 | 账户接管 | scrypt 哈希 + 频率限制 + 密码强度策略 |
| JWT Token 被盗 | 未经授权访问 | httpOnly Cookie + token_version 失效 + CSRF 防护 |
| XSS 攻击 | 会话劫持/数据泄露 | React 自动转义 + escapeHtml + CSP 头 |
| CSRF 攻击 | 伪造用户操作 | Origin/Referer 校验 + SameSite Cookie |
| 时序侧信道攻击 | 绕过验证码/Token | crypto.timingSafeEqual |
| 文件上传攻击 | 服务器被植入恶意文件 | 扩展名白名单 + MIME 检查 + 魔术字节校验 + SVG 拦截 |
| 验证码暴力猜解 | 账户接管 | 单码 5 次尝试 + 30 分钟窗口 15 次累计 + IP 频率限制 |
| 竞态条件 | 数据不一致 | 事务 + WHERE 状态守卫 + 递归 setTimeout |

---

## 认证与授权

### JWT 机制

- Token 存储在 **httpOnly Cookie** 中，JavaScript 无法读取
- HTTPS 环境自动启用 `SameSite=None; Secure`
- HTTP 环境使用 `SameSite=Lax; Secure=False`
- Token 有效期：登录 7 天，注册 3 天

### token_version 失效机制

```
用户修改密码 → token_version + 1 → 所有已有 JWT 中的 tokenVersion 与 DB 不匹配 → 401 强制重新登录
```

触发场景：修改密码、重置密码、强制设置密码。

### 认证中间件

- 每次请求从 DB 读取最新 `token_version` 与 JWT payload 比对
- 不匹配返回 401，前端自动跳转登录页
- 仅从 Cookie 读取 JWT（不读取 Authorization 头，减少泄露面）

---

## 密码安全

| 策略 | 值 |
|------|----|
| 哈希算法 | Node.js crypto.scryptSync |
| 盐长度 | 16 字节随机盐 |
| 密钥长度 | 64 字节 |
| 最短密码 | 8 位 |
| 最长密码 | 16 位 |
| 复杂度要求 | 必须包含字母和数字 |

---

## 频率限制

| 端点/操作 | 限制 | 维度 |
|-----------|------|------|
| 登录/注册/发送验证码 | 10 次/15 分钟 | IP |
| 发送验证码（IP 维度） | 30 次/小时 | IP |
| 社区操作 | 6 次/分钟 | IP |
| 信件密码验证 | 20 次/15 分钟 | IP |
| 密码修改/重置 | 5 次/15 分钟 | IP |
| 验证码验证（单码） | 5 次尝试 | 邮箱+类型 |
| 验证码验证（30 分钟窗口累计） | 15 次 | 邮箱+类型 |
| 验证码发送间隔 | 60 秒 | 邮箱+类型 |
| 验证码每日上限 | 10 次/天 | 邮箱+类型 |

---

## 数据持久化安全

- 数据库使用 sql.js（SQLite 内存数据库）+ 500ms 节流写盘
- **关键写入**（`runCritical`）立即同步写盘，绕过节流：
  - 信件发送/删除
  - 用户状态变更（alert→push）
  - 验证码增删
  - 信件访问 Token 增删
  - 遗书公开到社区
- `SIGINT`/`SIGTERM` 信号处理强制写盘
- 所有事务使用 `runTransaction({ critical: true })`

---

## 信件访问保护

```
用户查看有密码的信件：
1. POST /api/letters/:id/verify（提交密码）
2. 服务端 scrypt 验证 + timingSafeEqual Token 比对
3. 验证通过 → 生成随机 32 字节 Token → 存入 letter_verify_tokens 表
4. 返回 accessToken（5 分钟有效）
5. 前端携带 x-letter-token 头访问 GET /api/letters/:id
6. Token 使用后立即删除（一次性）
7. 过期 Token 由调度器每 5 分钟清理
```

---

## 文件上传安全

1. **扩展名白名单**：仅允许 .jpg/.jpeg/.png/.gif/.webp
2. **SVG 拦截**：SVG 可内嵌 JavaScript，直接拒绝
3. **MIME 类型检查**：通过 `file-type` 包验证实际文件类型
4. **魔术字节校验**：读取文件头魔数与扩展名匹配
5. **大小限制**：5MB

---

## XSS 防护

- **前端**：React 默认 HTML 转义，禁止使用 `dangerouslySetInnerHTML` 渲染用户内容
- **后端邮件模板**：所有用户生成内容通过 `escapeHtml()` 转义
- **CSP 响应头**：限制脚本和样式来源
- **X-Content-Type-Options: nosniff**：防止 MIME 嗅探
- **X-Frame-Options: DENY**：防止点击劫持

---

## CSRF 防护

- POST/PUT/DELETE 请求校验 `Origin` 或 `Referer` 头
- 源必须在 `CORS_ORIGINS` 白名单内
- GET/HEAD/OPTIONS 请求豁免
- 无 Origin 头的请求（原生应用、curl）豁免
- 配合 SameSite Cookie 策略双重防护

---

## 已知局限（Demo 阶段）

- SQLite 单文件数据库，无并发写入能力，不适合生产环境
- SMS 和实体邮信推送方式仅模拟（console.log）
- 无 HTTPS 证书管理（依赖 Cloudflare Tunnel 终结 TLS）
- 无审计日志系统
- 无多因素认证（MFA）

# 邮箱绑定功能设计

## 概述

为账号系统增加邮箱绑定功能。邮箱用于：登录（支持昵称或邮箱）、密码找回、系统通知（打卡提醒等）。邮箱全局唯一，需通过验证码验证真实性。

## 数据模型变更

### users 表新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `email` | TEXT | NULL | 绑定邮箱，UNIQUE 约束 |
| `email_verified` | INTEGER | 0 | 0=未验证, 1=已验证 |

### 新增 email_verification_codes 表

```sql
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,         -- 'register' | 'bind' | 'reset_password'
  user_id INTEGER,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 迁移策略

- 现有用户 `email = NULL`, `email_verified = 0`
- 登录后检查 `email IS NULL` → 跳转绑定邮箱页面（类似 force-reset 流程）
- 新增 `needBindEmail` 状态字段

### 验证码清理

- 发送新验证码前，删除该 email + type 的旧验证码
- scheduler 定期清理过期验证码（5分钟轮询时顺便清理）

## API 变更

### 修改现有接口

**POST /api/auth/register**

- 新增必填参数 `email`
- 流程变更：验证 email 格式和唯一性 → 发送验证码 → 返回 `{ needVerifyEmail: true }`

**POST /api/auth/login**

- 参数 `nickname` 改为 `account`（接受昵称或邮箱）
- 后端逻辑：先按 nickname 查，没找到再按 email 查
- 错误提示改为"账号或密码错误"

**GET /api/auth/me**

- 返回中增加 `email`、`emailVerified`、`needBindEmail` 字段

### 新增接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/register/verify` | POST | 注册验证：提交 email + code + nickname + password |
| `/api/auth/send-code` | POST | 发送验证码（参数：email, type） |
| `/api/auth/bind-email` | POST | 绑定邮箱（参数：email, code） |
| `/api/auth/reset-password-request` | POST | 请求重置密码（参数：email），发送验证码 |
| `/api/auth/reset-password` | POST | 重置密码（参数：email, code, newPassword） |

### 频率限制

- 同一 email 60秒内只能发一次验证码
- 同一 email 每天最多10次
- 密码重置接口 rateLimit：5次/15分钟

## 前端流程变更

### 注册流程（两步）

1. 用户填写 email → 点"发送验证码" → `/api/auth/send-code` (type=register)
2. 用户填写 email + 验证码 + 昵称 + 密码 → `/api/auth/register/verify` 完成注册

### 登录流程

- 输入框 placeholder 改为"昵称或邮箱"
- 参数名从 `nickname` 改为 `account`
- 支持昵称或邮箱登录

### 现有用户绑定邮箱流程

- 登录后 `GET /api/auth/me` 返回 `needBindEmail: true`
- 前端跳转到绑定邮箱页面（类似 ForceResetPage）
- 流程：填写 email → 发送验证码 → 填写验证码 → `/api/auth/bind-email`
- 绑定成功后进入主界面

### 密码找回流程（新增）

- 登录页增加"忘记密码？"链接
- 流程：填写 email → 发送验证码 → 填写验证码 + 新密码 → 重置成功
- 重置成功后跳转登录页

### Profile 页面

- 显示当前绑定邮箱（部分遮掩，如 `j***@gmail.com`）
- 提供"更换邮箱"功能（需验证新邮箱）

## 安全设计

### 验证码安全

- 验证码 5 分钟过期
- 验证码验证失败 5 次后删除该 code，需重新发送
- 验证码正确验证后立即删除（一次性使用）
- 发送频率：60秒间隔，每天每 email 10次上限

### 密码重置安全

- 密码重置接口 rateLimit：5次/15分钟
- 重置后不自动登录，需重新登录

## 边界情况

- **邮箱已被占用**：绑定/注册时检查，返回"该邮箱已被其他账号绑定"
- **更换邮箱**：走 bind-email 流程提交新邮箱。新邮箱验证通过后才覆盖旧邮箱，验证失败则保留原邮箱
- **未验证邮箱**：邮箱验证通过后才能用于登录。注册时验证码通过即视为 `email_verified = 1`
- **SMTP 不可用**：与现有邮件发送逻辑一致，console 模拟。验证码正常生成存储
- **并发注册**：email UNIQUE 约束保证不会重复绑定

## 邮件模板

- 注册/绑定：验证码 + 5分钟有效期提示
- 密码重置：验证码 + 5分钟有效期提示
- 后续可扩展通知模板（打卡提醒等）

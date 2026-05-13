# 邮箱绑定功能 — 实现计划

## 步骤总览

1. DB schema 迁移（新增字段 + 新增表）
2. 后端：验证码工具函数 + 发送接口
3. 后端：注册流程改造（两步注册）
4. 后端：登录流程改造（支持邮箱登录）
5. 后端：现有用户强制绑定邮箱流程
6. 后端：密码找回接口
7. 后端：scheduler 清理过期验证码
8. 前端：注册页面改造（两步注册）
9. 前端：登录页面改造（昵称/邮箱登录）
10. 前端：强制绑定邮箱页面
11. 前端：密码找回页面
12. 前端：Profile 页面显示/更换邮箱
13. 更新 CLAUDE.md

---

## Step 1: DB schema 迁移

**文件**: `backend/db.js`

在 `initDb()` 中添加：
- `ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL` (try/catch)
- `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0` (try/catch)
- `CREATE TABLE IF NOT EXISTS email_verification_codes (...)`
- 为 email 列创建 UNIQUE 索引（需在新增列后处理）

注意：SQLite 不支持 ALTER TABLE ADD CONSTRAINT UNIQUE，需要通过创建唯一索引实现：
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL
```

## Step 2: 后端验证码工具函数 + 发送接口

**文件**: `backend/server.js`

### 2a. 验证码工具函数

```js
// 生成6位数字验证码
function generateVerificationCode() { ... }

// 验证邮箱格式
function isValidEmail(email) { ... }

// 邮箱遮掩（j***@gmail.com）
function maskEmail(email) { ... }
```

### 2b. 验证码发送频率检查

```js
// 检查60秒内是否已发送
function checkSendRateLimit(email, type) { ... }

// 检查当天发送次数
function checkDailyLimit(email) { ... }
```

### 2c. `POST /api/auth/send-code`

- 参数: `{ email, type }` (type = 'register' | 'bind' | 'reset_password')
- 验证 email 格式
- type=register 时检查 email 是否已注册
- type=bind 时检查 email 是否已被其他账号使用
- type=reset_password 时检查 email 是否有对应用户
- 频率限制检查
- 删除旧验证码，生成新验证码，存入 DB
- 调用 sendEmail 发送
- rateLimit: authLimiter

### 2d. 邮件模板

注册/绑定验证码邮件模板和密码重置验证码邮件模板，使用 escapeHtml。

## Step 3: 注册流程改造

**文件**: `backend/server.js`

### 3a. `POST /api/auth/register` 改造

- 新增必填参数 `email`
- 验证 email 格式 + 唯一性
- 验证 nickname + password
- 生成验证码，存入 DB（type='register'）
- 发送验证码邮件
- 返回 `{ needVerifyEmail: true, email }`

### 3b. 新增 `POST /api/auth/register/verify`

- 参数: `{ email, code, nickname, password }`
- 验证验证码（查找 email + type='register' + 未过期 + 匹配）
- 验证码错误 5 次删除该 code
- 验证通过后：删除验证码，创建用户（email, email_verified=1）
- 签发 JWT，返回 token + user

## Step 4: 登录流程改造

**文件**: `backend/server.js`

### `POST /api/auth/login` 改造

- 参数 `nickname` → `account`（兼容旧版：如果传 nickname 也接受）
- 查找逻辑：先 `WHERE nickname = ?`，没找到再 `WHERE email = ? AND email_verified = 1`
- 错误提示统一为"账号或密码错误"
- needSetPassword 逻辑保持不变
- 登录成功后返回 `needBindEmail: !user.email`

## Step 5: 现有用户强制绑定邮箱

**文件**: `backend/server.js`

### 5a. `GET /api/auth/me` 改造

- 返回增加 `email`, `emailVerified`, `needBindEmail` 字段

### 5b. 新增 `POST /api/auth/bind-email` (需 auth)

- 参数: `{ email, code }`
- 验证验证码（type='bind'）
- 验证 email 未被其他账号使用
- 更新当前用户的 email + email_verified=1
- 删除验证码

## Step 6: 密码找回接口

**文件**: `backend/server.js`

### 6a. 新增 `POST /api/auth/reset-password-request`

- 参数: `{ email }`
- 检查 email 对应用户存在且 email_verified=1
- 生成验证码（type='reset_password'），发送邮件
- rateLimit: passwordChangeLimiter

### 6b. 新增 `POST /api/auth/reset-password`

- 参数: `{ email, code, newPassword }`
- 验证验证码（type='reset_password'）
- 更新用户密码
- 不自动登录，返回成功提示

## Step 7: scheduler 清理过期验证码

**文件**: `backend/scheduler.js`

在 `checkOverdueAndSend()` 末尾添加：
```js
run("DELETE FROM email_verification_codes WHERE expires_at < datetime('now')");
```

## Step 8: 前端注册页面改造

**文件**: `frontend/src/App.jsx`

### LoginPage 改造

注册模式变为两步：
1. 步骤1：email 输入框 + "发送验证码"按钮
2. 步骤2：email（只读）+ 验证码 + 昵称 + 密码 + 确认密码

状态管理：
- `registerStep`: 1 或 2
- `email`, `code` 新增 state
- 发送验证码后显示60秒倒计时
- 验证码输入框 6位数字

## Step 9: 前端登录页面改造

**文件**: `frontend/src/App.jsx`

- 输入框 placeholder: "昵称" → "昵称或邮箱"
- 请求参数: `nickname` → `account`
- 新增"忘记密码？"链接
- 登录成功后检查 `needBindEmail` 状态

## Step 10: 强制绑定邮箱页面

**文件**: `frontend/src/App.jsx`

### 新增 `BindEmailPage` 组件

- 类似 ForceResetPage 的全屏流程
- 步骤：email 输入 → 发送验证码 → 填写验证码 → 提交绑定
- 绑定成功后进入主界面

### App.jsx 路由逻辑

- 在 forceReset 检查后增加 needBindEmail 检查
- `if (user.needBindEmail) return <BindEmailPage ... />`

## Step 11: 密码找回页面

**文件**: `frontend/src/App.jsx`

### 新增 `ResetPasswordPage` 组件

- 步骤：email 输入 → 发送验证码 → 验证码 + 新密码 + 确认密码
- 成功后跳转登录页

### LoginPage 中集成

- "忘记密码？"链接切换到 ResetPasswordPage
- 可在同一组件内用状态切换，避免增加路由复杂度

## Step 12: Profile 页面邮箱显示/更换

**文件**: `frontend/src/pages/Profile.jsx`

- 在"修改密码"卡片上方新增"绑定邮箱"卡片
- 显示当前邮箱（遮掩格式）+ 验证状态
- "更换邮箱"按钮 → 内联表单：新邮箱 → 发送验证码 → 验证码 → 提交
- 复用 send-code (type='bind') 和 bind-email 接口

## Step 13: 更新 CLAUDE.md

- 新增 email/email_verified 字段说明
- 新增 email_verification_codes 表
- 更新 API 端点列表
- 更新注册/登录流程说明
- 更新安全机制说明

---

## 实现顺序与依赖

```
Step 1 (DB) → Step 2 (验证码工具+发送) → Step 3 (注册) + Step 4 (登录) + Step 5 (绑定)
                                    → Step 6 (密码找回)
                                    → Step 7 (scheduler)

Step 3 → Step 8 (前端注册)
Step 4 → Step 9 (前端登录)
Step 5 → Step 10 (前端绑定邮箱)
Step 6 → Step 11 (前端密码找回)
Step 5 → Step 12 (Profile 邮箱)

所有前端步骤 → Step 13 (文档更新)
```

建议按 1→2→3→4→5→6→7→8→9→10→11→12→13 顺序线性实施，因为后端必须先就位前端才能测试。

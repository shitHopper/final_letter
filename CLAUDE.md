# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"绝笔信" (Farewell Letter) — a mobile web app where users periodically check in to confirm they're okay. The app uses a **two-phase check-in mechanism**:

1. **预警期限 (Alert phase)**: User must check in within `alert_interval_days` (1-7 days). If missed, the app enters the push phase.
2. **推送期限 (Push phase)**: A grace period of `push_interval_days` (1-7 days). If the user still doesn't check in, farewell letters are automatically sent via their chosen delivery method.

The app also includes emergency contacts (notified during alert→push transition), a community feed, and mental health resources.

## Tech Stack

**当前为 Demo 原型阶段**，使用 SQLite + React + Vite 快速验证功能。

**正式落地技术选型**（方案A：快速启动型）：
- 前端：Flutter
- 后端：NestJS + PostgreSQL
- 邮件推送：Resend / 阿里云邮件推送
- 短信推送：阿里云短信
- 实体邮信：二期实现，先预留接口
- 部署：Docker + 云服务器（阿里云/腾讯云）

## Architecture

**Monorepo with two separate directories:**
- `backend/` — Express.js server with sql.js (SQLite in-memory, persisted to file)
- `frontend/` — React 19 + Vite SPA with client-side routing via tab state

**No shared build system or workspace config.** Each directory has its own `package.json` and `node_modules`.

### Backend (`backend/`)
- `server.js` — Express server with all API routes and business logic (DB helpers imported from `db-helpers.js`)
- `db.js` — Database initialization, schema, migrations, and persistence (sql.js with throttled file save to `juebixin.db`)
- `db-helpers.js` — Shared DB helper functions (`all`, `run`, `runCritical`, `get`, `runTransaction`) used by both `server.js` and `scheduler.js`. `runCritical` performs immediate synchronous save (bypasses throttle) for key writes like letter send/delete.
- `scheduler.js` — Background scheduler that runs every 5 minutes to check for overdue users and trigger notifications/letter delivery
- `uploads/` — Multer-based image upload directory (5MB limit, images only, SVG blocked)
- Port: **3000** (or `PORT` env var; listens on `0.0.0.0`)

### Frontend (`frontend/`)
- `src/App.jsx` — Root component with login/register flow (two-step registration with email verification), force-reset password flow, bind-email flow, reset-password flow, bottom tab navigation (打卡/写信/社区/个人), ErrorBoundary
- `src/api.js` — Shared API utility with cookie-based auth, 401 auto-logout handling (no client-side `isLoggedIn` check — auth state determined by server `/api/auth/me` response)
- `src/pages/` — Four page components matching the tabs:
  - `Checkin.jsx` — Two-phase countdown (alert/push), one-tap check-in, post-checkin notify modal for contacts, nearby clinics (Amap API), mental health hotlines, rotating warm quotes
  - `Letters.jsx` — CRUD for farewell letters with server-side password protection (scrypt hash), letter access token flow, and push method selection
  - `Community.jsx` — Social feed with image uploads (up to 9 per post), likes, threaded comments, delete with confirmation, click user avatar/name to view profile card
  - `Profile.jsx` — User profile editing (nickname, signature, avatar upload, gender), email display/change, password change, emergency contacts management (CRUD), check-in stats display
- `src/App.css` — Single global stylesheet with CSS custom properties (theming via `:root` variables)
- Vite dev server proxies `/api` → `http://localhost:3000`, `/uploads` → `http://localhost:3000`, and `/amap` → `https://restapi.amap.com`

### Database Schema (SQLite via sql.js)
- `users` — id, nickname, password (scrypt hash), email, email_verified (0/1), signature, avatar_url, gender, checkin_interval_days (1-7), last_checkin_at, alert_interval_days, push_interval_days, status ('alert'|'push'), alert_started_at, push_started_at, force_reset, created_at
- `letters` — id, user_id, title, content, push_method (1-4), push_target, password (scrypt hash, optional), is_sent, sent_at, timestamps
- `posts` — id, user_id, content, image_url (JSON array), likes, created_at
- `comments` — id, post_id, user_id, content, reply_to_id (threaded), created_at
- `post_likes` — composite PK (post_id, user_id)
- `contacts` — id, user_id, name, notify_method (1=email, 2=SMS), notify_target, created_at
- `email_verification_codes` — id, email, code, type ('register'|'bind'|'reset_password'), user_id, attempts, expires_at, created_at

### Push Methods
1 = 电子邮件 (email, 阿里云邮件推送), 2 = 手机短信 (SMS, 模拟中), 3 = 实体邮信 (physical mail, 模拟中), 4 = 公开到社区 (community post, 已实现). Email delivery uses nodemailer with Aliyun SMTP; SMS and physical mail are simulated (console log).

## Authentication & Security

- **JWT-based auth**: Login/register issues JWT tokens stored in httpOnly cookies. Cookie options are dynamic: HTTPS uses `sameSite: 'none', secure: true`; HTTP uses `sameSite: 'lax', secure: false` (via `getCookieOptions(req)`). Token expires in 7 days.
- **Password hashing**: Server-side scrypt with random 16-byte salt. Minimum password length: 4 characters.
- **Force reset**: Users without a password can no longer log in directly — login returns `403` with `needSetPassword: true`. They must use `POST /api/auth/set-password` first.
- **Email binding**: Existing users without an email are redirected to a bind-email page after login (similar to force-reset flow). `GET /api/auth/me` returns `needBindEmail: true` when email is NULL.
- **Email verification codes**: 6-digit code, 5-minute expiry, max 5 failed attempts per code. Sending rate-limited: 60s interval, 10/day per email.
- **Registration**: Two-step — step 1 sends verification code to email, step 2 submits email + code + nickname + password. Email is marked verified upon successful registration.
- **Login**: Accepts `account` parameter (nickname or email). Email login requires `email_verified = 1`.
- **Auth middleware**: All API endpoints (except register/login/send-code) require valid JWT via `auth` middleware.
- **Rate limiting**: Register/login/send-code: 10 requests per 15 min; Letter password verification: 20 requests per 15 min; Password change/reset: 5 requests per 15 min.
- **Security headers**: CSP, X-Content-Type-Options, X-Frame-Options set on all responses.
- **XSS prevention**: HTML email templates use `escapeHtml()` for all user-generated content (nickname, message, letter title/content).
- **Image validation**: File extension whitelist (.jpg/.jpeg/.png/.gif/.webp), SVG blocked, MIME type check, 5MB limit.
- **JWT_SECRET env var required**: Server refuses to start without it.
- **Letter access tokens**: After password verification, a short-lived token (5 min TTL) is issued and must be passed as `x-letter-token` header to `GET /api/letters/:id`. Prevents replay of verified access.

## Environment Variables

- `JWT_SECRET` — Required. Strong random key for JWT signing.
- `AMAP_KEY` — Optional. Amap API key for nearby clinics. Falls back to hardcoded Beijing/Shanghai/Guangzhou clinics.
- `SMTP_HOST` — Default: `smtpdm.aliyun.com`
- `SMTP_PORT` — Default: `465`
- `SMTP_USER` / `SMTP_PASS` — Aliyun SMTP credentials. If absent, email sending is simulated (console log).
- `MAIL_FROM` — Default: `绝笔信 <noreply@yourdomain.com>`
- `CORS_ORIGINS` — Comma-separated allowed origins. Default: `http://localhost:5173,http://localhost:4173,https://juebixin.asia,https://www.juebixin.asia`
- `PORT` — Default: `3000`

## Scheduler (`scheduler.js`)

Runs every 5 minutes via `setInterval`:
1. **Phase 1 — Alert overdue**: Users in `alert` status whose `alert_started_at + alert_interval_days` has passed → notify all emergency contacts (求救信息), set status to `push`, record `push_started_at`. Status update uses `runTransaction` for race-condition protection (verifies status still `alert` before update, checks `getRowsModified()` to detect lost races).
2. **Phase 2 — Push overdue**: Users in `push` status whose `push_started_at + push_interval_days` has passed → send all unsent letters via their chosen push method. Successfully sent letters are marked via `runCritical` (immediate sync to avoid data loss on crash).
3. **Housekeeping**: Expired email verification codes are cleaned up each cycle.

## Development Commands

```bash
# Backend (from backend/)
npm install
npm run dev       # Start with --watch (auto-restart on changes)
npm start         # Start without watch

# Frontend (from frontend/)
npm install
npm run dev       # Vite dev server with HMR
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

Start backend first, then frontend — Vite proxy handles API routing.

**Production deployment**: Frontend is built to `frontend/dist/` and served by the backend as static files. Backend also serves `frontend/dist/index.html` as SPA fallback for all non-API routes. Supports Cloudflare tunnel for external access.

## Production Deployment (Cloudflare Tunnel)

域名：`juebixin.asia` / `www.juebixin.asia`，通过 Cloudflare Named Tunnel 内网穿刺部署。

1. 构建前端：`cd frontend && npm run build`
2. 启动后端：`cd backend && npm run dev`
3. 启动隧道：`E:\cloudflared-windows-amd64.exe tunnel run juebixin`

Tunnel 配置文件：`~/.cloudflared/config.yml`（ingress 规则指向 `http://localhost:3000`）

## API Endpoints Summary

### Auth
- `POST /api/auth/register` — 注册第一步（参数：email, nickname, password，发送验证码，返回 `needVerifyEmail: true`）
- `POST /api/auth/register/verify` — 注册第二步（参数：email, code, nickname, password，验证码通过后创建用户）
- `POST /api/auth/login` — 登录（参数 `account` 接受昵称或邮箱，无密码账号返回 403 + `needSetPassword: true`）
- `POST /api/auth/logout` — 登出
- `GET /api/auth/me` — 当前用户信息（含 `email`, `emailVerified`, `needBindEmail`）
- `POST /api/auth/set-password` — 强制设置密码
- `POST /api/auth/send-code` — 发送验证码（参数：email, type='register'|'bind'|'reset_password'）
- `POST /api/auth/bind-email` — 绑定/更换邮箱（参数：email, code，需 auth）
- `POST /api/auth/reset-password-request` — 请求重置密码（参数：email，发送验证码）
- `POST /api/auth/reset-password` — 重置密码（参数：email, code, newPassword）

### Users
- `GET /api/users/me` — 当前用户完整信息
- `PUT /api/users/me` — 更新个人资料（nickname, signature, avatarUrl, gender）
- `POST /api/users/me/avatar` — 上传头像
- `POST /api/users/me/change-password` — 修改密码
- `GET /api/users/:id` — 查看其他用户公开信息（nickname, avatar_url, gender, signature, created_at）

### Letters
- `GET /api/letters` — 列表（`has_password` 替代原 `password` 字段）
- `POST /api/letters` — 创建（push_method=4 时 pushTarget 可为空）
- `GET /api/letters/:id` — 详情（需 `x-letter-token` header，通过 verify 获取）
- `PUT /api/letters/:id` — 更新
- `DELETE /api/letters/:id` — 删除
- `POST /api/letters/:id/verify` — 验证信件密码，返回 `accessToken`（5分钟有效）

### Posts (Community)
- `GET /api/posts` — 列表（含 comment_count）
- `POST /api/posts` — 发帖
- `DELETE /api/posts/:id` — 删帖
- `POST /api/posts/:id/like` — 点赞/取消
- `GET /api/posts/:id/comments` — 评论列表
- `POST /api/posts/:id/comments` — 发评论/回复
- `DELETE /api/comments/:id` — 删评论

### Contacts
- `GET /api/contacts` — 列表
- `POST /api/contacts` — 添加
- `PUT /api/contacts/:id` — 编辑
- `DELETE /api/contacts/:id` — 删除

### Other
- `POST /api/upload` — 图片上传
- `GET /api/checkin` — 打卡状态（含 alert/push 倒计时）
- `POST /api/checkin` — 打卡
- `POST /api/checkin/notify` — 打卡后通知联系人
- `PUT /api/checkin/interval` — 更新打卡间隔（alertDays, pushDays）
- `GET /api/nearby-clinics` — 附近心理诊所（需 Amap API）

## Key Technical Details

- **sql.js persistence**: Database lives in memory and is throttled-saved to `juebixin.db` (500ms debounce). Data loss possible if process crashes within the debounce window. `SIGINT`/`SIGTERM` handlers force-save.
- **DB helpers**: Shared `all`, `run`, `runCritical`, `get`, `runTransaction` functions extracted into `db-helpers.js`. `run` now returns rows modified count. `runCritical` performs immediate synchronous file save (bypasses the 500ms throttle) for key writes where data loss on crash is unacceptable (letter send/delete, status transitions). `runTransaction` wraps operations in `BEGIN`/`COMMIT`/`ROLLBACK` for atomicity. Used by both `server.js` and `scheduler.js`.
- **Two-phase check-in**: `alert` → `push` → letter delivery. Check-in resets to `alert` phase, clears `push_started_at`, and updates `alert_started_at`. UPDATE uses `WHERE status IN ('alert', 'push')` to prevent overwriting scheduler state. Scheduler similarly uses `WHERE status = 'alert'` guard.
- **Letter password protection**: Server-side scrypt hash stored in `letters.password` column. Verification via `POST /api/letters/:id/verify` returns a short-lived `accessToken` (5 min). Subsequent `GET /api/letters/:id` requires `x-letter-token` header. `stripPassword()` also adds `has_password` boolean for frontend display.
- **Contact notifications**: On check-in, users can optionally notify contacts with preset ("我还安好" / "我已回来") or custom messages. On alert→push transition, contacts are automatically notified.
- **Amap integration**: Requires `AMAP_KEY` env var for nearby clinics. Falls back to hardcoded Beijing/Shanghai/Guangzhou clinics when key is missing or geolocation fails.
- **Image uploads**: Stored as files in `backend/uploads/`, served as static assets at `/uploads/`. Post image URLs validated server-side (must start with `/uploads/`, extension whitelist) and stored as JSON string arrays in the `image_url` column.
- **User profile cards in community**: Clicking avatar or name on posts/comments/replies shows a floating card with public profile info (nickname, avatar, gender, signature). Card is positioned near the clicked element. Implemented via `GET /api/users/:id` and `handleViewUser` in Community.jsx.
- **Avatar upload**: Users can upload avatar images via `POST /api/users/me/avatar` (multipart form). Avatars displayed throughout community (posts, comments, replies) and profile page.
- **Password change**: Authenticated users can change password via `POST /api/users/me/change-password` (requires old password verification, rate limited).
- **Email verification codes**: Stored in `email_verification_codes` table. Code is 6-digit numeric, 5-minute TTL, max 5 failed verification attempts per code. New code invalidates previous code for same email+type. Scheduler cleans up expired codes every 5 minutes. `verifyCode()` checks attempts and deletes code after 5 failures.
- **Email binding flow**: Existing users (`email IS NULL`) see `needBindEmail: true` from `/api/auth/me`, frontend shows `BindEmailPage` (similar to `ForceResetPage`). New users get email verified during registration. Email can be changed in Profile page via `/api/auth/bind-email` endpoint.
- **Chinese-language codebase**: UI text, comments, and error messages are in Chinese. Maintain this convention.

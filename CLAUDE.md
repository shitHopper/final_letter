# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"绝笔信" (Farewell Letter) — a mobile web app where users periodically check in to confirm they're okay. The app uses a **two-phase check-in mechanism**:

1. **预警期限 (Alert phase)**: User must check in within `alert_interval_days` (1-7 days). If missed, the app enters the push phase.
2. **推送期限 (Push phase)**: A grace period of `push_interval_days` (1-7 days). If the user still doesn't check in, farewell letters are automatically sent via their chosen delivery method.

The app also includes emergency contacts (notified during alert→push transition), a community feed, and mental health resources.

## Tech Stack

**当前为 Demo 原型阶段**，使用 SQLite + React + Vite 快速验证功能。

**正式落地技术选型（方案A）**: Flutter (前端) + NestJS + PostgreSQL (后端) + Resend/阿里云邮件推送 + 阿里云短信 + Docker 部署。实体邮信二期实现。

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
- `src/utils.js` — Shared utility functions (`parseUTC` for UTC datetime parsing)
- `src/App.css` — Single global stylesheet with CSS custom properties (theming via `:root` variables)
- Vite dev server proxies `/api` → `http://localhost:3000`, `/uploads` → `http://localhost:3000`, and `/amap` → `https://restapi.amap.com`

### Database Schema (SQLite via sql.js)
- `users` — id, nickname (unique index), password (scrypt hash), email, email_verified (0/1), signature, avatar_url, gender, checkin_interval_days (1-7), last_checkin_at, alert_interval_days, push_interval_days, status ('alert'|'push'), alert_started_at, push_started_at, force_reset, token_version (INTEGER DEFAULT 0, bumped on password change to invalidate JWTs), created_at
- `letters` — id, user_id, title, content, push_method (1-4), push_target, password (scrypt hash, optional), is_sent, sent_at, timestamps
- `posts` — id, user_id, content, image_url (JSON array), likes, created_at
- `comments` — id, post_id, user_id, content, reply_to_id (threaded), created_at
- `post_likes` — composite PK (post_id, user_id)
- `contacts` — id, user_id, name, notify_method (1=email, 2=SMS), notify_target, created_at
- `email_verification_codes` — id, email, code, type ('register'|'bind'|'reset_password'), user_id, attempts, expires_at, created_at
- `letter_verify_tokens` — letter_id (PK), token, expires_at

### Push Methods
1 = 电子邮件 (email, 阿里云邮件推送), 2 = 手机短信 (SMS, 模拟中), 3 = 实体邮信 (physical mail, 模拟中), 4 = 公开到社区 (community post, 已实现). Email delivery uses nodemailer with Aliyun SMTP; SMS and physical mail are simulated (console log).

## Authentication & Security

- **JWT-based auth**: Login/register issues JWT tokens stored in httpOnly cookies. Token payload includes `tokenVersion` for invalidation. Cookie options are dynamic: HTTPS uses `sameSite: 'none', secure: true`; HTTP uses `sameSite: 'lax', secure: false` (via `getCookieOptions(req)`). Token expires in 7 days (3 days for register).
- **token_version invalidation**: Password change/reset bumps `users.token_version`. Auth middleware compares JWT `tokenVersion` against DB — mismatch forces re-login. This invalidates all existing tokens for that user.
- **CSRF protection**: Middleware on state-changing requests (POST/PUT/DELETE) validates Origin/Referer header against allowed CORS origins. GET/HEAD/OPTIONS and requests without origin headers (native apps, curl) are exempt.
- **Password hashing**: Server-side scrypt with random 16-byte salt. Password length: 4–16 characters.
- **Input validation**: All user input has character limits enforced server-side: nickname ≤50, signature ≤200, letter title ≤100, letter content ≤10000, post content ≤1000, comment ≤300, check-in notify custom message ≤500, contact name ≤50, contact target ≤200, letter password ≤16.
- **Force reset**: Users without a password can no longer log in directly — login returns `403` with `needSetPassword: true`. They must use `POST /api/auth/set-password` first.
- **Email binding**: Existing users without an email are redirected to a bind-email page after login (similar to force-reset flow). `GET /api/auth/me` returns `needBindEmail: true` when email is NULL.
- **Email verification codes**: 6-digit code, 5-minute expiry, max 5 failed attempts per code. Sending rate-limited: 60s interval, 10/day per email.
- **Registration**: Two-step — step 1 sends verification code to email, step 2 submits email + code + nickname + password. Nickname uniqueness enforced at DB level (unique index), duplicates caught as 400. Email is marked verified upon successful registration.
- **Login**: Accepts `account` parameter (nickname or email). Email login requires `email_verified = 1`.
- **Auth middleware**: All API endpoints (except register/login/send-code) require valid JWT via `auth` middleware. Middleware queries DB for current `token_version` on each request.
- **Rate limiting**: Register/login/send-code: 10 requests per 15 min; Letter password verification: 20 requests per 15 min; Password change/reset: 5 requests per 15 min.
- **Security headers**: CSP, X-Content-Type-Options, X-Frame-Options set on all responses.
- **XSS prevention**: HTML email templates use `escapeHtml()` for all user-generated content (nickname, message, letter title/content).
- **Image validation**: File extension whitelist (.jpg/.jpeg/.png/.gif/.webp), SVG blocked, MIME type check, 5MB limit.
- **JWT_SECRET env var required**: Server refuses to start without it.
- **Letter access tokens**: After password verification, a short-lived token (5 min TTL) is issued and must be passed as `x-letter-token` header to `GET /api/letters/:id`. Tokens are persisted in `letter_verify_tokens` DB table (survives server restart). Scheduler cleans up expired tokens every 5 minutes. Prevents replay of verified access.

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

Runs every 5 minutes via recursive `setTimeout` (not `setInterval`) — ensures previous cycle completes before next starts, preventing overlapping executions.

1. **Phase 1 — Alert overdue**: Users in `alert` status whose `alert_started_at + alert_interval_days` has passed → notify all emergency contacts (求救信息), set status to `push`, record `push_started_at`. Uses `runTransaction` with `WHERE status = 'alert'` guard for race-condition protection.
2. **Phase 2 — Push overdue**: Users in `push` status whose `push_started_at + push_interval_days` has passed → re-queries current user status before acting (additional race-condition guard against check-in between query and send), then sends all unsent letters. Successfully sent letters marked via `runCritical` (immediate sync to avoid data loss on crash).
3. **Housekeeping**: Expired email verification codes and expired letter verify tokens are cleaned up each cycle.

## Development Commands

```bash
# Backend (from backend/)
npm install && npm run dev   # Start with --watch (auto-restart on changes)
npm start                    # Start without watch

# Frontend (from frontend/)
npm install && npm run dev   # Vite dev server with HMR
npm run build                # Production build → frontend/dist/
npm run lint                 # ESLint
npm run preview              # Preview production build
```

Start backend first, then frontend — Vite proxy handles API routing.

**Production deployment**: Frontend is built to `frontend/dist/` and served by the backend as static files. Backend also serves `frontend/dist/index.html` as SPA fallback for all non-API routes.

## Production Deployment (Cloudflare Tunnel)

域名：`juebixin.asia` / `www.juebixin.asia`，通过 Cloudflare Named Tunnel 内网穿刺部署。

1. 构建前端：`cd frontend && npm run build`
2. 启动后端：`cd backend && npm run dev`
3. 启动隧道：`E:\cloudflared-windows-amd64.exe tunnel run juebixin`

Tunnel 配置文件：`~/.cloudflared/config.yml`（ingress 规则指向 `http://localhost:3000`）

## API Endpoints Summary

### Auth
POST `/api/auth/register` (发验证码) → `/api/auth/register/verify` (验证码+创建用户) | `/api/auth/login` (account=nickname|email) | `/api/auth/logout` | `GET /api/auth/me` (含 email, emailVerified, needBindEmail) | `/api/auth/set-password` | `/api/auth/send-code` (type=register|bind|reset_password) | `/api/auth/bind-email` | `/api/auth/reset-password-request` → `/api/auth/reset-password`

### Users
`GET /api/users/me` | `PUT /api/users/me` (nickname, signature, avatarUrl, gender) | `POST /api/users/me/avatar` | `POST /api/users/me/change-password` | `GET /api/users/:id` (其他用户公开信息)

### Letters
`GET /api/letters` (has_password 替代 password) | `POST /api/letters` (push_method=4 时 pushTarget 可为空) | `GET /api/letters/:id` (需 x-letter-token header) | `PUT /api/letters/:id` | `DELETE /api/letters/:id` | `POST /api/letters/:id/verify` (返回 accessToken, 5min TTL)

### Posts (Community)
`GET /api/posts` (含 comment_count) | `POST /api/posts` | `DELETE /api/posts/:id` | `POST /api/posts/:id/like` (toggle) | `GET /api/posts/:id/comments` | `POST /api/posts/:id/comments` (replyToId 可选) | `DELETE /api/comments/:id`

### Contacts
`GET /api/contacts` | `POST /api/contacts` | `PUT /api/contacts/:id` | `DELETE /api/contacts/:id`

### Other
`POST /api/upload` | `GET /api/checkin` (含 alert/push 倒计时) | `POST /api/checkin` | `POST /api/checkin/notify` | `PUT /api/checkin/interval` (alertDays, pushDays) | `GET /api/nearby-clinics`

## Key Technical Details

- **sql.js persistence**: Database lives in memory and is throttled-saved to `juebixin.db` (500ms debounce). Data loss possible if process crashes within the debounce window. `SIGINT`/`SIGTERM` handlers force-save.
- **DB helpers**: Shared `all`, `run`, `runCritical`, `get`, `runTransaction` functions extracted into `db-helpers.js`. `run` returns rows modified count. `runCritical` performs immediate synchronous file save (bypasses the 500ms throttle) for key writes (letter send/delete, status transitions). `runTransaction` wraps operations in `BEGIN`/`COMMIT`/`ROLLBACK` for atomicity.
- **token_version flow**: JWT payload carries `tokenVersion`. Password change, password reset, and force-set-password all execute `token_version = token_version + 1`. Auth middleware reads current `token_version` from DB per request and rejects mismatched tokens with 401. This ensures stolen tokens are invalidated when the user changes their password.
- **Scheduler race protection**: Uses recursive `setTimeout` (not `setInterval`) to prevent overlapping executions. Phase 1 uses SQL-level `WHERE status = 'alert'` guard. Phase 2 re-queries user's current status before sending letters — skips if user has since checked in and returned to `alert`.
- **Two-phase check-in**: `alert` → `push` → letter delivery. Check-in resets to `alert` phase, clears `push_started_at`, and updates `alert_started_at`. UPDATE uses `WHERE status IN ('alert', 'push')` to prevent overwriting scheduler state.
- **Letter password protection**: Server-side scrypt hash stored in `letters.password` column. Verification via `POST /api/letters/:id/verify` returns a short-lived `accessToken` (5 min). Subsequent `GET /api/letters/:id` requires `x-letter-token` header. `stripPassword()` adds `has_password` boolean for frontend display. Edit form uses `has_password` (not `password`) to conditionally show the "清除密码保护" checkbox — sending `password: null` clears the password.
- **Contact notifications**: On check-in, users can optionally notify contacts with preset ("我还安好" / "我已回来") or custom messages (max 500 chars). On alert→push transition, contacts are automatically notified.
- **Amap integration**: Requires `AMAP_KEY` env var for nearby clinics. Falls back to hardcoded Beijing/Shanghai/Guangzhou clinics when key is missing or geolocation fails.
- **Image uploads**: Stored as files in `backend/uploads/`, served as static assets at `/uploads/`. Post image URLs validated server-side (must start with `/uploads/`, extension whitelist) and stored as JSON string arrays in the `image_url` column.
- **User profile cards in community**: Clicking avatar or name on posts/comments/replies shows a floating card with public profile info (nickname, avatar, gender, signature). Card is positioned near the clicked element. Implemented via `GET /api/users/:id` and `handleViewUser` in Community.jsx.
- **Email verification codes**: Stored in `email_verification_codes` table. Code is 6-digit numeric, 5-minute TTL, max 5 failed verification attempts per code. New code invalidates previous code for same email+type. Scheduler cleans up expired codes every 5 minutes.
- **Chinese-language codebase**: UI text, comments, and error messages are in Chinese. Maintain this convention.
- **Shared utilities**: `frontend/src/utils.js` contains shared helpers like `parseUTC()` (converts SQLite datetime strings to JS Date objects). Imported by Letters.jsx and Profile.jsx.

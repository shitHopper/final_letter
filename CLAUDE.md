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
- `server.js` — Single-file Express server containing all API routes and business logic
- `db.js` — Database initialization, schema, migrations, and persistence (sql.js with throttled file save to `juebixin.db`)
- `scheduler.js` — Background scheduler that runs every 5 minutes to check for overdue users and trigger notifications/letter delivery
- `uploads/` — Multer-based image upload directory (5MB limit, images only, SVG blocked)
- Port: **3000** (or `PORT` env var; listens on `0.0.0.0`)

### Frontend (`frontend/`)
- `src/App.jsx` — Root component with login/register flow, force-reset password flow, bottom tab navigation (打卡/写信/社区/个人), ErrorBoundary
- `src/api.js` — Shared API utility with cookie-based auth, 401 auto-logout handling
- `src/pages/` — Four page components matching the tabs:
  - `Checkin.jsx` — Two-phase countdown (alert/push), one-tap check-in, post-checkin notify modal for contacts, nearby clinics (Amap API), mental health hotlines, rotating warm quotes
  - `Letters.jsx` — CRUD for farewell letters with server-side password protection (scrypt hash) and push method selection
  - `Community.jsx` — Social feed with image uploads (up to 9 per post), likes, threaded comments, delete with confirmation
  - `Profile.jsx` — User profile editing (nickname, signature), emergency contacts management (CRUD), check-in stats display
- `src/App.css` — Single global stylesheet with CSS custom properties (theming via `:root` variables)
- Vite dev server proxies `/api` → `http://localhost:3001` and `/amap` → `https://restapi.amap.com`

### Database Schema (SQLite via sql.js)
- `users` — id, nickname, password (scrypt hash), signature, checkin_interval_days (1-7), last_checkin_at, alert_interval_days, push_interval_days, status ('alert'|'push'), alert_started_at, push_started_at, force_reset, created_at
- `letters` — id, user_id, title, content, push_method (1-4), push_target, password (scrypt hash, optional), is_sent, sent_at, timestamps
- `posts` — id, user_id, content, image_url (JSON array), likes, created_at
- `comments` — id, post_id, user_id, content, reply_to_id (threaded), created_at
- `post_likes` — composite PK (post_id, user_id)
- `contacts` — id, user_id, name, notify_method (1=email, 2=SMS), notify_target, created_at

### Push Methods
1 = 电子邮件 (email, 阿里云邮件推送), 2 = 手机短信 (SMS, 模拟中), 3 = 实体邮信 (physical mail, 模拟中), 4 = 公开到社区 (community post, 已实现). Email delivery uses nodemailer with Aliyun SMTP; SMS and physical mail are simulated (console log).

## Authentication & Security

- **JWT-based auth**: Login/register issues JWT tokens stored in httpOnly cookies (`sameSite: 'none', secure: true`). Token expires in 7 days.
- **Password hashing**: Server-side scrypt with random 16-byte salt. Minimum password length: 4 characters.
- **Force reset**: Users created before password requirement are flagged `force_reset = 1` and must set a password before using the app.
- **Auth middleware**: All API endpoints (except register/login) require valid JWT via `auth` middleware.
- **Rate limiting**: Register/login: 10 requests per 15 min; Letter password verification: 20 requests per 15 min.
- **Security headers**: CSP, X-Content-Type-Options, X-Frame-Options set on all responses.
- **Image validation**: File extension whitelist (.jpg/.jpeg/.png/.gif/.webp), SVG blocked, MIME type check, 5MB limit.
- **JWT_SECRET env var required**: Server refuses to start without it.

## Environment Variables

- `JWT_SECRET` — Required. Strong random key for JWT signing.
- `AMAP_KEY` — Optional. Amap API key for nearby clinics. Falls back to hardcoded Beijing/Shanghai/Guangzhou clinics.
- `SMTP_HOST` — Default: `smtpdm.aliyun.com`
- `SMTP_PORT` — Default: `465`
- `SMTP_USER` / `SMTP_PASS` — Aliyun SMTP credentials. If absent, email sending is simulated (console log).
- `MAIL_FROM` — Default: `绝笔信 <noreply@yourdomain.com>`
- `CORS_ORIGINS` — Comma-separated allowed origins. Default: `http://localhost:5173,http://localhost:4173`
- `PORT` — Default: `3000`

## Scheduler (`scheduler.js`)

Runs every 5 minutes via `setInterval`:
1. **Phase 1 — Alert overdue**: Users in `alert` status whose `alert_started_at + alert_interval_days` has passed → notify all emergency contacts (求救信息), set status to `push`, record `push_started_at`.
2. **Phase 2 — Push overdue**: Users in `push` status whose `push_started_at + push_interval_days` has passed → send all unsent letters via their chosen push method.

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

## Key Technical Details

- **sql.js persistence**: Database lives in memory and is throttled-saved to `juebixin.db` (500ms debounce). Data loss possible if process crashes within the debounce window. `SIGINT`/`SIGTERM` handlers force-save.
- **Two-phase check-in**: `alert` → `push` → letter delivery. Check-in resets to `alert` phase and updates `alert_started_at`.
- **Letter password protection**: Server-side scrypt hash stored in `letters.password` column. Verification via `POST /api/letters/:id/verify` with rate limiting.
- **Contact notifications**: On check-in, users can optionally notify contacts with preset ("我还安好" / "我已回来") or custom messages. On alert→push transition, contacts are automatically notified.
- **Amap integration**: Requires `AMAP_KEY` env var for nearby clinics. Falls back to hardcoded Beijing/Shanghai/Guangzhou clinics when key is missing or geolocation fails.
- **Image uploads**: Stored as files in `backend/uploads/`, served as static assets at `/uploads/`. Post image URLs validated server-side (must start with `/uploads/`, extension whitelist) and stored as JSON string arrays in the `image_url` column.
- **Chinese-language codebase**: UI text, comments, and error messages are in Chinese. Maintain this convention.

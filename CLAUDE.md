# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"绝笔信" (Farewell Letter) — a mobile app where users periodically check in to confirm they're okay. If a user misses a check-in beyond their set interval, pre-written farewell letters are automatically sent via their chosen delivery method (email, SMS, physical mail, or community post). The app also includes a community feed and mental health resources.

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
- `uploads/` — Multer-based image upload directory (5MB limit, images only)
- Port: **3001**

### Frontend (`frontend/`)
- `src/App.jsx` — Root component with bottom tab navigation (打卡/写信/社区/个人)
- `src/pages/` — Four page components matching the tabs:
  - `Checkin.jsx` — Countdown timer, one-tap check-in, nearby clinics (Amap API), mental health hotlines, rotating warm quotes
  - `Letters.jsx` — CRUD for farewell letters with client-side password protection (localStorage-based hash) and push method selection
  - `Community.jsx` — Social feed with image uploads (up to 9 per post), likes, threaded comments
  - `Profile.jsx` — User profile editing (nickname, signature)
- `src/App.css` — Single global stylesheet with CSS custom properties (theming via `:root` variables)
- Vite dev server proxies `/api` → `http://localhost:3001` and `/amap` → `https://restapi.amap.com`

### Database Schema (SQLite via sql.js)
- `users` — id, nickname, signature, checkin_interval_days (1-7), last_checkin_at, created_at
- `letters` — id, user_id, title, content, push_method (1-4), push_target, is_sent, timestamps
- `posts` — id, user_id, content, image_url (JSON array), likes, created_at
- `comments` — id, post_id, user_id, content, reply_to_id (threaded), created_at
- `post_likes` — composite PK (post_id, user_id)

### Push Methods
1 = 电子邮件 (email), 2 = 手机短信 (SMS), 3 = 实体邮信 (physical mail), 4 = 公开到社区 (community post). Actual delivery not yet implemented — letters are stored only.

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

Start backend first (port 3001), then frontend — Vite proxy handles API routing.

## Key Technical Details

- **sql.js persistence**: Database lives in memory and is throttled-saved to `juebixin.db` (500ms debounce). Data loss possible if process crashes within the debounce window.
- **Demo user**: `DEMO_USER_ID = 1` is hardcoded in App.jsx and seeded in db.js. No auth system exists yet.
- **Letter password protection**: Client-side only (localStorage with simple hash). Not cryptographically secure — this is a UI-level guard, not real security.
- **Amap integration**: Requires `AMAP_KEY` env var for nearby clinics. Falls back to hardcoded Beijing/Shanghai/Guangzhou clinics when key is missing or geolocation fails.
- **No authentication**: All API endpoints accept any user ID. No login/register flow yet.
- **Image uploads**: Stored as files in `backend/uploads/`, served as static assets at `/uploads/`. Post image URLs stored as JSON string arrays in the `image_url` column.
- **Chinese-language codebase**: UI text, comments, and error messages are in Chinese. Maintain this convention.

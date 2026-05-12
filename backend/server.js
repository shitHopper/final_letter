const express = require("express");
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const { initDb } = require("./db");
const { startScheduler } = require("./scheduler");
const { createHelpers } = require("./db-helpers");

const app = express();
app.set("trust proxy", 1);
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:5173", "http://localhost:4173", "https://juebixin.asia", "https://www.juebixin.asia"];
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// CSP 响应头，缓解 XSS 攻击
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' https://restapi.amap.com; " +
    "font-src 'self'; " +
    "frame-ancestors 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// Cookie 安全策略：根据请求协议动态选择
// HTTPS 环境（生产 Cloudflare）：sameSite=none + secure=true（支持跨域 cookie）
// HTTP 环境（本地开发）：sameSite=lax + secure=false
function getCookieOptions(req) {
  const isSecure = req.secure;
  return {
    httpOnly: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("错误: 未设置 JWT_SECRET 环境变量，出于安全考虑拒绝启动。");
  console.error("请在环境变量中设置一个强随机密钥，例如: JWT_SECRET=$(openssl rand -hex 32) node server.js");
  process.exit(1);
}
const AMAP_KEY = process.env.AMAP_KEY || "";

// ========== 速率限制 ==========

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10,
  message: { error: "请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

const letterVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "验证请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "密码修改请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Static file serving for uploaded images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Multer config for image uploads
const UPLOAD_ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const BLOCKED_MIMES = new Set(["image/svg+xml"]);

const storage = multer.diskStorage({
  destination: path.join(__dirname, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!UPLOAD_ALLOWED_EXTS.has(ext))
      return cb(new Error("不支持的图片格式，仅支持 jpg/png/gif/webp"));
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (BLOCKED_MIMES.has(file.mimetype))
      return cb(new Error("不允许上传 SVG 图片"));
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("只允许上传图片"));
  },
});

let db, saveDb;
let all, run, get, runTransaction;

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== 邮件发送 ==========

function createTransporter() {
  const host = process.env.SMTP_HOST || "smtpdm.aliyun.com";
  const port = Number(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  if (!user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

async function sendEmail(to, subject, html) {
  const from = process.env.MAIL_FROM || "绝笔信 <noreply@yourdomain.com>";
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[邮件-模拟] 收件人: ${to}, 主题: ${subject}`);
    return true;
  }
  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log(`[邮件-已发送] 收件人: ${to}, 主题: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[邮件-发送失败] 收件人: ${to}, 错误: ${err.message}`);
    return false;
  }
}

// ========== 安全工具：移除敏感字段 ==========

function stripPassword(obj) {
  if (!obj) return obj;
  const { password, ...rest } = obj;
  rest.has_password = !!password;
  return rest;
}

// ========== JWT 认证中间件 ==========

function auth(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
  if (!token)
    return res.status(401).json({ error: "未登录" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId };
    next();
  } catch {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

// ========== 密码工具 ==========

const SALT_LEN = 16;
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
}
function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, key] = stored.split(":");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return derived === key;
}

// ========== 信件验证 token ==========

const LETTER_VERIFY_TOKENS = new Map(); // letterId -> { expiresAt }
const VERIFY_TOKEN_TTL = 5 * 60 * 1000; // 5分钟有效

function issueVerifyToken(letterId) {
  const token = crypto.randomBytes(32).toString("hex");
  LETTER_VERIFY_TOKENS.set(letterId, { token, expiresAt: Date.now() + VERIFY_TOKEN_TTL });
  return token;
}

function consumeVerifyToken(letterId, token) {
  const entry = LETTER_VERIFY_TOKENS.get(letterId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt || entry.token !== token) {
    LETTER_VERIFY_TOKENS.delete(letterId);
    return false;
  }
  LETTER_VERIFY_TOKENS.delete(letterId);
  return true;
}

// 定期清理过期 token
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of LETTER_VERIFY_TOKENS) {
    if (now > entry.expiresAt) LETTER_VERIFY_TOKENS.delete(id);
  }
}, 60 * 1000);

// 托管前端文件夹，访问域名直接打开网页
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ========== 认证模块 ==========

app.post("/api/auth/register", authLimiter, (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !nickname.trim())
    return res.status(400).json({ error: "请输入昵称" });
  if (!password || password.length < 4)
    return res.status(400).json({ error: "密码至少4位" });
  const existing = get("SELECT * FROM users WHERE nickname = ?", [nickname.trim()]);
  if (existing)
    return res.status(400).json({ error: "注册失败，请尝试其他昵称" });
  const hashed = hashPassword(password);
  run("INSERT INTO users (nickname, password, signature, checkin_interval_days, last_checkin_at, alert_interval_days, push_interval_days, status, alert_started_at) VALUES (?, ?, '', 3, ?, 3, 3, 'alert', ?)",
    [nickname.trim(), hashed, new Date().toISOString(), new Date().toISOString()]);
  const user = get("SELECT * FROM users WHERE nickname = ?", [nickname.trim()]);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, getCookieOptions(req));
  res.json({ token, user: { id: user.id, nickname: user.nickname } });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !nickname.trim())
    return res.status(400).json({ error: "请输入昵称" });
  if (!password)
    return res.status(400).json({ error: "请输入密码" });
  const user = get("SELECT * FROM users WHERE nickname = ?", [nickname.trim()]);
  if (!user)
    return res.status(401).json({ error: "昵称或密码错误" });
  if (!user.password) {
    return res.status(403).json({ error: "账号需要设置密码后才能登录", needSetPassword: true });
  }
  if (!verifyPassword(password, user.password))
    return res.status(401).json({ error: "昵称或密码错误" });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, getCookieOptions(req));
  res.json({ token, user: { id: user.id, nickname: user.nickname, forceReset: !!user.force_reset } });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  const safe = stripPassword(user);
  safe.forceReset = !!user.force_reset;
  res.json(safe);
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", getCookieOptions(req));
  res.json({ success: true });
});

app.post("/api/auth/set-password", auth, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4)
    return res.status(400).json({ error: "密码至少4位" });
  const hashed = hashPassword(password);
  run("UPDATE users SET password = ?, force_reset = 0 WHERE id = ?", [hashed, req.user.id]);
  res.json({ success: true });
});

// ========== 打卡模块 ==========

app.get("/api/checkin", auth, (req, res) => {
  const user = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  const status = user.status || 'alert';
  const alertDays = user.alert_interval_days || 3;
  const pushDays = user.push_interval_days || 3;
  const now = Date.now();

  let deadline;
  if (status === 'push') {
    const pushStart = user.push_started_at ? new Date(user.push_started_at) : new Date();
    deadline = new Date(pushStart.getTime() + pushDays * 86400000);
  } else {
    const alertStart = user.alert_started_at ? new Date(user.alert_started_at) : new Date();
    deadline = new Date(alertStart.getTime() + alertDays * 86400000);
  }
  const remaining = Math.max(0, deadline.getTime() - now);
  const overdue = now > deadline.getTime();

  const unsentLetters = all("SELECT id, title, push_method FROM letters WHERE user_id = ? AND is_sent = 0", [req.user.id]);
  const contacts = all("SELECT id FROM contacts WHERE user_id = ?", [req.user.id]);

  res.json({
    status,
    alertIntervalDays: alertDays,
    pushIntervalDays: pushDays,
    deadline: deadline.toISOString(),
    remainingMs: remaining,
    overdue,
    unsentLetterCount: unsentLetters.length,
    contactsCount: contacts.length,
  });
});

app.post("/api/checkin", auth, (req, res) => {
  const user = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  const now = new Date().toISOString();
  const prevStatus = user.status || 'alert';

  // 使用 WHERE 条件防止覆盖调度器已更新的状态
  run("UPDATE users SET last_checkin_at = ?, alert_started_at = ?, push_started_at = NULL, status = 'alert' WHERE id = ? AND status IN ('alert', 'push')", [now, now, req.user.id]);

  const contacts = all("SELECT id FROM contacts WHERE user_id = ?", [req.user.id]);

  res.json({
    success: true,
    prevStatus,
    status: 'alert',
    canNotify: contacts.length > 0,
  });
});

app.post("/api/checkin/notify", auth, async (req, res) => {
  const { type, customMessage, contactIds } = req.body;
  if (!type || !['well', 'back'].includes(type))
    return res.status(400).json({ error: "无效的通知类型" });

  const user = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  let contacts;
  if (contactIds && contactIds.length > 0) {
    contacts = all("SELECT * FROM contacts WHERE user_id = ? AND id IN (" + contactIds.map(() => '?').join(',') + ")", [req.user.id, ...contactIds]);
  } else {
    contacts = all("SELECT * FROM contacts WHERE user_id = ?", [req.user.id]);
  }

  if (contacts.length === 0)
    return res.status(400).json({ error: "没有可通知的联系人" });

  const templates = {
    well: "我还安好，挂念着你，请你放心。",
    back: "麻烦解决，我已回来，请你放心。",
  };
  const subjects = {
    well: `${user.nickname} 报平安`,
    back: `${user.nickname} 已回来`,
  };
  const message = customMessage || templates[type];
  const subject = subjects[type];

  for (const contact of contacts) {
    if (contact.notify_method === 1) {
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#6c5ce7;">来自「绝笔信」的通知</h2>
        <p><strong>${escapeHtml(user.nickname)}</strong> 给你发来了一条消息：</p>
        <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin:16px 0;">
          <p style="white-space:pre-wrap;line-height:1.8;">${escapeHtml(message)}</p>
        </div>
        <p style="color:#636e72;font-size:12px;">此消息由「绝笔信」应用发送</p>
      </div>`;
      await sendEmail(contact.notify_target, subject, html);
    } else {
      console.log(`[短信-模拟] 收信人: ${contact.notify_target}, 内容: ${message}`);
    }
  }

  res.json({ success: true, notifiedCount: contacts.length });
});

app.put("/api/checkin/interval", auth, (req, res) => {
  const { alertDays, pushDays, days } = req.body;
  const alert = alertDays || days;
  const push = pushDays || days;
  if (!alert || alert < 1 || alert > 7) return res.status(400).json({ error: "预警期限需在1-7天之间" });
  if (!push || push < 1 || push > 7) return res.status(400).json({ error: "推送期限需在1-7天之间" });
  run("UPDATE users SET alert_interval_days = ?, push_interval_days = ?, checkin_interval_days = ? WHERE id = ?", [alert, push, alert, req.user.id]);
  res.json({ success: true, alertIntervalDays: alert, pushIntervalDays: push });
});

// ========== 写信模块 ==========

app.get("/api/letters", auth, (req, res) => {
  const letters = all("SELECT * FROM letters WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
  res.json(letters.map(stripPassword));
});

app.post("/api/letters", auth, (req, res) => {
  const { title, content, pushMethod, pushTarget, password } = req.body;
  if (!title || !content || !pushMethod)
    return res.status(400).json({ error: "缺少必填字段" });
  const method = Number(pushMethod);
  if (!Number.isInteger(method) || method < 1 || method > 4)
    return res.status(400).json({ error: "无效的推送方式" });
  if (method !== 4 && !pushTarget)
    return res.status(400).json({ error: "缺少推送目标" });
  const hashedLetterPw = password ? hashPassword(password) : null;
  run(
    "INSERT INTO letters (user_id, title, content, push_method, push_target, password) VALUES (?, ?, ?, ?, ?, ?)",
    [req.user.id, title, content, method, pushTarget || '', hashedLetterPw]
  );
  const row = get("SELECT last_insert_rowid() as id");
  res.json({ id: row.id, success: true });
});

app.put("/api/letters/:id", auth, (req, res) => {
  const { title, content, pushMethod, pushTarget, password } = req.body;
  if (!title || !content)
    return res.status(400).json({ error: "缺少必填字段" });
  const letter = get("SELECT * FROM letters WHERE id = ?", [req.params.id]);
  if (!letter) return res.status(404).json({ error: "信件不存在" });
  if (letter.user_id !== req.user.id)
    return res.status(403).json({ error: "无权修改他人信件" });
  const method = Number(pushMethod);
  if (!Number.isInteger(method) || method < 1 || method > 4)
    return res.status(400).json({ error: "无效的推送方式" });
  const newPw = password !== undefined ? (password ? hashPassword(password) : null) : letter.password;
  run(
    "UPDATE letters SET title = ?, content = ?, push_method = ?, push_target = ?, password = ?, updated_at = datetime('now') WHERE id = ?",
    [title, content, method, pushTarget, newPw, req.params.id]
  );
  res.json({ success: true });
});

app.post("/api/letters/:id/verify", auth, letterVerifyLimiter, (req, res) => {
  const letter = get("SELECT * FROM letters WHERE id = ?", [req.params.id]);
  if (!letter) return res.status(404).json({ error: "信件不存在" });
  if (letter.user_id !== req.user.id)
    return res.status(403).json({ error: "无权查看他人信件" });
  if (!letter.password) {
    const token = issueVerifyToken(letter.id);
    return res.json({ verified: true, accessToken: token });
  }
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "请输入密码" });
  if (!verifyPassword(password, letter.password))
    return res.status(403).json({ error: "密码错误" });
  const token = issueVerifyToken(letter.id);
  res.json({ verified: true, accessToken: token });
});

app.get("/api/letters/:id", auth, (req, res) => {
  const letter = get("SELECT * FROM letters WHERE id = ?", [req.params.id]);
  if (!letter) return res.status(404).json({ error: "信件不存在" });
  if (letter.user_id !== req.user.id)
    return res.status(403).json({ error: "无权查看他人信件" });
  if (letter.password) {
    const accessToken = req.headers['x-letter-token'];
    if (!accessToken || !consumeVerifyToken(letter.id, accessToken))
      return res.status(403).json({ error: "请先验证信件密码" });
  }
  res.json(stripPassword(letter));
});

app.delete("/api/letters/:id", auth, (req, res) => {
  const letter = get("SELECT * FROM letters WHERE id = ?", [req.params.id]);
  if (!letter) return res.status(404).json({ error: "信件不存在" });
  if (letter.user_id !== req.user.id)
    return res.status(403).json({ error: "无权删除他人信件" });
  run("DELETE FROM letters WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ========== 社区模块 ==========

app.get("/api/posts", auth, (req, res) => {
  const posts = all(
    `SELECT p.id, p.user_id, p.content, p.image_url, p.likes, p.created_at, u.nickname, u.avatar_url,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
     FROM posts p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`
  );

  const likedRows = all("SELECT post_id FROM post_likes WHERE user_id = ?", [req.user.id]);
  const likedSet = new Set(likedRows.map(r => r.post_id));
  posts.forEach(p => { p.liked = likedSet.has(p.id); p.comment_count = p.comment_count || 0; });

  res.json(posts);
});

const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function validateImageUrl(url) {
  if (typeof url !== "string") return false;
  if (!url.startsWith("/uploads/")) return false;
  const ext = path.extname(url).toLowerCase();
  return ALLOWED_IMAGE_EXTS.has(ext);
}

app.post("/api/posts", auth, (req, res) => {
  const { content, imageUrls } = req.body;
  if (!content) return res.status(400).json({ error: "缺少必填字段" });
  const urls = Array.isArray(imageUrls) ? imageUrls : [];
  if (urls.length > 9) return res.status(400).json({ error: "最多上传9张图片" });
  for (const u of urls) {
    if (!validateImageUrl(u)) return res.status(400).json({ error: "图片链接无效" });
  }
  run(
    "INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)",
    [req.user.id, content, JSON.stringify(urls)]
  );
  const row = get("SELECT last_insert_rowid() as id");
  res.json({ id: row.id, success: true });
});

app.post("/api/posts/:id/like", auth, (req, res) => {
  const post = get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  const existing = get("SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?", [req.params.id, req.user.id]);

  runTransaction(() => {
    if (existing) {
      db.run("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?", [req.params.id, req.user.id]);
      db.run("UPDATE posts SET likes = likes - 1 WHERE id = ? AND likes > 0", [req.params.id]);
    } else {
      db.run("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)", [req.params.id, req.user.id]);
      db.run("UPDATE posts SET likes = likes + 1 WHERE id = ?", [req.params.id]);
    }
  });

  res.json({ success: true, liked: !existing });
});

app.get("/api/posts/:id/comments", auth, (req, res) => {
  const comments = all(
    `SELECT c.id, c.post_id, c.user_id, c.content, c.reply_to_id, c.created_at, u.nickname, u.avatar_url
     FROM comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC`,
    [req.params.id]
  );
  res.json(comments);
});

app.post("/api/posts/:id/comments", auth, (req, res) => {
  const { content, replyToId } = req.body;
  if (!content) return res.status(400).json({ error: "缺少必填字段" });
  const post = get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  let replyTo = replyToId || null;
  if (replyTo) {
    const parentComment = get("SELECT id, post_id FROM comments WHERE id = ?", [replyTo]);
    if (!parentComment || parentComment.post_id !== Number(req.params.id))
      return res.status(400).json({ error: "回复的评论不存在或不属于该帖子" });
  }
  run(
    "INSERT INTO comments (post_id, user_id, content, reply_to_id) VALUES (?, ?, ?, ?)",
    [req.params.id, req.user.id, content, replyTo]
  );
  const row = get("SELECT last_insert_rowid() as id");
  res.json({ id: row.id, success: true });
});

app.delete("/api/posts/:id", auth, (req, res) => {
  const post = get("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  if (post.user_id !== req.user.id)
    return res.status(403).json({ error: "无权删除他人帖子" });
  runTransaction(() => {
    db.run("DELETE FROM post_likes WHERE post_id = ?", [req.params.id]);
    db.run("DELETE FROM comments WHERE post_id = ?", [req.params.id]);
    db.run("DELETE FROM posts WHERE id = ?", [req.params.id]);
  });
  res.json({ success: true });
});

app.delete("/api/comments/:id", auth, (req, res) => {
  const comment = get("SELECT * FROM comments WHERE id = ?", [req.params.id]);
  if (!comment) return res.status(404).json({ error: "评论不存在" });
  if (comment.user_id !== req.user.id)
    return res.status(403).json({ error: "无权删除他人评论" });
  runTransaction(() => {
    db.run("UPDATE comments SET reply_to_id = NULL WHERE reply_to_id = ?", [req.params.id]);
    db.run("DELETE FROM comments WHERE id = ?", [req.params.id]);
  });
  res.json({ success: true });
});

// ========== 图片上传 ==========

app.post("/api/upload", auth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未上传文件" });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// ========== 个人模块 ==========

app.get("/api/users/me", auth, (req, res) => {
  const user = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  res.json(stripPassword(user));
});

app.get("/api/users/:id", auth, (req, res) => {
  const user = get("SELECT id, nickname, avatar_url, gender, signature, created_at FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  res.json(user);
});

app.put("/api/users/me", auth, (req, res) => {
  const { nickname, signature, avatarUrl, gender } = req.body;
  const fields = [];
  const values = [];
  if (nickname !== undefined) { fields.push("nickname = ?"); values.push(nickname); }
  if (signature !== undefined) { fields.push("signature = ?"); values.push(signature); }
  if (avatarUrl !== undefined) {
    if (avatarUrl && !validateImageUrl(avatarUrl))
      return res.status(400).json({ error: "头像链接无效" });
    fields.push("avatar_url = ?"); values.push(avatarUrl);
  }
  if (gender !== undefined) {
    const validGenders = ["男", "女", "武装直升机", ""];
    if (!validGenders.includes(gender))
      return res.status(400).json({ error: "无效的性别选项" });
    fields.push("gender = ?"); values.push(gender);
  }
  if (fields.length === 0)
    return res.status(400).json({ error: "没有需要更新的字段" });
  values.push(req.user.id);
  run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
  res.json({ success: true });
});

app.post("/api/users/me/avatar", auth, upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未上传文件" });
  const avatarUrl = `/uploads/${req.file.filename}`;
  run("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarUrl, req.user.id]);
  res.json({ success: true, avatarUrl });
});

app.post("/api/users/me/change-password", auth, passwordChangeLimiter, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword)
    return res.status(400).json({ error: "请输入旧密码和新密码" });
  if (newPassword.length < 4)
    return res.status(400).json({ error: "新密码至少4位" });
  const user = get("SELECT password FROM users WHERE id = ?", [req.user.id]);
  if (!user.password || !verifyPassword(oldPassword, user.password))
    return res.status(403).json({ error: "旧密码错误" });
  const hashed = hashPassword(newPassword);
  run("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);
  res.json({ success: true });
});

// ========== 联系人模块 ==========

app.get("/api/contacts", auth, (req, res) => {
  const contacts = all("SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
  res.json(contacts);
});

app.post("/api/contacts", auth, (req, res) => {
  const { name, notifyMethod, notifyTarget } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "请输入联系人称呼" });
  const method = Number(notifyMethod);
  if (!Number.isInteger(method) || method < 1 || method > 2)
    return res.status(400).json({ error: "无效的通知方式" });
  if (!notifyTarget || !notifyTarget.trim())
    return res.status(400).json({ error: "请输入联系方式" });
  run(
    "INSERT INTO contacts (user_id, name, notify_method, notify_target) VALUES (?, ?, ?, ?)",
    [req.user.id, name.trim(), method, notifyTarget.trim()]
  );
  const row = get("SELECT last_insert_rowid() as id");
  res.json({ id: row.id, success: true });
});

app.put("/api/contacts/:id", auth, (req, res) => {
  const { name, notifyMethod, notifyTarget } = req.body;
  const contact = get("SELECT * FROM contacts WHERE id = ?", [req.params.id]);
  if (!contact) return res.status(404).json({ error: "联系人不存在" });
  if (contact.user_id !== req.user.id)
    return res.status(403).json({ error: "无权修改他人联系人" });
  const method = Number(notifyMethod);
  if (!Number.isInteger(method) || method < 1 || method > 2)
    return res.status(400).json({ error: "无效的通知方式" });
  run(
    "UPDATE contacts SET name = ?, notify_method = ?, notify_target = ? WHERE id = ?",
    [name.trim(), method, notifyTarget.trim(), req.params.id]
  );
  res.json({ success: true });
});

app.delete("/api/contacts/:id", auth, (req, res) => {
  const contact = get("SELECT * FROM contacts WHERE id = ?", [req.params.id]);
  if (!contact) return res.status(404).json({ error: "联系人不存在" });
  if (contact.user_id !== req.user.id)
    return res.status(403).json({ error: "无权删除他人联系人" });
  run("DELETE FROM contacts WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ========== 高德地图代理 ==========

app.get("/api/nearby-clinics", async (req, res) => {
  const { lng, lat } = req.query;
  const numLng = Number(lng);
  const numLat = Number(lat);
  if (!lng || !lat || !Number.isFinite(numLng) || !Number.isFinite(numLat)
    || numLng < -180 || numLng > 180 || numLat < -90 || numLat > 90)
    return res.status(400).json({ error: "经纬度参数无效" });
  if (!AMAP_KEY) {
    return res.json({ fallback: true, pois: [
      { name: "北京心理危机研究与干预中心", address: "北京市西城区德外安康胡同5号", tel: "010-82951332" },
      { name: "上海市精神卫生中心", address: "上海市徐汇区宛平南路600号", tel: "021-64387250" },
      { name: "广州市惠爱医院", address: "广州市荔湾区明心路36号", tel: "020-81899120" },
    ]});
  }
  try {
    const url = `https://restapi.amap.com/v3/place/around?key=${AMAP_KEY}&keywords=心理咨询&location=${numLng},${numLat}&radius=10000&offset=5&output=json`;
    const r = await fetch(url);
    const data = await r.json();
    const pois = (data.pois || []).map(poi => {
      const dist = Number(poi.distance);
      return {
        name: poi.name,
        address: poi.address || poi.pname + poi.cityname + poi.adname,
        distance: poi.distance && Number.isFinite(dist) && dist > 0
          ? (dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`)
          : "",
        tel: Array.isArray(poi.tel) ? poi.tel.join(", ") : (poi.tel || ""),
      };
    });
    res.json({ fallback: false, pois });
  } catch {
    res.json({ fallback: true, pois: [
      { name: "北京心理危机研究与干预中心", address: "北京市西城区德外安康胡同5号", tel: "010-82951332" },
      { name: "上海市精神卫生中心", address: "上海市徐汇区宛平南路600号", tel: "021-64387250" },
      { name: "广州市惠爱医院", address: "广州市荔湾区明心路36号", tel: "020-81899120" },
    ]});
  }
});

// SPA fallback: 所有非 API/非静态资源请求返回 index.html，交给前端路由处理
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// ========== 启动 ==========

initDb().then(({ db: _db, save }) => {
  db = _db;
  saveDb = save;
  const helpers = createHelpers(db, saveDb);
  all = helpers.all;
  run = helpers.run;
  get = helpers.get;
  runTransaction = helpers.runTransaction;
  startScheduler(db, saveDb);
  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
});

process.on("SIGINT", () => { saveDb(); process.exit(0); });
process.on("SIGTERM", () => { saveDb(); process.exit(0); });

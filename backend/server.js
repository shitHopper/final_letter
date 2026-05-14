const express = require("express");
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const nodemailer = require("nodemailer");
const { initDb } = require("./db");
const { startScheduler } = require("./scheduler");
const { createHelpers } = require("./db-helpers");

const app = express();
app.set("trust proxy", "loopback");
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:5173", "http://localhost:4173", "https://juebixin.asia", "https://www.juebixin.asia"];
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// CSRF 防护：HTTPS 环境下检查 Origin/Referer 请求头
// 当 Cookie sameSite=none 时，浏览器会携带 Cookie 跨站请求，攻击者可伪造请求
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next(); // 无来源头的请求放行（如原生 app、curl）
  try {
    const originHost = new URL(origin).host;
    const allowedHosts = CORS_ORIGINS.map(o => new URL(o).host);
    if (!allowedHosts.includes(originHost)) {
      return res.status(403).json({ error: "跨站请求被拒绝" });
    }
  } catch {
    return res.status(403).json({ error: "无效的请求来源" });
  }
  next();
});

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
    maxAge: 3 * 24 * 60 * 60 * 1000,
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

const sendCodeIPLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: "发送验证码过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

const communityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  message: { error: "操作过于频繁，请稍后再试" },
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
let all, run, runCritical, get, runTransaction;

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MAGIC_BYTES = {
  '.jpg':  [0xFF, 0xD8, 0xFF],
  '.jpeg': [0xFF, 0xD8, 0xFF],
  '.png':  [0x89, 0x50, 0x4E, 0x47],
  '.gif':  [0x47, 0x49, 0x46],
  '.webp': [0x52, 0x49, 0x46, 0x46],
};

function validateFileMagic(filePath, ext) {
  const magic = MAGIC_BYTES[ext];
  if (!magic) return false;
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  if (ext === '.webp') {
    return buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  }
  return true;
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
  const token = req.cookies?.token;
  if (!token)
    return res.status(401).json({ error: "未登录" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = get("SELECT token_version FROM users WHERE id = ?", [payload.userId]);
    if (!user)
      return res.status(401).json({ error: "用户不存在" });
    if (payload.tokenVersion !== (user.token_version || 0))
      return res.status(401).json({ error: "密码已修改，请重新登录" });
    req.user = { id: payload.userId };
    next();
  } catch {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

// ========== 密码工具 ==========

const SALT_LEN = 16;
function validatePasswordStrength(password) {
  if (!password || password.length < 8) return "密码至少8位";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
    return "密码需包含字母和数字";
  return null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
}
function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, key] = stored.split(":");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  if (derived.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(key));
}

// ========== 信件验证 token（持久化到数据库） ==========

const VERIFY_TOKEN_TTL = 5 * 60 * 1000; // 5分钟有效

function issueVerifyToken(letterId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL).toISOString();
  // 先清理该信件的旧 token，再插入新 token
  runCritical("DELETE FROM letter_verify_tokens WHERE letter_id = ?", [letterId]);
  runCritical("INSERT INTO letter_verify_tokens (letter_id, token, expires_at) VALUES (?, ?, ?)", [letterId, token, expiresAt]);
  return token;
}

function consumeVerifyToken(letterId, token) {
  const row = get("SELECT * FROM letter_verify_tokens WHERE letter_id = ?", [letterId]);
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    runCritical("DELETE FROM letter_verify_tokens WHERE letter_id = ?", [letterId]);
    return false;
  }
  try {
    const a = Buffer.from(row.token, 'hex');
    const b = Buffer.from(token, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  runCritical("DELETE FROM letter_verify_tokens WHERE letter_id = ?", [letterId]);
  return true;
}

// 托管前端文件夹，访问域名直接打开网页
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ========== 邮箱验证码工具 ==========

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 3))}@${domain}`;
}

function checkSendRateLimit(email, type) {
  // 30分钟窗口内累计尝试次数超限则禁止发送
  const totalRecord = get(
    "SELECT SUM(attempts) as total FROM email_verification_codes WHERE email = ? AND type = ? AND created_at > datetime('now', '-30 minutes')",
    [email, type]
  );
  if (totalRecord && totalRecord.total >= 15) {
    return false;
  }

  const recent = get(
    "SELECT created_at FROM email_verification_codes WHERE email = ? AND type = ? ORDER BY created_at DESC LIMIT 1",
    [email, type]
  );
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 60 * 1000) {
    return false;
  }
  // 使用 SQLite 本地时间计算今日零点，避免时区偏差
  const todayLocal = get("SELECT date('now', 'localtime') as d");
  const todayStart = todayLocal.d + ' 00:00:00';
  // created_at 用 datetime('now') 存 UTC，需转成本地时间再比较
  const dailyCount = get(
    "SELECT COUNT(*) as cnt FROM email_verification_codes WHERE email = ? AND datetime(created_at, 'localtime') >= ?",
    [email, todayStart]
  );
  if (dailyCount && dailyCount.cnt >= 10) {
    return false;
  }
  return true;
}

const VERIFY_CODE_TTL = 5 * 60 * 1000; // 5分钟

function sendCodeEmailTemplate(code, type) {
  const typeLabel = type === 'register' ? '注册' : type === 'bind' ? '绑定邮箱' : '重置密码';
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
    <h2 style="color:#6c5ce7;">「绝笔信」验证码</h2>
    <p>您正在进行<strong>${typeLabel}</strong>操作，验证码为：</p>
    <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin:16px 0;text-align:center;">
      <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#6c5ce7;">${escapeHtml(code)}</span>
    </div>
    <p style="color:#636e72;font-size:14px;">验证码5分钟内有效，请勿泄露给他人。</p>
    <p style="color:#636e72;font-size:12px;">如非本人操作，请忽略此邮件。</p>
  </div>`;
}

app.post("/api/auth/send-code", authLimiter, sendCodeIPLimiter, async (req, res) => {
  const { email, type } = req.body;
  if (!email || !isValidEmail(email.trim()))
    return res.status(400).json({ error: "请输入有效的邮箱地址" });
  const trimmedEmail = email.trim().toLowerCase();
  const validTypes = ['register', 'bind', 'reset_password'];
  if (!type || !validTypes.includes(type))
    return res.status(400).json({ error: "无效的验证码类型" });

  if (type === 'register') {
    const existing = get("SELECT id FROM users WHERE email = ? AND email_verified = 1", [trimmedEmail]);
    if (existing) return res.status(400).json({ error: "该邮箱已被注册" });
  } else if (type === 'bind') {
    const existing = get("SELECT id FROM users WHERE email = ? AND email_verified = 1", [trimmedEmail]);
    if (existing) return res.status(400).json({ error: "该邮箱已被其他账号绑定" });
  } else if (type === 'reset_password') {
    const existing = get("SELECT id FROM users WHERE email = ? AND email_verified = 1", [trimmedEmail]);
    if (!existing) return res.status(400).json({ error: "该邮箱未注册或未验证" });
  }

  if (!checkSendRateLimit(trimmedEmail, type))
    return res.status(429).json({ error: "发送过于频繁，请稍后再试" });

  // 删除该 email+type 的旧验证码
  runCritical("DELETE FROM email_verification_codes WHERE email = ? AND type = ?", [trimmedEmail, type]);

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFY_CODE_TTL).toISOString();
  runCritical("INSERT INTO email_verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)",
    [trimmedEmail, code, type, expiresAt]);

  const subject = type === 'reset_password' ? '绝笔信 - 密码重置验证码' : '绝笔信 - 验证码';
  // 先返回响应，再异步发送邮件（避免 SMTP 慢导致请求超时）
  res.json({ success: true, email: trimmedEmail });
  sendEmail(trimmedEmail, subject, sendCodeEmailTemplate(code, type)).catch(err => {
    console.error(`[邮件-异步发送失败] 收件人: ${trimmedEmail}, 错误: ${err.message}`);
  });
});

function verifyCode(email, code, type) {
  // 跨验证码累计尝试次数检查（30分钟窗口内最多15次）
  const totalRecord = get(
    "SELECT SUM(attempts) as total FROM email_verification_codes WHERE email = ? AND type = ? AND created_at > datetime('now', '-30 minutes')",
    [email, type]
  );
  const totalAttempts = (totalRecord?.total || 0) + 1;
  if (totalAttempts > 15) {
    runCritical("DELETE FROM email_verification_codes WHERE email = ? AND type = ? AND created_at > datetime('now', '-30 minutes')", [email, type]);
    return { valid: false, error: "尝试次数过多，请30分钟后再试" };
  }

  // 查找未过期且匹配的验证码
  const record = get(
    "SELECT * FROM email_verification_codes WHERE email = ? AND type = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1",
    [email, type]
  );
  if (!record) {
    return { valid: false, error: "验证码错误或已过期，请重新发送" };
  }

  const codeBufA = Buffer.from(String(record.code), 'utf8');
  const codeBufB = Buffer.from(String(code), 'utf8');
  if (codeBufA.length !== codeBufB.length || !crypto.timingSafeEqual(codeBufA, codeBufB)) {
    const newAttempts = (record.attempts || 0) + 1;
    if (newAttempts >= 5) {
      // 单验证码5次失败，删除该验证码
      runCritical("DELETE FROM email_verification_codes WHERE id = ?", [record.id]);
      return { valid: false, error: "验证码错误次数过多，请重新发送验证码" };
    }
    runCritical("UPDATE email_verification_codes SET attempts = ? WHERE id = ?", [newAttempts, record.id]);
    return { valid: false, error: "验证码错误" };
  }

  // 验证成功，删除该 email+type 所有验证码（一次性使用）
  runCritical("DELETE FROM email_verification_codes WHERE email = ? AND type = ?", [email, type]);
  return { valid: true, record };
}

// ========== 认证模块 ==========

app.post("/api/auth/register/verify", authLimiter, (req, res) => {
  const { email, code, nickname, password } = req.body;
  if (!email || !code || !nickname || !password)
    return res.status(400).json({ error: "缺少必填字段" });
  if (!nickname.trim())
    return res.status(400).json({ error: "昵称不能为空" });
  if (nickname.trim().length > 50)
    return res.status(400).json({ error: "昵称最多50个字符" });
  const pwError = validatePasswordStrength(password);
  if (pwError) return res.status(400).json({ error: pwError });
  if (password.length > 16)
    return res.status(400).json({ error: "密码最多16位" });
  const trimmedEmail = email.trim().toLowerCase();

  const result = verifyCode(trimmedEmail, code, 'register');
  if (!result.valid)
    return res.status(400).json({ error: result.error });

  // 再次检查昵称唯一性
  const existing = get("SELECT id FROM users WHERE nickname = ?", [nickname.trim()]);
  if (existing)
    return res.status(400).json({ error: "注册失败，请尝试其他昵称" });

  const hashed = hashPassword(password);
  const now = new Date().toISOString();
  try {
    runCritical("INSERT INTO users (nickname, password, email, email_verified, signature, last_checkin_at, alert_interval_days, push_interval_days, status, alert_started_at) VALUES (?, ?, ?, 1, '', ?, 3, 3, 'alert', ?)",
      [nickname.trim(), hashed, trimmedEmail, now, now]);
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: "注册失败，请尝试其他昵称" });
    }
    throw e;
  }
  const user = get("SELECT * FROM users WHERE email = ? AND email_verified = 1", [trimmedEmail]);
  const token = jwt.sign({ userId: user.id, tokenVersion: user.token_version || 0 }, JWT_SECRET, { expiresIn: "3d" });
  res.cookie("token", token, getCookieOptions(req));
  res.json({ token, user: { id: user.id, nickname: user.nickname } });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { account, nickname, password } = req.body;
  const accountValue = (account || nickname || '').trim();
  if (!accountValue)
    return res.status(400).json({ error: "请输入账号" });
  if (!password)
    return res.status(400).json({ error: "请输入密码" });
  // 先按昵称查，再按邮箱查
  let user = get("SELECT * FROM users WHERE nickname = ?", [accountValue]);
  if (!user) {
    user = get("SELECT * FROM users WHERE email = ? AND email_verified = 1", [accountValue.toLowerCase()]);
  }
  if (!user)
    return res.status(401).json({ error: "账号或密码错误" });
  if (!user.password) {
    return res.status(403).json({ error: "账号需要设置密码后才能登录", needSetPassword: true });
  }
  if (!verifyPassword(password, user.password))
    return res.status(401).json({ error: "账号或密码错误" });
  const token = jwt.sign({ userId: user.id, tokenVersion: user.token_version || 0 }, JWT_SECRET, { expiresIn: "3d" });
  res.cookie("token", token, getCookieOptions(req));
  res.json({ token, user: { id: user.id, nickname: user.nickname, forceReset: !!user.force_reset, needBindEmail: !user.email } });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = get(
    "SELECT id, nickname, signature, avatar_url, gender, real_name, email, email_verified, force_reset, alert_interval_days, push_interval_days, status, last_checkin_at, alert_started_at, push_started_at, created_at FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: "用户不存在" });
  user.forceReset = !!user.force_reset;
  user.emailVerified = !!user.email_verified;
  user.needBindEmail = !user.email;
  res.json(user);
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", getCookieOptions(req));
  res.json({ success: true });
});

app.post("/api/auth/bind-email", auth, (req, res) => {
  const { email, code } = req.body;
  if (!email || !isValidEmail(email.trim()))
    return res.status(400).json({ error: "请输入有效的邮箱地址" });
  if (!code)
    return res.status(400).json({ error: "请输入验证码" });
  const trimmedEmail = email.trim().toLowerCase();

  const result = verifyCode(trimmedEmail, code, 'bind');
  if (!result.valid)
    return res.status(400).json({ error: result.error });

  // 再次检查邮箱未被其他账号使用
  const existing = get("SELECT id FROM users WHERE email = ? AND email_verified = 1 AND id != ?", [trimmedEmail, req.user.id]);
  if (existing)
    return res.status(400).json({ error: "该邮箱已被其他账号绑定" });

  runCritical("UPDATE users SET email = ?, email_verified = 1 WHERE id = ?", [trimmedEmail, req.user.id]);
  res.json({ success: true, email: trimmedEmail });
});

app.post("/api/auth/set-password", auth, (req, res) => {
  const { password } = req.body;
  const pwError = validatePasswordStrength(password);
  if (pwError) return res.status(400).json({ error: pwError });
  if (password.length > 16)
    return res.status(400).json({ error: "密码最多16位" });
  const hashed = hashPassword(password);
  runCritical("UPDATE users SET password = ?, force_reset = 0, token_version = token_version + 1 WHERE id = ?", [hashed, req.user.id]);
  res.json({ success: true });
});

app.post("/api/auth/reset-password-request", passwordChangeLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email.trim()))
    return res.status(400).json({ error: "请输入有效的邮箱地址" });
  const trimmedEmail = email.trim().toLowerCase();
  const user = get("SELECT id FROM users WHERE email = ? AND email_verified = 1", [trimmedEmail]);
  if (!user)
    return res.status(400).json({ error: "该邮箱未注册或未验证" });

  if (!checkSendRateLimit(trimmedEmail, 'reset_password'))
    return res.status(429).json({ error: "发送过于频繁，请稍后再试" });

  runCritical("DELETE FROM email_verification_codes WHERE email = ? AND type = 'reset_password'", [trimmedEmail]);
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFY_CODE_TTL).toISOString();
  runCritical("INSERT INTO email_verification_codes (email, code, type, user_id, expires_at) VALUES (?, ?, 'reset_password', ?, ?)",
    [trimmedEmail, code, user.id, expiresAt]);

  // 先返回响应，再异步发送邮件
  res.json({ success: true });
  sendEmail(trimmedEmail, '绝笔信 - 密码重置验证码', sendCodeEmailTemplate(code, 'reset_password')).catch(err => {
    console.error(`[邮件-异步发送失败] 收件人: ${trimmedEmail}, 错误: ${err.message}`);
  });
});

app.post("/api/auth/reset-password", passwordChangeLimiter, (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword)
    return res.status(400).json({ error: "缺少必填字段" });
  const pwError = validatePasswordStrength(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  if (newPassword.length > 16)
    return res.status(400).json({ error: "密码最多16位" });
  const trimmedEmail = email.trim().toLowerCase();

  const result = verifyCode(trimmedEmail, code, 'reset_password');
  if (!result.valid)
    return res.status(400).json({ error: result.error });

  const user = get("SELECT id FROM users WHERE email = ? AND email_verified = 1", [trimmedEmail]);
  if (!user)
    return res.status(400).json({ error: "该邮箱未注册或未验证" });

  const hashed = hashPassword(newPassword);
  runCritical("UPDATE users SET password = ?, force_reset = 0, token_version = token_version + 1 WHERE id = ?", [hashed, user.id]);
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
  const now = new Date().toISOString();
  let prevStatus;
  let modified;

  // 事务保护：读状态 + 更新原子操作，防止调度器竞态覆盖；critical 立即持久化
  runTransaction(() => {
    const user = get("SELECT status FROM users WHERE id = ?", [req.user.id]);
    prevStatus = user?.status || 'alert';
    db.run("UPDATE users SET last_checkin_at = ?, alert_started_at = ?, push_started_at = NULL, status = 'alert' WHERE id = ? AND status IN ('alert', 'push')", [now, now, req.user.id]);
    modified = db.getRowsModified();
  }, { critical: true });

  if (!modified) {
    return res.status(409).json({ error: "打卡失败，状态可能已变更，请刷新重试" });
  }

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
  if (customMessage && customMessage.length > 500)
    return res.status(400).json({ error: "自定义消息最多500个字符" });

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
  const identityName = user.real_name || user.nickname;
  const subjects = {
    well: `${identityName} 报平安`,
    back: `${identityName} 已回来`,
  };
  const message = customMessage || templates[type];
  const subject = subjects[type];

  for (const contact of contacts) {
    if (contact.notify_method === 1) {
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#6c5ce7;">来自「绝笔信」的通知</h2>
        <p><strong>${escapeHtml(identityName)}</strong> 给你发来了一条消息：</p>
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
  runCritical("UPDATE users SET alert_interval_days = ?, push_interval_days = ? WHERE id = ?", [alert, push, req.user.id]);
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
  if (title.length > 100)
    return res.status(400).json({ error: "标题最多100个字符" });
  if (content.length > 10000)
    return res.status(400).json({ error: "信件内容最多10000个字符" });
  const method = Number(pushMethod);
  if (!Number.isInteger(method) || method < 1 || method > 4)
    return res.status(400).json({ error: "无效的推送方式" });
  if (method !== 4 && !pushTarget)
    return res.status(400).json({ error: "缺少推送目标" });
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: "查看密码至少8位" });
    if (password.length > 16) return res.status(400).json({ error: "查看密码最多16位" });
  }
  const hashedLetterPw = password ? hashPassword(password) : null;
  const row = runTransaction(() => {
    db.run("INSERT INTO letters (user_id, title, content, push_method, push_target, password) VALUES (?, ?, ?, ?, ?, ?)",
      [req.user.id, title, content, method, pushTarget || '', hashedLetterPw]);
    return get("SELECT last_insert_rowid() as id");
  }, { critical: true });
  res.json({ id: row.id, success: true });
});

app.put("/api/letters/:id", auth, (req, res) => {
  const { title, content, pushMethod, pushTarget, password } = req.body;
  if (!title || !content)
    return res.status(400).json({ error: "缺少必填字段" });
  if (title.length > 100)
    return res.status(400).json({ error: "标题最多100个字符" });
  if (content.length > 10000)
    return res.status(400).json({ error: "信件内容最多10000个字符" });
  const letter = get("SELECT * FROM letters WHERE id = ?", [req.params.id]);
  if (!letter) return res.status(404).json({ error: "信件不存在" });
  if (letter.user_id !== req.user.id)
    return res.status(403).json({ error: "无权修改他人信件" });
  const method = Number(pushMethod);
  if (!Number.isInteger(method) || method < 1 || method > 4)
    return res.status(400).json({ error: "无效的推送方式" });
  if (password !== undefined && password !== null && password !== '') {
    if (password.length < 8) return res.status(400).json({ error: "查看密码至少8位" });
    if (password.length > 16) return res.status(400).json({ error: "查看密码最多16位" });
  }
  const newPw = password !== undefined ? (password ? hashPassword(password) : null) : letter.password;
  runCritical(
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
  if (letter.password) {
    const accessToken = req.headers['x-letter-token'];
    if (!accessToken || !consumeVerifyToken(letter.id, accessToken))
      return res.status(403).json({ error: "请先验证信件密码后再删除" });
  }
  runCritical("DELETE FROM letters WHERE id = ?", [req.params.id]);
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

app.post("/api/posts", auth, communityLimiter, (req, res) => {
  const { content, imageUrls } = req.body;
  if (!content) return res.status(400).json({ error: "缺少必填字段" });
  if (content.length > 1000)
    return res.status(400).json({ error: "帖子内容最多1000个字符" });
  const urls = Array.isArray(imageUrls) ? imageUrls : [];
  if (urls.length > 9) return res.status(400).json({ error: "最多上传9张图片" });
  for (const u of urls) {
    if (!validateImageUrl(u)) return res.status(400).json({ error: "图片链接无效" });
  }
  const row = runTransaction(() => {
    db.run("INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)",
      [req.user.id, content, JSON.stringify(urls)]);
    return get("SELECT last_insert_rowid() as id");
  }, { critical: true });
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
  }, { critical: true });

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

app.post("/api/posts/:id/comments", auth, communityLimiter, (req, res) => {
  const { content, replyToId } = req.body;
  if (!content) return res.status(400).json({ error: "缺少必填字段" });
  if (content.length > 300)
    return res.status(400).json({ error: "评论最多300个字符" });
  const post = get("SELECT id FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  let replyTo = replyToId || null;
  if (replyTo) {
    const parentComment = get("SELECT id, post_id FROM comments WHERE id = ?", [replyTo]);
    if (!parentComment || parentComment.post_id !== Number(req.params.id))
      return res.status(400).json({ error: "回复的评论不存在或不属于该帖子" });
  }
  const row = runTransaction(() => {
    db.run("INSERT INTO comments (post_id, user_id, content, reply_to_id) VALUES (?, ?, ?, ?)",
      [req.params.id, req.user.id, content, replyTo]);
    return get("SELECT last_insert_rowid() as id");
  }, { critical: true });
  res.json({ id: row.id, success: true });
});

app.delete("/api/posts/:id", auth, (req, res) => {
  const post = get("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  if (post.user_id !== req.user.id)
    return res.status(403).json({ error: "无权删除他人帖子" });
  // 删除关联图片文件
  try {
    const urls = JSON.parse(post.image_url || '[]');
    for (const url of urls) {
      if (url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
  } catch (e) {
    console.error(`[清理] 删除帖子图片失败: ${e.message}`);
  }
  runTransaction(() => {
    db.run("DELETE FROM post_likes WHERE post_id = ?", [req.params.id]);
    db.run("DELETE FROM comments WHERE post_id = ?", [req.params.id]);
    db.run("DELETE FROM posts WHERE id = ?", [req.params.id]);
  }, { critical: true });
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
  }, { critical: true });
  res.json({ success: true });
});

// ========== 图片上传 ==========

app.post("/api/upload", auth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未上传文件" });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!validateFileMagic(req.file.path, ext)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "文件内容与格式不符" });
  }
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
  const { nickname, signature, avatarUrl, gender, realName } = req.body;
  if (nickname !== undefined && !nickname.trim())
    return res.status(400).json({ error: "昵称不能为空" });
  if (nickname !== undefined && nickname.length > 50)
    return res.status(400).json({ error: "昵称最多50个字符" });
  if (signature !== undefined && signature.length > 200)
    return res.status(400).json({ error: "个性签名最多200个字符" });
  if (realName !== undefined && realName.length > 50)
    return res.status(400).json({ error: "真实姓名最多50个字符" });
  const fields = [];
  const values = [];
  if (nickname !== undefined) { fields.push("nickname = ?"); values.push(nickname.trim()); }
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
  if (realName !== undefined) { fields.push("real_name = ?"); values.push(realName); }
  if (fields.length === 0)
    return res.status(400).json({ error: "没有需要更新的字段" });
  values.push(req.user.id);
  runCritical(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
  res.json({ success: true });
});

app.post("/api/users/me/avatar", auth, upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未上传文件" });
  const avatarUrl = `/uploads/${req.file.filename}`;
  runCritical("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarUrl, req.user.id]);
  res.json({ success: true, avatarUrl });
});

app.post("/api/users/me/change-password", auth, passwordChangeLimiter, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword)
    return res.status(400).json({ error: "请输入旧密码和新密码" });
  const pwError = validatePasswordStrength(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  if (newPassword.length > 16)
    return res.status(400).json({ error: "新密码最多16位" });
  const user = get("SELECT password FROM users WHERE id = ?", [req.user.id]);
  if (!user.password || !verifyPassword(oldPassword, user.password))
    return res.status(403).json({ error: "旧密码错误" });
  const hashed = hashPassword(newPassword);
  runCritical("UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?", [hashed, req.user.id]);
  res.json({ success: true });
});

// ========== 联系人模块 ==========

app.get("/api/contacts", auth, (req, res) => {
  const contacts = all("SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
  res.json(contacts);
});

const MAX_CONTACTS = 8;

app.post("/api/contacts", auth, (req, res) => {
  const { name, notifyMethod, notifyTarget } = req.body;
  const count = get("SELECT COUNT(*) as cnt FROM contacts WHERE user_id = ?", [req.user.id]);
  if (count.cnt >= MAX_CONTACTS)
    return res.status(400).json({ error: `最多添加${MAX_CONTACTS}个联系人` });
  if (!name || !name.trim()) return res.status(400).json({ error: "请输入联系人称呼" });
  if (name.trim().length > 50) return res.status(400).json({ error: "称呼最多50个字符" });
  if (notifyTarget && notifyTarget.trim().length > 200) return res.status(400).json({ error: "联系方式最多200个字符" });
  const method = Number(notifyMethod);
  if (!Number.isInteger(method) || method < 1 || method > 2)
    return res.status(400).json({ error: "无效的通知方式" });
  if (!notifyTarget || !notifyTarget.trim())
    return res.status(400).json({ error: "请输入联系方式" });
  const row = runTransaction(() => {
    db.run("INSERT INTO contacts (user_id, name, notify_method, notify_target) VALUES (?, ?, ?, ?)",
      [req.user.id, name.trim(), method, notifyTarget.trim()]);
    return get("SELECT last_insert_rowid() as id");
  }, { critical: true });
  res.json({ id: row.id, success: true });
});

app.put("/api/contacts/:id", auth, (req, res) => {
  const { name, notifyMethod, notifyTarget } = req.body;
  if (name && name.trim().length > 50) return res.status(400).json({ error: "称呼最多50个字符" });
  if (notifyTarget && notifyTarget.trim().length > 200) return res.status(400).json({ error: "联系方式最多200个字符" });
  const contact = get("SELECT * FROM contacts WHERE id = ?", [req.params.id]);
  if (!contact) return res.status(404).json({ error: "联系人不存在" });
  if (contact.user_id !== req.user.id)
    return res.status(403).json({ error: "无权修改他人联系人" });
  const method = Number(notifyMethod);
  if (!Number.isInteger(method) || method < 1 || method > 2)
    return res.status(400).json({ error: "无效的通知方式" });
  runCritical(
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
  runCritical("DELETE FROM contacts WHERE id = ?", [req.params.id]);
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
  } catch (err) {
    console.error('[高德API] 请求失败:', err.message);
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
  runCritical = helpers.runCritical;
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

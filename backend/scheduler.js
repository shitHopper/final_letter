const nodemailer = require("nodemailer");

let db, saveDb;
let checkInterval;

function all(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function run(query, params = []) {
  db.run(query, params);
  saveDb();
}

// ========== 邮件推送 ==========

function createTransporter() {
  const host = process.env.SMTP_HOST || "smtp.resend.com";
  const port = Number(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || process.env.RESEND_API_KEY || "";
  if (!user && !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

async function sendEmail(to, subject, html) {
  const from = process.env.MAIL_FROM || "绝笔信 <noreply@resend.dev>";
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

// ========== 社区公开 ==========

function publishToCommunity(userId, letter) {
  const content = `【遗书送达】${letter.title}\n\n${letter.content}`;
  run("INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)", [userId, content, "[]"]);
  console.log(`[社区-已公开] 用户${userId}的信件"${letter.title}"已公开到社区`);
}

// ========== 核心调度 ==========

async function checkOverdueAndSend() {
  const now = Date.now();

  // 找出所有超时用户
  const overdueUsers = all(`
    SELECT id, nickname, last_checkin_at, checkin_interval_days
    FROM users
    WHERE last_checkin_at IS NOT NULL
  `).filter(u => {
    const deadline = new Date(u.last_checkin_at).getTime() + u.checkin_interval_days * 86400000;
    return now > deadline;
  });

  if (overdueUsers.length === 0) return;

  for (const user of overdueUsers) {
    // 查找该用户未发送的遗书
    const letters = all("SELECT * FROM letters WHERE user_id = ? AND is_sent = 0", [user.id]);
    if (letters.length === 0) continue;

    console.log(`[调度] 用户"${user.nickname}"(id=${user.id})已超时，发现${letters.length}封未发送遗书`);

    for (const letter of letters) {
      let sent = false;

      switch (letter.push_method) {
        case 1: { // 电子邮件
          const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#6c5ce7;">来自「绝笔信」的一封信</h2>
            <p>用户 <strong>${user.nickname}</strong> 未能按时打卡，以下是其留下的信件：</p>
            <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin:16px 0;">
              <h3>${letter.title}</h3>
              <p style="white-space:pre-wrap;line-height:1.8;">${letter.content}</p>
            </div>
            <p style="color:#636e72;font-size:12px;">此信由「绝笔信」应用自动送达</p>
          </div>`;
          sent = await sendEmail(letter.push_target, `来自「绝笔信」的一封信：${letter.title}`, html);
          break;
        }
        case 2: { // 手机短信
          // 阿里云短信需企业认证，Demo 阶段仅打印日志
          console.log(`[短信-模拟] 收信人: ${letter.push_target}, 内容: ${letter.title} - ${letter.content.slice(0, 50)}...`);
          sent = true;
          break;
        }
        case 3: { // 实体邮信
          // 二期功能，Demo 阶段仅打印日志
          console.log(`[实体信-模拟] 收件地址: ${letter.push_target}, 标题: ${letter.title}`);
          sent = true;
          break;
        }
        case 4: { // 公开到社区
          publishToCommunity(user.id, letter);
          sent = true;
          break;
        }
        default:
          console.log(`[未知推送方式] method=${letter.push_method}`);
      }

      if (sent) {
        const sentAt = new Date().toISOString();
        run("UPDATE letters SET is_sent = 1, sent_at = ? WHERE id = ?", [sentAt, letter.id]);
      }
    }
  }
}

function startScheduler(dbInstance, saveFn) {
  db = dbInstance;
  saveDb = saveFn;

  // 每5分钟检查一次
  checkInterval = setInterval(checkOverdueAndSend, 5 * 60 * 1000);

  // 启动时立即检查一次
  checkOverdueAndSend();

  console.log("[调度器] 已启动，每5分钟检查超时用户并发送遗书");
}

function stopScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

module.exports = { startScheduler, stopScheduler };

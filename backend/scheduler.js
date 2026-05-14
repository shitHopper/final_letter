const nodemailer = require("nodemailer");
const { createHelpers } = require("./db-helpers");

let db, saveDb;
let all, run, runCritical, get, runTransaction;
let checkTimer;
let stopped = false;

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== 邮件推送 ==========

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

// ========== 联系人通知 ==========

async function notifyContacts(userId, subject, message) {
  const user = get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return;
  const contacts = all("SELECT * FROM contacts WHERE user_id = ?", [userId]);
  if (contacts.length === 0) {
    console.log(`[通知] 用户${userId}没有紧急联系人，跳过通知`);
    return;
  }

  for (const contact of contacts) {
    if (contact.notify_method === 1) {
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#e74c3c;">来自「绝笔信」的紧急通知</h2>
        <p><strong>${escapeHtml(user.nickname)}</strong> 的联系人收到以下消息：</p>
        <div style="background:#fff3cd;border-radius:12px;padding:16px;margin:16px 0;">
          <p style="white-space:pre-wrap;line-height:1.8;font-size:16px;">${escapeHtml(message)}</p>
        </div>
        <p style="color:#636e72;font-size:12px;">此消息由「绝笔信」应用自动发送</p>
      </div>`;
      await sendEmail(contact.notify_target, subject, html);
    } else {
      console.log(`[短信-模拟] 收信人: ${contact.notify_target}, 内容: ${message}`);
    }
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

  // ===== 阶段1：预警期限超时 → 发送求救信息，进入推送期限 =====
  const alertOverdueUsers = all(`
    SELECT id, nickname, alert_started_at, alert_interval_days
    FROM users
    WHERE status = 'alert' AND alert_started_at IS NOT NULL
  `).filter(u => {
    const deadline = new Date(u.alert_started_at).getTime() + u.alert_interval_days * 86400000;
    return now > deadline;
  });

  for (const user of alertOverdueUsers) {
    console.log(`[调度] 用户"${user.nickname}"(id=${user.id})预警期限超时，发送求救信息`);

    await notifyContacts(user.id, `紧急：${user.nickname} 可能需要帮助`, "我可能遇上了麻烦，我可能失联了，请寻找我。");

    // 事务保护：确认状态仍为 alert 再更新，防止与打卡接口竞态
    runTransaction(() => {
      db.run("UPDATE users SET status = 'push', push_started_at = ? WHERE id = ? AND status = 'alert'", [new Date().toISOString(), user.id]);
      if (!db.getRowsModified()) {
        console.log(`[调度] 用户${user.id}状态已变更，跳过更新`);
      }
    });
  }

  // ===== 阶段2：推送期限超时 → 发送遗书 =====
  const pushOverdueUsers = all(`
    SELECT id, nickname, push_started_at, push_interval_days
    FROM users
    WHERE status = 'push' AND push_started_at IS NOT NULL
  `).filter(u => {
    const deadline = new Date(u.push_started_at).getTime() + u.push_interval_days * 86400000;
    return now > deadline;
  });

  if (pushOverdueUsers.length === 0) return;

  for (const user of pushOverdueUsers) {
    try {
      // 重新查询用户当前状态，防止竞态条件：用户可能在查询列表后已完成打卡
      const current = get("SELECT status FROM users WHERE id = ?", [user.id]);
      if (!current || current.status !== 'push') {
        console.log(`[调度] 用户${user.id}状态已变更(${current?.status || '不存在'})，跳过发送`);
        continue;
      }

      const letters = all("SELECT * FROM letters WHERE user_id = ? AND is_sent = 0", [user.id]);
      if (letters.length === 0) continue;

      console.log(`[调度] 用户"${user.nickname}"(id=${user.id})推送期限超时，发现${letters.length}封未发送遗书`);

      for (const letter of letters) {
        let sent = false;

        switch (letter.push_method) {
          case 1: {
            const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <h2 style="color:#6c5ce7;">来自「绝笔信」的一封信</h2>
              <p>用户 <strong>${escapeHtml(user.nickname)}</strong> 未能按时打卡，以下是其留下的信件：</p>
              <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin:16px 0;">
                <h3>${escapeHtml(letter.title)}</h3>
                <p style="white-space:pre-wrap;line-height:1.8;">${escapeHtml(letter.content)}</p>
              </div>
              <p style="color:#636e72;font-size:12px;">此信由「绝笔信」应用自动送达</p>
            </div>`;
            sent = await sendEmail(letter.push_target, `来自「绝笔信」的一封信：${letter.title}`, html);
            break;
          }
          case 2: {
            console.log(`[短信-模拟] 收信人: ${letter.push_target}, 内容: ${letter.title} - ${letter.content.slice(0, 50)}...`);
            sent = true;
            break;
          }
          case 3: {
            console.log(`[实体信-模拟] 收件地址: ${letter.push_target}, 标题: ${letter.title}`);
            sent = true;
            break;
          }
          case 4: {
            publishToCommunity(user.id, letter);
            sent = true;
            break;
          }
          default:
            console.log(`[未知推送方式] method=${letter.push_method}`);
        }

        if (sent) {
          const sentAt = new Date().toISOString();
          runCritical("UPDATE letters SET is_sent = 1, sent_at = ? WHERE id = ?", [sentAt, letter.id]);
        }
      }
    } catch (err) {
      console.error(`[调度] 处理用户${user.id}推送信件时出错: ${err.message}`);
    }
  }

  // 清理过期验证码
  run("DELETE FROM email_verification_codes WHERE expires_at < datetime('now')");
  // 清理过期信件验证 token
  run("DELETE FROM letter_verify_tokens WHERE expires_at < datetime('now')");
}

function startScheduler(dbInstance, saveFn) {
  db = dbInstance;
  saveDb = saveFn;
  const helpers = createHelpers(db, saveDb);
  all = helpers.all;
  run = helpers.run;
  runCritical = helpers.runCritical;
  get = helpers.get;
  runTransaction = helpers.runTransaction;
  stopped = false;

  // 使用 setTimeout 递归替代 setInterval，确保上次执行完成后才启动下一次
  async function loop() {
    if (stopped) return;
    await checkOverdueAndSend();
    if (stopped) return;
    checkTimer = setTimeout(loop, 5 * 60 * 1000);
  }

  // 立即执行一次，然后每5分钟循环
  loop();

  console.log("[调度器] 已启动，每5分钟检查超时用户");
}

function stopScheduler() {
  stopped = true;
  if (checkTimer) {
    clearTimeout(checkTimer);
    checkTimer = null;
  }
}

module.exports = { startScheduler, stopScheduler };

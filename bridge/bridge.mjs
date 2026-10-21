#!/usr/bin/env node
/**
 * Telegram <-> OpenCode bridge.
 *
 * Listens for Telegram messages from allowed users and forwards them to an
 * OpenCode session through the local background service, then posts the
 * answer back to the chat.
 *
 * Usage:
 *   node bridge.mjs            start the bridge (foreground)
 *   node bridge.mjs --ask "…"  run one prompt in the configured workdir and print the answer
 *   node bridge.mjs --print-config
 *
 * Config: ~/.config/opencode/bridge.json
 * State:  ~/.config/opencode/bridge-state.json
 * Log:    ~/.config/opencode/bridge.log
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const home = os.homedir();
const configDir = path.join(home, ".config", "opencode");
const configPath = process.env.BRIDGE_CONFIG || path.join(configDir, "bridge.json");
const notifyPath = path.join(configDir, "notify.json");
const statePath = path.join(configDir, "bridge-state.json");
const logPath = path.join(configDir, "bridge.log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}`;
  try {
    fs.appendFileSync(logPath, line + "\n");
  } catch {}
  if (process.env.BRIDGE_VERBOSE) console.log(line);
}

process.on("uncaughtException", (error) => {
  log("uncaught:", error?.stack || String(error));
});
process.on("unhandledRejection", (error) => {
  log("unhandled:", error?.stack || String(error));
});

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function loadConfig() {
  const notify = readJson(notifyPath, {});
  const cfg = readJson(configPath, {});
  const config = {
    bot_token: cfg.bot_token || notify.bot_token || "",
    machine: String(cfg.machine || os.hostname() || "unknown").trim(),
    allowed_user_ids: (cfg.allowed_user_ids || []).map(String),
    workdir: cfg.workdir || path.join(home, "opencode-workspace"),
    auto_approve: cfg.auto_approve !== false,
    require_mention_in_groups: cfg.require_mention_in_groups !== false,
    max_minutes: Number(cfg.max_minutes || 15),
    opencode_bin: cfg.opencode_bin || "",
    signature: cfg.signature || "OpenCode Bridge",
  };
  return config;
}

const config = loadConfig();
const state = readJson(statePath, { offset: 0, sessions: {}, workdirs: {} });

function saveState() {
  writeJson(statePath, state);
}

function resolveOpencode() {
  if (config.opencode_bin) return config.opencode_bin;
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (process.platform !== "win32") return "opencode";

  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "opencode", "opencode.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const lines = execFileSync("where.exe", ["opencode"], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const cmd = lines.find((l) => l.toLowerCase().endsWith(".cmd"));
    if (cmd) {
      const exe = path.join(path.dirname(cmd), "node_modules", "@opencode", "cli", "bin", "opencode.exe");
      if (fs.existsSync(exe)) return exe;
    }
    const direct = lines.find((l) => l.toLowerCase().endsWith(".exe"));
    if (direct) return direct;
  } catch {}
  return "opencode";
}

const OPENCODE = resolveOpencode();

async function opencodeApi(method, endpoint, body) {
  const args = ["api", method, endpoint];
  if (body !== undefined) args.push("--data", JSON.stringify(body));
  const { stdout } = await execFileAsync(OPENCODE, args, {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    timeout: 120000,
  });
  const text = (stdout || "").trim();
  return text ? JSON.parse(text) : null;
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${config.bot_token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(`Telegram ${method}: ${data.description || response.status}`);
  }
  return data.result;
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function splitText(text, limit = 3900) {
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.6) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.6) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

async function send(chatId, text, replyTo) {
  const chunks = splitText(text);
  let first;
  for (let i = 0; i < chunks.length; i++) {
    const message = await telegram("sendMessage", {
      chat_id: chatId,
      text: chunks[i],
      ...(i === 0 && replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
    });
    if (i === 0) first = message;
  }
  return first;
}

async function edit(chatId, messageId, text) {
  try {
    await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000) });
  } catch (error) {
    log("edit failed:", error.message);
  }
}

let botUsername = "";
let me;

async function ensureSession(chatId) {
  const workdir = path.resolve(state.workdirs[chatId] || config.workdir);
  const key = `${chatId}::${workdir}`;
  const existing = state.sessions[key];
  if (existing) {
    try {
      await opencodeApi("get", `/api/session/${existing}`);
      return { sessionID: existing, workdir, key };
    } catch {
      delete state.sessions[key];
    }
  }
  const created = await opencodeApi("post", "/api/session", {
    title: `Telegram ${chatId}`,
    location: { directory: workdir.replace(/\\/g, "/") },
  });
  const sessionID = created.data.id;
  state.sessions[key] = sessionID;
  saveState();
  log("created session", sessionID, "in", workdir);
  return { sessionID, workdir, key };
}

async function getMessages(sessionID) {
  const response = await opencodeApi("get", `/api/session/${sessionID}/message?limit=100`);
  return response?.data || [];
}

async function collectAnswer(sessionID, baseline) {
  const messages = await getMessages(sessionID);
  const fresh = messages.filter((message) => !baseline.has(message.id));
  const idle = fresh.find((message) => message.type === "idle");
  const parts = [];
  for (const message of fresh) {
    if (message.type !== "assistant") continue;
    for (const content of message.content || []) {
      if (content.type === "text" && content.text && content.text.trim()) parts.push(content.text.trim());
    }
  }
  return { idle, text: parts.join("\n\n").trim() };
}

async function autoReplyPermissions(sessionID) {
  let pending = [];
  try {
    pending = (await opencodeApi("get", `/api/session/${sessionID}/permission`))?.data || [];
  } catch {
    return;
  }
  for (const request of pending) {
    const decision = config.auto_approve ? "once" : "reject";
    try {
      await opencodeApi("post", `/api/session/${sessionID}/permission/${request.id}/reply`, {
        decision,
        message: config.auto_approve ? undefined : "Auto-rejected by the Telegram bridge.",
      });
      log("permission", request.id, request.action, "->", decision);
    } catch (error) {
      log("permission reply failed:", error.message);
    }
  }
}

const queue = [];
let active = null;

async function runJob(job) {
  const { chatId, text, replyTo, ack } = job;
  let sessionID;
  try {
    const session = await ensureSession(chatId);
    sessionID = session.sessionID;
    const baseline = new Set((await getMessages(sessionID)).map((message) => message.id));
    const started = Date.now();
    await opencodeApi("post", `/api/session/${sessionID}/prompt`, { text });
    const deadline = started + config.max_minutes * 60 * 1000;

    while (Date.now() < deadline) {
      await sleep(1500);
      await autoReplyPermissions(sessionID);
      const { idle, text: answer } = await collectAnswer(sessionID, baseline);
      if (!idle) continue;

      const seconds = Math.round((Date.now() - started) / 1000);
      if (idle.outcome === "succeeded") {
        const body = answer || "(không có nội dung trả về)";
        const chunks = splitText(`✅ Xong (${seconds}s) · ${config.machine}\n\n${body}`);
        await edit(chatId, ack.message_id, chunks[0]);
        for (let index = 1; index < chunks.length; index++) {
          await send(chatId, chunks[index]);
        }
      } else {
        const reason = idle.error?.message || idle.outcome || "unknown";
        await edit(chatId, ack.message_id, `❌ Lỗi (${seconds}s) · ${config.machine}: ${reason.slice(0, 1000)}`);
      }
      log("job done", sessionID, idle.outcome, seconds + "s");
      return;
    }

    await opencodeApi("post", `/api/session/${sessionID}/interrupt`, {}).catch(() => {});
    await edit(chatId, ack.message_id, `⏱️ [${config.machine}] Quá ${config.max_minutes} phút — đã dừng. Gửi /stop để dừng ngay lần sau.`);
    log("job timeout", sessionID);
  } catch (error) {
    log("job error:", error.message);
    const detail = (error.stderr || error.stdout || error.message || "").toString().slice(0, 800);
    if (ack?.message_id) await edit(chatId, ack.message_id, `❌ [${config.machine}] Lỗi: ${detail}`);
    else await send(chatId, `❌ [${config.machine}] Lỗi: ${detail}`).catch(() => {});
  }
}

async function processQueue() {
  if (active || !queue.length) return;
  active = queue.shift();
  try {
    await runJob(active);
  } finally {
    active = null;
    processQueue();
  }
}

function helpText() {
  return [
    `🤖 OpenCode bridge · ${config.machine}`,
    "",
    "/run <yêu cầu> — giao việc cho OpenCode",
    "/status — phiên hiện tại, thư mục, hàng đợi",
    "/stop — dừng việc đang chạy và xóa hàng đợi",
    "/new — tạo phiên mới (xóa ngữ cảnh)",
    "/dir — xem thư mục làm việc",
    "/dir <đường dẫn> — đổi thư mục (phiên mới)",
    "/whoami — máy, user, chat, bot, session",
    "/help — trợ giúp",
    "",
    "Gửi tin nhắn thường (không bắt đầu bằng /) cũng được hiểu là /run.",
    `Trong nhóm, hãy nhắc @${botUsername || "bot"} hoặc gõ /lệnh@${botUsername || "bot"}.`,
  ].join("\n");
}

function isAllowed(userId) {
  return config.allowed_user_ids.includes(String(userId));
}

async function handleMessage(message) {
  if (!message || !message.text) return;
  const chatId = String(message.chat.id);
  const chatType = message.chat.type;
  const userId = message.from?.id;
  if (message.from?.is_bot) return;
  if (!isAllowed(userId)) {
    log("ignored message from", userId, "in", chatId);
    return;
  }

  let text = message.text.trim();
  if (chatType !== "private") {
    const commandTarget = text.match(/^\/([A-Za-z0-9_]+)@([A-Za-z0-9_]+)/);
    if (commandTarget && commandTarget[2].toLowerCase() !== botUsername.toLowerCase()) {
      return;
    }
    const mention = `@${botUsername}`.toLowerCase();
    const mentioned = text.toLowerCase().includes(mention);
    if (config.require_mention_in_groups && !mentioned) return;
    text = text.replace(new RegExp(`@${escapeRegExp(botUsername)}\\b`, "gi"), "").trim();
  }

  const replyTo = message.message_id;

  if (text.startsWith("/")) {
    const [rawCommand, ...rest] = text.split(/\s+/);
    const command = rawCommand.split("@")[0].toLowerCase();
    const argument = rest.join(" ").trim();

    if (command === "/start" || command === "/help") {
      await send(chatId, helpText(), replyTo);
      return;
    }
    if (command === "/new") {
      const workdir = path.resolve(state.workdirs[chatId] || config.workdir);
      delete state.sessions[`${chatId}::${workdir}`];
      saveState();
      await send(chatId, "🆕 Phiên mới. Tin nhắn tiếp theo sẽ bắt đầu ngữ cảnh sạch.", replyTo);
      return;
    }
    if (command === "/status") {
      const workdir = path.resolve(state.workdirs[chatId] || config.workdir);
      const sessionID = state.sessions[`${chatId}::${workdir}`] || "(chưa có)";
      const lines = [
        `🖥️ Máy: ${config.machine}`,
        `🤖 Bot: @${botUsername}`,
        `📁 ${workdir}`,
        `🧠 ${sessionID}`,
        `⚙️ ${active ? "đang chạy" : "rảnh"} · hàng đợi: ${queue.length}`,
        `⏱️ giới hạn: ${config.max_minutes} phút`,
      ];
      await send(chatId, lines.join("\n"), replyTo);
      return;
    }
    if (command === "/whoami" || command === "/id") {
      const workdir = path.resolve(state.workdirs[chatId] || config.workdir);
      const sessionID = state.sessions[`${chatId}::${workdir}`] || "(chưa có)";
      await send(
        chatId,
        [
          `🖥️ Máy: ${config.machine}`,
          `👤 User: ${userId}`,
          `💬 Chat: ${chatId} (${chatType})`,
          `🤖 Bot: @${botUsername}`,
          `📁 ${workdir}`,
          `🧠 ${sessionID}`,
        ].join("\n"),
        replyTo,
      );
      return;
    }
    if (command === "/stop") {
      const workdir = path.resolve(state.workdirs[chatId] || config.workdir);
      const sessionID = state.sessions[`${chatId}::${workdir}`];
      queue.length = 0;
      if (sessionID) {
        try {
          await opencodeApi("post", `/api/session/${sessionID}/interrupt`, {});
        } catch (error) {
          log("interrupt failed:", error.message);
        }
      }
      await send(chatId, "⏹️ Đã dừng và xóa hàng đợi.", replyTo);
      return;
    }
    if (command === "/dir") {
      if (!argument) {
        await send(chatId, `📁 ${path.resolve(state.workdirs[chatId] || config.workdir)}`, replyTo);
        return;
      }
      const target = path.resolve(argument.replace(/^"|"$/g, ""));
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        await send(chatId, `❌ Không thấy thư mục: ${target}`, replyTo);
        return;
      }
      state.workdirs[chatId] = target;
      saveState();
      await send(chatId, `📁 Đã đổi sang ${target}\nPhiên mới sẽ bắt đầu ở đây.`, replyTo);
      return;
    }

    if (command === "/run") {
      if (!argument) {
        await send(chatId, "Dùng: /run <yêu cầu>", replyTo);
        return;
      }
      text = argument;
    } else {
      await send(chatId, `Lệnh không hỗ trợ: ${command}\n\n${helpText()}`, replyTo);
      return;
    }
  }

  if (queue.length >= 5) {
    await send(chatId, "⛔ Hàng đợi đầy (5). Chờ bớt hoặc /stop.", replyTo);
    return;
  }

  const position = queue.length + (active ? 1 : 0);
  const ack = await send(
    chatId,
    position > 0 ? `⏳ [${config.machine}] Đã xếp hàng (${position})…` : `⏳ [${config.machine}] Đang xử lý…`,
    replyTo,
  );
  queue.push({ chatId, text, replyTo, ack });
  log("queued", chatId, JSON.stringify(text).slice(0, 120));
  processQueue();
}

async function poll() {
  log("bridge starting", `machine=${config.machine}`, `pid=${process.pid}`, `opencode=${OPENCODE}`);
  if (!config.bot_token) {
    log("missing bot token");
    console.error("Missing bot token. Put bot_token in bridge.json or notify.json.");
    process.exit(2);
  }
  if (!config.allowed_user_ids.length) {
    log("allowed_user_ids is empty");
    console.error("allowed_user_ids is empty in bridge.json — refusing to start.");
    process.exit(2);
  }
  fs.mkdirSync(config.workdir, { recursive: true });

  me = await telegram("getMe", {});
  botUsername = me.username;
  log("connected as", botUsername);

  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset: state.offset || 0,
        timeout: 25,
        allowed_updates: ["message"],
      });
      for (const update of updates || []) {
        state.offset = update.update_id + 1;
        saveState();
        try {
          await handleMessage(update.message);
        } catch (error) {
          log("handle error:", error.message);
        }
      }
    } catch (error) {
      log("poll error:", error.message);
      await sleep(3000);
    }
  }
}

async function askOnce(prompt) {
  fs.mkdirSync(config.workdir, { recursive: true });
  const created = await opencodeApi("post", "/api/session", {
    title: "bridge ask",
    location: { directory: path.resolve(config.workdir).replace(/\\/g, "/") },
  });
  const sessionID = created.data.id;
  const baseline = new Set((await getMessages(sessionID)).map((message) => message.id));
  const started = Date.now();
  await opencodeApi("post", `/api/session/${sessionID}/prompt`, { text: prompt });
  while (Date.now() - started < config.max_minutes * 60 * 1000) {
    await sleep(1500);
    await autoReplyPermissions(sessionID);
    const { idle, text } = await collectAnswer(sessionID, baseline);
    if (idle) {
      if (idle.outcome === "succeeded") {
        process.stdout.write((text || "(no output)") + "\n");
        return 0;
      }
      console.error(`failed: ${idle.error?.message || idle.outcome}`);
      return 1;
    }
  }
  console.error("timeout");
  return 1;
}

const argv = process.argv.slice(2);
if (argv.includes("--print-config")) {
  console.log(JSON.stringify({ ...config, bot_token: config.bot_token ? "***" : "" }, null, 2));
} else if (argv[0] === "--ask") {
  const prompt = argv.slice(1).join(" ");
  if (!prompt) {
    console.error("Usage: node bridge.mjs --ask \"prompt\"");
    process.exit(2);
  }
  askOnce(prompt).then((code) => process.exit(code));
} else if (argv[0] === "--simulate") {
  const text = argv.slice(1).join(" ");
  if (!text) {
    console.error("Usage: node bridge.mjs --simulate \"/status\"");
    process.exit(2);
  }
  const notify = readJson(notifyPath, {});
  const chatId = String(notify.chat_id || "");
  if (!chatId) {
    console.error("notify.json has no chat_id");
    process.exit(2);
  }
  me = await telegram("getMe", {});
  botUsername = me.username;
  log("simulate start", chatId, JSON.stringify(text).slice(0, 120));
  await handleMessage({
    message_id: null,
    chat: { id: Number(chatId), type: chatId.startsWith("-") ? "group" : "private" },
    from: { id: Number(config.allowed_user_ids[0]), is_bot: false },
    text,
  });
  while (active || queue.length) await sleep(500);
  log("simulate done");
  await sleep(500);
  process.exitCode = 0;
} else {
  poll();
}

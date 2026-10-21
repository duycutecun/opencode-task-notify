#!/usr/bin/env node
/**
 * task-notify — send a Telegram notification when a task finishes.
 *
 * Usage:
 *   node notify.mjs "Short summary of what was done"
 *   node notify.mjs --title "Build fixed" --status fail "3 tests still red: ..."
 *   node notify.mjs --setup              # validate token, discover chat_id, send test
 *   node notify.mjs --whoami             # show bot + chat_id that will be used
 *   node notify.mjs --test               # send a test message
 *   node notify.mjs --video "C:\path\to\final.mp4"          # announce a finished video
 *   node notify.mjs --video "C:\path\to\project-folder"     # newest video inside it
 *   node notify.mjs --video <path> --name "Paris Biểu Tình" # custom video title
 *
 * Flags:
 *   --title <text>    Bold first line (default: "Task finished")
 *   --status <s>      ok | fail | blocked | info  (default: ok)
 *   --project <name>  Override the project name (default: current directory name)
 *   --silent          Send without phone sound/vibration
 *   --video <path>    Announce a finished video file (or newest video in a folder)
 *   --name <text>     Video title used in the announcement
 *   --json            Print the raw Telegram response
 *   --dry-run         Print the formatted message instead of sending it
 *
 * Config: ~/.config/opencode/notify.json  (override with TASK_NOTIFY_CONFIG)
 * Env override: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * Exit codes: 0 sent, 1 send failed, 2 not configured / bad usage.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STATUS = {
  ok: { emoji: "\u2705", label: "Done" },
  fail: { emoji: "\u274C", label: "Failed" },
  blocked: { emoji: "\u26A0\uFE0F", label: "Blocked" },
  info: { emoji: "\u2139\uFE0F", label: "Update" },
};

const configPath =
  process.env.TASK_NOTIFY_CONFIG ||
  path.join(os.homedir(), ".config", "opencode", "notify.json");

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Cannot read ${configPath}: ${error.message}`);
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function parseArgs(argv) {
  const opts = { body: [], status: "ok", silent: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--title") opts.title = argv[++i];
    else if (arg === "--status") opts.status = argv[++i];
    else if (arg === "--project") opts.project = argv[++i];
    else if (arg === "--video") opts.video = argv[++i];
    else if (arg === "--name") opts.name = argv[++i];
    else if (arg === "--attach") opts.attach = true;
    else if (arg === "--no-attach") opts.attach = false;
    else if (arg === "--no-compress") opts.compress = false;
    else if (arg === "--api-base") opts.apiBase = argv[++i];
    else if (arg === "--chat") opts.chat = argv[++i];
    else if (arg === "--silent") opts.silent = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--setup") opts.setup = true;
    else if (arg === "--test") opts.test = true;
    else if (arg === "--whoami") opts.whoami = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else opts.body.push(arg);
  }
  return opts;
}

function usage() {
  console.log(
    [
      "Usage: node notify.mjs [--title <text>] [--status ok|fail|blocked|info] [--silent] <message>",
      "       node notify.mjs --setup     validate token, discover chat_id, send test",
      "       node notify.mjs --whoami    show the bot and chat_id in use",
      "       node notify.mjs --test      send a test message",
      "       node notify.mjs --dry-run   print the formatted message without sending",
      "       node notify.mjs --video <file-or-folder> [--name <video title>] [--no-attach] [--api-base <url>]",
      "                                   announce a finished video (newest mp4 if a folder is given)",
      "                                   sends the video itself when it fits in Telegram's 50 MB upload,",
      "                                   otherwise a compressed 720p preview; --no-attach sends text only",
    ].join("\n"),
  );
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let API_BASE = "https://api.telegram.org";

function isLocalBase() {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(API_BASE);
}

function maxUploadBytes() {
  return isLocalBase() ? 1900 * 1024 * 1024 : 49 * 1024 * 1024;
}

function fileUri(file) {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "");
  return `file:///${encodeURI(normalized)}`;
}

async function telegram(token, method, payload) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(15000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram returned HTTP ${response.status} with a non-JSON body`);
  }
  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description ?? response.status}`);
  }
  return data.result;
}

function expandPath(input) {
  const text = String(input).trim().replace(/^"(.*)"$/, "$1");
  if (text === "~") return os.homedir();
  if (text.startsWith("~/") || text.startsWith("~\\")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return path.resolve(text);
}

function findNewestVideo(dir) {
  let best = null;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(entry.name)) {
        const stat = fs.statSync(full);
        if (!best || stat.mtimeMs > best.mtimeMs) {
          best = { file: full, mtime: stat.mtimeMs, size: stat.size };
        }
      }
    }
  }
  return best;
}

function videoName(file, explicit) {
  if (explicit) return explicit;
  const base = path.basename(file, path.extname(file));
  const generic = /^(final|final_render|preview|draft|master|export|output|out|video|video_noaudio|render)([-_ ].*)?$/i;
  if (!generic.test(base)) return base;

  let dir = path.dirname(file);
  while (/^(renders?|output|outputs|exports?|build|dist|videos?)$/i.test(path.basename(dir))) {
    dir = path.dirname(dir);
  }
  const folder = path.basename(dir);
  return folder && folder !== path.parse(dir).root ? folder : base;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function resolveVideo(opts) {
  if (!opts.video) throw Object.assign(new Error("--video needs a file or folder path"), { exitCode: 2 });

  const target = expandPath(opts.video);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw Object.assign(new Error(`Video not found: ${target}`), { exitCode: 2 });
  }

  let file = target;
  if (stat.isDirectory()) {
    const newest = findNewestVideo(target);
    if (!newest) throw Object.assign(new Error(`No video file inside: ${target}`), { exitCode: 2 });
    file = newest.file;
    stat = newest;
  }

  return { file, size: stat.size, name: videoName(file, opts.name) };
}

function buildVideoMessage(opts, resolved = resolveVideo(opts)) {  const time = new Date().toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

  const lines = [
    `\u{1F3AC} <b>Đã tạo xong video ${escapeHtml(resolved.name)}</b>`,
    "",
    `Lưu tại: <code>${escapeHtml(resolved.file)}</code>`,
  ];
  const size = formatBytes(resolved.size);
  if (size) lines.push(`Dung lượng: ${size} \u00B7 ${time}`);
  lines.push("", "Vui lòng kiểm tra.");
  return lines.join("\n");
}

function buildMessage(opts, config) {
  const status = STATUS[opts.status] ? opts.status : "ok";
  const { emoji, label } = STATUS[status];
  const project =
    opts.project || path.basename(process.cwd()) || "opencode";
  const title = opts.title || `${label}`;
  const body = opts.body.join(" ").trim() || "(no details)";
  const time = new Date().toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

  const lines = [
    `${emoji} <b>${escapeHtml(title)}</b>`,
    "",
    escapeHtml(body),
    "",
    `<i>${escapeHtml(project)} \u00B7 ${time}</i>`,
  ];
  if (config.signature) lines.push(`<i>${escapeHtml(config.signature)}</i>`);
  return lines.join("\n");
}

async function send(token, chatId, text, silent) {
  return telegram(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_notification: Boolean(silent),
    link_preview_options: { is_disabled: true },
  });
}

const CLOUD_LIMIT = 49 * 1024 * 1024; // Telegram cloud Bot API caps uploads at 50 MB

function compressPreview(file) {
  const out = path.join(os.tmpdir(), `task-notify-preview-${process.pid}.mp4`);
  const attempts = [
    ["-vf", "scale=-2:720", "-crf", "30"],
    ["-vf", "scale=-2:480", "-crf", "33"],
  ];
  for (const extra of attempts) {
    const result = spawnSync(
      "ffmpeg",
      [
        "-y", "-loglevel", "error", "-i", file,
        "-c:v", "libx264", ...extra,
        "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart", out,
      ],
      { stdio: "ignore" },
    );
    if (result.status === 0 && fs.existsSync(out) && fs.statSync(out).size <= CLOUD_LIMIT) {
      return out;
    }
  }
  fs.rmSync(out, { force: true });
  return null;
}

async function sendVideoFile(token, chatId, file, caption, silent) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("supports_streaming", "true");
  form.set("disable_notification", String(Boolean(silent)));
  form.set("video", new Blob([fs.readFileSync(file)], { type: "video/mp4" }), path.basename(file));

  const response = await fetch(`${API_BASE}/bot${token}/sendVideo`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(300000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(`Telegram video upload failed: ${data?.description ?? response.status}`);
  }
  return data.result;
}

// Local Bot API server: hand it a file URI instead of uploading the bytes.
async function sendVideoLocal(token, chatId, file, caption, silent) {
  return telegram(token, "sendVideo", {
    chat_id: chatId,
    video: fileUri(file),
    caption,
    parse_mode: "HTML",
    supports_streaming: true,
    disable_notification: Boolean(silent),
  });
}

async function discoverChatId(token) {
  const updates = await telegram(token, "getUpdates", { limit: 100 });
  for (let i = updates.length - 1; i >= 0; i--) {
    const message =
      updates[i].message ||
      updates[i].edited_message ||
      updates[i].channel_post ||
      updates[i].my_chat_member;
    const id = message?.chat?.id;
    if (id) {
      return { id, name: message.chat.title || message.chat.username || message.chat.first_name };
    }
  }
  return null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = readConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN || config.bot_token || "";
  let chatId = opts.chat || process.env.TELEGRAM_CHAT_ID || config.chat_id || "";

  API_BASE = (opts.apiBase || process.env.TELEGRAM_API_BASE || config.api_base || "https://api.telegram.org")
    .trim()
    .replace(/\/+$/, "");

  if (opts.help) {
    usage();
    return 0;
  }

  if (opts.dryRun) {
    if (!opts.video) {
      console.log(buildMessage(opts, config));
      return 0;
    }
    const resolved = resolveVideo(opts);
    console.log(buildVideoMessage(opts, resolved));
    const attach = opts.attach !== false;
    const limit = maxUploadBytes();
    const plan = !attach
      ? "text only (--no-attach)"
      : resolved.size <= limit
        ? isLocalBase()
          ? "attach original via local Bot API server (file URI, no upload)"
          : "attach video"
        : opts.compress === false
          ? `over ${formatBytes(limit)}, cannot attach`
          : "attach compressed 720p preview via ffmpeg";
    console.log(`\n[dry-run] ${formatBytes(resolved.size)} \u2192 ${plan}`);
    console.log(`[dry-run] api base: ${API_BASE}`);
    return 0;
  }

  if (!token) {
    console.error(
      [
        "Telegram bot token is missing.",
        `Add "bot_token" to ${configPath}`,
        "  {",
        '    "bot_token": "123456:ABC...",',
        '    "chat_id": "",',
        '    "signature": "OpenCode"',
        "  }",
        "Get a token from @BotFather in Telegram, then run: node notify.mjs --setup",
      ].join("\n"),
    );
    return 2;
  }

  if (opts.setup) {
    const me = await telegram(token, "getMe", {});
    console.log(`Bot: @${me.username} (${me.first_name})`);

    let found;
    try {
      found = chatId ? { id: chatId } : await discoverChatId(token);
    } catch (error) {
      console.error(`Could not read updates: ${error.message}`);
      return 1;
    }

    if (!found?.id) {
      console.error(
        [
          "No chat found. Open Telegram, send any message to @" + me.username + ",",
          "then run this command again. For a group, add the bot to the group and send a message there.",
        ].join("\n"),
      );
      return 2;
    }

    chatId = String(found.id);
    config.bot_token = token;
    config.chat_id = chatId;
    if (!config.signature) config.signature = "OpenCode";
    writeConfig(config);
    console.log(`Saved chat_id ${chatId} to ${configPath}`);

    await send(token, chatId, buildMessage({ ...opts, body: ["Notification channel is ready."] }, config), false);
    console.log("Test message sent. Check your phone.");
    return 0;
  }

  if (opts.whoami) {
    const me = await telegram(token, "getMe", {});
    console.log(`Bot: @${me.username}`);
    console.log(`chat_id: ${chatId || "(not set — run --setup)"}`);
    console.log(`api base: ${API_BASE}${isLocalBase() ? " (local — uploads up to 2000 MB)" : ""}`);
    console.log(`config: ${configPath}`);
    return 0;
  }

  if (!chatId) {
    const found = await discoverChatId(token).catch(() => null);
    if (!found?.id) {
      console.error(`chat_id is missing. Run: node notify.mjs --setup`);
      return 2;
    }
    chatId = String(found.id);
    config.bot_token = token;
    config.chat_id = chatId;
    writeConfig(config);
  }

  if (opts.test) {
    opts.body = ["Test from OpenCode. Notifications are working."];
    if (!opts.title) opts.title = "Notification test";
  }

  if (opts.video) {
    const resolved = resolveVideo(opts);
    const caption = buildVideoMessage(opts, resolved);

    if (opts.attach !== false) {
      const limit = maxUploadBytes();
      let file = resolved.file;
      let compressed = false;

      // Local Bot API server can read the file straight off disk (up to 2000 MB).
      if (isLocalBase() && resolved.size <= limit) {
        try {
          const result = await sendVideoLocal(token, chatId, file, caption, opts.silent);
          console.log(`Sent original video via ${API_BASE} (message ${result.message_id})`);
          return 0;
        } catch (error) {
          console.error(`Local Bot API send failed (${error.message}); falling back.`);
        }
      }

      if (fs.statSync(file).size > CLOUD_LIMIT) {
        if (opts.compress === false) {
          console.error("Video is over Telegram's 50 MB cloud limit; sending text only (--no-compress).");
        } else {
          const preview = compressPreview(resolved.file);
          if (preview) {
            file = preview;
            compressed = true;
          } else {
            console.error("Could not compress the video under 50 MB (is ffmpeg installed?); sending text only.");
          }
        }
      }

      if (fs.statSync(file).size <= CLOUD_LIMIT) {
        try {
          const result = await sendVideoFile(token, chatId, file, caption, opts.silent);
          console.log(
            `Sent video to chat ${result.chat.id} (message ${result.message_id})` +
              (compressed ? " \u2014 compressed preview" : ""),
          );
          return 0;
        } catch (error) {
          console.error(`Video upload failed (${error.message}); sending text instead.`);
        } finally {
          if (compressed) fs.rmSync(file, { force: true });
        }
      }
    }

    const result = await send(token, chatId, caption, opts.silent);
    console.log(`Sent to chat ${result.chat.id} (message ${result.message_id})`);
    return 0;
  }

  const text = buildMessage(opts, config);
  const result = await send(token, chatId, text, opts.silent);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Sent to chat ${result.chat.id} (message ${result.message_id})`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`task-notify failed: ${error.message}`);
    process.exitCode = error.exitCode ?? 1;
  });

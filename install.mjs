#!/usr/bin/env node
/**
 * Installer for the OpenCode task-notify skill.
 *
 * Copies the skill into the OpenCode config directory, adds the completion /
 * video notification rule to the global AGENTS.md, and optionally hooks the
 * OpenMontage agent guide so finished renders are announced.
 *
 * Usage:
 *   node install.mjs
 *   node install.mjs --token 123456:ABC... --chat-id 123456789
 *   node install.mjs --openmontage "C:/path/to/OpenMontage"
 *   node install.mjs --no-openmontage
 *   node install.mjs --config-dir "C:/tmp/test-config" --dry-run
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const has = (name) => args.includes(name);
const val = (name, fallback = "") => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const slash = (p) => p.replace(/\\/g, "/");

const dryRun = has("--dry-run");
const token = val("--token");
const chatId = val("--chat-id");
const apiBase = val("--api-base");
const openMontage = path.resolve(val("--openmontage", path.join(os.homedir(), "OpenMontage")));
const skipOpenMontage = has("--no-openmontage");

const configDir = path.resolve(
  val(
    "--config-dir",
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
      : path.join(os.homedir(), ".config", "opencode"),
  ),
);
const skillDir = path.join(configDir, "skills", "task-notify");
const scriptPath = slash(path.join(skillDir, "notify.mjs"));
const fence = "```";

const AGENTS_START = "<!-- task-notify:start -->";
const AGENTS_END = "<!-- task-notify:end -->";
const OM_START = "<!-- task-notify:om:start -->";
const OM_END = "<!-- task-notify:om:end -->";

function agentsBlock() {
  return [
    AGENTS_START,
    "## Thông báo khi xong task (bắt buộc)",
    "",
    "Khi hoàn thành một task thực sự (đã viết code, sửa bug, chạy test, viết tài liệu, nghiên cứu xong, hoặc dừng lại vì bị chặn), **luôn gửi thông báo Telegram về điện thoại của tôi** bằng skill `task-notify` trước khi trả lời cuối cùng.",
    "",
    "Cách gọi:",
    "",
    fence + "sh",
    `node "${scriptPath}" --status ok --title "<3-6 từ>" "<kết quả + điều quan trọng nhất>"`,
    fence,
    "",
    "- `--status ok` khi xong, `--status fail` khi hỏng, `--status blocked` khi cần tôi quyết định.",
    "- Chỉ gửi **một** tin cho mỗi task, ở cuối task. Không gửi cho câu hỏi ngắn, đọc file, hay hội thoại thông thường.",
    "- Nội dung ngắn gọn, đọc được trên màn hình khoá. Không dán stack trace, diff, token hay dữ liệu nhạy cảm.",
    "- Nếu gửi lỗi: thử lại một lần, rồi bỏ qua và nhắc một dòng trong câu trả lời. Thông báo lỗi không được làm fail task.",
    `- Chưa cấu hình (exit code 2): nhắc tôi thêm \`bot_token\` vào \`${slash(path.join(configDir, "notify.json"))}\` và chạy \`--setup\`. Không hỏi token trong chat.`,
    "",
    "## Thông báo khi tạo xong video (bắt buộc)",
    "",
    "Ngay khi render xong một video và file đã ghi ra đĩa, **luôn** gửi thông báo bằng lệnh sau (đúng mẫu nội dung tôi yêu cầu):",
    "",
    fence + "sh",
    `node "${scriptPath}" --video "<đường dẫn file video>" --name "<tên video>"`,
    fence,
    "",
    "Tin nhắn sẽ có dạng:",
    "",
    fence,
    "🎬 Đã tạo xong video <tên>",
    "",
    "Lưu tại: <đường dẫn>",
    "Dung lượng: 85 MB · 17:05 21-10",
    "",
    "Vui lòng kiểm tra.",
    fence,
    "",
    "- `--video` nhận **file** hoặc **thư mục project** (thư mục thì tự chọn video mới nhất).",
    "- Luôn truyền `--name` bằng tên video người đọc được (ví dụ \"Paris Biểu Tình\"), đừng để slug `paris-bieu-tinh`.",
    "- Chỉ thông báo **video thành phẩm** (final.mp4 hoặc file tôi yêu cầu). Không thông báo preview, draft, hay từng lần render thử.",
    "- Gửi **một** tin cho mỗi video, ngay khi file tồn tại và có dung lượng > 0. Không chờ review chất lượng trừ khi tôi yêu cầu.",
    "- Mặc định script gửi kèm video: file ≤ 50 MB gửi nguyên, file lớn hơn thì nén preview 720p (cần ffmpeg). Cần chỉ tin nhắn thì thêm `--no-attach`.",
    "- Nếu `notify.json` có `api_base` trỏ về Bot API server local (ví dụ `http://127.0.0.1:8081`), script gửi nguyên file tới 2 GB bằng `file:///`, không nén.",
    "- Telegram Bot API không cho upload file > 50 MB, nên video lớn sẽ đến dưới dạng preview nén kèm đường dẫn gốc — phải nói rõ điều này khi báo lại.",
    "- File không tồn tại (exit code 2): sửa đường dẫn và thử lại một lần. Không báo \"đã xong\" cho file không có thật.",
    "- Nếu video tạo xong mà gửi lỗi, vẫn phải nêu đường dẫn video trong câu trả lời cuối.",
    AGENTS_END,
  ].join("\n");
}

function openMontageBlock() {
  return [
    OM_START,
    "## Delivery Notification (HARD RULE)",
    "",
    "When `compose` finishes and the deliverable video exists on disk, notify the user's phone **before** ending the turn:",
    "",
    fence + "sh",
    `node "${scriptPath}" --video "${slash(path.join(openMontage, "projects", "<project-id>", "renders", "final.mp4"))}" --name "<human title>"`,
    fence,
    "",
    "The message reads: `🎬 Đã tạo xong video <tên>` / `Lưu tại: <path>` / `Dung lượng: …` / `Vui lòng kiểm tra.`",
    "",
    "- Notify only the final deliverable (`renders/final.mp4` or the file the brief names) — not previews, drafts, per-scene renders, or test renders.",
    "- One message per finished video, sent as soon as the file is written and non-empty. Do not gate it on the reviewer.",
    "- Always pass `--name` with a human title (e.g. \"Paris Biểu Tình\"), not the project slug.",
    "- A missing file or a folder with no video exits 2: fix the path, retry once, and never announce a file that does not exist.",
    "- If the send fails, still include the output path in your final message. A notification failure must never fail the render or block the pipeline.",
    OM_END,
  ].join("\n");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertMarked(file, start, end, block, insertBefore) {
  const exists = fs.existsSync(file);
  let content = exists ? fs.readFileSync(file, "utf8") : "";
  let action = "updated";

  if (content.includes(start) && content.includes(end)) {
    content = content.replace(
      new RegExp(escapeRegExp(start) + "[\\s\\S]*?" + escapeRegExp(end)),
      block,
    );
  } else if (insertBefore && content.includes(insertBefore)) {
    const index = content.indexOf(insertBefore);
    content = content.slice(0, index) + block + "\n\n" + content.slice(index);
    action = "patched";
  } else {
    if (content && !content.endsWith("\n")) content += "\n";
    content += (content.trim() ? "\n" : "") + block + "\n";
    action = exists ? "appended" : "created";
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return action;
}

function writeConfig() {
  const file = path.join(configDir, "notify.json");
  let config = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      console.warn(`! Could not parse ${file} (${error.message}); leaving it untouched.`);
      return "skipped (invalid JSON)";
    }
  }
  const before = JSON.stringify(config);
  if (token) config.bot_token = token;
  if (chatId) config.chat_id = chatId;
  if (apiBase) config.api_base = apiBase;
  if (!config.signature) config.signature = "OpenCode";
  if (!("bot_token" in config)) config.bot_token = "";
  if (!("chat_id" in config)) config.chat_id = "";

  if (!dryRun && JSON.stringify(config) !== before) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  }
  return fs.existsSync(file) ? "ready" : "created";
}

function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) {
    console.error(`Node 18+ required (found ${process.versions.node}).`);
    process.exit(1);
  }

  console.log(`Installing task-notify into ${configDir}`);
  if (dryRun) console.log("(dry run — no files will be written)");

  if (!dryRun) fs.mkdirSync(skillDir, { recursive: true });  for (const file of ["SKILL.md", "notify.mjs"]) {
    const from = path.join(repoRoot, "skills", "task-notify", file);
    const to = path.join(skillDir, file);
    if (!dryRun) fs.copyFileSync(from, to);
    console.log(`  skill   ${to}`);
  }

  const configAction = writeConfig();
  console.log(`  config  ${path.join(configDir, "notify.json")} (${configAction})`);

  const agentsFile = path.join(configDir, "AGENTS.md");
  const agentsAction = upsertMarked(agentsFile, AGENTS_START, AGENTS_END, agentsBlock());
  console.log(`  rules   ${agentsFile} (${agentsAction})`);

  if (!skipOpenMontage) {
    const guide = path.join(openMontage, "AGENT_GUIDE.md");
    if (fs.existsSync(guide)) {
      const action = upsertMarked(guide, OM_START, OM_END, openMontageBlock(), "## Reviewer Protocol");
      console.log(`  hook    ${guide} (${action})`);
    } else {
      console.log(`  hook    skipped — no AGENT_GUIDE.md at ${openMontage}`);
    }
  }

  console.log("");
  console.log("Next steps:");
  if (!token) {
    console.log("  1. Message @BotFather on Telegram → /newbot → copy the token.");
    console.log(`  2. Put it in ${path.join(configDir, "notify.json")} as "bot_token".`);
    console.log("  3. Press Start in the chat with your new bot.");
    console.log(`  4. Run: node "${scriptPath}" --setup`);
  } else {
    console.log("  1. Press Start in the chat with your bot, then run:");
    console.log(`     node "${scriptPath}" --setup`);
  }
  console.log(`  Verify anytime with: node "${scriptPath}" --whoami`);
}

main();

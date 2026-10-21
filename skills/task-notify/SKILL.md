---
name: task-notify
description: Sends a Telegram message to the user's phone when a video render finishes, including the output path. Use when a video is created, rendered, exported, re-rendered, or delivered. Do not use it for other tasks — this user only wants notifications for finished videos.
---

# Task Notify

## Policy: videos only

This user wants notifications **only when a video is finished**. Do not send a notification for code changes, bug fixes, test runs, documentation, research, or general task completion — those are noise.

Send exactly one message per finished video, as soon as the file exists on disk and is non-empty.

## Sending a finished video

Use the absolute command from `AGENTS.md` if present, otherwise:

```sh
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --video "<file or project folder>" --name "<human title>"
```

`$HOME` expands in both PowerShell and bash, so the same line works on Windows, macOS, and Linux. `--video` accepts a video **file** or a **project folder** (it picks the newest `.mp4/.mov/.webm/.mkv/.m4v` inside).

The phone shows:

```
🎬 Đã tạo xong video Paris Biểu Tình

Lưu tại: C:\Users\Minh\OpenMontage\projects\paris-bieu-tinh\renders\final.mp4
Dung lượng: 85 MB · 17:05 21-10

Vui lòng kiểm tra.
```

## Video rules

- Always pass `--name` with a human title ("Paris Biểu Tình"), never the project slug.
- Announce the deliverable only — `renders/final.mp4` or the file the user asked for. No previews, drafts, per-scene renders, or test renders.
- By default the script **uploads the video into the chat**: original when it is under Telegram's 50 MB cloud cap, otherwise a 720p preview compressed with `ffmpeg`, keeping the full path in the caption. `--no-attach` sends text only.
- If `api_base` in `notify.json` points at a local Bot API server (e.g. `http://127.0.0.1:8081`), the script sends the original file with a `file:///` URI up to 2 GB and skips compression. `--whoami` shows the active endpoint.
- Missing file or an empty folder exits 2: fix the path, retry once, and never announce a file that does not exist.
- Do not wait for a quality review unless the user asked for a review-gated notification.
- If the send fails, retry once, then mention the failure in one short line — and still include the video path in your final reply. A notification failure must never fail the render.

## Optional: other messages

The script also sends plain task messages, but only when the user explicitly asks for one:

```sh
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --status ok --title "Deploy xong" "Production đã chạy bản mới."
```

Statuses: `ok`, `fail`, `blocked`, `info`. Flags: `--title`, `--project`, `--silent`, `--dry-run`, `--json`, `--chat`, `--test`, `--setup`, `--whoami`, `--help`.

Keep messages readable on a lock screen: 3-6 word title, one or two lines of body, no stack traces, diffs, tokens, or customer data.

## Setup and failures

- `node notify.mjs --setup` — validates the token, discovers the chat id (message the bot first), saves `notify.json`, sends a test message.
- `node notify.mjs --whoami` — prints bot, chat id, and active API endpoint.
- Missing config (exit 2): tell the user to add `bot_token` to `~/.config/opencode/notify.json` and run `--setup`. Never ask for the token in the conversation.
- Send failure (exit 1, network or Telegram error): retry once, then continue — never block or fail the task itself.
- Config path can be overridden with `TASK_NOTIFY_CONFIG`; `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `TELEGRAM_API_BASE` override file values.

## Checklist

1. The task actually produced a video file.
2. Correct path, human-readable `--name`.
3. Run the script, check exit code 0.
4. Mention the notification only if it failed.

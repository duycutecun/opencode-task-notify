---
name: task-notify
description: Sends a Telegram push notification to the user's phone when a task finishes, fails, or gets blocked, and announces finished videos with their output path. Use when completing any multi-step task, finishing a build or test run, ending a long agent session, rendering a video, or when the user asked to be pinged.
---

# Task Notify

## Overview

One command turns "the agent finished" into a push notification on the user's phone. The script reads `~/.config/opencode/notify.json` for the bot token and chat id, so no secret ever appears on a command line.

```sh
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --title "Fixed auth bug" "Login now retries once; 42/42 tests pass."
```

On Windows, `$HOME` expands in PowerShell and Node accepts forward slashes, so the same command works in both shells. If your `AGENTS.md` contains an absolute path to `notify.mjs`, prefer that one.

## When to Use

Send a notification when **all** of these are true:

- A real task just finished — code written, bug fixed, tests run, doc produced, migration done, or research answered.
- A video finished rendering (use the video template below).
- The work took more than a couple of tool calls, or the user is likely to step away.
- The result is worth interrupting the user for.

Do **not** notify for:

- Trivial chat, a single file read, a question answered in one line.
- Every intermediate step of a multi-step task — one message at the end, not five.
- Repeated failures of the same command; send one message when you stop retrying.

## Sending

Pick the status that matches the outcome:

```sh
# success
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --status ok --title "Shipped login fix" "Button no longer double-submits. Tests 42/42."

# failure
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --status fail --title "Build broken" "Webpack fails on src/db/client.ts: missing DATABASE_URL. Needs your input."

# blocked / waiting on the user
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --status blocked --title "Need a decision" "Two options for the cache layer; reply with 1 or 2."

# quiet message (no sound)
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --silent --status info "Docs refreshed, 12 files."
```

Useful flags: `--title`, `--status ok|fail|blocked|info`, `--project <name>`, `--silent`, `--test`, `--whoami`, `--dry-run`, `--json`. Run with `--help` for the full list.

## Video finished

When a render finishes and the file exists on disk, announce it with the user's requested template:

```sh
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --video "$HOME/OpenMontage/projects/<project-id>/renders/final.mp4" --name "Paris Biểu Tình"
```

That produces this on the phone:

```
🎬 Đã tạo xong video Paris Biểu Tình

Lưu tại: C:\Users\Minh\OpenMontage\projects\paris-bieu-tinh\renders\final.mp4
Dung lượng: 85 MB · 17:05 21-10

Vui lòng kiểm tra.
```

Rules:

- `--video` accepts a **file** or a **project folder** — for a folder it picks the newest `.mp4/.mov/.webm/.mkv/.m4v` inside, so pointing at `projects/<id>` also works.
- By default the script **uploads the video into the chat**: directly when it is under Telegram's 50 MB upload cap, otherwise it compresses a 720p preview with `ffmpeg` and sends that, keeping the full path in the caption. Use `--no-attach` for a text-only ping, or `--no-compress` to skip the preview.
- Telegram's Bot API cannot upload files over 50 MB without a local Bot API server, so a large `final.mp4` always arrives as a compressed preview plus the original path — say so when reporting back.
- `--name` sets the video title. Without it the script falls back to the file name, and to the project folder name when the file is a generic `final.mp4` / `preview.mp4` / `render.mp4`.
- Announce the deliverable (`final.mp4` or the file the user asked for). Do not spam previews, intermediate renders, or drafts unless the user asked to be told about them.
- Send **once** per finished video, as soon as the file is written and non-empty. Do not wait for quality review unless the user asked for a review-gated notification.
- If the file is missing or the folder has no video, the script exits 2 — fix the path and retry once; never send an announcement for a file that does not exist.
- Include `--name` with the human title when the project folder is a slug (`paris-bieu-tinh`), so the lock screen reads naturally.

## Message content

Keep it readable on a lock screen — three lines at most:

1. **Title** — what happened, in 3-6 words (`Fixed login race`, `Tests green`, `Need API key`).
2. **Body** — the outcome plus the single most useful fact: what changed, which tests pass, or exactly what the user must do next.
3. **Never** paste stack traces, diffs, file dumps, secrets, tokens, or customer data. Summarize instead: "3 tests failing in auth suite" beats 40 lines of output.

Good: `--title "Migration done" "Added 4 columns to users, backfilled 1.2M rows, verified counts."`
Bad: `--title "Done" "Task complete."` (tells the user nothing)

## Setup and failures

- `node notify.mjs --setup` — validates the token, discovers the chat id (send the bot any message first), saves `notify.json`, and sends a test message.
- `node notify.mjs --whoami` — prints the bot and chat id currently in use.
- Missing config (exit code 2): tell the user to add `bot_token` to `~/.config/opencode/notify.json` and run `--setup`. Do not ask for the token in the conversation and do not write it anywhere else.
- Send failure (exit code 1, network or Telegram error): retry **once** after a couple of seconds. If it still fails, mention it in one short line in the final reply and continue — notification failure must never block or fail the task itself.
- Config can be relocated with `TASK_NOTIFY_CONFIG`; token and chat id can come from `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` for one-off use.

## Checklist

1. Task genuinely complete (or stopped with a reason worth reporting).
2. One message, correct `--status`, title says what happened.
3. Run the script, check exit code 0.
4. Mention the notification in the final reply only if it failed.

# Telegram â†” OpenCode bridge

Chat with your Telegram bot and have it run OpenCode tasks on this machine.

```
you (Telegram) â†’ bot â†’ bridge.mjs â†’ OpenCode session in a chosen folder
                                  â† answer / errors
```

The bridge uses the same bot token as `task-notify`, so there is nothing else to create on Telegram.

## What you need

- Node.js 18+ on the machine that runs OpenCode.
- OpenCode installed and its background service reachable (`opencode api get /api/session` works).
- A bot token in `~/.config/opencode/notify.json` (from task-notify) or `bot_token` in `bridge.json`.
- Your numeric Telegram user id (the same id task-notify uses for private chat).

## Install (Windows)

```powershell
cd bridge
.\bridge.ps1 install -OwnerId 123456789
.\bridge.ps1 start
.\bridge.ps1 status
```

`install` writes `~/.config/opencode/bridge.json`, creates the default work folder
`~/opencode-workspace`, and copies the bot token from `notify.json` when present.
Add `-WorkDir "C:\path\to\project"` to choose another default folder, or `-Autostart`
to add a shortcut to the Windows Startup folder.

macOS / Linux: the same `bridge.mjs` runs, but the PowerShell helper does not.
Start it with `node bridge.mjs` (use your process manager of choice for autostart).

## Commands

| Command | Meaning |
| --- | --- |
| `/run <request>` | Send a task to OpenCode |
| plain text | Same as `/run` |
| `/status` | Work folder, session id, queue state |
| `/stop` | Interrupt the running task and clear the queue |
| `/new` | Forget the current session (fresh context) |
| `/dir` | Show the work folder |
| `/dir <path>` | Switch folder (a new session starts there) |
| `/help` | Command list |

In groups, the bot only reacts to commands or to messages that mention it
(`@YourBot â€¦`). This avoids hijacking normal group chat. Set
`"require_mention_in_groups": false` to change that.

## Configuration

`~/.config/opencode/bridge.json`:

```json
{
  "bot_token": "",
  "allowed_user_ids": ["123456789"],
  "workdir": "C:/Users/Minh/opencode-workspace",
  "auto_approve": true,
  "require_mention_in_groups": true,
  "max_minutes": 15
}
```

- `bot_token` â€” optional; falls back to `notify.json`.
- `allowed_user_ids` â€” the only Telegram users allowed to command the bot. Required.
  Everyone else is ignored. Never leave this empty.
- `workdir` â€” folder the agent starts in. `/dir` can change it per chat.
- `auto_approve` â€” answer OpenCode permission prompts with "once". When `false`,
  prompts are rejected and the task may stop. This is remote code execution by
  design: the allowed user's messages can run tools, edit files, and execute shell
  commands with your account.
- `require_mention_in_groups` â€” in groups, require `@bot` for plain text.
- `max_minutes` â€” hard stop for one task.

Runtime files, kept outside the repository:

- `~/.config/opencode/bridge-state.json` â€” Telegram offset and session ids.
- `~/.config/opencode/bridge.log` â€” log.
- `~/.config/opencode/bridge.pid` â€” PID used by `bridge.ps1`.

## Security

- Restrict `allowed_user_ids` to people you trust with a shell on this machine.
- The agent can `cd` outside the work folder. The folder is a starting point, not a sandbox.
- Treat the bot token like a password. It is stored only in local config files.
- Do not commit `bridge.json`, `bridge-state.json`, or logs.

## Notes and troubleshooting

- **No updates in a group.** Bots have privacy mode on by default and then only see
  commands. Open @BotFather â†’ `/setprivacy` â†’ select the bot â†’ **Disable**, then remove
  and re-add the bot to the group. Alternatively make the bot an admin.
- **`getUpdates` conflict.** The bridge consumes updates with long polling. Do not run
  `notify.mjs --setup` discovery while the bridge is running; stop the bridge first.
  If a webhook was ever set, delete it with `deleteWebhook` before using the bridge.
- **Session not found after cleanup.** Delete the matching entry in
  `bridge-state.json` or send `/new`; the bridge creates a fresh session.
- **Answers are only sent when the task finishes.** The bridge edits the
  â€œâ³ Äang xá»­ lÃ½â€¦â€ message into the result.
- **OpenCode cannot be found.** Set `"opencode_bin"` in `bridge.json` to the full
  path of the `opencode` executable (on Windows, the `.exe` inside
  `node_modules/@opencode/cli/bin`, not the `.cmd` shim).
- **One job at a time.** Messages that arrive during a job are queued (max 5).

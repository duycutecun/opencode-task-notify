# Telegram ↔ OpenCode bridge

Chat with your Telegram bot and have it run OpenCode tasks on this machine.

```
you (Telegram) → bot → bridge.mjs → OpenCode session in a chosen folder
                                  ← answer / errors
```

The bridge can reuse the bot token from `task-notify`, so there is nothing else to create on Telegram if you only run it on one computer.

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

macOS / Linux:

```sh
cd bridge
chmod +x bridge.sh
./bridge.sh install --owner 123456789 --machine PC-02
./bridge.sh start
./bridge.sh status
```

`bridge.sh` reads the bot token from `notify.json` when present and runs the same
`bridge.mjs`. Use `./bridge.sh logs` and `./bridge.sh stop` to inspect or stop it.
For autostart, add `node /path/to/bridge.mjs` to launchd (macOS) or a systemd user
unit (Linux).

## Commands

| Command | Meaning |
| --- | --- |
| `/run <request>` | Send a task to OpenCode |
| plain text | Same as `/run` |
| `/status` | Machine, work folder, session id, queue state |
| `/stop` | Interrupt the running task and clear the queue |
| `/new` | Forget the current session (fresh context) |
| `/dir` | Show the work folder |
| `/dir <path>` | Switch folder (a new session starts there) |
| `/whoami` | Machine, user id, chat id, bot, session |
| `/help` | Command list |

In groups, the bot only reacts when it is mentioned: either `@YourBot …` or a
command with the bot name, such as `/status@YourBot`. This is required when two
bots share a group, so that commands are not answered twice. Set
`"require_mention_in_groups": false` only if this bot is alone in the group.

Every answer starts with the machine name, so you can tell which computer replied.

## Configuration

`~/.config/opencode/bridge.json`:

```json
{
  "bot_token": "",
  "machine": "PC-01",
  "allowed_user_ids": ["123456789"],
  "workdir": "C:/Users/Minh/opencode-workspace",
  "auto_approve": true,
  "require_mention_in_groups": true,
  "max_minutes": 15
}
```

- `bot_token` — optional; falls back to `notify.json`.
- `machine` — name shown in answers and `/status`; defaults to the hostname.
- `allowed_user_ids` — the only Telegram users allowed to command the bot. Required.
  Everyone else is ignored. Never leave this empty.
- `workdir` — folder the agent starts in. `/dir` can change it per chat.
- `auto_approve` — answer OpenCode permission prompts with "once". When `false`,
  prompts are rejected and the task may stop. This is remote code execution by
  design: the allowed user's messages can run tools, edit files, and execute shell
  commands with your account.
- `require_mention_in_groups` — in groups, require `@bot` (or `/command@bot`)
  before responding. Keep it on when other bots are in the same group.
- `max_minutes` — hard stop for one task.

Runtime files, kept outside the repository:

- `~/.config/opencode/bridge-state.json` — Telegram offset, session ids, per-chat folders.
- `~/.config/opencode/bridge.log` — log.
- `~/.config/opencode/bridge.pid` — PID used by `bridge.ps1`.

## Two computers

Video notifications can share one bot: every message shows `🖥️ Máy: <machine>`, so
the computers stay distinguishable. Set `machine` per computer (or leave it empty
and let the hostname fill in).

The bridge is different: **do not run two bridges with the same bot token.**
Telegram delivers each update to one poller only, so commands would go to a random
machine and the other machine would never see them. Use one bot per computer
(one bridge per bot):

1. In @BotFather, create a bot for each computer (`/newbot`). Name them so they are
   easy to tell apart in Telegram, for example `PC-01` and `PC-02`.
2. Put each token in that computer's `bridge.json` (`bot_token`), with the same
   `allowed_user_ids` and a different `machine` name.
3. Add both bots to the group. Address commands explicitly:
   `/status@BotPC01`, `/run@BotPC02 …`, or mention `@BotPC01` in plain text.
4. Each bridge ignores commands addressed to the other bot, so only the intended
   computer answers.

On the Mac, install and start the bridge with `./bridge.sh install ...` and
`./bridge.sh start` as shown above.

## Security

- Restrict `allowed_user_ids` to people you trust with a shell on this machine.
- The agent can `cd` outside the work folder. The folder is a starting point, not a sandbox.
- Treat the bot token like a password. It is stored only in local config files.
- Do not commit `bridge.json`, `bridge-state.json`, or logs.

## Notes and troubleshooting

- **No updates in a group.** Bots have privacy mode on by default and then only see
  commands. Open @BotFather → `/setprivacy` → select the bot → **Disable**, then remove
  and re-add the bot to the group. Alternatively make the bot an admin.
- **`getUpdates` conflict.** The bridge consumes updates with long polling. Do not run
  `notify.mjs --setup` discovery while the bridge is running; stop the bridge first.
  If a webhook was ever set, delete it with `deleteWebhook` before using the bridge.
- **Session not found after cleanup.** Delete the matching entry in
  `bridge-state.json` or send `/new`; the bridge creates a fresh session.
- **Answers are only sent when the task finishes.** The bridge edits the
  “⏳ Đang xử lý…” message into the result.
- **OpenCode cannot be found.** Set `"opencode_bin"` in `bridge.json` to the full
  path of the `opencode` executable (on Windows, the `.exe` inside
  `node_modules/@opencode/cli/bin`, not the `.cmd` shim).
- **One job at a time per bridge.** Messages that arrive during a job are queued (max 5).

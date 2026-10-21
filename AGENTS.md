# Installing task-notify (instructions for AI agents)

This repository contains a skill for OpenCode. When a video render finishes, it sends a Telegram message (and the video) to the user's phone. It never notifies for code changes, tests, docs, or general task completion.

If the user asked you to install this repository, follow these steps exactly.

## 1. Check prerequisites

```sh
node -v      # must be 18 or newer
git --version
```

If Node is missing, install Node.js LTS first. On Windows: `winget install OpenJS.NodeJS.LTS` (open a new shell afterwards). On macOS: `brew install node`.

## 2. Get the repository

```sh
git clone https://github.com/duycutecun/opencode-task-notify.git
cd opencode-task-notify
```

If git is unavailable, download `https://github.com/duycutecun/opencode-task-notify/archive/refs/heads/main.zip` and extract it instead.

## 3. Ask the user for the bot token

The token looks like `123456:ABC-DEF...`. The user can find it in:

- their existing machine at `~/.config/opencode/notify.json` (`C:\Users\<name>\.config\opencode\notify.json` on Windows), or
- @BotFather on Telegram (`/mybots` → select bot → API Token).

Never guess a token, never commit it, and never write it into the repository. The chat id is usually the user's numeric Telegram id, e.g. `7152973094`; if they do not know it, omit `--chat` and run the setup command in step 4 without it after asking them to send any message to the bot.

## 4. Run the installer

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Token "<token>" -ChatId "<chat id>"
```

macOS / Linux:

```sh
chmod +x install.sh
./install.sh --token "<token>" --chat-id "<chat id>"
```

The installer copies the skill to `~/.config/opencode/skills/task-notify/`, adds a marked rule block to `~/.config/opencode/AGENTS.md`, and writes `~/.config/opencode/notify.json`. It is safe to run more than once.

When `--token` is present, the installer also validates the token, saves it, and sends a test message in one step. No separate `--setup` call is needed.

If the token is not available yet, run the installer without it (the skill and rule are still installed), then tell the user to provide the token and run:

```sh
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --setup --token "<token>" --chat "<chat id>"
```

Omit `--chat` to auto-discover the chat. If setup reports `No chat found`, ask the user to send any message to the bot, then run the same command again. Pass `--no-setup` to the installer if you do not want it to contact Telegram.

## 5. Verify

```sh
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --whoami
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --test
```

`--whoami` must show the bot username, the chat id, and `api base: https://api.telegram.org`. The user should receive the test message on their phone.

## 6. Restart OpenCode

Skills and `AGENTS.md` are loaded at startup. Tell the user to restart OpenCode (or the background service) before expecting notifications.

## Optional: videos larger than 50 MB

Telegram's cloud API caps uploads at 50 MB, so larger videos are sent as a compressed 720p preview. That requires `ffmpeg` in `PATH` (Windows: `winget install Gyan.FFmpeg`). Without ffmpeg, the script sends a text message with the file path instead of failing.

Do not configure `api_base` (the local Bot API server) unless the user explicitly asks for original files above 50 MB. It logs the bot out of the cloud API and breaks notifications on any other machine using the same bot.

## Rules for the installed agent

- Notify only when a video render finishes and the file exists on disk.
- One message per finished video, with a human-readable `--name`.
- If sending fails, retry once and still include the video path in the final reply.
- Never put the bot token in the repository, a commit, or a public log.

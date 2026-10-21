# task-notify

Skill cho [OpenCode](https://opencode.ai): khi AI render xong video, điện thoại bạn rung.

Gửi tin nhắn Telegram kèm đường dẫn file mỗi khi có video thành phẩm. **Chỉ báo khi tạo xong video** — sửa code, chạy test, viết tài liệu hay trả lời câu hỏi thì không làm phiền bạn.

## Cài nhanh (không cần git)

Windows — PowerShell, chỉ cần Node.js 18+:

```powershell
iwr https://raw.githubusercontent.com/duycutecun/opencode-task-notify/main/bootstrap.ps1 -OutFile "$env:TEMP\tn.ps1"
& "$env:TEMP\tn.ps1" -Token "123456:ABC..." -ChatId "7152973094"
```

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/duycutecun/opencode-task-notify/main/bootstrap.sh | sh -s -- --token "123456:ABC..." --chat-id "7152973094"
```

Hai script này tải repo về thư mục tạm, chạy installer rồi tự dọn — không cần `git`, không để lại file thừa.

## Dán link cho AI trên máy mới

Gửi cho AI (OpenCode, Claude, Cursor...) đoạn này:

> Cài task-notify từ https://github.com/duycutecun/opencode-task-notify theo `AGENTS.md` trong repo. Bot token: `<token>`. Chat id: `7152973094`.

AI sẽ đọc `AGENTS.md`, clone repo, chạy installer, kiểm tra bằng `--whoami` và `--test`, rồi nhắc bạn khởi động lại OpenCode. Nếu không muốn đưa token vào chat, copy `notify.json` từ máy cũ sang trước, rồi bảo AI cài không cần token.

## Phạm vi

Chỉ một trường hợp được tự động gửi: **video đã render xong và file nằm trên đĩa**.

Không gửi thông báo khi: sửa code, fix bug, chạy test, viết tài liệu, nghiên cứu, trả lời câu hỏi, hay kết thúc phiên làm việc. Những tin đó là nhiễu.

Muốn báo thêm việc khác thì gọi script bằng tay — xem [Dùng tay (tùy chọn)](#dùng-tay-tùy-chọn).

## Tin nhắn trông thế nào

Video xong:

```
🎬 Đã tạo xong video Paris Biểu Tình

Lưu tại: C:\Users\Minh\OpenMontage\projects\paris-bieu-tinh\renders\final.mp4
Dung lượng: 85 MB · 17:05 21-10

Vui lòng kiểm tra.
```

## Yêu cầu

- OpenCode (V2)
- Node.js 18 trở lên
- Telegram trên điện thoại

## Cài đặt

### Windows

```powershell
git clone https://github.com/duycutecun/opencode-task-notify.git
cd opencode-task-notify
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```bash
git clone https://github.com/duycutecun/opencode-task-notify.git
cd opencode-task-notify
chmod +x install.sh
./install.sh
```

Installer sẽ:

1. Copy skill vào `~/.config/opencode/skills/task-notify/` (trên Windows: `C:\Users\<bạn>\.config\opencode\skills\task-notify\`).
2. Thêm luật **chỉ báo khi tạo xong video** vào `~/.config/opencode/AGENTS.md` để **mọi project** đều dùng.
3. Tạo `~/.config/opencode/notify.json` để chứa bot token.
4. Nếu tìm thấy OpenMontage (`~/OpenMontage`), vá luôn `AGENT_GUIDE.md` để thông báo chạy ngay ở stage `compose`.

Chạy lại installer bao nhiêu lần cũng được: các block được đánh dấu `<!-- task-notify:start -->` nên chỉ cập nhật, không nhân đôi.

Tùy chọn:

```powershell
.\install.ps1 -Token "123456:ABC..." -ChatId "987654321"
.\install.ps1 -OpenMontage "D:\Tools\OpenMontage"
.\install.ps1 -ApiBase "http://127.0.0.1:8081"   # dùng local Bot API server
.\install.ps1 -NoOpenMontage
.\install.ps1 -DryRun
```

## Cài trên máy thứ hai (cùng một bot)

Một bot Telegram nhắn được cho **nhiều máy** cùng lúc, miễn là các máy dùng chung `bot_token` và `chat_id`. Tin từ máy nào cũng về đúng cuộc trò chuyện đó trên điện thoại bạn.

Điều kiện: tất cả các máy phải dùng **cloud API** (`api.telegram.org`). Nếu một máy bật local Bot API server và gọi `logOut`, bot sẽ rời cloud và các máy còn lại mất thông báo cho tới khi logOut ngược lại.

Chọn một trong ba cách:

**1. Installer với token + chat_id có sẵn** (nhanh nhất):

```powershell
.\install.ps1 -Token "123456:ABC..." -ChatId "7152973094"
```

**2. Copy `notify.json`** từ máy cũ sang `~/.config/opencode/notify.json` của máy mới (Windows: `C:\Users\<bạn>\.config\opencode\notify.json`). Giữ nguyên `bot_token`, `chat_id`; đừng copy `api_base` nếu muốn dùng cloud.

**3. Biến môi trường** (không ghi file, phải set lại mỗi phiên):

```powershell
$env:TELEGRAM_BOT_TOKEN = "123456:ABC..."
$env:TELEGRAM_CHAT_ID  = "7152973094"
```

Sau khi cài, kiểm tra:

```powershell
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --whoami
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --test
```

- Không cần chạy `--setup` trên máy mới nếu đã có `chat_id`; `--setup` dò chat gần nhất nên có thể chọn nhầm nhóm.
- Token là mật khẩu của bot: chuyển qua trình quản lý mật khẩu, USB hay mạng nội bộ — đừng dán vào chat công khai.
- Muốn tạm im một máy: xóa `bot_token` trong `notify.json` của máy đó, hoặc tắt thông báo chat trên Telegram.

## Cấu hình bot (một lần)

1. Mở Telegram, chat với **@BotFather**, gõ `/newbot`, đặt tên → nhận token dạng `123456:ABC-DEF...`.
2. Dán token vào `~/.config/opencode/notify.json`:

   ```json
   {
     "bot_token": "123456:ABC-DEF...",
     "chat_id": "",
     "signature": "OpenCode"
   }
   ```

   Hoặc chạy installer với `-Token "..."` để nó ghi hộ.

3. Bấm **Start** trong chat với bot vừa tạo (bot không nhắn được cho người chưa bấm Start).
4. Chạy setup — nó tự tìm `chat_id`, lưu lại và gửi tin test:

   ```powershell
   node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --setup
   ```

   Đã biết token và chat id thì gộp làm một bước (dùng cho máy thứ hai):

   ```powershell
   node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --setup --token "<token>" --chat "7152973094"
   ```

Nếu dùng nhóm Telegram: thêm bot vào nhóm, gửi một tin trong nhóm, rồi chạy `--setup`.

## Dùng tay (tùy chọn)

Các lệnh dưới đây không tự chạy — chỉ dùng khi bạn muốn báo thêm việc ngoài video.

```sh
# task xong
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --title "Deploy xong" "Production đã chạy bản mới."

# task fail
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --status fail --title "Build hỏng" "Thiếu DATABASE_URL."

# cần bạn quyết định
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --status blocked --title "Chọn cách nào?" "1) Redis 2) Postgres. Trả lời 1 hoặc 2."

# video xong (nhận file hoặc cả thư mục project)
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --video "$HOME/OpenMontage/projects/paris-bieu-tinh/renders/final.mp4" --name "Paris Biểu Tình"

# xem trước nội dung, không gửi
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --dry-run --video "$HOME/OpenMontage/projects/paris-bieu-tinh"
```

`$HOME` hoạt động trong cả PowerShell và bash. Trên Windows bạn cũng có thể dùng đường dẫn tuyệt đối mà installer đã ghi vào `AGENTS.md`.

### Gửi kèm video vào chat

Mặc định `--video` **gửi luôn file video** vào Telegram, không chỉ đường dẫn:

| Kích thước file | Cách gửi |
|---|---|
| ≤ 50 MB | Gửi nguyên file, phát được trong chat |
| > 50 MB | Nén preview 720p bằng `ffmpeg` rồi gửi, caption vẫn giữ đường dẫn file gốc |

- Cần `ffmpeg` trong `PATH` để nén. Không có ffmpeg thì script gửi tin nhắn văn bản kèm đường dẫn (không fail).
- `--no-attach`: chỉ gửi tin nhắn, không gửi file.
- `--no-compress`: không nén; file > 50 MB sẽ chỉ gửi tin nhắn.
- `--dry-run` in ra kế hoạch, ví dụ `[dry-run] 85 MB → attach compressed 720p preview via ffmpeg`.

Giới hạn 50 MB là của **Telegram Bot API cloud** (mọi loại file). Muốn gửi nguyên file 50 MB–2 GB vào chat, chạy Bot API server local — xem [`local-bot-api/`](local-bot-api/README.md). Khi `api_base` trỏ về server đó, script gửi nguyên video bằng `file:///`, không nén.

Cờ đầy đủ: `--title`, `--status`, `--project`, `--silent`, `--video`, `--name`, `--chat`, `--token`, `--api-base`, `--test`, `--setup`, `--whoami`, `--dry-run`, `--json`, `--help`.

## Cách agent dùng

- `skills/task-notify/SKILL.md` dạy agent khi nào nên gửi, viết nội dung thế nào, và xử lý lỗi ra sao.
- Block trong `AGENTS.md` là luật cứng: **render xong video → gọi script trước khi trả lời**. Task khác không gọi.
- Block trong `AGENT_GUIDE.md` của OpenMontage: render xong `final.mp4` → gửi tin kèm đường dẫn, ngay trong stage `compose`.

Nguyên tắc chung: **một tin cho một việc**, chỉ báo thành phẩm, không dán stack trace hay token, gửi lỗi thì không được làm fail task.

## Cấu hình nâng cao

| Biến / trường | Ý nghĩa |
|---|---|
| `bot_token` | Token từ @BotFather |
| `chat_id` | ID chat/nhóm nhận tin (tự tìm khi chạy `--setup`) |
| `signature` | Dòng chữ nhỏ cuối tin, mặc định `OpenCode` |
| `api_base` | Địa chỉ Bot API server, mặc định `https://api.telegram.org`; đặt `http://127.0.0.1:8081` để gửi file tới 2 GB qua server local |
| `TASK_NOTIFY_CONFIG` | Đổi đường dẫn file config |
| `TELEGRAM_BOT_TOKEN` | Token qua biến môi trường (ưu tiên hơn file) |
| `TELEGRAM_CHAT_ID` | Chat id qua biến môi trường |

File `notify.json` chứa secret: đừng commit, đừng chia sẻ. Trên macOS/Linux installer đặt quyền `600`.

### Bảo mật token

Repo này **không** chứa token. Mỗi máy giữ token trong `~/.config/opencode/notify.json` (đã nằm trong `.gitignore`).

Muốn dùng cùng một bot cho nhiều máy, chép file `notify.json` sang từng máy bằng tay, hoặc để nó trong password manager / private repo riêng — không đưa vào repo public.

Nếu token từng bị dán vào chat, ảnh chụp màn hình, hay commit: vào @BotFather → `/mybots` → chọn bot → **API Token** → **Revoke current token**, rồi cập nhật lại `notify.json`.

## Gỡ cài đặt

```powershell
# Windows
Remove-Item -Recurse -Force "$HOME\.config\opencode\skills\task-notify"
Remove-Item "$HOME\.config\opencode\notify.json"
```

Sau đó xóa block giữa `<!-- task-notify:start -->` và `<!-- task-notify:end -->` trong `AGENTS.md`, và block `<!-- task-notify:om:start -->` … `om:end` trong `AGENT_GUIDE.md` của OpenMontage.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách sửa |
|---|---|
| `Telegram error: Unauthorized` (exit 1) | Token sai hoặc đã bị thu hồi. Tạo token mới với @BotFather. |
| `No chat found` (exit 2) | Chưa bấm Start với bot, hoặc chưa gửi tin nào cho bot. |
| Không thấy skill `task-notify` | Mở phiên OpenCode mới — skill được quét lúc khởi động. |
| `Video not found` (exit 2) | Sai đường dẫn, hoặc render chưa ghi xong file. |
| Có tin nhưng không kêu | Tin gửi bằng `--silent`, hoặc bạn đã mute bot trong Telegram. |
| Agent không tự gửi | Kiểm tra block còn trong `AGENTS.md` không, và phiên đã được khởi động lại sau khi cài. |

## Cấu trúc repo

```
opencode-task-notify/
├── skills/task-notify/
│   ├── SKILL.md        # hướng dẫn cho agent
│   └── notify.mjs      # script gửi Telegram
├── local-bot-api/      # server local để gửi video > 50 MB
│   ├── README.md
│   ├── docker-compose.yml
│   └── server.ps1
├── AGENTS.md           # hướng dẫn cài đặt cho AI agent
├── bootstrap.ps1       # tải + cài, không cần git (Windows)
├── bootstrap.sh        # tải + cài, không cần git (macOS/Linux)
├── install.mjs         # logic cài đặt (đa nền tảng)
├── install.ps1         # wrapper Windows
├── install.sh          # wrapper macOS/Linux
└── README.md
```

## English

A Telegram notification skill for OpenCode. Install with `install.ps1` (Windows) or `install.sh` (macOS/Linux), or run `bootstrap.ps1` / `bootstrap.sh` to download and install without git. It copies the skill into your OpenCode config and adds a global rule so agents notify you **only when a video render finishes**. Then create a bot with @BotFather, put the token in `~/.config/opencode/notify.json`, and run `notify.mjs --setup`. To install on another machine with the same bot, reuse the same token and chat id.

## License

MIT — xem [LICENSE](LICENSE).

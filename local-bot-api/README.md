# Local Telegram Bot API server

Mặc định bot Telegram chỉ cho upload file **≤ 50 MB**. Chạy Bot API server trên máy bạn thì giới hạn thành **2000 MB**, và script có thể đưa server đường dẫn `file:///...` để nó đọc thẳng file trên đĩa — không upload, không nén, không tốn RAM.

Dùng thư mục này khi bạn cần gửi nguyên video 50 MB–2 GB vào chat.

## 1. Lấy `api_id` và `api_hash`

1. Mở https://my.telegram.org → đăng nhập bằng số điện thoại của bạn.
2. **API development tools** → điền tên app bất kỳ → **Create application**.
3. Copy `api_id` (số) và `api_hash` (chuỗi).

Đây là credential của **tài khoản**, không phải bot token — đừng commit, đừng chia sẻ.

## 2. Cấu hình

```powershell
cd local-bot-api
Copy-Item .env.example .env
notepad .env   # điền TELEGRAM_API_ID và TELEGRAM_API_HASH
```

## 3. Chạy server

### Cách A — Docker (khuyến nghị)

```powershell
.\server.ps1 install   # kiểm tra Docker
.\server.ps1 start
```

Hoặc không cần script:

```bash
docker compose --env-file .env up -d
```

### Cách B — Windows binary (không cần Docker)

Máy chưa có Docker/WSL. Có bản build Windows sẵn ở
<https://github.com/Bezdarnost01/telegram-bot-api-windows/releases> (bên thứ ba, không phải Telegram chính thức — tải về và tự chịu trách nhiệm, hoặc tự build từ <https://github.com/tdlib/telegram-bot-api>).

```powershell
# tải + giải nén bản build vào local-bot-api\bin\
.\server.ps1 install -Download

# hoặc trỏ tới file exe bạn tự tải
.\server.ps1 install -ExePath "D:\tools\telegram-bot-api.exe"

.\server.ps1 start
```

Server chạy ở `http://127.0.0.1:8081`, dữ liệu trong `local-bot-api\data\`.

### Cách C — macOS / Linux

```bash
docker compose --env-file .env up -d
```

## 4. Chuyển bot sang server local

Telegram yêu cầu bot **log out khỏi cloud** trước khi chạy local:

```powershell
curl "https://api.telegram.org/bot<TOKEN>/logOut"
```

Sau đó trỏ script sang server local — thêm vào `~/.config/opencode/notify.json`:

```json
{
  "bot_token": "123456:ABC...",
  "chat_id": "7152973094",
  "api_base": "http://127.0.0.1:8081"
}
```

Kiểm tra:

```powershell
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --whoami
node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --video "C:\...\final.mp4"
```

Khi `api_base` là local, script gửi **nguyên file** bằng `file:///` (không nén, không upload qua mạng) cho tới 2 GB. File vẫn phải nằm trên cùng máy với server.

## 5. Quay lại cloud

Xóa `api_base` khỏi `notify.json` (hoặc đặt lại `https://api.telegram.org`), tắt server local, rồi gọi `logOut` trên server local:

```powershell
curl "http://127.0.0.1:8081/bot<TOKEN>/logOut"
```

Sau đó bot lại nhận lệnh từ cloud như cũ.

## Lệnh hữu ích

```powershell
.\server.ps1 status     # server có sống không, bot là ai
.\server.ps1 logs       # log 50 dòng cuối
.\server.ps1 stop
.\server.ps1 start
```

## Lưu ý

- `api_id`/`api_hash` cho phép đăng nhập tài khoản Telegram của bạn nếu lộ — giữ kín, file `.env` đã nằm trong `.gitignore`.
- Server chỉ nghe trên `127.0.0.1`, không mở ra mạng ngoài.
- Bot chạy local thì **không** dùng được cloud cùng lúc; nếu server tắt, thông báo sẽ fail cho tới khi bật lại.
- Dữ liệu tải về (file người dùng gửi cho bot) nằm trong `data/` — xóa được bất cứ lúc nào khi server đã tắt.

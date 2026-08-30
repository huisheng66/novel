# 安全修复记录（2026-08-30）

## 实测验证过的行为

- 登录限速：admin 登录 5 次失败后封禁（429 + 提示），`/api/login` 10 次失败后 429，WebDAV 错 token 10 次后 429；正确密码正常登录且计数清零。
- WebDAV：条件请求返回 304；EPUB 生成后写入磁盘缓存（实测 13MB/1.3s 生成，缓存命中后直接回传）；每 token 每分钟 30 次下载上限，实测第 30 次触发 429。
- 安全头：HTTPS 上 CSP/nosniff/X-Frame-Options/Referrer-Policy/HSTS 全部就位，HTTP 上无 HSTS（符合预期）。
- ReadAny：566/566 核心测试通过，类型检查与基线错误数一致（那 2 个 ArrayBuffer 报错是基线就有的，与本次无关），biome 对改动文件零错误。

## 需要知道的行为变化

- **管理员密码已更换**：新强口令在 `novel/.env` 的 `ADMIN_PASSWORD`（会话密钥也一并换成随机值）。代码不再有 `admin123` 回退——缺环境变量会拒绝启动。
- **HTTP 3008 只监听 127.0.0.1**：局域网读者请改用 `https://IP:3443`（自签名证书需手动信任）。如果确实要保留明文局域网访问，在 `.env` 设 `HTTP_HOST=0.0.0.0`，但那会重新打开明文暴露面。
- **ReadAny 临时 WebDAV 导入不再记住密码**（与弹窗"这次导完就走"的承诺一致），旧版明文存下的密码会在下次打开弹窗时自动清除。
- **书源 allowInsecure**：已有书源没有该字段，按兼容逻辑仍接受自签名；新导入会把你勾选的"允许不安全连接"持久化到每本书。

## 需要手动验证的三处（无法在此环境跑 GUI）

重新构建桌面端/移动端后请冒烟：

1. 桌面端从文件选择器导入一本书并打开；
2. 若书库根目录设在外置盘/非常规路径，确认还能访问（scope 收窄保留了 HOME 和 `/Volumes`、`/media`、`/mnt` 等挂载点，但不含 `/srv` 这类路径）；
3. 移动端打开一本书阅读（已关掉 `allowFileAccessFromFileURLs`/`allowUniversalAccessFromFileURLs`，书内容本就应走本地 HTTP 服务，若真有 file:// 直读的路径会在此暴露）。

## 遗留事项（有意未动，需要更大改动或真机验证）

- 阅读器 iframe 的 `allow-scripts` 沙箱与 Tauri CSP（foliate 依赖内联注入的分页脚本，盲改会坏渲染，需真机调试）；
- WebDAV 密码仍在 SQLite `source_info` 里（迁移到 OS 钥匙串需要新增 Rust 插件）；
- token 走 URL 的设计（`?token=`，需要会话机制重构）；
- `/metrics`、`/healthz` 未鉴权；
- `X-Forwarded-For` 无条件信任；
- memoryCache 无淘汰；
- dashboard 全表扫描。

相关提交：

- Novel（分支 `read`）：`990e043` 后台强口令+登录限速+HTTP 收回本机+Secure cookie；`5da6a9c` 安全响应头+CSP/HSTS+评论限速+Referer 脱敏+WebDAV 304/缓存/限流
- ReadAny（分支 `main`）：`f01f3acd` 书源功能基线；`15e59a8d` 凭据与同步加固；`11f73134` scope 收窄+WebView 标志+LAN 配对码

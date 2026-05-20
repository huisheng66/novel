# 部署测试优化日志

## 2026-05-15

目标：在 Ubuntu 服务器验证一键部署脚本，遇到问题后优化脚本并复测。

## 45.113.2.218 连接测试

账号：`huisheng`

结果：未进入 SSH 认证阶段。

- SSH `45.113.2.218:22`：连接超时
- `ssh -o ConnectTimeout=12 huisheng@45.113.2.218 exit`：`Connection timed out`
- Ping：4 次全部超时
- TCP `80`：超时
- TCP `443`：超时

结论：当前网络到该服务器不可达，不像密码错误。

## 192.168.159.130 实测环境

账号：`huisheng`

- Ubuntu 24.04.3 LTS
- Node.js v22.22.2
- MySQL 已监听 `127.0.0.1:3306`
- Nginx 已监听 `0.0.0.0:80`
- sudo 可用
- 测试目录：`/home/huisheng/codexnovel-deploy-test`

执行命令：

```bash
sudo ADMIN_PASSWORD='admin123' DB_PASSWORD='000000' PORT=3008 bash scripts/deploy-ubuntu.sh
```

## 问题与优化

### 1. Nginx default_server 冲突

现象：

```text
a duplicate default server for 0.0.0.0:80 in /etc/nginx/sites-enabled/novel:2
```

原因：服务器已有其它 Nginx 站点占用 `default_server`。

修复：部署脚本不再生成 `listen 80 default_server;`，未设置域名时使用服务器 IP 作为 `server_name`。

### 2. 健康检查过早失败

现象：

```text
curl: (7) Failed to connect to 127.0.0.1 port 3008
```

原因：应用首次启动需要执行数据库初始化，脚本只等待 2 秒就请求首页。

修复：健康检查改为最多等待 30 秒，循环检查 systemd active 和本机 HTTP。

### 3. 旧章节表结构不兼容

现象：

```text
Unknown column 'chapter_number' in 'field list'
```

原因：服务器已有旧结构 `chapters` 表，字段为 `chapter_no`，缺少当前版本需要的 `novel_id` 和 `chapter_number`。

修复：`db.js` 增加兼容迁移，保留旧数据并补齐：

- `novel_id`
- `chapter_number`
- `uk_novel_chapter` 唯一索引
- `fk_chapters_novel` 外键

## 最终复测

一键部署脚本最终执行成功，退出码 `0`。

验证结果：

- `codexnovel` systemd 服务：`active`
- `nginx` 服务：`active`
- `curl -I http://127.0.0.1:3008/`：`200 OK`
- `curl -I -H 'Host: 192.168.159.130' http://127.0.0.1/`：`200 OK`
- 外部访问 `http://192.168.159.130/`：`200 OK`
- 外部访问 `http://192.168.159.130/admin/login`：`200 OK`
- 外部访问 `http://192.168.159.130/novel/1/1`：`200 OK`
- 数据库 `chapters` 总数：645
- 已迁移 `novel_id` 和 `chapter_number` 的章节数：645

部署脚本最终输出：

```text
Deploy complete

Site: http://192.168.159.130/
Admin: http://192.168.159.130/admin/login
Admin password: admin123
```

## 剩余提示

Nginx 仍会输出以下警告：

```text
conflicting server name "192.168.159.130" on 0.0.0.0:80, ignored
```

原因是服务器已有其它 Nginx 站点也配置了该 IP。当前访问验证正常，不影响本次部署结果。生产环境建议绑定正式域名部署。

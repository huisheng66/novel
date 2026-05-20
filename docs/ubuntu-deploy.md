# Ubuntu 一键部署

在 Ubuntu 22.04/24.04 服务器上，进入项目目录后执行脚本即可。脚本会自动安装 Node.js、MySQL、Nginx，创建数据库和 `.env`，安装依赖，配置 systemd 常驻运行，并配置 Nginx 反向代理。

## 最简单部署

```bash
sudo bash scripts/deploy-ubuntu.sh
```

完成后访问：

- 前台：`http://服务器IP/`
- 后台：`http://服务器IP/admin/login`

后台密码会在脚本执行完成后显示，同时写入项目根目录 `.env`。

## 带域名部署

```bash
sudo DOMAIN=example.com bash scripts/deploy-ubuntu.sh
```

多个域名：

```bash
sudo DOMAIN="example.com www.example.com" bash scripts/deploy-ubuntu.sh
```

## 带 HTTPS 部署

请先把域名解析到服务器 IP，再执行：

```bash
sudo DOMAIN="example.com www.example.com" ENABLE_SSL=1 EMAIL=you@example.com bash scripts/deploy-ubuntu.sh
```

## 自定义密码

不传密码时脚本会自动生成强密码。也可以手动指定：

```bash
sudo ADMIN_PASSWORD='admin-strong-password' DB_PASSWORD='mysql-strong-password' bash scripts/deploy-ubuntu.sh
```

## 更新项目

以后更新代码后，重新执行同一个脚本即可：

```bash
sudo bash scripts/deploy-ubuntu.sh
```

脚本会重新安装依赖、刷新服务配置并重启应用。

## 常用命令

查看服务状态：

```bash
sudo systemctl status codexnovel
```

查看实时日志：

```bash
sudo journalctl -u codexnovel -f
```

重启服务：

```bash
sudo systemctl restart codexnovel
```

部署测试和优化记录见：[deploy-test-log.md](deploy-test-log.md)。

查看配置：

```bash
cat .env
```

## 脚本默认值

- 应用服务名：`codexnovel`
- 应用端口：`3008`
- 数据库名：`novel`
- 数据库用户：`novel_app`
- 运行用户：当前登录用户；用 `sudo bash ...` 执行时使用发起 sudo 的用户；直接 root 执行时使用 `www-data`

需要改默认值时，在命令前加环境变量：

```bash
sudo APP_NAME=my-novel PORT=3010 DB_NAME=my_novel bash scripts/deploy-ubuntu.sh
```

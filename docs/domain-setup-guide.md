# 域名配置指南

**域名**: novel.huisheng.us.ci  
**服务器**: 35.78.226.63  
**应用端口**: 3008

---

## 当前状态

- ✅ 域名已解析（通过 Cloudflare）
- ✅ 应用已部署并运行
- ⏳ Nginx 反向代理待配置
- ⏳ SSL 证书待配置

---

## 配置步骤

### 1. 配置 Nginx

SSH 连接到服务器：
```bash
ssh -i "D:\运维\aws001.pem" ubuntu@35.78.226.63
```

安装 Nginx：
```bash
sudo apt-get update
sudo apt-get install -y nginx
```

创建站点配置：
```bash
sudo nano /etc/nginx/sites-available/novel.huisheng.us.ci
```

粘贴以下配置：
```nginx
# codexnovel - novel.huisheng.us.ci
server {
    listen 80;
    listen [::]:80;
    server_name novel.huisheng.us.ci;

    # 安全响应头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 日志
    access_log /var/log/nginx/novel.huisheng.us.ci_access.log;
    error_log /var/log/nginx/novel.huisheng.us.ci_error.log;

    # 限制请求体大小
    client_max_body_size 50M;

    # 反向代理到 Node.js
    location / {
        proxy_pass http://localhost:3008;
        proxy_http_version 1.1;

        # 保持连接
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # 真实 IP（支持 Cloudflare）
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 静态文件缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://localhost:3008;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # 健康检查
    location /healthz {
        proxy_pass http://localhost:3008/healthz;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

启用站点并重启 Nginx：
```bash
# 启用站点
sudo ln -s /etc/nginx/sites-available/novel.huisheng.us.ci /etc/nginx/sites-enabled/

# 删除默认站点
sudo rm -f /etc/nginx/sites-enabled/default

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### 2. 更新应用配置

编辑 .env 文件：
```bash
cd /home/ubuntu/codexnovel
nano .env
```

添加或更新以下配置：
```bash
# 信任代理（必需）
TRUST_PROXY=true

# 允许的域名
ALLOWED_HOSTS=novel.huisheng.us.ci,35.78.226.63
```

重启应用：
```bash
pm2 restart codexnovel --update-env
pm2 list
```

### 3. 配置防火墙

允许 HTTP 和 HTTPS 流量：
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

### 4. 测试访问

本地测试（服务器上）：
```bash
curl -I http://localhost
curl http://localhost/healthz
```

外部测试：
```bash
# Windows 本地
curl -I http://novel.huisheng.us.ci
```

---

## 如果使用 Cloudflare

### Cloudflare 设置

1. **SSL/TLS 模式**: Flexible 或 Full
   - 访问: Cloudflare Dashboard > SSL/TLS
   - 推荐: Full（需要服务器配置 SSL）

2. **真实 IP 恢复**
   - Cloudflare 会添加 `CF-Connecting-IP` 头
   - Nginx 配置已包含此头的转发

3. **防火墙规则**
   - 可选：只允许 Cloudflare IP 访问源站
   - 参考: https://www.cloudflare.com/ips/

### 安装 SSL 证书（推荐）

如果使用 Cloudflare Flexible SSL，服务器可以不配置证书。
如果使用 Full SSL，按以下步骤配置：

```bash
# 安装 Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 申请证书
sudo certbot --nginx -d novel.huisheng.us.ci --email admin@huisheng.us.ci

# 测试自动续期
sudo certbot renew --dry-run
```

---

## 验证清单

- [ ] Nginx 已安装并运行
- [ ] 站点配置已创建并启用
- [ ] .env 文件已更新 TRUST_PROXY=true
- [ ] 应用已重启
- [ ] 防火墙已开放 80/443 端口
- [ ] 本地 curl 测试通过
- [ ] 外部浏览器访问测试
- [ ] 健康检查端点可访问
- [ ] Cloudflare SSL 模式已设置

---

## 故障排查

### Nginx 无法启动
```bash
# 查看错误日志
sudo nginx -t
sudo journalctl -u nginx -n 50

# 检查端口占用
sudo lsof -i :80
sudo netstat -tuln | grep :80
```

### 502 Bad Gateway
```bash
# 检查应用是否运行
pm2 list
curl http://localhost:3008/healthz

# 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/novel.huisheng.us.ci_error.log

# 检查 SELinux（如果启用）
sudo setenforce 0  # 临时禁用测试
```

### 域名无法访问
```bash
# 检查 DNS 解析
nslookup novel.huisheng.us.ci
dig novel.huisheng.us.ci

# 检查防火墙
sudo ufw status
sudo iptables -L -n

# 检查 Nginx 监听
sudo ss -tuln | grep :80
```

### Cloudflare 循环重定向
- 问题：Cloudflare SSL 设置为 Flexible，但 Nginx 强制 HTTPS
- 解决：Cloudflare 改为 Full，或 Nginx 移除 HTTPS 重定向

---

## 自动化脚本

### 快速配置
```bash
# 本地运行（需要 SSH 连接正常）
bash setup-nginx.sh

# 配置 SSL（可选）
bash setup-ssl.sh
```

### 快速部署
```bash
# 推送代码并重启
bash deploy-fast.sh
```

---

## Nginx 常用命令

```bash
# 测试配置
sudo nginx -t

# 重启
sudo systemctl restart nginx

# 重新加载（无停机）
sudo systemctl reload nginx

# 查看状态
sudo systemctl status nginx

# 查看访问日志
sudo tail -f /var/log/nginx/novel.huisheng.us.ci_access.log

# 查看错误日志
sudo tail -f /var/log/nginx/novel.huisheng.us.ci_error.log
```

---

## 最后更新

**日期**: 2026-11-02  
**状态**: 待配置  
**下一步**: SSH 连接服务器，执行上述配置步骤

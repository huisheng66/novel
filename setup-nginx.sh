#!/bin/bash
# Nginx 配置脚本 - 配置域名和 HTTPS

set -e

DOMAIN="novel.huisheng.us.ci"
SERVER_IP="35.78.226.63"
APP_PORT="3008"

echo "=========================================="
echo "配置域名: $DOMAIN"
echo "=========================================="

# 1. 检查域名解析
echo ""
echo "1. 检查域名解析..."
RESOLVED_IP=$(dig +short $DOMAIN | tail -1)
if [ -z "$RESOLVED_IP" ]; then
    echo "⚠️  域名未解析或解析未生效"
    echo ""
    echo "请在域名管理处添加 A 记录："
    echo "  主机记录: novel.huisheng"
    echo "  记录类型: A"
    echo "  记录值: $SERVER_IP"
    echo "  TTL: 600"
    echo ""
    read -p "解析完成后按回车继续..."
else
    echo "✓ 域名已解析到: $RESOLVED_IP"
    if [ "$RESOLVED_IP" != "$SERVER_IP" ]; then
        echo "⚠️  解析的 IP ($RESOLVED_IP) 与服务器 IP ($SERVER_IP) 不一致"
        read -p "是否继续? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

# 2. 在服务器上安装和配置 Nginx
echo ""
echo "2. 配置 Nginx..."

ssh -i "D:\\运维\\aws001.pem" ubuntu@${SERVER_IP} << ENDSSH
    set -e

    # 安装 Nginx
    if ! command -v nginx &> /dev/null; then
        echo "安装 Nginx..."
        sudo apt-get update
        sudo apt-get install -y nginx
    else
        echo "✓ Nginx 已安装"
        nginx -v
    fi

    # 创建 Nginx 配置
    echo "创建站点配置..."
    sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null << 'EOF'
# codexnovel - $DOMAIN
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # 安全响应头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 日志
    access_log /var/log/nginx/${DOMAIN}_access.log;
    error_log /var/log/nginx/${DOMAIN}_error.log;

    # 限制请求体大小
    client_max_body_size 50M;

    # 反向代理到 Node.js
    location / {
        proxy_pass http://localhost:$APP_PORT;
        proxy_http_version 1.1;

        # 保持连接
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;

        # 真实 IP
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 静态文件缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://localhost:$APP_PORT;
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # 健康检查
    location /healthz {
        proxy_pass http://localhost:$APP_PORT/healthz;
        proxy_set_header Host \$host;
        access_log off;
    }
}
EOF

    # 启用站点
    echo "启用站点..."
    sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/

    # 删除默认站点（如果存在）
    sudo rm -f /etc/nginx/sites-enabled/default

    # 测试配置
    echo "测试 Nginx 配置..."
    sudo nginx -t

    # 重启 Nginx
    echo "重启 Nginx..."
    sudo systemctl restart nginx
    sudo systemctl enable nginx

    echo "✓ Nginx 配置完成"
    echo ""
    echo "Nginx 状态:"
    sudo systemctl status nginx --no-pager | head -10
ENDSSH

# 3. 更新应用配置
echo ""
echo "3. 更新应用配置..."
ssh -i "D:\\运维\\aws001.pem" ubuntu@${SERVER_IP} << ENDSSH
    cd /home/ubuntu/codexnovel

    # 备份 .env
    cp .env .env.backup.\$(date +%Y%m%d_%H%M%S)

    # 更新配置
    if ! grep -q "^TRUST_PROXY=" .env; then
        echo "TRUST_PROXY=true" >> .env
    else
        sed -i 's/^TRUST_PROXY=.*/TRUST_PROXY=true/' .env
    fi

    if ! grep -q "^ALLOWED_HOSTS=" .env; then
        echo "ALLOWED_HOSTS=$DOMAIN,$SERVER_IP" >> .env
    else
        sed -i "s/^ALLOWED_HOSTS=.*/ALLOWED_HOSTS=$DOMAIN,$SERVER_IP/" .env
    fi

    echo "✓ 配置已更新"

    # 重启应用
    echo "重启应用..."
    pm2 restart codexnovel --update-env
    sleep 2
    pm2 list
ENDSSH

# 4. 测试访问
echo ""
echo "4. 测试访问..."
sleep 2

HTTP_CODE=\$(curl -s -o /dev/null -w "%{http_code}" http://$DOMAIN)
if [ "\$HTTP_CODE" = "200" ] || [ "\$HTTP_CODE" = "302" ] || [ "\$HTTP_CODE" = "301" ]; then
    echo "✓ HTTP 访问成功 (状态码: \$HTTP_CODE)"
else
    echo "⚠️  HTTP 访问异常 (状态码: \$HTTP_CODE)"
fi

echo ""
echo "=========================================="
echo "✅ 域名配置完成！"
echo "=========================================="
echo ""
echo "访问地址:"
echo "  HTTP:  http://$DOMAIN"
echo "  直接:  http://$SERVER_IP:$APP_PORT"
echo ""
echo "下一步: 配置 HTTPS (Let's Encrypt)"
echo "  运行: bash setup-ssl.sh"
echo ""

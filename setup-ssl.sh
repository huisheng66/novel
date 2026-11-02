#!/bin/bash
# SSL 证书配置脚本 - Let's Encrypt

set -e

DOMAIN="novel.huisheng.us.ci"
SERVER_IP="35.78.226.63"
EMAIL="admin@huisheng.us.ci"  # 修改为你的邮箱

echo "=========================================="
echo "配置 SSL 证书: $DOMAIN"
echo "=========================================="

# 1. 检查域名可访问性
echo ""
echo "1. 检查域名 HTTP 访问..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://$DOMAIN)
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "302" ] && [ "$HTTP_CODE" != "301" ] && [ "$HTTP_CODE" != "403" ]; then
    echo "❌ 域名无法通过 HTTP 访问 (状态码: $HTTP_CODE)"
    echo "请先运行: bash setup-nginx.sh"
    exit 1
fi
echo "✓ 域名可访问"

# 2. 安装 Certbot
echo ""
echo "2. 安装 Certbot..."
ssh -i "D:\\运维\\aws001.pem" ubuntu@${SERVER_IP} << 'ENDSSH'
    if ! command -v certbot &> /dev/null; then
        echo "安装 Certbot..."
        sudo apt-get update
        sudo apt-get install -y certbot python3-certbot-nginx
    else
        echo "✓ Certbot 已安装"
        certbot --version
    fi
ENDSSH

# 3. 申请证书
echo ""
echo "3. 申请 SSL 证书..."
ssh -i "D:\\运维\\aws001.pem" ubuntu@${SERVER_IP} << ENDSSH
    set -e

    echo "申请证书（自动配置 Nginx）..."
    sudo certbot --nginx \
        -d $DOMAIN \
        --email $EMAIL \
        --agree-tos \
        --no-eff-email \
        --redirect \
        --non-interactive

    echo ""
    echo "✓ 证书申请成功"

    # 测试自动续期
    echo ""
    echo "测试自动续期..."
    sudo certbot renew --dry-run

    echo ""
    echo "✓ 自动续期配置正常"

    # 查看证书信息
    echo ""
    echo "证书信息:"
    sudo certbot certificates
ENDSSH

# 4. 更新应用配置
echo ""
echo "4. 更新应用配置..."
ssh -i "D:\\运维\\aws001.pem" ubuntu@${SERVER_IP} << ENDSSH
    cd /home/ubuntu/codexnovel

    # 确保 TRUST_PROXY 已启用
    if ! grep -q "^TRUST_PROXY=true" .env; then
        sed -i 's/^TRUST_PROXY=.*/TRUST_PROXY=true/' .env || echo "TRUST_PROXY=true" >> .env
    fi

    echo "重启应用..."
    pm2 restart codexnovel --update-env
ENDSSH

# 5. 测试 HTTPS 访问
echo ""
echo "5. 测试 HTTPS 访问..."
sleep 2

HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN)
if [ "$HTTPS_CODE" = "200" ] || [ "$HTTPS_CODE" = "302" ] || [ "$HTTPS_CODE" = "301" ]; then
    echo "✓ HTTPS 访问成功 (状态码: $HTTPS_CODE)"
else
    echo "⚠️  HTTPS 访问异常 (状态码: $HTTPS_CODE)"
fi

# 6. 测试 HTTP 重定向
echo ""
echo "6. 测试 HTTP -> HTTPS 重定向..."
REDIRECT=$(curl -s -I http://$DOMAIN | grep -i "location:" | grep "https://" || echo "")
if [ -n "$REDIRECT" ]; then
    echo "✓ HTTP 自动重定向到 HTTPS"
else
    echo "⚠️  HTTP 未重定向"
fi

echo ""
echo "=========================================="
echo "✅ SSL 证书配置完成！"
echo "=========================================="
echo ""
echo "访问地址:"
echo "  HTTPS: https://$DOMAIN"
echo "  HTTP:  http://$DOMAIN (自动重定向到 HTTPS)"
echo ""
echo "证书信息:"
echo "  颁发者: Let's Encrypt"
echo "  有效期: 90 天"
echo "  自动续期: 已配置 (certbot renew)"
echo ""
echo "安全评级测试:"
echo "  https://www.ssllabs.com/ssltest/analyze.html?d=$DOMAIN"
echo ""

#!/bin/bash
# 快速部署 - 只传代码，不编译

set -e

SERVER_IP="35.78.226.63"
PEM_FILE="D:\\运维\\aws001.pem"
REMOTE_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/codexnovel"

echo "=========================================="
echo "快速部署到 AWS: $SERVER_IP"
echo "=========================================="

# 1. 推送到 GitHub
echo ""
echo "1. 推送到 GitHub..."
if ! git diff-index --quiet HEAD --; then
    echo "⚠️  有未提交的修改"
    git status --short
    read -p "是否提交并推送? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git add -A
        read -p "提交消息: " commit_msg
        git commit -m "$commit_msg"
        git push origin app
    else
        echo "取消部署"
        exit 1
    fi
else
    echo "✓ 代码已是最新，推送..."
    git push origin app
fi

# 2. 服务器拉取并重启
echo ""
echo "2. 服务器更新..."
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} << 'ENDSSH'
    set -e
    cd /home/ubuntu/codexnovel

    echo "拉取最新代码..."
    git fetch origin
    git checkout app
    git pull origin app

    echo "检查依赖变更..."
    if git diff HEAD@{1} HEAD -- package.json package-lock.json | grep -q .; then
        echo "依赖有变更，安装..."
        npm install --omit=dev
    else
        echo "✓ 依赖无变更，跳过安装"
    fi

    echo "重启服务..."
    pm2 restart codexnovel --update-env

    sleep 2
    echo ""
    echo "服务状态:"
    pm2 list

    echo ""
    echo "最近日志（最后 5 行）:"
    pm2 logs codexnovel --lines 5 --nostream
ENDSSH

# 3. 健康检查
echo ""
echo "3. 健康检查..."
sleep 1
HEALTH=$(ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "curl -s http://localhost:3008/healthz")
echo "$HEALTH" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('✓ 状态:', d['status'])
    print('✓ 数据库:', d.get('database', {}).get('total', 'N/A'), '连接')
    print('✓ 内存:', d.get('memory', {}).get('rss', 'N/A'))
except:
    print('❌ 健康检查失败')
    sys.exit(1)
"

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo "访问: http://$SERVER_IP:3008"
echo ""

#!/bin/bash
# AWS 服务器部署脚本

set -e

SERVER_IP="35.78.226.63"
PEM_FILE="D:\\运维\\aws001.pem"
REMOTE_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/codexnovel"

echo "=========================================="
echo "部署到 AWS 服务器: $SERVER_IP"
echo "=========================================="

# 1. 测试 SSH 连接
echo ""
echo "1. 测试 SSH 连接..."
ssh -i "$PEM_FILE" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${REMOTE_USER}@${SERVER_IP} "echo '连接成功'" || {
    echo "❌ SSH 连接失败，请检查："
    echo "  - 服务器 IP: $SERVER_IP"
    echo "  - PEM 文件路径: $PEM_FILE"
    echo "  - 服务器是否运行"
    echo "  - 安全组规则（SSH 端口 22）"
    exit 1
}

# 2. 检查远程目录
echo ""
echo "2. 检查远程目录..."
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    if [ ! -d '$REMOTE_DIR' ]; then
        echo '远程目录不存在，创建目录...'
        mkdir -p $REMOTE_DIR
        cd $REMOTE_DIR
        git clone https://github.com/huisheng66/novel.git .
    fi
    cd $REMOTE_DIR
    echo '当前分支：'
    git branch
"

# 3. 拉取最新代码
echo ""
echo "3. 拉取最新代码..."
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    cd $REMOTE_DIR
    echo '切换到 app 分支...'
    git fetch origin
    git checkout app
    git pull origin app
    echo '最新提交：'
    git log --oneline -3
"

# 4. 安装依赖
echo ""
echo "4. 安装依赖..."
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    cd $REMOTE_DIR
    if [ ! -f package.json ]; then
        echo '❌ package.json 不存在'
        exit 1
    fi
    echo '安装 npm 依赖...'
    npm install --production
"

# 5. 重启服务
echo ""
echo "5. 重启服务..."
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    cd $REMOTE_DIR

    # 检查 PM2 是否安装
    if ! command -v pm2 &> /dev/null; then
        echo '安装 PM2（需要 sudo）...'
        sudo npm install -g pm2
    fi

    # 停止旧进程（如果有）
    pkill -f 'node.*server.js' || true

    # 检查 .env 文件
    if [ ! -f .env ]; then
        echo '⚠️  警告: .env 文件不存在，使用 .env.example 创建'
        if [ -f .env.example ]; then
            cp .env.example .env
            echo '请编辑 .env 文件配置数据库和密钥'
        fi
    fi

    # 重启应用
    if pm2 list | grep -q 'codexnovel'; then
        echo '重启现有应用...'
        pm2 restart codexnovel
    else
        echo '首次启动应用...'
        NODE_ENV=production pm2 start server.js --name codexnovel
    fi

    # 设置开机自启
    pm2 startup | grep 'sudo' | bash || true
    pm2 save

    # 显示状态
    pm2 list
    echo ''
    echo '最近日志:'
    pm2 logs codexnovel --lines 10 --nostream
"

# 6. 健康检查
echo ""
echo "6. 健康检查..."
sleep 3
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    echo '检查服务状态...'
    curl -s http://localhost:3000/healthz | head -20 || echo '健康检查失败'
"

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "访问地址:"
echo "  http://$SERVER_IP:3000"
echo ""
echo "常用命令:"
echo "  查看日志: ssh -i \"$PEM_FILE\" ${REMOTE_USER}@${SERVER_IP} \"cd $REMOTE_DIR && pm2 logs codexnovel\""
echo "  重启服务: ssh -i \"$PEM_FILE\" ${REMOTE_USER}@${SERVER_IP} \"cd $REMOTE_DIR && pm2 restart codexnovel\""
echo "  停止服务: ssh -i \"$PEM_FILE\" ${REMOTE_USER}@${SERVER_IP} \"cd $REMOTE_DIR && pm2 stop codexnovel\""
echo ""

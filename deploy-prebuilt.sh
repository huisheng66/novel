#!/bin/bash
# 预编译部署脚本 - 本地构建，服务器免编译

set -e

SERVER_IP="35.78.226.63"
PEM_FILE="D:\\运维\\aws001.pem"
REMOTE_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/codexnovel"
LOCAL_DEPLOY_DIR=".deploy"

echo "=========================================="
echo "预编译部署到 AWS: $SERVER_IP"
echo "=========================================="

# 1. 本地准备部署包
echo ""
echo "1. 准备本地部署包..."
rm -rf $LOCAL_DEPLOY_DIR
mkdir -p $LOCAL_DEPLOY_DIR

# 复制必要文件（不包括 node_modules）
echo "复制文件..."
rsync -av --progress \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.deploy' \
  --exclude='test*' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='uploads/*' \
  --exclude='*.md' \
  --exclude='docs/*' \
  --exclude='android/*' \
  --exclude='.release/*' \
  ./ $LOCAL_DEPLOY_DIR/

echo "✓ 文件复制完成"
echo ""

# 2. 上传到服务器
echo "2. 上传到服务器..."
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    # 创建临时目录
    mkdir -p ${REMOTE_DIR}_new
"

rsync -avz --delete --progress \
  -e "ssh -i \"$PEM_FILE\"" \
  $LOCAL_DEPLOY_DIR/ \
  ${REMOTE_USER}@${SERVER_IP}:${REMOTE_DIR}_new/

echo "✓ 文件上传完成"
echo ""

# 3. 服务器端操作
echo "3. 服务器端部署..."
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    set -e
    cd ${REMOTE_DIR}_new

    echo '安装生产依赖（仅首次或依赖变更）...'
    if [ ! -d node_modules ]; then
        npm ci --omit=dev
    else
        # 检查 package-lock.json 是否变更
        if [ -f ${REMOTE_DIR}/package-lock.json ]; then
            if ! diff -q package-lock.json ${REMOTE_DIR}/package-lock.json > /dev/null 2>&1; then
                echo '依赖有变更，重新安装...'
                npm ci --omit=dev
            else
                echo '依赖无变更，跳过安装'
                cp -r ${REMOTE_DIR}/node_modules ./
            fi
        else
            npm ci --omit=dev
        fi
    fi

    echo '保留 .env 和 uploads 目录...'
    if [ -f ${REMOTE_DIR}/.env ]; then
        cp ${REMOTE_DIR}/.env ./
    fi
    if [ -d ${REMOTE_DIR}/uploads ]; then
        cp -r ${REMOTE_DIR}/uploads ./
    fi

    echo '替换旧版本...'
    cd ~
    if [ -d ${REMOTE_DIR}_old ]; then
        rm -rf ${REMOTE_DIR}_old
    fi
    if [ -d ${REMOTE_DIR} ]; then
        mv ${REMOTE_DIR} ${REMOTE_DIR}_old
    fi
    mv ${REMOTE_DIR}_new ${REMOTE_DIR}

    echo '重启服务...'
    cd ${REMOTE_DIR}
    if pm2 list | grep -q codexnovel; then
        pm2 restart codexnovel --update-env
    else
        NODE_ENV=production pm2 start server.js --name codexnovel
        pm2 save
    fi

    sleep 2
    echo ''
    echo '服务状态:'
    pm2 list | grep codexnovel || pm2 list

    echo ''
    echo '最近日志:'
    pm2 logs codexnovel --lines 10 --nostream
"

# 4. 清理本地临时文件
echo ""
echo "4. 清理本地临时文件..."
rm -rf $LOCAL_DEPLOY_DIR
echo "✓ 清理完成"

# 5. 健康检查
echo ""
echo "5. 健康检查..."
sleep 2
ssh -i "$PEM_FILE" ${REMOTE_USER}@${SERVER_IP} "
    curl -s http://localhost:3008/healthz | python3 -c 'import sys, json; d=json.load(sys.stdin); print(\"Status:\", d[\"status\"]); print(\"Database:\", d.get(\"database\", {}).get(\"total\", \"N/A\"), \"connections\")'
"

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "访问地址: http://$SERVER_IP:3008"
echo ""
echo "回滚命令（如需要）:"
echo "  ssh -i \"$PEM_FILE\" ${REMOTE_USER}@${SERVER_IP} \"cd ~ && rm -rf $REMOTE_DIR && mv ${REMOTE_DIR}_old $REMOTE_DIR && pm2 restart codexnovel\""
echo ""

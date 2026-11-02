#!/bin/bash
# 快速数据库配置脚本

set -e

DB_NAME="codexnovel"
DB_USER="codexnovel_app"
DB_PASS=$(openssl rand -base64 24)
DB_ROOT_PASS=""

echo "=========================================="
echo "数据库配置向导"
echo "=========================================="
echo ""

# 1. 检查 MySQL
if ! command -v mysql &> /dev/null; then
    echo "❌ MySQL 未安装"
    echo "安装命令: sudo apt-get install mysql-server"
    exit 1
fi

echo "✓ MySQL 已安装"
mysql --version
echo ""

# 2. 提示输入 root 密码
echo "请输入 MySQL root 密码（如果没有设置则直接回车）:"
read -s DB_ROOT_PASS
echo ""

# 3. 测试连接
if [ -z "$DB_ROOT_PASS" ]; then
    MYSQL_CMD="sudo mysql"
else
    MYSQL_CMD="mysql -u root -p$DB_ROOT_PASS"
fi

echo "测试 MySQL 连接..."
if ! $MYSQL_CMD -e "SELECT 1" &> /dev/null; then
    echo "❌ MySQL 连接失败"
    echo "尝试使用 sudo 连接..."
    MYSQL_CMD="sudo mysql"
    if ! $MYSQL_CMD -e "SELECT 1" &> /dev/null; then
        echo "❌ 无法连接到 MySQL"
        exit 1
    fi
fi
echo "✓ MySQL 连接成功"
echo ""

# 4. 创建数据库和用户
echo "创建数据库和用户..."
$MYSQL_CMD << EOF
-- 创建数据库
CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';

-- 授予权限
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER
ON $DB_NAME.* TO '$DB_USER'@'localhost';

FLUSH PRIVILEGES;

-- 显示结果
SELECT 'Database and user created successfully' AS Status;
SHOW DATABASES LIKE '$DB_NAME';
EOF

echo ""
echo "✓ 数据库配置完成"
echo ""
echo "=========================================="
echo "数据库连接信息"
echo "=========================================="
echo "数据库名: $DB_NAME"
echo "用户名: $DB_USER"
echo "密码: $DB_PASS"
echo "主机: localhost"
echo "端口: 3306"
echo ""

# 5. 更新 .env
if [ -f .env ]; then
    echo "更新 .env 文件..."
    cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

    # 更新数据库配置
    sed -i "s/^DB_NAME=.*/DB_NAME=$DB_NAME/" .env
    sed -i "s/^DB_USER=.*/DB_USER=$DB_USER/" .env
    sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$DB_PASS/" .env

    echo "✓ .env 已更新"
fi

echo ""
echo "=========================================="
echo "下一步"
echo "=========================================="
echo "1. 重启应用: pm2 restart codexnovel"
echo "2. 查看日志: pm2 logs codexnovel"
echo "3. 访问: http://35.78.226.63:3008"
echo ""

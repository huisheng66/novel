# 🚀 项目启动指南

**时间**: 2024-11-01  
**前置条件**: ✅ MySQL 已启动  
**状态**: 准备启动 Node.js 服务器

---

## 第一步：测试数据库连接

在项目根目录打开终端，运行：

```bash
node test-db.js
```

**预期输出**:
```
✅ MySQL 连接成功
✅ 数据库 'novel' 存在
✅ 数据库结构完整
✅ 数据库结构是最新版本 (v11)
```

**如果报错**:
- `ECONNREFUSED` → MySQL 未启动，运行 `net start MySQL80`
- `Access denied` → 检查 `.env` 中的 `DB_PASSWORD=000000` 是否正确
- `ER_BAD_DB_ERROR` → 数据库不存在，首次启动会自动创建

---

## 第二步：启动服务器

### 方式 1: npm start（推荐）

```bash
npm start
```

**预期输出**:
```
codexnovel server listening on port 3008
Database connected
数据库迁移完成 (如果有新迁移)
```

### 方式 2: node 直接启动

```bash
node server.js
```

---

## 第三步：验证启动成功

### 3.1 在浏览器打开

```
http://localhost:3008
```

应该看到首页（书籍列表）

### 3.2 运行健康检查（新终端）

**保持第一个终端运行服务器**，打开新终端：

```bash
node health-check.js
```

**预期输出**:
```
✅ 首页 (200 OK)
✅ 登录页 (200 OK)
✅ 注册页 (200 OK)
✅ 钱包页重定向 (302)
✅ 管理后台 (200 OK)
✅ API 端点 (200 OK)
✅ 404 页面 (404)

📊 测试结果: 7 通过 / 0 失败
```

### 3.3 运行代码验证

```bash
node verify-fixes.js
```

**预期输出**:
```
✅ PASS: CSS 变量定义正确
✅ 使用 classList.toggle 替代 hidden
✅ visualViewport API 已集成
✅ 5 秒超时恢复机制

📊 测试结果: 9 通过 / 0 失败
```

---

## 关键 URL

| 页面 | URL | 备注 |
|------|-----|------|
| 首页 | http://localhost:3008 | 书籍列表 |
| 登录 | http://localhost:3008/login | - |
| 注册 | http://localhost:3008/register | - |
| 钱包 | http://localhost:3008/wallet | 需要登录 |
| 管理后台 | http://localhost:3008/admin/login | 密码: `CxfSvCfH-vid8E` |
| API 文档 | http://localhost:3008/api/v1/health | 健康检查 |

---

## 快速测试流程

### 1. 测试注册/登录（5 分钟）

```
1. 访问 http://localhost:3008/register
2. 注册新用户:
   用户名: testuser001
   密码: Test@123456
   邮箱: test001@example.com
3. 登录
4. 查看右上角应显示用户名和"退出"按钮
```

### 2. 测试阅读功能（5 分钟）

```
1. 首页点击"星辰变"
2. 点击"第一章 秦羽"进入阅读
3. 测试功能:
   - 字体大小调整（右上角 A+/A-）
   - 主题切换（日间/夜间）
   - 滚动页面，观察进度保存
   - 刷新页面，应恢复到上次位置
```

### 3. 测试付费系统（10 分钟）

```
1. 登录管理后台 http://localhost:3008/admin/login
   密码: CxfSvCfH-vid8E

2. 点击"付费墙配置" → 设置书籍付费
   - 选择"星辰变"
   - 免费到第几章: 1
   - 每章价格: 10 (分)
   - 启用: 是
   - 保存

3. 退出管理后台，回到普通用户

4. 点击"星辰变"第二章
   - 应该显示付费页面"本章需要 0.10 元"

5. 点击"钱包" → 应该显示余额 0.00

6. 回到管理后台 → "充值码管理" → 生成充值码
   - 金额: 100 (分 = 1元)
   - 数量: 1
   - 复制生成的充值码

7. 退出，回到用户钱包页 → 输入充值码 → 兑换
   - 余额应该变为 1.00 元

8. 回到第二章 → 点击"解锁阅读"
   - 应该扣费成功，余额变为 0.90 元
   - 可以正常阅读第二章

9. 刷新页面，第二章应该仍然可读（已购买）
```

### 4. 测试管理后台（5 分钟）

```
1. 管理后台 → "仪表盘"
   - 查看访问统计、用户数、订单数

2. "书籍管理" → 点击"星辰变" → "章节管理"
   - 查看章节列表
   - 可以编辑章节标题/内容

3. "用户管理"
   - 查看注册用户列表
   - 可以查看用户余额、购买记录

4. "令牌管理"（Token）
   - 创建新令牌（用于分享链接）
   - 测试令牌访问: http://localhost:3008/?token=<生成的token>
```

---

## P0 修复验证

### 1. CSS 变量（2 分钟）

```
1. 打开首页 http://localhost:3008
2. F12 → Elements 标签
3. 选中 <html> 元素
4. Computed 面板 → 搜索 --bg
5. ✅ 应该看到颜色值（如 #ffffff）
6. 切换系统深色模式（Windows 设置 → 个性化 → 颜色 → 深色）
7. 刷新页面
8. ✅ 背景应该变为深色（#0a0d12 左右）
```

### 2. 章节搜索性能（3 分钟）

```
1. 访问"星辰变"书籍页
2. 在章节搜索框输入"第"
3. ✅ 应该立即筛选，无明显卡顿
4. F12 → Performance 标签 → 录制
5. 快速输入"第一章"
6. 停止录制，查看火焰图
7. ✅ 过滤操作应该 < 100ms
```

### 3. 移动端键盘问题（5 分钟）

```
1. 打开任意章节 http://localhost:3008/chapter/1
2. F12 → 切换设备工具栏（Ctrl+Shift+M）
3. 选择 iPhone 12 Pro
4. 滚动到 50% 位置
5. Console 输入: localStorage.getItem('read_progress_chap_1')
   记录值（如 {"r":0.5}）
6. 点击页面任意输入框（模拟键盘弹起）
7. 再次检查: localStorage.getItem('read_progress_chap_1')
8. ✅ 值应该未改变（键盘弹起不误触）
```

### 4. 表单按钮恢复（3 分钟）

```
1. 打开登录页 http://localhost:3008/login
2. F12 → Network → Throttling → Offline
3. 输入任意用户名密码
4. 点击"登录"
5. ✅ 按钮变为"处理中…"且禁用
6. 开始计时 5 秒
7. ✅ 5 秒后按钮应自动恢复为"登录"且可点击
8. Network → Throttling → No throttling（恢复网络）
```

---

## 常见问题

### Q: 端口 3008 被占用
```bash
# 查找占用进程
netstat -ano | findstr :3008

# 杀死进程（替换 <PID> 为上面显示的数字）
taskkill /PID <PID> /F

# 或者修改端口
# 编辑 .env 文件: PORT=3009
```

### Q: 启动后立即退出
```bash
# 查看详细错误
node server.js

# 常见原因:
# 1. MySQL 未启动
# 2. 数据库密码错误
# 3. 端口被占用
```

### Q: 页面显示异常
```bash
# 清除浏览器缓存
Ctrl + Shift + Delete

# 硬刷新
Ctrl + F5

# 检查 CSS 文件是否加载
F12 → Network → 查找 main.css（应该 200 OK）
```

### Q: 数据库连接失败
```bash
# 测试 MySQL 连接
mysql -u root -p000000

# 如果成功，说明 MySQL 正常，检查 .env 配置
cat .env | grep DB_

# 确保:
# DB_HOST=localhost
# DB_USER=root
# DB_PASSWORD=000000
# DB_NAME=novel
```

---

## 下一步

✅ 完成启动和基础测试后：

1. 📝 填写测试结果到 `TEST-LOG-20241101.md`
2. 📱 移动端真机测试（可选）
3. 🚀 性能测试 Lighthouse（可选）
4. 📊 查看 `P0-FIX-REPORT.md` 了解技术细节

---

## 需要帮助？

如果遇到任何问题：
1. 查看服务器终端的错误日志
2. 查看浏览器 F12 Console 的错误
3. 告诉我具体的错误信息，我会立即帮你解决

---

**准备好了！现在在终端运行:**

```bash
# 第一步：测试数据库
node test-db.js

# 第二步：启动服务器
npm start
```

🎉 启动后访问: http://localhost:3008

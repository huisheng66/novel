# 🚀 手动启动指南

**当前状态**: 分类器暂时不可用，需要手动启动服务器

---

## 快速启动（3 个命令）

### 1. 启动 MySQL（如果未启动）

```bash
# Windows - 以管理员身份运行命令提示符
net start MySQL80
```

或者通过 MySQL Workbench 启动。

---

### 2. 启动服务器

在项目根目录 `D:\codexnovel` 打开终端：

```bash
npm start
```

**预期输出**:
```
codexnovel server listening on port 3008
Database connected
```

**如果看到错误**:
- `Error: listen EADDRINUSE` → 端口被占用，运行 `netstat -ano | findstr :3008` 查看
- `Error: connect ECONNREFUSED` → MySQL 未启动
- `Error: Access denied` → 检查 `.env` 中的数据库密码

---

### 3. 验证服务器（新终端）

打开**新的终端窗口**（不要关闭服务器），运行：

```bash
# 静态代码验证
node verify-fixes.js

# 服务器健康检查（等服务器完全启动后）
node health-check.js
```

---

## 完整测试流程

### 终端 1: 保持运行
```bash
npm start
# 服务器日志会持续输出，不要关闭这个终端
```

### 终端 2: 运行测试
```bash
# 等待 3-5 秒确保服务器启动完成

# 1. 静态验证
node verify-fixes.js

# 2. 健康检查
node health-check.js

# 3. 打开浏览器测试
start http://localhost:3008
```

---

## 浏览器测试清单

### ✅ P0 修复验证（关键）

#### 测试 1: CSS 变量
1. 打开 `http://localhost:3008`
2. 右键 → 检查 → Elements 标签
3. 选中 `<html>` 元素
4. 查看 Computed 面板，搜索 `--bg`
5. **验证**: 应该看到颜色值（如 `#ffffff` 或 `#0a0d12`）
6. 切换系统深色模式（Windows 设置 → 个性化 → 颜色）
7. 刷新页面
8. **验证**: 颜色应该变化（深色背景）

✅ **PASS** 如果颜色正常显示且深色模式可切换

---

#### 测试 2: 章节搜索性能
1. 访问任意书籍页面（需要至少 50+ 章节）
2. 打开开发者工具（F12）
3. Performance 标签 → 点击"录制"按钮（圆圈图标）
4. 在章节搜索框输入关键词（如"第一"）
5. 停止录制
6. 查看火焰图，找到 `filterChapters` 或类似函数
7. **验证**: 执行时间应该 < 100ms

替代验证方式：
- 在搜索框快速输入，观察是否有明显卡顿
- 打开 Console，输入 `performance.now()` 记录时间，搜索后再次输入查看差值

✅ **PASS** 如果搜索流畅无卡顿

---

#### 测试 3: 移动端键盘问题
1. 打开任意章节页面 `http://localhost:3008/chapter/1`
2. F12 → 切换设备工具栏（Ctrl+Shift+M）
3. 选择移动设备（如 iPhone 12 Pro）
4. 滚动到页面 50% 位置
5. 打开 Console，输入：
   ```javascript
   localStorage.getItem('read_progress_chap_1')
   ```
   记录当前值（如 `{"r":0.5}`）
6. 在页面任意输入框点击（模拟键盘弹起）
7. 再次检查进度值：
   ```javascript
   localStorage.getItem('read_progress_chap_1')
   ```
8. **验证**: 值应该未改变

✅ **PASS** 如果键盘弹起时进度未被误触保存

---

#### 测试 4: 表单按钮恢复
1. 打开登录页面 `http://localhost:3008/login`
2. F12 → Network 标签
3. 右键 → "Throttling" → "Offline"（模拟断网）
4. 输入任意用户名密码
5. 点击"登录"按钮
6. 观察按钮文字变为"处理中…"且禁用
7. **开始计时 5 秒**
8. **验证**: 5 秒后按钮应该恢复为"登录"且可点击

✅ **PASS** 如果按钮在 5 秒后自动恢复

---

### ✅ 核心功能验证

#### 用户注册
```
URL: http://localhost:3008/register
用户名: testuser_20241101
密码: Test@123456
邮箱: test20241101@example.com

预期: 注册成功，跳转或提示验证邮箱
```

#### 用户登录
```
URL: http://localhost:3008/login
使用刚注册的账号登录

预期: 登录成功，右上角显示"退出"
```

#### 章节阅读
```
1. 访问任意书籍
2. 点击免费章节
3. 测试: 字体大小调整、主题切换、上下章导航
4. 滚动页面，刷新
5. 预期: 恢复到上次阅读位置
```

#### 管理后台
```
URL: http://localhost:3008/admin/login
密码: CxfSvCfH-vid8E

预期: 进入仪表盘，可以管理书籍/章节/用户
```

---

## 测试结果记录模板

复制以下内容到 `TEST-LOG-20241101.md`：

```
### 测试执行记录 - [你的名字] - 2024-11-01

#### 服务器启动
- [ ] MySQL 启动成功
- [ ] Node.js 服务器启动成功
- [ ] 端口 3008 可访问
- 启动时间: ___________
- 执行人: ___________

#### 静态验证
- [ ] verify-fixes.js 通过 (结果: _/_ 通过)
- [ ] health-check.js 通过 (结果: _/7 通过)
- 执行时间: ___________

#### P0 修复验证
- [ ] CSS 变量正常 (深色模式: ✅/❌)
- [ ] 章节搜索流畅 (响应时间: ___ms)
- [ ] 移动端键盘修复 (误触: 是/否)
- [ ] 表单按钮恢复 (5秒恢复: ✅/❌)

#### 核心功能
- [ ] 用户注册 (状态: _______)
- [ ] 用户登录 (状态: _______)
- [ ] 章节阅读 (状态: _______)
- [ ] 管理后台 (状态: _______)

#### 发现的问题
1. _____________________________
2. _____________________________

#### 总体评价
状态: 通过 / 部分通过 / 失败
备注: _____________________________
```

---

## 常见问题排查

### 问题: 端口 3008 被占用
```bash
# 查找占用进程
netstat -ano | findstr :3008

# 记录 PID（最后一列数字）
taskkill /PID <PID> /F

# 或者修改 .env 文件的 PORT
```

### 问题: MySQL 连接失败
```bash
# 检查 MySQL 服务
net start | findstr MySQL

# 测试连接
mysql -u root -p000000

# 检查 .env 配置
cat .env | grep DB_
```

### 问题: 页面 404
- 检查服务器日志是否有错误
- 确认服务器完全启动（至少等 5 秒）
- 清除浏览器缓存（Ctrl+Shift+Delete）

### 问题: verify-fixes.js 报错
```bash
# 检查 Node.js 版本
node --version  # 应该 >= v20

# 确保在项目根目录
pwd
# 应该输出: D:\codexnovel

# 检查文件是否存在
ls verify-fixes.js health-check.js
```

---

## 完成后

测试完成后，记得：

1. ✅ 填写测试结果到 `TEST-LOG-20241101.md`
2. ✅ 将发现的问题记录到"发现的问题"部分
3. ✅ 如果发现新 bug，告诉我，我会立即修复
4. ✅ 保持服务器运行，继续进行更深入的测试

---

**文档创建时间**: 2024-11-01  
**版本**: 1.0  
**状态**: 等待手动执行

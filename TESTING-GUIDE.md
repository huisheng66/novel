# 🚀 codexnovel 测试快速指南

## 前置条件

### 1. 启动 MySQL
```bash
# Windows (以管理员身份运行)
net start MySQL80

# 或通过 MySQL Workbench 启动
```

### 2. 确认数据库
```bash
mysql -u root -p
# 密码: 000000 (见 .env)

USE novel;
SHOW TABLES;
SELECT COUNT(*) FROM novels;
SELECT COUNT(*) FROM chapters;
EXIT;
```

### 3. 启动服务器
```bash
npm start
```

访问: `http://localhost:3008`

---

## 快速测试流程

### 阶段 1: P0 修复验证 (15 分钟)

#### 1.1 CSS 变量（2 分钟）
1. 打开首页 `http://localhost:3008`
2. 打开开发者工具 → Elements → Computed
3. 检查 `--bg`, `--accent` 等变量是否生效
4. 切换系统深色模式，验证颜色变化
5. ✅ 无样式异常

#### 1.2 章节搜索（5 分钟）
1. 访问任意书籍页面（需要 100+ 章节的书）
2. 打开开发者工具 → Performance → 开始录制
3. 在搜索框输入关键词
4. 停止录制，查看性能瀑布图
5. ✅ 搜索响应 < 100ms，无长任务

#### 1.3 移动端键盘（5 分钟）
1. 打开章节页面
2. 切换到移动设备模拟 (F12 → Toggle device toolbar)
3. 滚动到 50% 位置
4. 打开控制台，输入 `localStorage.getItem('read_progress_chap_XXX')`
5. 记录当前进度值（如 `{"r":0.5}`）
6. 模拟键盘弹起（在输入框输入文字）
7. ✅ 进度值未改变（键盘弹起时不触发保存）

#### 1.4 表单按钮（3 分钟）
1. 打开登录页面 `/login`
2. 输入任意用户名密码
3. 打开 Network 面板，右键选择"Offline"（模拟网络断开）
4. 点击"登录"按钮
5. 观察按钮状态
6. 5 秒后观察按钮
7. ✅ 按钮在 5 秒后恢复可点击状态

---

### 阶段 2: 核心功能测试 (30 分钟)

#### 2.1 用户认证流程
```bash
# 测试注册
1. http://localhost:3008/register
2. 用户名: testuser001
3. 密码: Test@123456
4. 邮箱: test@example.com
5. 提交
✅ 注册成功跳转

# 测试登录
1. http://localhost:3008/login
2. 输入刚注册的账号
3. 提交
✅ 登录成功，跳转首页
✅ 右上角显示"退出"按钮
```

#### 2.2 阅读器功能
```bash
1. 访问任意书籍页面
2. 点击任意免费章节
3. 测试功能:
   - [ ] 字体大小 +/-
   - [ ] 主题切换（亮/暗/护眼）
   - [ ] 上一章/下一章
   - [ ] 返回书籍
   - [ ] 滚动进度保存
4. 刷新页面
✅ 恢复到上次阅读位置
✅ 字体/主题设置保持
```

#### 2.3 付费系统
```bash
# 准备: 在 MySQL 中设置一本书为付费
UPDATE novels SET paywall_enabled = 1 WHERE id = 1;
INSERT INTO novel_paywall (novel_id, chapters_free, price_per_chapter)
VALUES (1, 5, 10);

# 测试购买流程
1. 访问该书籍的第 6 章（付费章节）
2. ✅ 显示付费提示
3. 点击"充值"
4. 使用充值码充值（需要先在管理后台生成）
5. 返回章节页面
6. 点击"解锁"
7. ✅ 扣费成功，显示章节内容
```

#### 2.4 管理后台
```bash
1. http://localhost:3008/admin/login
2. 密码: CxfSvCfH-vid8E (见 .env)
3. 测试功能:
   - [ ] 仪表盘数据显示
   - [ ] 新增书籍
   - [ ] 批量导入章节
   - [ ] 生成充值码
   - [ ] 用户管理
   - [ ] 付费规则设置
```

---

### 阶段 3: API 端点测试 (20 分钟)

#### 3.1 使用 curl 测试
```bash
# 注册
curl -X POST http://localhost:3008/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"apitest001","password":"Test@123","email":"api@test.com"}'

# 登录
curl -X POST http://localhost:3008/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"apitest001","password":"Test@123"}'

# 保存返回的 accessToken

# 获取书籍列表
curl http://localhost:3008/api/v1/novels \
  -H "Authorization: Bearer <accessToken>"

# 获取章节内容
curl http://localhost:3008/api/v1/chapters/1 \
  -H "Authorization: Bearer <accessToken>"

# 钱包余额
curl http://localhost:3008/api/v1/wallet \
  -H "Authorization: Bearer <accessToken>"
```

#### 3.2 测试幂等性
```bash
# 并发购买同一章节（应该只扣费一次）
for i in {1..5}; do
  curl -X POST http://localhost:3008/api/v1/purchase \
    -H "Authorization: Bearer <accessToken>" \
    -H "Content-Type: application/json" \
    -d '{"chapterId":6}' &
done
wait

# 检查交易记录
curl http://localhost:3008/api/v1/wallet/transactions \
  -H "Authorization: Bearer <accessToken>"

✅ 应该只有一条购买记录
```

---

### 阶段 4: 性能测试 (15 分钟)

#### 4.1 使用 Lighthouse
```bash
1. 打开 Chrome DevTools
2. Lighthouse 面板
3. 选择 "Performance" + "Accessibility"
4. Generate report

目标:
- Performance: > 90
- Accessibility: > 95
- Best Practices: > 90
```

#### 4.2 内存泄漏检查
```bash
1. 打开 Performance 面板
2. 开始录制
3. 执行以下操作 3 次:
   - 浏览书籍列表
   - 打开章节
   - 搜索章节
   - 返回首页
4. 停止录制
5. 查看 Memory 图表

✅ 内存曲线应该回落（无明显泄漏）
```

---

## 问题排查

### 服务器启动失败
```bash
# 检查端口占用
netstat -ano | findstr :3008
# 如果占用，杀死进程或修改 .env 的 PORT

# 检查 MySQL 连接
mysql -u root -p
# 确保密码是 000000
```

### 页面样式异常
```bash
# 清除浏览器缓存
Ctrl + Shift + Delete

# 检查 CSS 文件加载
开发者工具 → Network → 过滤 CSS
✅ main.css 应该 200 OK
```

### API 401 错误
```bash
# 检查 JWT token
localStorage.getItem('codexnovel_access_token')

# 重新登录获取新 token
```

---

## 测试结果记录模板

### P0 修复验证
- [ ] CSS 变量正常 - 测试人: ___ 时间: ___
- [ ] 章节搜索流畅 - 测试人: ___ 时间: ___
- [ ] 移动端键盘修复 - 测试人: ___ 时间: ___
- [ ] 按钮状态恢复 - 测试人: ___ 时间: ___

### 核心功能
- [ ] 注册/登录 - 测试人: ___ 时间: ___
- [ ] 阅读器 - 测试人: ___ 时间: ___
- [ ] 付费系统 - 测试人: ___ 时间: ___
- [ ] 管理后台 - 测试人: ___ 时间: ___

### API 端点
- [ ] 认证接口 - 测试人: ___ 时间: ___
- [ ] 内容接口 - 测试人: ___ 时间: ___
- [ ] 付费接口 - 测试人: ___ 时间: ___

### 性能指标
- [ ] Lighthouse 评分 - 得分: ___ 测试人: ___ 时间: ___
- [ ] 内存泄漏检查 - 结果: ___ 测试人: ___ 时间: ___

---

## 发现的问题记录

### 问题 #1
- **描述**: 
- **复现步骤**: 
- **预期行为**: 
- **实际行为**: 
- **优先级**: P0/P1/P2
- **负责人**: 
- **状态**: 待修复/已修复

---

## 签字确认

- [ ] 开发人员: ___________ 日期: _______
- [ ] 测试人员: ___________ 日期: _______
- [ ] 产品负责人: _________ 日期: _______

---

**文档版本**: 1.0  
**最后更新**: 2024-11-01

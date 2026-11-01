# 按本解锁功能说明

## 概述

新增"按本解锁"功能，允许用户一次性解锁整本书的所有付费章节。用户可以选择：
1. **按章购买** - 单独购买每一章（原有功能）
2. **按本解锁** - 一次性解锁整本书（新增功能）

## 数据库变更

### 新增字段

#### `novel_paywall` 表
- `unlock_full_price` (INT UNSIGNED, NULL) - 按本解锁的价格（分），NULL 表示不支持按本解锁

#### `novel_orders` 表（新增）
- `id` (INT UNSIGNED, PRIMARY KEY, AUTO_INCREMENT)
- `user_id` (INT UNSIGNED, NOT NULL) - 购买用户 ID
- `novel_id` (INT UNSIGNED, NOT NULL) - 小说 ID
- `amount` (INT UNSIGNED, NOT NULL) - 支付金额（分）
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
- **唯一约束**: `UNIQUE KEY unique_user_novel (user_id, novel_id)` - 防止重复购买

### 迁移脚本

迁移版本：**v12**
- 文件：`lib/migrations.js`
- 函数：`migrateToV12()`
- 自动在应用启动时执行

## 后台管理配置

### 设置按本解锁价格

1. 访问 `/admin/paywall`
2. 在小说的付费规则行，找到"按本解锁"列
3. 输入价格（元），例如 `19.90`
4. 留空或设为 `0` 则不支持按本解锁
5. 点击"保存"

### 配置优先级

与章节付费规则相同：
- **单章覆盖** > **书籍规则** > **全局规则**

## 用户使用流程

### Web 端

#### 1. 小说详情页
- 如果书籍支持按本解锁，在章节列表上方会显示"按本解锁整本书"横幅
- 显示价格和"立即解锁"按钮
- 点击后跳转到支付流程

#### 2. 章节锁定页
- 当遇到付费章节时，会显示两个选项：
  - **按本解锁整本书**（高亮推荐）- 显示总价和节省的金额
  - **单独购买本章** - 显示单章价格
- 已解锁整本的用户会看到绿色提示："✓ 你已解锁整本《书名》"

### App API

#### 端点：`POST /api/v1/purchases/full`

**请求体**：
```json
{
  "novelId": 1
}
```

**成功响应** (201 Created 或 200 OK)：
```json
{
  "novelId": 1,
  "alreadyOwned": false,
  "amount": 1990,
  "balance": 3000
}
```

**错误响应**：
- `400 Bad Request` - novelId 缺失或无效
- `402 Payment Required` - 余额不足
- `404 Not Found` - 小说不存在或不支持按本解锁

## 核心逻辑

### 权限检查

文件：`lib/paywall.js`

```javascript
// 检查用户是否已解锁整本书
hasUnlockedFull(userId, novelId)

// 检查章节访问权限（自动考虑按本解锁）
getChapterAccess({ userId, novelId, chapterNumber })
```

### 购买逻辑

文件：`lib/api/purchases.js`

```javascript
// 按本解锁
async function purchaseFullNovel(userId, novelId) {
  // 1. 获取按本解锁价格
  // 2. 检查是否已解锁（幂等）
  // 3. 检查余额
  // 4. 事务：扣款 + 记录订单 + 记录流水
  // 5. 返回结果
}
```

### 幂等性保证

- 数据库唯一约束：`(user_id, novel_id)`
- 重复购买返回 `alreadyOwned: true`，不重复扣费
- 事务内操作：扣款和记录同时成功或失败

## 缓存策略

- **小说详情页**：可缓存（按本解锁价格对所有人相同）
- **章节页**：付费章节不缓存（`Cache-Control: private, no-store`）
- **付费规则**：30 秒 TTL

## 数据一致性

### 事务保护

```sql
START TRANSACTION;
-- 1. 检查是否已购买（SELECT FOR UPDATE）
-- 2. 扣除余额（UPDATE user_wallets）
-- 3. 插入订单记录（INSERT INTO novel_orders）
-- 4. 记录交易流水（INSERT INTO wallet_transactions）
COMMIT;
```

### 死锁处理

- 自动重试 3 次（lib/db.js）
- 统一锁定顺序：钱包表 → 订单表 → 流水表

## 测试场景

### 正常流程
1. ✅ 用户余额充足，首次购买 → 扣款成功，解锁整本
2. ✅ 用户已购买整本 → 返回 `alreadyOwned: true`，不重复扣费
3. ✅ 解锁整本后访问任意付费章节 → 直接显示正文

### 异常处理
1. ✅ 余额不足 → 返回 402，提示充值
2. ✅ 小说不支持按本解锁 → 返回 404
3. ✅ 并发购买同一本书 → 唯一约束生效，只扣一次费

### 权限验证
1. ✅ 未登录用户 → 显示"登录后解锁整本"
2. ✅ 已解锁用户访问章节 → 直接显示，无需重复购买
3. ✅ 按本解锁后，章节购买记录保持独立

## 性能优化

- **索引优化**：`novel_orders` 表建立 `(user_id, novel_id)` 唯一索引
- **查询优化**：单次查询判断整本解锁状态
- **缓存策略**：按本解锁状态随付费规则一起缓存

## 监控指标

建议监控：
- 按本解锁的购买转化率
- 按本 vs 按章的收入占比
- 按本解锁后的阅读完成率

## 注意事项

1. **价格设置**：建议按本价格略低于所有付费章节的总和，提供优惠激励
2. **退款策略**：解锁整本后无法退款（与单章购买一致）
3. **规则变更**：修改按本价格不影响已购买用户的权益
4. **书源限制**：第三方书源（Legado）不支持按本解锁，只输出免费章节

## 升级步骤

1. **备份数据库**（重要！）
2. 部署新代码
3. 应用自动执行 v12 迁移
4. 在后台为需要的书籍配置按本解锁价格
5. 通知用户新功能上线

## 回滚方案

如需回滚：
```sql
-- 删除整本购买记录（可选，保留数据不影响旧版本运行）
-- DROP TABLE IF EXISTS novel_orders;

-- 删除按本解锁价格字段
ALTER TABLE novel_paywall DROP COLUMN IF EXISTS unlock_full_price;

-- 降级 SCHEMA_VERSION
UPDATE platform_settings SET value = '11' WHERE key = 'SCHEMA_VERSION';
```

## API 文档更新

新增端点已添加到：
- `/api/v1/purchases/full` - POST 按本解锁
- 返回格式与单章购买一致

---

**实现完成日期**：2026-11-01
**版本**：v12
**负责人**：自动化部署

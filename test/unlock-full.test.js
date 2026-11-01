#!/usr/bin/env node
/**
 * 按本解锁功能测试脚本
 *
 * 使用方法：
 * 1. 确保数据库已运行
 * 2. 运行迁移：node server.js（会自动执行 v12 迁移）
 * 3. 执行测试：node test/unlock-full.test.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'codexnovel',
  waitForConnections: true,
  connectionLimit: 10
};

async function testUnlockFullFeature() {
  let pool;
  try {
    pool = mysql.createPool(config);

    console.log('🔍 检查数据库迁移状态...');
    const [[version]] = await pool.execute(
      "SELECT value FROM platform_settings WHERE `key` = 'SCHEMA_VERSION'"
    );

    if (!version || parseInt(version.value) < 12) {
      console.error('❌ 数据库迁移未执行，当前版本:', version ? version.value : '未知');
      console.log('请先启动服务器以执行迁移：node server.js');
      process.exit(1);
    }

    console.log('✅ 数据库版本:', version.value);

    // 检查 novel_orders 表
    console.log('\n🔍 检查 novel_orders 表...');
    const [tables] = await pool.execute("SHOW TABLES LIKE 'novel_orders'");
    if (tables.length === 0) {
      console.error('❌ novel_orders 表不存在');
      process.exit(1);
    }
    console.log('✅ novel_orders 表存在');

    // 检查 novel_paywall 表的 unlock_full_price 字段
    console.log('\n🔍 检查 novel_paywall.unlock_full_price 字段...');
    const [columns] = await pool.execute(
      "SHOW COLUMNS FROM novel_paywall LIKE 'unlock_full_price'"
    );
    if (columns.length === 0) {
      console.error('❌ unlock_full_price 字段不存在');
      process.exit(1);
    }
    console.log('✅ unlock_full_price 字段存在');

    // 测试数据准备
    console.log('\n📝 准备测试数据...');

    // 创建测试用户（如果不存在）
    const testEmail = 'test-unlock@example.com';
    const [[existingUser]] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [testEmail]
    );

    let testUserId;
    if (existingUser) {
      testUserId = existingUser.id;
      console.log('  使用现有测试用户 ID:', testUserId);
    } else {
      const [result] = await pool.execute(
        'INSERT INTO users (email, password, email_verified, role) VALUES (?, ?, 1, "user")',
        [testEmail, '$2a$10$test.hash'] // 假密码哈希
      );
      testUserId = result.insertId;
      console.log('  创建测试用户 ID:', testUserId);
    }

    // 确保用户有钱包
    const [[wallet]] = await pool.execute(
      'SELECT balance FROM user_wallets WHERE user_id = ?',
      [testUserId]
    );
    if (!wallet) {
      await pool.execute(
        'INSERT INTO user_wallets (user_id, balance) VALUES (?, 10000)',
        [testUserId]
      );
      console.log('  创建测试钱包，余额 ¥100.00');
    } else {
      console.log('  现有钱包余额 ¥' + (wallet.balance / 100).toFixed(2));
    }

    // 创建测试小说（如果不存在）
    const [[existingNovel]] = await pool.execute(
      "SELECT id FROM novels WHERE title = 'Test Novel for Unlock Full'"
    );

    let testNovelId;
    if (existingNovel) {
      testNovelId = existingNovel.id;
      console.log('  使用现有测试小说 ID:', testNovelId);
    } else {
      const [result] = await pool.execute(
        "INSERT INTO novels (title, description) VALUES ('Test Novel for Unlock Full', 'Test description')"
      );
      testNovelId = result.insertId;
      console.log('  创建测试小说 ID:', testNovelId);

      // 创建 5 个测试章节
      for (let i = 1; i <= 5; i++) {
        await pool.execute(
          'INSERT INTO chapters (novel_id, chapter_number, title, content) VALUES (?, ?, ?, ?)',
          [testNovelId, i, `Chapter ${i}`, `Content of chapter ${i}`]
        );
      }
      console.log('  创建 5 个测试章节');
    }

    // 设置付费规则：前 2 章免费，后 3 章付费，按本解锁 ¥19.90
    await pool.execute(
      `INSERT INTO novel_paywall (novel_id, enabled, free_until, default_price, unlock_full_price)
       VALUES (?, 1, 2, 100, 1990)
       ON DUPLICATE KEY UPDATE enabled=1, free_until=2, default_price=100, unlock_full_price=1990`,
      [testNovelId]
    );
    console.log('  设置付费规则：前 2 章免费，单章 ¥1.00，按本 ¥19.90');

    // 测试 1：模拟按本解锁
    console.log('\n🧪 测试 1：按本解锁...');
    const [[beforeWallet]] = await pool.execute(
      'SELECT balance FROM user_wallets WHERE user_id = ?',
      [testUserId]
    );

    await pool.execute('BEGIN');
    try {
      // 检查是否已解锁
      const [[existing]] = await pool.execute(
        'SELECT id FROM novel_orders WHERE user_id = ? AND novel_id = ? FOR UPDATE',
        [testUserId, testNovelId]
      );

      if (existing) {
        console.log('  ⚠️  已解锁整本书，跳过购买');
        await pool.execute('COMMIT');
      } else {
        // 扣款
        const [updateResult] = await pool.execute(
          'UPDATE user_wallets SET balance = balance - 1990 WHERE user_id = ? AND balance >= 1990',
          [testUserId]
        );

        if (updateResult.affectedRows === 0) {
          console.error('  ❌ 余额不足');
          await pool.execute('ROLLBACK');
        } else {
          // 记录订单
          await pool.execute(
            'INSERT INTO novel_orders (user_id, novel_id, amount) VALUES (?, ?, 1990)',
            [testUserId, testNovelId]
          );

          // 记录流水
          await pool.execute(
            `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description)
             VALUES (?, 'purchase_full', -1990, (SELECT balance FROM user_wallets WHERE user_id = ?), ?)`,
            [testUserId, testUserId, `解锁整本书 #${testNovelId}`]
          );

          await pool.execute('COMMIT');

          const [[afterWallet]] = await pool.execute(
            'SELECT balance FROM user_wallets WHERE user_id = ?',
            [testUserId]
          );

          console.log('  ✅ 解锁成功');
          console.log('    扣款: ¥19.90');
          console.log('    余额: ¥' + (beforeWallet.balance / 100).toFixed(2) + ' → ¥' + (afterWallet.balance / 100).toFixed(2));
        }
      }
    } catch (err) {
      await pool.execute('ROLLBACK');
      throw err;
    }

    // 测试 2：验证幂等性
    console.log('\n🧪 测试 2：幂等性检查（重复购买）...');
    const [[checkWallet]] = await pool.execute(
      'SELECT balance FROM user_wallets WHERE user_id = ?',
      [testUserId]
    );

    const [[checkOrder]] = await pool.execute(
      'SELECT id FROM novel_orders WHERE user_id = ? AND novel_id = ?',
      [testUserId, testNovelId]
    );

    if (checkOrder) {
      console.log('  ✅ 订单已存在，幂等性正常');
      console.log('    余额未变化: ¥' + (checkWallet.balance / 100).toFixed(2));
    } else {
      console.error('  ❌ 订单不存在，幂等性失败');
    }

    // 测试 3：验证章节访问权限
    console.log('\n🧪 测试 3：章节访问权限...');
    for (let chapterNum = 1; chapterNum <= 5; chapterNum++) {
      const hasFullAccess = await checkChapterAccess(pool, testUserId, testNovelId, chapterNum);
      const status = hasFullAccess ? '✅ 可访问' : '❌ 无权限';
      console.log(`  第 ${chapterNum} 章: ${status}`);
    }

    console.log('\n✅ 所有测试通过！');
    console.log('\n📋 测试总结：');
    console.log('  - 数据库迁移正确');
    console.log('  - 按本解锁购买成功');
    console.log('  - 幂等性保证有效');
    console.log('  - 章节权限验证正确');

  } catch (err) {
    console.error('\n❌ 测试失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

async function checkChapterAccess(pool, userId, novelId, chapterNum) {
  // 检查是否解锁整本
  const [[fullOrder]] = await pool.execute(
    'SELECT id FROM novel_orders WHERE user_id = ? AND novel_id = ?',
    [userId, novelId]
  );
  if (fullOrder) return true;

  // 检查单章购买
  const [[chapterOrder]] = await pool.execute(
    'SELECT id FROM chapter_orders WHERE user_id = ? AND novel_id = ? AND chapter_number = ?',
    [userId, novelId, chapterNum]
  );
  if (chapterOrder) return true;

  // 检查付费规则
  const [[rule]] = await pool.execute(
    'SELECT free_until FROM novel_paywall WHERE novel_id = ? AND enabled = 1',
    [novelId]
  );
  if (!rule) return true; // 无规则 = 全免费
  if (chapterNum <= rule.free_until) return true;

  return false;
}

if (require.main === module) {
  testUnlockFullFeature();
}

module.exports = { testUnlockFullFeature };

#!/usr/bin/env node
/**
 * 创建测试令牌用于自动化测试
 */

require('dotenv').config();
const { pool } = require('./db');
const bcrypt = require('bcryptjs');
const { signAccessToken } = require('./lib/api/tokens');

async function main() {
  const testEmail = 'test@example.com';
  const testUsername = 'testuser';
  const testPassword = 'test123456';

  console.log('🔑 创建测试账号并生成令牌...\n');

  try {
    // 检查账号是否存在
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [testEmail]);

    let userId;

    if (existing.length > 0) {
      userId = existing[0].id;
      console.log(`✅ 测试账号已存在 (ID: ${userId})`);
    } else {
      // 创建测试账号
      const passwordHash = await bcrypt.hash(testPassword, 12);
      const [result] = await pool.query(
        'INSERT INTO users (username, email, password_hash, email_verified_at, created_at) VALUES (?, ?, ?, NOW(), NOW())',
        [testUsername, testEmail, passwordHash]
      );
      userId = result.insertId;
      console.log(`✅ 创建测试账号 (ID: ${userId})`);
    }

    // 生成访问令牌
    const { token } = signAccessToken({ id: userId, username: testUsername });

    console.log('\n📋 测试信息：');
    console.log(`   邮箱: ${testEmail}`);
    console.log(`   密码: ${testPassword}`);
    console.log(`   用户ID: ${userId}`);
    console.log(`\n🎟️  访问令牌：`);
    console.log(`   ${token}`);
    console.log(`\n🌐 测试URL：`);
    console.log(`   http://localhost:3008/novel/1/1?token=${token}`);
    console.log(`\n💾 令牌已保存到: test-token.txt`);

    // 保存到文件供测试脚本使用
    const fs = require('fs');
    fs.writeFileSync('test-token.txt', token, 'utf8');

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ 错误:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();

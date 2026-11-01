#!/usr/bin/env node
/**
 * 数据库诊断脚本 - 检查数据库连接、表结构和数据
 *
 * 使用方法:
 *   node test-db.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'novel',
  charset: 'utf8mb4'
};

async function main() {
  console.log('🔍 codexnovel 数据库诊断\n');
  console.log('='.repeat(60));
  console.log('\n📋 配置信息:');
  console.log(`   主机: ${config.host}`);
  console.log(`   用户: ${config.user}`);
  console.log(`   密码: ${'*'.repeat(config.password.length)}`);
  console.log(`   数据库: ${config.database}\n`);

  let conn;
  try {
    // 1. 测试连接
    console.log('[1/8] 测试 MySQL 连接...');
    conn = await mysql.createConnection({
      host: config.host,
      user: config.user,
      password: config.password
    });
    console.log('   ✅ MySQL 连接成功\n');

    // 2. 检查数据库是否存在
    console.log('[2/8] 检查数据库是否存在...');
    const [dbs] = await conn.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [config.database]
    );
    if (dbs.length === 0) {
      console.log(`   ⚠️  数据库 '${config.database}' 不存在`);
      console.log('   ℹ️  运行 npm start 将自动创建数据库\n');
      await conn.end();
      return;
    }
    console.log(`   ✅ 数据库 '${config.database}' 存在\n`);

    // 3. 连接到目标数据库
    await conn.changeUser({ database: config.database });

    // 4. 检查核心表
    console.log('[3/8] 检查核心表结构...');
    const coreTables = [
      'novels',
      'chapters',
      'users',
      'user_wallets',
      'chapter_orders',
      'novel_paywall',
      'recharge_codes',
      'access_tokens',
      'platform_settings',
      'schema_version'
    ];

    const [allTables] = await conn.execute(
      'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?',
      [config.database]
    );
    const existingTables = allTables.map(row => row.TABLE_NAME);

    let allTablesExist = true;
    for (const table of coreTables) {
      if (existingTables.includes(table)) {
        console.log(`   ✅ ${table}`);
      } else {
        console.log(`   ❌ ${table} (缺失)`);
        allTablesExist = false;
      }
    }
    console.log();

    if (!allTablesExist) {
      console.log('   ⚠️  部分表缺失，运行 npm start 将自动创建\n');
    }

    // 5. 检查 schema 版本
    if (existingTables.includes('schema_version')) {
      console.log('[4/8] 检查数据库迁移版本...');
      const [versions] = await conn.execute(
        'SELECT version, applied_at FROM schema_version ORDER BY version DESC LIMIT 1'
      );
      if (versions.length > 0) {
        const current = versions[0].version;
        const expected = 11;
        console.log(`   当前版本: v${current}`);
        console.log(`   期望版本: v${expected}`);
        if (current === expected) {
          console.log('   ✅ 数据库结构是最新版本\n');
        } else if (current < expected) {
          console.log(`   ⚠️  需要迁移 (v${current} → v${expected})`);
          console.log('   ℹ️  运行 npm start 将自动执行迁移\n');
        } else {
          console.log('   ⚠️  数据库版本比代码新，请检查代码版本\n');
        }
      } else {
        console.log('   ⚠️  未记录版本，首次启动将执行所有迁移\n');
      }
    } else {
      console.log('[4/8] schema_version 表不存在，首次启动将创建\n');
    }

    // 6. 统计数据
    console.log('[5/8] 统计数据量...');
    if (existingTables.includes('novels')) {
      const [[novels]] = await conn.execute('SELECT COUNT(*) AS cnt FROM novels');
      console.log(`   📚 书籍: ${novels.cnt}`);
    }
    if (existingTables.includes('chapters')) {
      const [[chapters]] = await conn.execute('SELECT COUNT(*) AS cnt FROM chapters');
      console.log(`   📄 章节: ${chapters.cnt}`);
    }
    if (existingTables.includes('users')) {
      const [[users]] = await conn.execute('SELECT COUNT(*) AS cnt FROM users');
      console.log(`   👤 用户: ${users.cnt}`);
    }
    if (existingTables.includes('chapter_orders')) {
      const [[orders]] = await conn.execute('SELECT COUNT(*) AS cnt FROM chapter_orders');
      console.log(`   💰 订单: ${orders.cnt}`);
    }
    console.log();

    // 7. 检查付费配置
    console.log('[6/8] 检查付费系统配置...');
    if (existingTables.includes('platform_settings')) {
      const [settings] = await conn.execute(
        `SELECT setting_key, setting_value FROM platform_settings
         WHERE setting_key LIKE 'paywall%'`
      );
      if (settings.length > 0) {
        for (const s of settings) {
          console.log(`   ${s.setting_key}: ${s.setting_value}`);
        }
      } else {
        console.log('   ℹ️  付费配置未设置（默认全免费）');
      }
    }
    console.log();

    // 8. 检查管理员密码
    console.log('[7/8] 检查管理员配置...');
    const adminPassword = process.env.ADMIN_PASSWORD || 'CxfSvCfH-vid8E';
    console.log(`   管理员密码: ${adminPassword}`);
    console.log(`   管理后台: http://localhost:${process.env.PORT || 3008}/admin/login\n`);

    // 9. 检查潜在问题
    console.log('[8/8] 检查潜在问题...');
    let hasIssues = false;

    if (existingTables.includes('chapters') && existingTables.includes('novels')) {
      // 检查孤立章节
      const [[orphans]] = await conn.execute(`
        SELECT COUNT(*) AS cnt FROM chapters c
        LEFT JOIN novels n ON n.id = c.novel_id
        WHERE n.id IS NULL
      `);
      if (orphans.cnt > 0) {
        console.log(`   ⚠️  发现 ${orphans.cnt} 个孤立章节（没有对应书籍）`);
        hasIssues = true;
      }

      // 检查重复章节号
      const [[dups]] = await conn.execute(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT novel_id, chapter_number, COUNT(*) AS n
          FROM chapters
          GROUP BY novel_id, chapter_number
          HAVING n > 1
        ) t
      `);
      if (dups.cnt > 0) {
        console.log(`   ⚠️  发现 ${dups.cnt} 组重复章节号`);
        hasIssues = true;
      }
    }

    if (existingTables.includes('users')) {
      // 检查未验证邮箱用户
      const [[unverified]] = await conn.execute(`
        SELECT COUNT(*) AS cnt FROM users
        WHERE email IS NOT NULL AND email_verified_at IS NULL
      `);
      if (unverified.cnt > 0) {
        console.log(`   ℹ️  ${unverified.cnt} 个用户邮箱未验证`);
      }
    }

    if (!hasIssues) {
      console.log('   ✅ 未发现明显问题');
    }
    console.log();

    // 总结
    console.log('='.repeat(60));
    console.log('📊 诊断总结\n');
    if (allTablesExist) {
      console.log('✅ 数据库结构完整');
      console.log('✅ 可以正常启动服务器\n');
      console.log('▶️  运行: npm start');
    } else {
      console.log('⚠️  数据库结构不完整');
      console.log('ℹ️  首次启动会自动创建缺失的表\n');
      console.log('▶️  运行: npm start');
    }

  } catch (err) {
    console.error('\n❌ 错误:', err.message);
    console.error('\n📝 可能的原因:');
    console.error('   1. MySQL 服务未启动 → 运行: net start MySQL80');
    console.error('   2. 密码错误 → 检查 .env 中的 DB_PASSWORD');
    console.error('   3. 用户权限不足 → 确保 MySQL 用户有 CREATE DATABASE 权限');
    console.error('\n🔧 手动测试连接:');
    console.error(`   mysql -h ${config.host} -u ${config.user} -p`);
    process.exit(1);
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

main();

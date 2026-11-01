#!/usr/bin/env node
/**
 * 服务器健康检查脚本
 * 在服务器启动后运行，验证所有端点是否正常
 */

const http = require('http');
const PORT = process.env.PORT || 3008;
const BASE_URL = `http://localhost:${PORT}`;

const tests = [];
let passed = 0;
let failed = 0;

function test(name, path, expectedStatus = 200) {
  tests.push({ name, path, expectedStatus });
}

// 定义测试用例
test('首页', '/', 200);
test('登录页', '/login', 200);
test('注册页', '/register', 200);
test('钱包页（未登录应重定向）', '/wallet', 302);
test('管理后台登录', '/admin/login', 200);
test('API 健康检查', '/api/v1/novels', 200);
test('不存在的页面应返回 404', '/nonexistent', 404);

console.log('🔍 codexnovel 服务器健康检查\n');
console.log('='.repeat(60));
console.log(`目标: ${BASE_URL}`);
console.log(`测试数量: ${tests.length}`);
console.log('='.repeat(60));

async function runTest(test) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    http.get(BASE_URL + test.path, (res) => {
      const duration = Date.now() - startTime;
      const status = res.statusCode;
      const success = (status === test.expectedStatus);

      if (success) {
        console.log(`✅ ${test.name}`);
        console.log(`   路径: ${test.path}`);
        console.log(`   状态: ${status} (预期 ${test.expectedStatus})`);
        console.log(`   响应时间: ${duration}ms\n`);
        passed++;
      } else {
        console.log(`❌ ${test.name}`);
        console.log(`   路径: ${test.path}`);
        console.log(`   状态: ${status} (预期 ${test.expectedStatus})`);
        console.log(`   响应时间: ${duration}ms\n`);
        failed++;
      }

      resolve();
    }).on('error', (err) => {
      console.log(`❌ ${test.name}`);
      console.log(`   路径: ${test.path}`);
      console.log(`   错误: ${err.message}\n`);
      failed++;
      resolve();
    });
  });
}

async function runAllTests() {
  for (const test of tests) {
    await runTest(test);
  }

  console.log('='.repeat(60));
  console.log(`\n📊 测试结果: ${passed} 通过 / ${failed} 失败\n`);

  if (failed === 0) {
    console.log('🎉 服务器健康检查通过！\n');
    process.exit(0);
  } else {
    console.log('❌ 部分测试失败，请检查服务器日志。\n');
    process.exit(1);
  }
}

// 等待 2 秒确保服务器完全启动
setTimeout(runAllTests, 2000);

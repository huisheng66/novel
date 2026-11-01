#!/usr/bin/env node
/**
 * 启动脚本 - 启动服务器并运行健康检查
 *
 * 使用方法:
 *   node start-and-test.js
 */

const { spawn } = require('child_process');
const http = require('http');
const PORT = process.env.PORT || 3008;

console.log('🚀 codexnovel 启动与测试脚本\n');
console.log('='.repeat(60));

// 检查服务器是否已在运行
console.log('检查端口 ' + PORT + '...');
http.get(`http://localhost:${PORT}`, (res) => {
  console.log(`⚠️  端口 ${PORT} 已被占用`);
  console.log('   如果是本项目的服务器，请直接运行: node health-check.js');
  console.log('   否则请修改 .env 中的 PORT 或关闭占用进程\n');
  process.exit(1);
}).on('error', () => {
  console.log(`✅ 端口 ${PORT} 可用\n`);
  startServer();
});

function startServer() {
  console.log('启动服务器...');
  console.log('命令: npm start\n');

  const server = spawn('npm', ['start'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env }
  });

  server.on('error', (err) => {
    console.error('❌ 启动失败:', err.message);
    process.exit(1);
  });

  server.on('exit', (code) => {
    if (code !== 0) {
      console.error(`❌ 服务器退出，代码: ${code}`);
      process.exit(code);
    }
  });

  // 等待 5 秒后运行健康检查
  setTimeout(() => {
    console.log('\n' + '='.repeat(60));
    console.log('运行健康检查...\n');

    const checker = spawn('node', ['health-check.js'], {
      stdio: 'inherit',
      shell: true
    });

    checker.on('exit', (code) => {
      if (code === 0) {
        console.log('✅ 所有检查通过！服务器运行正常。');
        console.log(`\n访问: http://localhost:${PORT}`);
        console.log('\n按 Ctrl+C 停止服务器');
      } else {
        console.log('\n❌ 健康检查失败');
        server.kill();
        process.exit(1);
      }
    });
  }, 5000);
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n\n正在关闭服务器...');
  process.exit(0);
});

#!/usr/bin/env node
// 性能测试脚本
const http = require('http');
const { performance } = require('perf_hooks');

const BASE_URL = process.env.API_BASE || 'http://localhost:3008';
const CONCURRENT = parseInt(process.env.CONCURRENT) || 10;
const REQUESTS = parseInt(process.env.REQUESTS) || 100;

const results = {
  total: 0,
  success: 0,
  failed: 0,
  times: [],
  errors: []
};

function request(path) {
  return new Promise((resolve) => {
    const start = performance.now();
    const url = new URL(path, BASE_URL);

    const req = http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'User-Agent': 'perf-test/1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const duration = performance.now() - start;
        results.total++;
        results.times.push(duration);

        if (res.statusCode >= 200 && res.statusCode < 400) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({ status: res.statusCode, path });
        }

        resolve({ duration, status: res.statusCode });
      });
    });

    req.on('error', (err) => {
      results.total++;
      results.failed++;
      results.errors.push({ error: err.message, path });
      resolve({ error: err.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      results.total++;
      results.failed++;
      results.errors.push({ error: 'timeout', path });
      resolve({ error: 'timeout' });
    });
  });
}

async function runConcurrent(path, count) {
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(request(path));
  }
  return Promise.all(promises);
}

async function runTest() {
  console.log('Performance Test Starting...');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Concurrent: ${CONCURRENT}`);
  console.log(`Total Requests: ${REQUESTS}`);
  console.log('');

  const testStart = performance.now();

  // 测试不同端点（主要测试不需要认证的端点）
  const endpoints = [
    { path: '/healthz', name: 'Health Check', weight: 5 },
    { path: '/metrics', name: 'Metrics', weight: 1 }
  ];

  // 按权重分配请求
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  const batches = Math.ceil(REQUESTS / CONCURRENT);

  for (let batch = 0; batch < batches; batch++) {
    const tasks = [];
    for (let i = 0; i < CONCURRENT; i++) {
      const idx = (batch * CONCURRENT + i) % endpoints.length;
      const endpoint = endpoints[idx];
      tasks.push(request(endpoint.path));
    }

    await Promise.all(tasks);

    // 显示进度
    if ((batch + 1) % 10 === 0) {
      process.stdout.write(`\rProgress: ${results.total}/${REQUESTS} requests`);
    }
  }

  const testDuration = performance.now() - testStart;

  console.log('\n\n=== Test Results ===');
  console.log(`Total Duration: ${(testDuration / 1000).toFixed(2)}s`);
  console.log(`Requests: ${results.total}`);
  console.log(`Success: ${results.success} (${((results.success / results.total) * 100).toFixed(2)}%)`);
  console.log(`Failed: ${results.failed} (${((results.failed / results.total) * 100).toFixed(2)}%)`);
  console.log(`Requests/sec: ${(results.total / (testDuration / 1000)).toFixed(2)}`);

  if (results.times.length > 0) {
    results.times.sort((a, b) => a - b);
    const p50 = results.times[Math.floor(results.times.length * 0.5)];
    const p90 = results.times[Math.floor(results.times.length * 0.9)];
    const p95 = results.times[Math.floor(results.times.length * 0.95)];
    const p99 = results.times[Math.floor(results.times.length * 0.99)];
    const avg = results.times.reduce((sum, t) => sum + t, 0) / results.times.length;
    const min = results.times[0];
    const max = results.times[results.times.length - 1];

    console.log('\n=== Response Times (ms) ===');
    console.log(`Min: ${min.toFixed(2)}`);
    console.log(`Avg: ${avg.toFixed(2)}`);
    console.log(`P50: ${p50.toFixed(2)}`);
    console.log(`P90: ${p90.toFixed(2)}`);
    console.log(`P95: ${p95.toFixed(2)}`);
    console.log(`P99: ${p99.toFixed(2)}`);
    console.log(`Max: ${max.toFixed(2)}`);
  }

  if (results.errors.length > 0) {
    console.log('\n=== Errors (first 10) ===');
    results.errors.slice(0, 10).forEach((err, idx) => {
      console.log(`${idx + 1}. ${err.error || 'HTTP ' + err.status} - ${err.path}`);
    });
  }

  // 获取服务器健康状态
  console.log('\n=== Server Health ===');
  const healthResponse = await request('/healthz');
  if (healthResponse.duration) {
    console.log(`Health check response time: ${healthResponse.duration.toFixed(2)}ms`);
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

// 处理 Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nTest interrupted.');
  console.log(`Completed: ${results.total} requests`);
  process.exit(1);
});

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

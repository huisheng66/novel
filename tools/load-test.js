#!/usr/bin/env node

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

const target = process.argv[2] || 'http://localhost:3008/';
const concurrency = Number(process.argv[3] || 20);
const durationSeconds = Number(process.argv[4] || 15);
const timeoutMs = Number(process.argv[5] || 10000);
const extraHeaders = {};

for (const item of process.argv.slice(6)) {
  const separatorIndex = item.indexOf(':');
  if (separatorIndex > 0) {
    extraHeaders[item.slice(0, separatorIndex).trim()] = item.slice(separatorIndex + 1).trim();
  }
}

const targetUrl = new URL(target);
const client = targetUrl.protocol === 'https:' ? https : http;
const agent = new client.Agent({
  keepAlive: true,
  maxSockets: Math.max(concurrency * 2, 64)
});

const startedAt = performance.now();
const deadline = startedAt + durationSeconds * 1000;
const latencies = [];
const statuses = new Map();
const errors = new Map();

let total = 0;
let completed = 0;
let active = 0;

function count(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function percentile(values, pct) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil((pct / 100) * values.length) - 1);
  return values[index];
}

function requestOnce() {
  total += 1;
  active += 1;
  const requestStartedAt = performance.now();

  const req = client.request(targetUrl, {
    agent,
    method: 'GET',
    timeout: timeoutMs,
    headers: {
      'User-Agent': 'codex-load-test/1.0',
      'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
      ...extraHeaders
    }
  }, res => {
    res.resume();
    res.on('end', () => {
      const elapsed = performance.now() - requestStartedAt;
      latencies.push(elapsed);
      count(statuses, String(res.statusCode));
      completed += 1;
      active -= 1;
      schedule();
    });
  });

  req.on('timeout', () => {
    req.destroy(new Error('timeout'));
  });

  req.on('error', err => {
    const elapsed = performance.now() - requestStartedAt;
    latencies.push(elapsed);
    count(errors, err.code || err.message || 'error');
    completed += 1;
    active -= 1;
    schedule();
  });

  req.end();
}

function schedule() {
  if (performance.now() >= deadline) return;
  requestOnce();
}

for (let i = 0; i < concurrency; i += 1) {
  requestOnce();
}

const interval = setInterval(() => {
  if (performance.now() < deadline || active > 0) return;
  clearInterval(interval);
  agent.destroy();

  latencies.sort((a, b) => a - b);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const failed = [...errors.values()].reduce((sum, value) => sum + value, 0);
  const statusObject = Object.fromEntries([...statuses.entries()].sort());
  const errorObject = Object.fromEntries([...errors.entries()].sort());

  const result = {
    target,
    concurrency,
    durationSeconds,
    extraHeaders: Object.keys(extraHeaders),
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    totalRequests: total,
    completedRequests: completed,
    requestsPerSecond: Number((completed / elapsedSeconds).toFixed(2)),
    failures: failed,
    statusCodes: statusObject,
    errors: errorObject,
    latencyMs: {
      min: Number((latencies[0] || 0).toFixed(2)),
      p50: Number(percentile(latencies, 50).toFixed(2)),
      p90: Number(percentile(latencies, 90).toFixed(2)),
      p95: Number(percentile(latencies, 95).toFixed(2)),
      p99: Number(percentile(latencies, 99).toFixed(2)),
      max: Number((latencies[latencies.length - 1] || 0).toFixed(2)),
      avg: Number((latencies.reduce((sum, value) => sum + value, 0) / Math.max(latencies.length, 1)).toFixed(2))
    }
  };

  console.log(JSON.stringify(result, null, 2));
}, 100);

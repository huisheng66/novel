// Redis 可选后端：限流跨实例共享 + 缓存失效广播。
// 用 ioredis-mock 驱动，验证的是本仓库的逻辑（命令组合、降级、回环过滤），
// 不是真实 Redis 的行为 —— 上线前仍需在目标环境跑一遍。

const test = require('node:test');
const assert = require('node:assert/strict');

const RedisMock = require('ioredis-mock');

process.env.REDIS_URL = 'redis://mock:6379';

const redis = require('../lib/redis');
const rateLimitStore = require('../lib/rateLimitStore');
const { createCacheStore } = require('../lib/memoryCache');

const factory = () => new RedisMock();

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test.before(async () => {
  const ok = await redis.init({ factory });
  assert.equal(ok, true, 'Redis(mock) 应连接成功');
  assert.equal(redis.isReady(), true);
});

test.after(async () => {
  await redis.resetForTest();
  delete process.env.REDIS_URL;
});

/* ===== 限流：计数确实落在 Redis，而不是进程内存 ===== */

test('限流：达到上限后拒绝，且被拒请求不占用配额', async () => {
  const client = redis.getClient();
  await client.del('codexnovel:rl:t1');

  const opts = { max: 2, windowMs: 10_000 };
  assert.equal((await rateLimitStore.consume('t1', opts)).allowed, true);
  assert.equal((await rateLimitStore.consume('t1', opts)).allowed, true);

  const blocked = await rateLimitStore.consume('t1', opts);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 10);

  // 被拒的那次已经把自己从 ZSET 移除，只留 2 条
  assert.equal(Number(await client.zcard('codexnovel:rl:t1')), 2);
});

test('限流：清空进程内存后仍被拒 —— 证明计数来自 Redis', async () => {
  const opts = { max: 2, windowMs: 10_000 };
  rateLimitStore.reset(); // 只清内存窗口
  const blocked = await rateLimitStore.consume('t1', opts);
  assert.equal(blocked.allowed, false, '内存已清空，仍应被 Redis 中的计数拦住');
});

test('限流：窗口过期后恢复放行（窗口下限被钳制在 1s）', async () => {
  const client = redis.getClient();
  await client.del('codexnovel:rl:t2');

  // consume() 会把 windowMs 钳到 >= 1000，防住「窗口极短导致限流失效」的配置失误
  const opts = { max: 1, windowMs: 1000 };

  assert.equal((await rateLimitStore.consume('t2', opts)).allowed, true);
  assert.equal((await rateLimitStore.consume('t2', opts)).allowed, false);

  await wait(1150);
  assert.equal((await rateLimitStore.consume('t2', opts)).allowed, true, '窗口过期后应重新放行');
});

test('限流：不同 key 互不影响', async () => {
  const client = redis.getClient();
  await client.del('codexnovel:rl:t3a', 'codexnovel:rl:t3b');
  const opts = { max: 1, windowMs: 10_000 };

  assert.equal((await rateLimitStore.consume('t3a', opts)).allowed, true);
  assert.equal((await rateLimitStore.consume('t3a', opts)).allowed, false);
  assert.equal((await rateLimitStore.consume('t3b', opts)).allowed, true);
});

/* ===== 缓存失效广播 ===== */

test('失效广播：本实例清除会把前缀发到频道', async () => {
  const watcher = new RedisMock();
  const messages = [];
  await watcher.subscribe(redis.INVALIDATE_CHANNEL);
  watcher.on('message', (channel, payload) => messages.push(JSON.parse(payload)));

  const storeA = createCacheStore({ publish: prefix => redis.publishInvalidate(prefix) });
  storeA.set('html:novel:5:a.test', '<html>');
  storeA.clear('html:novel:');

  await wait(60);
  assert.equal(messages.length, 1, '应收到一条失效通知');
  assert.equal(messages[0].prefix, 'html:novel:');
  assert.ok(messages[0].origin, 'payload 需带 origin 以过滤回环');
  assert.equal(storeA.get('html:novel:5:a.test'), null, '本实例自身也要清除');
  await watcher.quit();
});

test('失效广播：收到其他实例的通知后只清本地、不回环', async () => {
  const storeB = createCacheStore({ publish: prefix => redis.publishInvalidate(prefix) });
  storeB.set('html:novel:7:b.test', '<html>');
  storeB.set('html:home:b.test:all', '<html>');

  let calls = 0;
  redis.onInvalidate(prefix => {
    calls += 1;
    storeB.clearLocal(prefix);
  });

  // 模拟另一个实例发布（origin 不同）
  const other = new RedisMock();
  await other.publish(
    redis.INVALIDATE_CHANNEL,
    JSON.stringify({ origin: 'other-instance', prefix: 'html:novel:' })
  );
  await wait(60);

  assert.equal(calls, 1, '异源通知应触发一次处理');
  assert.equal(storeB.get('html:novel:7:b.test'), null, '匹配前缀的键应失效');
  assert.equal(storeB.get('html:home:b.test:all'), '<html>', '不匹配前缀的键应保留');

  // 自己发的消息应被 origin 过滤，不再触发处理（否则多实例会无限回环）
  await redis.publishInvalidate('html:home:');
  await wait(60);
  assert.equal(calls, 1, '本实例发出的通知不应再回调自己');
  await other.quit();
});

/* ===== 未配置 Redis 时的降级 ===== */

test('降级：未配置 REDIS_URL 时不连 Redis，限流走内存', async () => {
  await redis.resetForTest();
  delete process.env.REDIS_URL;

  assert.equal(redis.isConfigured(), false);
  assert.equal(redis.isReady(), false);
  assert.equal(await redis.publishInvalidate('html:'), false, '未启用时应静默返回 false');

  const opts = { max: 1, windowMs: 10_000 };
  assert.equal((await rateLimitStore.consume('fallback', opts)).allowed, true);
  assert.equal((await rateLimitStore.consume('fallback', opts)).allowed, false);
});

test('降级：Redis 初始化失败时不影响限流可用', async () => {
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  const ok = await redis.init({
    factory: () => ({
      status: 'wait',
      connect: async () => { throw new Error('ECONNREFUSED'); },
      on() {},
      publish: async () => { throw new Error('ECONNREFUSED'); },
      quit: async () => {},
      disconnect() {}
    })
  });
  assert.equal(ok, false, '连接失败应返回 false 而不是抛错');
  assert.equal(redis.isReady(), false);

  rateLimitStore.reset();
  const opts = { max: 1, windowMs: 10_000 };
  assert.equal((await rateLimitStore.consume('degraded', opts)).allowed, true, '仍应能计数（内存）');
  assert.equal((await rateLimitStore.consume('degraded', opts)).allowed, false);

  delete process.env.REDIS_URL;
});

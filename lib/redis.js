// Redis 可选后端：只有配置 REDIS_URL 时才启用。
//
// 设计前提：**单实例默认零依赖**，全部状态留在进程内存；一旦部署多实例，
// 或者希望重启不丢限流计数，才通过 REDIS_URL 打开。
//
// 这里只承担两件事（其余进程内状态刻意不外提，理由见 docs/multi-instance.md）：
//   1. 缓存失效广播：{@link publishInvalidate} / {@link onInvalidate}
//   2. 限流计数：由 lib/rateLimitStore.js 通过 {@link getClient} 使用
//
// 任何 Redis 故障都必须**降级到内存而不是抛错**：限流退化为单机计数、
// 缓存失效退化为本机失效——比整个站点挂掉要好。

const crypto = require('crypto');
const logger = require('./logger');

const INVALIDATE_CHANNEL = 'codexnovel:cache:invalidate';
const INSTANCE_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

/** disabled | connecting | ready | error */
let status = 'disabled';
let ready = false;
let lastError = '';
let client = null;
let subscriber = null;
let invalidationHandler = null;

function redisUrl() {
  return String(process.env.REDIS_URL || '').trim();
}

function isConfigured() {
  return Boolean(redisUrl());
}

function isReady() {
  return ready && client !== null;
}

/**
 * 兼容不同实现：真实 ioredis 在 lazyConnect 下 status 为 'wait' 需要显式 connect；
 * 而 ioredis-mock 等实现没有 status 字段、构造即就绪，此时不该再调用 connect
 * （会抛 "Redis is already connecting/connected"）。
 */
async function ensureConnected(c) {
  if (!c || typeof c.connect !== 'function') return;
  const st = c.status;
  if (st === 'ready') return;
  if (st === 'wait' || st === 'end' || st === 'close') {
    await c.connect();
  }
  // 'connecting' / 无 status：视为可用，交给后续命令自行报错
}

function getClient() {
  return isReady() ? client : null;
}

function getStatus() {
  return {
    status,
    configured: isConfigured(),
    instanceId: INSTANCE_ID,
    lastError: lastError || null
  };
}

function createClient(url) {
  const Redis = require('ioredis');
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: times => Math.min(times * 500, 5000)
  });
}

/**
 * 挂上 error / end 监听：
 * - 不挂 error 监听时 ioredis 会往 stderr 打 "Unhandled error event"，运维容易误判成崩溃；
 * - 运行中断连则翻转 ready，让限流与失效广播自动退回进程内模式。
 */
function attachGuards(c, target) {
  if (!c || typeof c.on !== 'function') return;
  c.on('error', err => {
    if (ready) logger.warn('Redis 连接异常', { target, err });
  });
  c.on('end', () => {
    if (!ready) return;
    ready = false;
    status = 'error';
    lastError = 'connection ended';
    logger.warn('Redis 连接已断开，降级为进程内状态', { target });
  });
}

function degrade(err, action) {
  if (ready) {
    logger.warn('Redis 不可用，降级为进程内状态', { action, err });
  }
  status = 'error';
  ready = false;
  lastError = err && err.message ? err.message : String(err);
}

/**
 * 建立连接并订阅失效频道。可注入 factory 便于测试（ioredis-mock）。
 * @param {{ factory?: (url: string) => any }} [options]
 */
async function init(options = {}) {
  if (!isConfigured()) {
    status = 'disabled';
    return false;
  }
  if (ready) return true;

  const url = redisUrl();
  const factory = options.factory || createClient;

  status = 'connecting';
  try {
    client = factory(url);
    attachGuards(client, 'client');
    await ensureConnected(client);

    // pub/sub 需要独立连接，复用同一连接会导致普通命令无法执行
    subscriber = factory(url);
    attachGuards(subscriber, 'subscriber');
    await ensureConnected(subscriber);
    await subscriber.subscribe(INVALIDATE_CHANNEL);
    subscriber.on('message', (channel, payload) => {
      if (channel !== INVALIDATE_CHANNEL) return;
      let msg;
      try {
        msg = JSON.parse(payload);
      } catch (err) {
        return;
      }
      if (!msg || msg.origin === INSTANCE_ID) return; // 自己发的，已在本地清除
      if (invalidationHandler) invalidationHandler(String(msg.prefix || ''));
    });

    status = 'ready';
    ready = true;
    lastError = '';
    logger.info('Redis 已连接（限流与缓存失效跨实例共享）', { instanceId: INSTANCE_ID });
    return true;
  } catch (err) {
    degrade(err, 'init');
    logger.error('Redis 连接失败，降级为进程内状态', { err });
    await close();
    status = 'error';
    ready = false;
    return false;
  }
}

/** 注册其它实例发出的失效通知（只做本地清除，不要再广播，否则形成回环） */
function onInvalidate(handler) {
  invalidationHandler = handler;
}

async function publishInvalidate(prefix) {
  if (!isReady()) return false;
  try {
    await client.publish(INVALIDATE_CHANNEL, JSON.stringify({ origin: INSTANCE_ID, prefix }));
    return true;
  } catch (err) {
    degrade(err, 'publish');
    return false;
  }
}

async function close() {
  // 先翻转 ready：避免 quit 触发的 'end' 事件把状态又改成 error
  ready = false;
  for (const c of [subscriber, client]) {
    if (!c) continue;
    try {
      await c.quit();
    } catch (err) {
      try {
        c.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
  }
  subscriber = null;
  client = null;
  if (status !== 'disabled') status = 'disabled';
}

/** 仅供测试：重置模块状态 */
async function resetForTest() {
  invalidationHandler = null;
  await close();
  status = 'disabled';
  ready = false;
  lastError = '';
}

module.exports = {
  INVALIDATE_CHANNEL,
  INSTANCE_ID,
  isConfigured,
  isReady,
  getClient,
  getStatus,
  init,
  close,
  onInvalidate,
  publishInvalidate,
  resetForTest
};

// 熔断器：防止故障扩散，快速失败
const logger = require('./logger');

const STATES = {
  CLOSED: 'CLOSED',       // 正常状态
  OPEN: 'OPEN',           // 熔断打开（快速失败）
  HALF_OPEN: 'HALF_OPEN'  // 半开（尝试恢复）
};

/**
 * 创建熔断器
 * @param {Object} options
 * @param {number} options.threshold - 失败次数阈值，默认 5
 * @param {number} options.timeout - 熔断超时（毫秒），默认 60秒
 * @param {number} options.resetTimeout - 重置时间（毫秒），默认 30秒
 */
function createCircuitBreaker(options = {}) {
  const {
    threshold = 5,
    timeout = 60000,
    resetTimeout = 30000,
    name = 'unnamed'
  } = options;

  let state = STATES.CLOSED;
  let failureCount = 0;
  let successCount = 0;
  let nextAttempt = Date.now();
  let openedAt = null;

  function getState() {
    return {
      state,
      failureCount,
      successCount,
      nextAttempt: state === STATES.OPEN ? nextAttempt : null,
      openedAt
    };
  }

  function recordSuccess() {
    failureCount = 0;

    if (state === STATES.HALF_OPEN) {
      successCount++;
      // 半开状态下连续成功，关闭熔断器
      if (successCount >= 3) {
        state = STATES.CLOSED;
        successCount = 0;
        logger.info('Circuit breaker closed', { name });
      }
    }
  }

  function recordFailure() {
    failureCount++;
    successCount = 0;

    if (failureCount >= threshold && state === STATES.CLOSED) {
      // 失败次数达到阈值，打开熔断器
      state = STATES.OPEN;
      openedAt = Date.now();
      nextAttempt = Date.now() + timeout;
      logger.warn('Circuit breaker opened', { name, failureCount, threshold });
    } else if (state === STATES.HALF_OPEN) {
      // 半开状态下失败，重新打开
      state = STATES.OPEN;
      nextAttempt = Date.now() + resetTimeout;
      logger.warn('Circuit breaker re-opened', { name });
    }
  }

  async function execute(fn) {
    // 检查熔断器状态
    if (state === STATES.OPEN) {
      if (Date.now() < nextAttempt) {
        // 熔断器打开，快速失败
        const err = new Error('Circuit breaker is OPEN');
        err.circuitBreakerOpen = true;
        throw err;
      }
      // 尝试恢复：进入半开状态
      state = STATES.HALF_OPEN;
      logger.info('Circuit breaker half-open', { name });
    }

    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      recordFailure();
      throw err;
    }
  }

  function reset() {
    state = STATES.CLOSED;
    failureCount = 0;
    successCount = 0;
    nextAttempt = Date.now();
    openedAt = null;
    logger.info('Circuit breaker manually reset', { name });
  }

  return {
    execute,
    getState,
    reset,
    get name() { return name; }
  };
}

module.exports = {
  createCircuitBreaker,
  STATES
};

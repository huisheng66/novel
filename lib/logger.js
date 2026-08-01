'use strict';

const crypto = require('crypto');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_NAMES = { 10: 'debug', 20: 'info', 30: 'warn', 40: 'error' };
const minLevel = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

function serialize(value) {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  return value;
}

function writeLine(level, msg, data) {
  if (LEVELS[level] < minLevel) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    msg
  };

  if (data) {
    for (const key of Object.keys(data)) {
      entry[key] = serialize(data[key]);
    }
  }

  const line = JSON.stringify(entry);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(line + '\n');
}

function createLogger(context = {}) {
  return {
    debug(msg, data) { writeLine('debug', msg, { ...context, ...data }); },
    info(msg, data) { writeLine('info', msg, { ...context, ...data }); },
    warn(msg, data) { writeLine('warn', msg, { ...context, ...data }); },
    error(msg, data) { writeLine('error', msg, { ...context, ...data }); },
    child(extra = {}) { return createLogger({ ...context, ...extra }); }
  };
}

const logger = createLogger();

// Express 中间件:为每个请求生成 req.id 和 req.log
function requestLogger(req, res, next) {
  const reqId = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  req.log = logger.child({ req_id: reqId });
  next();
}

module.exports = logger;
module.exports.requestLogger = requestLogger;
module.exports.createLogger = createLogger;

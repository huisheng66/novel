// API 统一错误

class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {object} [details] 附加字段（如付费章节的 price / teaser），合并进 error 对象
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

function sendError(res, err) {
  if (err instanceof ApiError) {
    const error = { code: err.code, message: err.message };
    if (err.details) Object.assign(error, err.details);
    return res.status(err.status).json({ error });
  }
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL' : 'BAD_REQUEST');
  return res.status(status).json({
    error: {
      code: typeof code === 'string' ? code : 'INTERNAL',
      message: err.message || 'Server internal error'
    }
  });
}

function badRequest(message) {
  return new ApiError(400, 'BAD_REQUEST', message);
}

function unauthorized(message = 'Unauthorized') {
  return new ApiError(401, 'UNAUTHORIZED', message);
}

function forbidden(message = 'Forbidden') {
  return new ApiError(403, 'FORBIDDEN', message);
}

function notFound(message = 'Not found') {
  return new ApiError(404, 'NOT_FOUND', message);
}

function conflict(message) {
  return new ApiError(409, 'CONFLICT', message);
}

/** 付费章节未解锁（HTTP 402），details 用于客户端直接展示价格与试读 */
function paymentRequired(message = 'Payment required', details) {
  return new ApiError(402, 'PAYMENT_REQUIRED', message, details);
}

module.exports = {
  ApiError,
  sendError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  paymentRequired
};

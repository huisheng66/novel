// API 统一错误

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function sendError(res, err) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message }
    });
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

module.exports = {
  ApiError,
  sendError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict
};

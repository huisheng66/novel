const express = require('express');
const { registerDevice, listDevices } = require('../../../lib/api/notices');
const { requireUser } = require('./middleware/auth');
const { sendError, ApiError } = require('../../../lib/api/errors');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.use(requireUser);

router.get('/', asyncRoute(async (req, res) => {
  try {
    res.json(await listDevices(req.apiUser.id));
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

router.post('/', asyncRoute(async (req, res) => {
  try {
    const device = await registerDevice(req.apiUser.id, req.body || {});
    res.status(201).json(device);
  } catch (err) {
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
}));

module.exports = router;

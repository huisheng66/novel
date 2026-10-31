// 官方 App 读者 API v1（不影响现有 Web SSR / Legado）

const express = require('express');
const { sendError, ApiError } = require('../../../lib/api/errors');
const { findUserById, publicUser } = require('../../../lib/api/users');
const { requireUser } = require('./middleware/auth');
const authRoutes = require('./auth');
const booksRoutes = require('./books');
const shelfRoutes = require('./shelf');
const progressRoutes = require('./progress');
const bookmarksRoutes = require('./bookmarks');
const opsRoutes = require('./ops');
const devicesRoutes = require('./devices');
const noticesRoutes = require('./notices');
const walletRoutes = require('./wallet');
const purchasesRoutes = require('./purchases');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.use((req, res, next) => {
  res.set('X-API-Version', '1');
  next();
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', apiVersion: 1 });
});

// 公开运营面（无需登录）
router.use('/ops', opsRoutes);

router.use('/auth', authRoutes);

router.get('/me', requireUser, asyncRoute(async (req, res) => {
  const user = await findUserById(req.apiUser.id);
  res.json({ user: publicUser(user) });
}));

router.use('/me/shelf', shelfRoutes);
router.use('/me/progress', progressRoutes);
router.use('/me/bookmarks', bookmarksRoutes);
router.use('/me/devices', devicesRoutes);
router.use('/me/notices', noticesRoutes);
router.use('/me/wallet', walletRoutes);
router.use('/me/purchases', purchasesRoutes);
router.use('/books', booksRoutes);

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof ApiError) return sendError(res, err);
  return sendError(res, err);
});

module.exports = router;

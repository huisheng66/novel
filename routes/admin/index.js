// 后台路由挂载点:auth(免认证) → requireAdmin → 各功能子模块

const express = require('express');
const { requireAdmin } = require('./shared');
const authRoutes = require('./auth');
const dashboardRoutes = require('./dashboard');
const tokenRoutes = require('./tokens');
const userRoutes = require('./users');
const novelRoutes = require('./novels');
const chapterRoutes = require('./chapters');

const router = express.Router();

// 登录/登出不需要认证
router.use(authRoutes);

// 以下路由需要管理员认证
router.use(requireAdmin);

router.use(dashboardRoutes);
router.use(tokenRoutes);
router.use(userRoutes);
router.use(novelRoutes);
router.use(chapterRoutes);

module.exports = router;

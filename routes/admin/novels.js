// 后台小说管理路由:创建、编辑、封面上传/删除、删除

const express = require('express');
const { pool } = require('../../db');
const {
  handleCoverUpload,
  clearNovelCache,
  clearHomeCache,
  toPositiveInt,
  saveCoverImage,
  deleteCoverImage
} = require('./shared');
const { normalizeText } = require('../../lib/chapterText');
const { renderNovelInfo } = require('./dashboard');

const router = express.Router();

router.post('/novels', async (req, res, next) => {
  try {
    const title = normalizeText(req.body.title);
    const author = normalizeText(req.body.author);
    const description = normalizeText(req.body.description);

    if (!title || !author) {
      return renderNovelInfo(req, res, { error: '小说标题和作者不能为空' });
    }

    const [result] = await pool.execute(
      'INSERT INTO novels (title, author, description) VALUES (?, ?, ?)',
      [title, author, description]
    );
    clearHomeCache();

    res.redirect(`/admin/novels/info?novel_id=${result.insertId}&notice=${encodeURIComponent('小说已创建')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    const title = normalizeText(req.body.title);
    const author = normalizeText(req.body.author);
    const description = normalizeText(req.body.description);

    if (!novelId || !title || !author) {
      return renderNovelInfo(req, res, { error: '小说标题和作者不能为空' });
    }

    await pool.execute(
      'UPDATE novels SET title = ?, author = ?, description = ? WHERE id = ?',
      [title, author, description, novelId]
    );
    clearNovelCache(novelId);

    res.redirect(`/admin/novels/info?novel_id=${novelId}&notice=${encodeURIComponent('小说已更新')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id/cover', handleCoverUpload, async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('无效的小说 ID')}`);
    }
    if (!req.file) {
      return res.redirect(`/admin/novels/info?novel_id=${novelId}&error=${encodeURIComponent('请选择要上传的封面图片')}`);
    }

    const [[novel]] = await pool.execute(
      'SELECT id, cover_image FROM novels WHERE id = ?',
      [novelId]
    );
    if (!novel) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('小说不存在')}`);
    }

    const coverPath = await saveCoverImage(novelId, req.file);
    await pool.execute('UPDATE novels SET cover_image = ? WHERE id = ?', [coverPath, novelId]);
    await deleteCoverImage(novel.cover_image);
    clearNovelCache(novelId);

    res.redirect(`/admin/novels/info?novel_id=${novelId}&notice=${encodeURIComponent('封面已上传')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id/cover/delete', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('无效的小说 ID')}`);
    }

    const [[novel]] = await pool.execute(
      'SELECT id, cover_image FROM novels WHERE id = ?',
      [novelId]
    );
    if (!novel) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('小说不存在')}`);
    }

    await pool.execute('UPDATE novels SET cover_image = NULL WHERE id = ?', [novelId]);
    await deleteCoverImage(novel.cover_image);
    clearNovelCache(novelId);

    res.redirect(`/admin/novels/info?novel_id=${novelId}&notice=${encodeURIComponent('封面已删除')}`);
  } catch (err) {
    next(err);
  }
});

router.post('/novels/:id/delete', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.params.id);
    if (!novelId) {
      return res.redirect(`/admin/novels/info?error=${encodeURIComponent('无效的小说 ID')}`);
    }

    const [[novel]] = await pool.execute(
      'SELECT cover_image FROM novels WHERE id = ?',
      [novelId]
    );
    await pool.execute('DELETE FROM novels WHERE id = ?', [novelId]);
    if (novel) await deleteCoverImage(novel.cover_image);
    clearNovelCache(novelId);
    res.redirect(`/admin/novels/info?notice=${encodeURIComponent('小说已删除')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

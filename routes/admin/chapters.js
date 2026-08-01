// 后台章节管理路由:新建、编辑、上传、删除

const express = require('express');
const path = require('path');
const { pool } = require('../../db');
const {
  upload,
  toPositiveInt,
  getNovels,
  getCurrentNovel,
  nextChapterNumber,
  clearNovelCache,
  clearChapterCache
} = require('./shared');
const {
  normalizeText,
  formatChapterContent,
  splitTextIntoChapters,
  decodeUploadedFilename,
  titleFromFilename,
  extractUploadedFile
} = require('../../lib/chapterText');

const router = express.Router();

router.get('/chapters/new', async (req, res, next) => {
  try {
    const novels = await getNovels();
    const novelId = toPositiveInt(req.query.novel_id) || (novels[0] && novels[0].id);
    const currentNovel = await getCurrentNovel(novelId);
    let nextNumber = 1;
    if (currentNovel) {
      const [[nextRow]] = await pool.execute(
        'SELECT COALESCE(MAX(chapter_number), 0) + 1 AS next_number FROM chapters WHERE novel_id = ?',
        [currentNovel.id]
      );
      nextNumber = nextRow.next_number;
    }

    res.render('admin/chapter-form', {
      mode: 'create',
      novels,
      currentNovel,
      chapter: {
        id: null,
        novel_id: currentNovel ? currentNovel.id : '',
        chapter_number: nextNumber,
        title: '',
        content: ''
      },
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters', async (req, res, next) => {
  try {
    const novelId = toPositiveInt(req.body.novel_id);
    const chapterNumber = toPositiveInt(req.body.chapter_number);
    const title = normalizeText(req.body.title);
    const content = formatChapterContent(req.body.content);

    if (!novelId || !chapterNumber || !title || !content) {
      return res.redirect(`/admin/chapters/new?novel_id=${novelId || ''}&error=${encodeURIComponent('章节编号、标题和内容不能为空')}`);
    }

    await pool.execute(
      'INSERT INTO chapters (novel_id, chapter_number, title, content) VALUES (?, ?, ?, ?)',
      [novelId, chapterNumber, title, content]
    );
    clearNovelCache(novelId);

    res.redirect(`/admin?novel_id=${novelId}&notice=${encodeURIComponent('章节已创建')}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/admin/chapters/new?novel_id=${req.body.novel_id || ''}&error=${encodeURIComponent('该章节编号已存在')}`);
    }
    next(err);
  }
});

router.post('/chapters/upload', upload.array('chapter_files', 50), async (req, res, next) => {
  const novelId = toPositiveInt(req.body.novel_id);
  const startNumber = toPositiveInt(req.body.start_number);
  const uploadMode = req.body.upload_mode === 'replace' ? 'replace' : 'append';

  if (!novelId) {
    return res.redirect(`/admin?error=${encodeURIComponent('请先选择小说')}`);
  }
  if (!req.files || req.files.length === 0) {
    return res.redirect(`/admin?novel_id=${novelId}&error=${encodeURIComponent('请选择要上传的 txt 或 docx 文件')}`);
  }

  const conn = await pool.getConnection();
  try {
    let chapterNumber = startNumber || await nextChapterNumber(conn, novelId);
    const imported = [];
    const skipped = [];

    await conn.beginTransaction();

    if (uploadMode === 'replace') {
      await conn.execute('DELETE FROM chapters WHERE novel_id = ?', [novelId]);
    }

    for (const file of req.files) {
      const originalName = decodeUploadedFilename(file.originalname);
      try {
        const ext = path.extname(originalName).toLowerCase();
        if (!['.txt', '.docx'].includes(ext)) {
          skipped.push(`${originalName}: 文件类型不支持`);
          continue;
        }

        const text = await extractUploadedFile(file);
        if (!text) {
          skipped.push(`${originalName}: 没有读取到正文`);
          continue;
        }

        const chapters = splitTextIntoChapters(text, titleFromFilename(originalName));
        if (chapters.length === 0) {
          skipped.push(`${originalName}: 未识别到可导入章节`);
          continue;
        }

        for (const chapter of chapters) {
          await conn.execute(
            'INSERT INTO chapters (novel_id, chapter_number, title, content) VALUES (?, ?, ?, ?)',
            [novelId, chapterNumber, chapter.title, formatChapterContent(chapter.content)]
          );
          chapterNumber += 1;
        }

        imported.push(`${originalName}(${chapters.length}章)`);
      } catch (err) {
        skipped.push(`${originalName}: ${err.code === 'ER_DUP_ENTRY' ? '章节编号已存在' : err.message}`);
      }
    }

    await conn.commit();
    clearNovelCache(novelId);

    const parts = [];
    const importedChapterCount = imported.reduce((total, item) => {
      const match = item.match(/\((\d+)章\)$/);
      return total + (match ? Number(match[1]) : 0);
    }, 0);
    if (importedChapterCount > 0) parts.push(`${uploadMode === 'replace' ? '已覆盖导入' : '已追加导入'} ${importedChapterCount} 章：${imported.join('、')}`);
    if (skipped.length > 0) parts.push(`跳过 ${skipped.length} 个文件：${skipped.join('；')}`);
    const message = parts.join('，') || '没有导入任何文件';

    res.redirect(`/admin?novel_id=${novelId}&${importedChapterCount > 0 ? 'notice' : 'error'}=${encodeURIComponent(message)}`);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get('/api/chapters/:id', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const novelId = toPositiveInt(req.query.novel_id);

    if (!chapterId || !novelId) {
      return res.status(400).json({ error: 'Invalid chapter request' });
    }

    const [[chapter]] = await pool.execute(
      'SELECT id, novel_id, chapter_number, title, content, CHAR_LENGTH(content) AS content_length FROM chapters WHERE id = ? AND novel_id = ?',
      [chapterId, novelId]
    );

    if (!chapter) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    res.json({ chapter });
  } catch (err) {
    next(err);
  }
});

router.get('/chapters/:id/edit', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const [[chapter]] = await pool.execute(
      'SELECT id, novel_id, chapter_number, title, content FROM chapters WHERE id = ?',
      [chapterId]
    );
    if (!chapter) return res.status(404).render('404', { url: req.originalUrl });

    const novels = await getNovels();
    const currentNovel = await getCurrentNovel(chapter.novel_id);

    res.render('admin/chapter-form', {
      mode: 'edit',
      novels,
      currentNovel,
      chapter,
      error: req.query.error || ''
    });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters/:id', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const novelId = toPositiveInt(req.body.novel_id);
    const chapterNumber = toPositiveInt(req.body.chapter_number);
    const title = normalizeText(req.body.title);
    const content = formatChapterContent(req.body.content);

    if (!chapterId || !novelId || !chapterNumber || !title || !content) {
      return res.redirect(`/admin/chapters/${chapterId}/edit?error=${encodeURIComponent('章节编号、标题和内容不能为空')}`);
    }

    await pool.execute(
      'UPDATE chapters SET novel_id = ?, chapter_number = ?, title = ?, content = ? WHERE id = ?',
      [novelId, chapterNumber, title, content, chapterId]
    );
    clearChapterCache(novelId, chapterId);

    res.redirect(`/admin?novel_id=${novelId}&chapter_id=${chapterId}&notice=${encodeURIComponent('章节已更新')}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.redirect(`/admin/chapters/${req.params.id}/edit?error=${encodeURIComponent('该章节编号已存在')}`);
    }
    next(err);
  }
});

router.post('/chapters/:id/delete', async (req, res, next) => {
  try {
    const chapterId = toPositiveInt(req.params.id);
    const novelId = toPositiveInt(req.body.novel_id);

    if (!chapterId) {
      return res.redirect(`/admin?novel_id=${novelId || ''}&error=${encodeURIComponent('无效的章节 ID')}`);
    }

    await pool.execute('DELETE FROM chapters WHERE id = ?', [chapterId]);
    clearNovelCache(novelId);
    res.redirect(`/admin?novel_id=${novelId || ''}&notice=${encodeURIComponent('章节已删除')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Homepage — directly shows TOC of the first novel
router.get('/', async (req, res, next) => {
  try {
    const [[novel]] = await pool.execute(
      'SELECT id, title, description FROM novels ORDER BY id LIMIT 1'
    );
    if (!novel) return res.send('暂无小说');

    const [chapters] = await pool.execute(
      'SELECT id, chapter_number, title, created_at FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC',
      [novel.id]
    );

    res.render('novel', { novel, chapters });
  } catch (err) {
    next(err);
  }
});

// Novel detail + table of contents
router.get('/novel/:id', async (req, res, next) => {
  try {
    const [[novel]] = await pool.execute(
      'SELECT id, title, description, created_at FROM novels WHERE id = ?',
      [req.params.id]
    );
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    const [chapters] = await pool.execute(
      'SELECT id, chapter_number, title, created_at FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC',
      [req.params.id]
    );

    res.render('novel', { novel, chapters });
  } catch (err) {
    next(err);
  }
});

// Chapter reading page
router.get('/novel/:id/:chapterNum', async (req, res, next) => {
  try {
    const { id, chapterNum } = req.params;

    const [[novel]] = await pool.execute(
      'SELECT id, title FROM novels WHERE id = ?',
      [id]
    );
    if (!novel) return res.status(404).render('404', { url: req.originalUrl });

    const [[chapter]] = await pool.execute(
      'SELECT id, chapter_number, title, content FROM chapters WHERE novel_id = ? AND chapter_number = ?',
      [id, chapterNum]
    );
    if (!chapter) return res.status(404).render('404', { url: req.originalUrl });

    // Split content into paragraphs
    chapter.paragraphs = chapter.content
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    // Previous chapter
    const [[prevChapter]] = await pool.execute(
      'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 1',
      [id, chapterNum]
    );

    // Next chapter
    const [[nextChapter]] = await pool.execute(
      'SELECT chapter_number, title FROM chapters WHERE novel_id = ? AND chapter_number > ? ORDER BY chapter_number ASC LIMIT 1',
      [id, chapterNum]
    );

    res.render('chapter', { novel, chapter, prevChapter, nextChapter });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

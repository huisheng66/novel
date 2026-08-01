// 章节文本处理纯函数,从 routes/admin.js 抽取,便于单元测试与复用

const path = require('path');
const iconv = require('iconv-lite');
const mammoth = require('mammoth');

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function formatChapterContent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return '';

  return normalized
    .replace(/[\t\u3000]+/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/([\u3002\uff01\uff1f!?])([\u201d\u2019"'\)\]\}\uff09\u3011\u300b\u300d\u300f]*)[ \t\u3000]*(?=\S)/g, '$1$2\n\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .join('\n\n');
}

function titleFromFilename(filename) {
  return path.basename(filename, path.extname(filename)).trim() || '未命名章节';
}

function decodeUploadedFilename(filename) {
  const rawName = String(filename || '');
  if (/[\u4e00-\u9fff]/.test(rawName)) return rawName;

  try {
    const decodedName = Buffer.from(rawName, 'latin1').toString('utf8');
    if (decodedName && !decodedName.includes('\uFFFD') && /[\u4e00-\u9fff]/.test(decodedName)) {
      return decodedName;
    }
  } catch (err) {
    return rawName;
  }

  return rawName;
}

function cleanChapterTitle(line) {
  return line
    .replace(/^[\s　]+|[\s　]+$/g, '')
    .replace(/^[#*\-=\s　]+|[#*\-=\s　]+$/g, '')
    .trim();
}

function isChapterTitleLine(line) {
  const title = cleanChapterTitle(line);
  if (!title || title.length > 80) return false;

  const chineseNumber = '零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟';
  const chineseChapterPattern = new RegExp(`^第[\\d${chineseNumber}]+[章节回卷集部篇幕].{0,60}$`);
  const arabicChapterPattern = /^(?:正文\s*)?(?:chapter|Chapter|CHAPTER)\s*\d+[\s\S]{0,60}$/;
  const prefixedChapterPattern = /^\d{1,5}\s*[.、]\s*(?:第?\d+[章节回]|[\u4e00-\u9fa5A-Za-z].{0,50})$/;

  return chineseChapterPattern.test(title) ||
    arabicChapterPattern.test(title) ||
    prefixedChapterPattern.test(title);
}

function splitTextIntoChapters(text, fallbackTitle) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const headings = [];

  lines.forEach((line, index) => {
    if (isChapterTitleLine(line)) {
      headings.push({
        index,
        title: cleanChapterTitle(line)
      });
    }
  });

  if (headings.length === 0) {
    return [{
      title: fallbackTitle,
      content: formatChapterContent(normalized)
    }];
  }

  return headings
    .map((heading, position) => {
      const nextHeading = headings[position + 1];
      const content = formatChapterContent(lines
        .slice(heading.index + 1, nextHeading ? nextHeading.index : lines.length)
        .join('\n'));

      return {
        title: heading.title,
        content
      };
    })
    .filter(chapter => chapter.title && chapter.content);
}

function decodeTxt(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8', 3);
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer, 'utf16-le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer, 'utf16-be');
  }

  const utf8 = buffer.toString('utf8');
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount === 0 || replacementCount / Math.max(utf8.length, 1) < 0.01) {
    return utf8;
  }

  return iconv.decode(buffer, 'gb18030');
}

async function extractUploadedFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.txt') {
    return normalizeText(decodeTxt(file.buffer));
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return normalizeText(result.value);
  }
  throw new Error('仅支持 .txt 和 .docx 文件');
}

module.exports = {
  normalizeText,
  formatChapterContent,
  titleFromFilename,
  decodeUploadedFilename,
  cleanChapterTitle,
  isChapterTitleLine,
  splitTextIntoChapters,
  decodeTxt,
  extractUploadedFile
};

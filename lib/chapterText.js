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

/**
 * 前台阅读页展示标题：保证带「第N章」前缀。
 * 夸克等浏览器对「第X章」识别更稳；「第X节 / 序：」单独出现时容易不触发阅读模式。
 */
function buildReaderChapterTitle(chapterNumber, rawTitle) {
  const title = String(rawTitle || '').trim().replace(/\s+/g, ' ');
  const num = Number(chapterNumber);
  if (!title && !num) return '';

  // 文中已有「第N章」→ 从该处截取（去掉卷名前缀重复）
  const chapterToken = /第\s*[\d零〇一二三四五六七八九十百千万两]+\s*章/;
  const at = title.search(chapterToken);
  if (at >= 0) return title.slice(at);

  // 去掉「第X卷…」前缀后再判断
  const rest = title
    .replace(/^第[\d零〇一二三四五六七八九十百千万两]+卷[：:\s]+\S+\s+/, '')
    .replace(/^第[\d零〇一二三四五六七八九十百千万两]+卷[：:\s]*/, '')
    .trim() || title;

  if (chapterToken.test(rest)) return rest;
  if (Number.isInteger(num) && num > 0) return `第${num}章 ${rest}`;
  return rest;
}

/**
 * 合并过短段落，提高正文文本块密度（利于阅读模式抽取）。
 * 对话体小说（如蛊真人）按句切段后短 p 极多，浏览器常判定为非正文。
 */
function mergeParagraphsForReader(paragraphs, minLen = 100) {
  const list = (Array.isArray(paragraphs) ? paragraphs : [])
    .map(p => String(p || '').trim())
    .filter(p => p && /[\u4e00-\u9fffA-Za-z0-9]/.test(p));

  if (list.length === 0) return [];

  const result = [];
  let buf = '';
  for (const part of list) {
    if (!buf) {
      buf = part;
      continue;
    }
    if (buf.length < minLen) {
      buf += part;
    } else {
      result.push(buf);
      buf = part;
    }
  }
  if (buf) result.push(buf);
  return result;
}

function splitContentParagraphs(content) {
  return String(content || '')
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .filter(p => /[\u4e00-\u9fffA-Za-z0-9]/.test(p));
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

// 中文数字字符集（含 dual form 与大写）
const CHINESE_NUMBER_CHARS = '零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟';
const CHAPTER_NUM = `[\\d${CHINESE_NUMBER_CHARS}]+`;
// 章节单位：不含「卷」(分卷标记)、「幕」(正文「第一幕…」易误伤)
const CHAPTER_UNITS = '章节回集部篇';
// 标题与序号之间的分隔：全半角冒号、顿号、点号、破折号、空白
const TITLE_SEP = '[\\s　：:、.\\-—–]';

function isVolumeTitleLine(line) {
  const title = cleanChapterTitle(line);
  if (!title || title.length > 60) return false;
  // 第X卷 / 第X卷：标题 / 第X卷 标题
  return new RegExp(`^第${CHAPTER_NUM}卷(?:${TITLE_SEP}+.*)?$`).test(title);
}

function isPrefaceTitleLine(line) {
  const title = cleanChapterTitle(line);
  if (!title || title.length > 80) return false;

  // 前序/序章/楔子等；单独「序」也识别（蛊真人等常见写法）
  // 较长词优先，避免被更短模式截断
  return /^(?:序章|序言|序文|前言|前序|楔子|引子|引言|后记|尾声|番外篇?|结语|终章|自序|代序|序)(?:[\s　：:、.\-—–]+.{0,50})?$/.test(title);
}

function isChapterTitleLine(line) {
  const title = cleanChapterTitle(line);
  if (!title || title.length > 80) return false;

  // 第N章/节/回… 后可：结束 / 分隔符+标题 / 无分隔短标题（如「第342章危危可急」）
  // 无分隔时限制长度且不含句号，降低正文误匹配。
  const chineseChapterPattern = new RegExp(
    `^第${CHAPTER_NUM}[${CHAPTER_UNITS}](?:${TITLE_SEP}+.*|[^。\\n]{1,40})?$`
  );
  const arabicChapterPattern = /^(?:正文\s*)?(?:chapter|Chapter|CHAPTER)\s*\d+(?:[\s:.\-—–].{0,60})?$/i;
  const prefixedChapterPattern = /^\d{1,5}\s*[.、]\s*(?:第?\d+[章节回]|[\u4e00-\u9fa5A-Za-z].{0,50})$/;

  return chineseChapterPattern.test(title) ||
    arabicChapterPattern.test(title) ||
    prefixedChapterPattern.test(title) ||
    isPrefaceTitleLine(title);
}

function composeChapterTitle(volumeTitle, chapterTitle) {
  if (!volumeTitle || isPrefaceTitleLine(chapterTitle) || chapterTitle.includes('卷')) {
    return chapterTitle;
  }
  return `${volumeTitle} ${chapterTitle}`;
}

/** 匹配标题开头的「第N卷…」前缀（用于去重展示/清洗） */
const VOLUME_TITLE_PREFIX = new RegExp(
  `^(第${CHAPTER_NUM}卷(?:${TITLE_SEP}+\\S+)?)\\s+(.+)$`
);

/**
 * 卷名只保留在该卷第一章：后续章节去掉重复的「第N卷」前缀。
 * 输入按章节顺序的标题列表，返回清洗后的标题列表。
 */
function dedupeVolumePrefixes(titles) {
  let lastVolume = '';
  return (Array.isArray(titles) ? titles : []).map(raw => {
    const title = String(raw || '').trim();
    const match = title.match(VOLUME_TITLE_PREFIX);
    if (!match) {
      lastVolume = '';
      return title;
    }
    const volume = match[1];
    const rest = match[2].trim();
    if (volume === lastVolume && rest) {
      return rest;
    }
    lastVolume = volume;
    return title;
  });
}

function splitTextIntoChapters(text, fallbackTitle) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const volumes = [];
  const headings = [];

  lines.forEach((line, index) => {
    if (isVolumeTitleLine(line)) {
      volumes.push({ index, title: cleanChapterTitle(line) });
    } else if (isChapterTitleLine(line)) {
      headings.push({ index, title: cleanChapterTitle(line) });
    }
  });

  if (headings.length === 0) {
    return [{ title: fallbackTitle, content: formatChapterContent(normalized) }];
  }

  // 卷名只挂在「进入该卷后的第一章」，后续章不再重复「第N卷」
  let volIdx = 0;
  let currentVolume = '';
  let lastAttachedVolume = '';

  return headings
    .map((heading, position) => {
      while (volIdx < volumes.length && volumes[volIdx].index < heading.index) {
        currentVolume = volumes[volIdx].title;
        volIdx += 1;
      }

      const next = headings[position + 1];
      const body = lines
        .slice(heading.index + 1, next ? next.index : lines.length)
        .filter(line => !isVolumeTitleLine(line))
        .join('\n');

      const isFirstOfVolume = currentVolume && currentVolume !== lastAttachedVolume;
      if (isFirstOfVolume) lastAttachedVolume = currentVolume;

      return {
        title: isFirstOfVolume
          ? composeChapterTitle(currentVolume, heading.title)
          : heading.title,
        content: formatChapterContent(body)
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
  buildReaderChapterTitle,
  mergeParagraphsForReader,
  splitContentParagraphs,
  titleFromFilename,
  decodeUploadedFilename,
  cleanChapterTitle,
  isVolumeTitleLine,
  isPrefaceTitleLine,
  isChapterTitleLine,
  dedupeVolumePrefixes,
  splitTextIntoChapters,
  decodeTxt,
  extractUploadedFile
};

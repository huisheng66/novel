#!/usr/bin/env node
/**
 * 自动化静态验证脚本
 * 验证 P0 修复的代码完整性
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 codexnovel P0 修复验证\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;
let warnings = 0;

// 测试 1: CSS 重复定义
console.log('\n[1/6] CSS 重复定义检查...');
try {
  const mainCSS = fs.readFileSync(path.join(__dirname, 'public/css/main.css'), 'utf8');

  // 统计 :root 定义数量（不在 media query 中的）
  const rootMatches = mainCSS.match(/:root\s*\{/g) || [];
  const darkModeMatches = mainCSS.match(/@media\s*\(prefers-color-scheme:\s*dark\)/g) || [];

  console.log(`   - 找到 ${rootMatches.length} 个 :root 定义`);
  console.log(`   - 找到 ${darkModeMatches.length} 个深色模式`);

  if (rootMatches.length === 2 && darkModeMatches.length === 1) {
    console.log('   ✅ PASS: CSS 变量定义正确（1 亮色 + 1 深色）');
    passed++;
  } else {
    console.log('   ❌ FAIL: CSS 定义数量异常');
    failed++;
  }
} catch (e) {
  console.log('   ❌ ERROR:', e.message);
  failed++;
}

// 测试 2: 章节搜索优化
console.log('\n[2/6] 章节搜索性能优化检查...');
try {
  const novelEJS = fs.readFileSync(path.join(__dirname, 'views/novel.ejs'), 'utf8');
  const mainCSS = fs.readFileSync(path.join(__dirname, 'public/css/main.css'), 'utf8');

  const hasClassToggle = novelEJS.includes("classList.toggle('chapter-filtered-out'");
  const hasCSSClass = mainCSS.includes('.chapter-filtered-out');
  const hasRAF = novelEJS.includes('requestAnimationFrame') || novelEJS.includes('requestIdleCallback');

  if (hasClassToggle) {
    console.log('   ✅ 使用 classList.toggle 替代 hidden');
    passed++;
  } else {
    console.log('   ❌ 缺少 classList.toggle');
    failed++;
  }

  if (hasCSSClass) {
    console.log('   ✅ CSS class 已定义');
    passed++;
  } else {
    console.log('   ❌ CSS class 缺失');
    failed++;
  }

  if (hasRAF) {
    console.log('   ✅ 使用异步优化');
    passed++;
  } else {
    console.log('   ⚠️  WARNING: 缺少 RAF/IdleCallback');
    warnings++;
  }
} catch (e) {
  console.log('   ❌ ERROR:', e.message);
  failed++;
}

// 测试 3: visualViewport 修复
console.log('\n[3/6] visualViewport API 集成检查...');
try {
  const chapterEJS = fs.readFileSync(path.join(__dirname, 'views/chapter.ejs'), 'utf8');

  const hasVisualViewport = chapterEJS.includes('window.visualViewport');
  const hasHeightCheck = chapterEJS.includes('visualViewport.height') || chapterEJS.includes('viewport.height');
  const hasResizeListener = chapterEJS.includes("visualViewport.addEventListener('resize'");
  const hasKeyboardDetect = chapterEJS.includes('isKeyboardOpen');

  if (hasVisualViewport && hasHeightCheck) {
    console.log('   ✅ visualViewport API 已集成');
    passed++;
  } else {
    console.log('   ❌ visualViewport API 缺失');
    failed++;
  }

  if (hasResizeListener && hasKeyboardDetect) {
    console.log('   ✅ 键盘检测逻辑已添加');
    passed++;
  } else {
    console.log('   ❌ 键盘检测缺失');
    failed++;
  }
} catch (e) {
  console.log('   ❌ ERROR:', e.message);
  failed++;
}

// 测试 4: 表单按钮恢复
console.log('\n[4/6] 表单提交按钮状态恢复检查...');
try {
  const siteJS = fs.readFileSync(path.join(__dirname, 'public/js/site.js'), 'utf8');

  const hasTimeout = siteJS.includes('setTimeout') && siteJS.includes('5000');
  const hasRestore = siteJS.includes('button.disabled = false');
  const hasCleanup = siteJS.includes("addEventListener('beforeunload'");
  const hasARIA = siteJS.includes('aria-disabled');

  if (hasTimeout && hasRestore) {
    console.log('   ✅ 5 秒超时恢复机制');
    passed++;
  } else {
    console.log('   ❌ 超时恢复缺失');
    failed++;
  }

  if (hasCleanup) {
    console.log('   ✅ beforeunload 清理');
    passed++;
  } else {
    console.log('   ❌ 清理逻辑缺失');
    failed++;
  }

  if (hasARIA) {
    console.log('   ✅ ARIA 属性同步');
    passed++;
  } else {
    console.log('   ⚠️  WARNING: 缺少 ARIA 属性');
    warnings++;
  }
} catch (e) {
  console.log('   ❌ ERROR:', e.message);
  failed++;
}

// 测试 5: 文件完整性
console.log('\n[5/6] 关键文件完整性检查...');
const criticalFiles = [
  'public/css/main.css',
  'public/js/site.js',
  'views/novel.ejs',
  'views/chapter.ejs',
  'views/login.ejs',
  'views/register.ejs',
  'views/wallet.ejs'
];

let missingFiles = 0;
criticalFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, file));
  if (exists) {
    console.log(`   ✅ ${file}`);
  } else {
    console.log(`   ❌ ${file} (缺失)`);
    missingFiles++;
  }
});

if (missingFiles === 0) {
  passed++;
} else {
  failed++;
}

// 测试 6: 代码语法检查
console.log('\n[6/6] JavaScript 语法检查...');
const jsFiles = [
  'public/js/site.js',
  'public/app/js/app.js'
];

let syntaxErrors = 0;
jsFiles.forEach(file => {
  try {
    const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
    // 简单的语法检查
    new Function(code);
    console.log(`   ✅ ${file} 语法正确`);
  } catch (e) {
    console.log(`   ❌ ${file} 语法错误: ${e.message}`);
    syntaxErrors++;
  }
});

if (syntaxErrors === 0) {
  passed++;
} else {
  failed++;
}

// 总结
console.log('\n' + '='.repeat(60));
console.log(`\n📊 测试结果: ${passed} 通过 / ${failed} 失败 / ${warnings} 警告\n`);

if (failed === 0 && warnings === 0) {
  console.log('🎉 所有 P0 问题修复验证通过！可以开始功能测试。\n');
  process.exit(0);
} else if (failed === 0) {
  console.log('✅ P0 问题修复通过，但有些警告需要关注。\n');
  process.exit(0);
} else {
  console.log('❌ 部分测试失败，请检查修复代码。\n');
  process.exit(1);
}

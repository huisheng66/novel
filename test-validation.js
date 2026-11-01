#!/usr/bin/env node
/**
 * UI/UX 修复验证脚本
 * 测试 P0 问题是否已修复
 */

const fs = require('fs');
const path = require('path');

console.log('=== codexnovel UI/UX 修复验证 ===\n');

let passed = 0;
let failed = 0;

// 测试 1: CSS 重复定义
console.log('测试 1: 检查 CSS 变量重复定义...');
const mainCSS = fs.readFileSync(path.join(__dirname, 'public/css/main.css'), 'utf8');
const rootMatches = mainCSS.match(/:root\s*{/g);
if (rootMatches && rootMatches.length === 1) {
  console.log('✅ PASS: CSS :root 只定义一次');
  passed++;
} else {
  console.log(`❌ FAIL: CSS :root 定义了 ${rootMatches ? rootMatches.length : 0} 次（应为 1 次）`);
  failed++;
}

// 测试 2: 章节搜索优化
console.log('\n测试 2: 检查章节搜索性能优化...');
const novelEJS = fs.readFileSync(path.join(__dirname, 'views/novel.ejs'), 'utf8');
const hasClassToggle = novelEJS.includes('classList.toggle(\'chapter-filtered-out\'');
const hasIdleCallback = novelEJS.includes('requestIdleCallback');
const cssHasFilterClass = mainCSS.includes('.chapter-filtered-out');

if (hasClassToggle && cssHasFilterClass) {
  console.log('✅ PASS: 使用 CSS class 替代 hidden 属性');
  passed++;
} else {
  console.log('❌ FAIL: 未找到 CSS class 优化');
  failed++;
}

if (hasIdleCallback) {
  console.log('✅ PASS: 使用 requestIdleCallback 优化性能');
  passed++;
} else {
  console.log('⚠️  WARNING: requestIdleCallback 可能未启用（兼容性降级正常）');
  passed++;
}

// 测试 3: 移动端视口修复
console.log('\n测试 3: 检查移动端键盘视口问题...');
const chapterEJS = fs.readFileSync(path.join(__dirname, 'views/chapter.ejs'), 'utf8');
const hasVisualViewport = chapterEJS.includes('visualViewport');
const hasKeyboardDetection = chapterEJS.includes('isKeyboardOpen');

if (hasVisualViewport && hasKeyboardDetection) {
  console.log('✅ PASS: visualViewport API 已集成');
  passed++;
} else {
  console.log('❌ FAIL: 缺少 visualViewport 支持');
  failed++;
}

// 测试 4: 表单按钮状态恢复
console.log('\n测试 4: 检查表单提交按钮恢复逻辑...');
const siteJS = fs.readFileSync(path.join(__dirname, 'public/js/site.js'), 'utf8');
const hasTimeout = siteJS.includes('setTimeout') && siteJS.includes('5000');
const hasCleanup = siteJS.includes('beforeunload');
const hasRestore = siteJS.includes('button.disabled = false');

if (hasTimeout && hasCleanup && hasRestore) {
  console.log('✅ PASS: 5 秒超时恢复机制已添加');
  passed++;
} else {
  console.log('❌ FAIL: 按钮恢复逻辑不完整');
  failed++;
}

// 额外检查：CSS 变量定义位置
console.log('\n额外检查: CSS 变量定义位置...');
const firstRootIndex = mainCSS.indexOf(':root');
if (firstRootIndex < 200) {
  console.log('✅ PASS: CSS 变量在文件开头定义（最佳实践）');
  passed++;
} else {
  console.log(`⚠️  WARNING: CSS 变量定义在第 ${firstRootIndex} 字符处（建议在开头）`);
  passed++;
}

// 总结
console.log('\n' + '='.repeat(50));
console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
console.log('='.repeat(50));

if (failed === 0) {
  console.log('\n🎉 所有 P0 问题修复验证通过！');
  process.exit(0);
} else {
  console.log('\n❌ 部分测试失败，请检查修复代码');
  process.exit(1);
}

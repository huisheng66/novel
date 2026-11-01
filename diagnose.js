#!/usr/bin/env node
/**
 * 诊断悬浮 UI 为什么看不到
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 诊断悬浮 UI 问题\n');
console.log('='.repeat(70));

// 1. 检查文件修改时间
const chapterEjsPath = path.join(__dirname, 'views', 'chapter.ejs');
const mainCssPath = path.join(__dirname, 'public', 'css', 'main.css');

try {
  const chapterStat = fs.statSync(chapterEjsPath);
  const cssStat = fs.statSync(mainCssPath);

  console.log('\n📁 文件修改时间：');
  console.log(`   chapter.ejs: ${chapterStat.mtime.toLocaleString('zh-CN')}`);
  console.log(`   main.css:    ${cssStat.mtime.toLocaleString('zh-CN')}`);

  const now = new Date();
  const chapterAge = Math.floor((now - chapterStat.mtime) / 1000);
  const cssAge = Math.floor((now - cssStat.mtime) / 1000);

  console.log(`\n⏱️  文件年龄：`);
  console.log(`   chapter.ejs: ${chapterAge} 秒前修改`);
  console.log(`   main.css:    ${cssAge} 秒前修改`);

  if (chapterAge > 3600 || cssAge > 3600) {
    console.log('\n⚠️  警告：文件修改时间超过 1 小时，可能不是最新版本');
  }
} catch (err) {
  console.error('❌ 无法读取文件状态:', err.message);
}

// 2. 检查关键代码是否存在
console.log('\n' + '='.repeat(70));
console.log('\n🔎 检查关键代码片段：\n');

const checks = [];

try {
  const chapterContent = fs.readFileSync(chapterEjsPath, 'utf8');

  checks.push({
    name: '悬浮搜索框 HTML',
    exists: chapterContent.includes('class="chapter-search-island"'),
    hint: '应该在 <footer> 之后'
  });

  checks.push({
    name: '返回顶部按钮 HTML',
    exists: chapterContent.includes('class="back-to-top"'),
    hint: '应该在悬浮搜索框之后'
  });

  checks.push({
    name: '搜索框滚动监听 JS',
    exists: chapterContent.includes("getElementById('chapter-search-island')"),
    hint: '应该在 <script> 标签内'
  });

  checks.push({
    name: '滚动超过 300px 触发逻辑',
    exists: chapterContent.includes('window.scrollY > 300'),
    hint: '控制搜索框显示'
  });

  checks.push({
    name: '滚动超过 500px 触发逻辑',
    exists: chapterContent.includes('window.scrollY > 500'),
    hint: '控制返回顶部按钮显示'
  });
} catch (err) {
  console.error('❌ 无法读取 chapter.ejs:', err.message);
}

try {
  const cssContent = fs.readFileSync(mainCssPath, 'utf8');

  checks.push({
    name: '悬浮搜索框 CSS',
    exists: cssContent.includes('.chapter-search-island {'),
    hint: '基础样式'
  });

  checks.push({
    name: 'is-visible 显示状态',
    exists: cssContent.includes('.chapter-search-island.is-visible'),
    hint: '滚动后显示'
  });

  checks.push({
    name: 'backdrop-filter 毛玻璃',
    exists: cssContent.includes('backdrop-filter: blur'),
    hint: '毛玻璃效果'
  });

  checks.push({
    name: '返回顶部按钮 CSS',
    exists: cssContent.includes('.back-to-top {'),
    hint: '基础样式'
  });
} catch (err) {
  console.error('❌ 无法读取 main.css:', err.message);
}

checks.forEach((check, i) => {
  const status = check.exists ? '✅' : '❌';
  console.log(`${i + 1}. ${status} ${check.name}`);
  if (!check.exists) {
    console.log(`   提示: ${check.hint}`);
  }
});

const allPassed = checks.every(c => c.exists);

console.log('\n' + '='.repeat(70));

if (allPassed) {
  console.log('\n✅ 所有代码片段都存在！\n');
  console.log('💡 可能的原因：\n');
  console.log('1. **服务器没有重启** - 请重启 Node 服务器');
  console.log('   ① 找到进程: ps aux | grep node');
  console.log('   ② 杀死进程: pkill -f "node.*server"');
  console.log('   ③ 重新启动: node server.js\n');

  console.log('2. **浏览器缓存** - 请硬刷新浏览器');
  console.log('   Windows: Ctrl+Shift+R 或 Ctrl+F5');
  console.log('   Mac: Cmd+Shift+R\n');

  console.log('3. **访问的不是章节页** - 悬浮 UI 只在章节阅读页显示');
  console.log('   ✅ 正确: /novel/1/5 (章节页)');
  console.log('   ❌ 错误: /novel/1 (目录页)\n');

  console.log('4. **没有滚动足够距离**');
  console.log('   • 悬浮搜索框: 向下滚动超过 300px');
  console.log('   • 返回顶部: 向下滚动超过 500px\n');

  console.log('📋 调试步骤：\n');
  console.log('① 访问任意章节页（如 http://localhost:3000/novel/1/5）');
  console.log('② 打开浏览器开发者工具（F12）');
  console.log('③ 在控制台输入以下代码：\n');
  console.log('   console.log("搜索框:", document.getElementById("chapter-search-island"));');
  console.log('   console.log("返回按钮:", document.getElementById("back-to-top"));');
  console.log('   console.log("滚动位置:", window.scrollY);\n');
  console.log('④ 如果三个都返回 null，说明 HTML 没有加载');
  console.log('⑤ 如果元素存在但不可见，手动添加 is-visible 类：\n');
  console.log('   document.getElementById("chapter-search-island").classList.add("is-visible");');
  console.log('   document.getElementById("back-to-top").classList.add("is-visible");\n');

} else {
  console.log('\n❌ 部分代码片段缺失！\n');
  console.log('请检查上述失败的项目，可能需要重新添加代码。');
}

console.log('='.repeat(70));

// 个人中心:登录 + 阅读统计 + 订阅链接,数据通过 /api/me 异步加载,兼容页面缓存
(function() {
  // 首页未登录:内联登录表单,提交后刷新页面(不依赖个人中心元素)
  var homeForm = document.getElementById('home-login-form');
  if (homeForm) {
    homeForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var nameInput = document.getElementById('home-login-name');
      var tokenInput = document.getElementById('home-login-token');
      var errEl = homeForm.querySelector('.home-login-error');
      var btn = homeForm.querySelector('button[type="submit"]');
      var name = nameInput.value.trim();
      var token = tokenInput.value.trim();
      if (!name || !token) {
        errEl.textContent = '请输入用户名和令牌';
        return;
      }
      btn.disabled = true;
      btn.textContent = '登录中…';
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, token: token })
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            location.reload();
          } else {
            errEl.textContent = data.error || '登录失败';
            btn.disabled = false;
            btn.textContent = '登录';
          }
        })
        .catch(function() {
          errEl.textContent = '网络错误,请重试';
          btn.disabled = false;
          btn.textContent = '登录';
        });
    });
  }

  var center = document.getElementById('personal-center');
  if (!center) return;

  var toggle = document.getElementById('pc-toggle');
  var panel = document.getElementById('pc-panel');
  var isOpen = false;
  var loaded = false;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(seconds) {
    seconds = Number(seconds) || 0;
    if (seconds < 60) return seconds + ' 秒';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' 分钟';
    var hours = Math.floor(minutes / 60);
    var remMin = minutes % 60;
    return remMin ? hours + ' 小时 ' + remMin + ' 分' : hours + ' 小时';
  }

  function formatWords(count) {
    count = Number(count) || 0;
    if (count < 10000) return count + ' 字';
    return (count / 10000).toFixed(1) + ' 万字';
  }

  function getReadingDuration() {
    return Number(localStorage.getItem('reading-duration')) || 0;
  }

  function updateDurationDisplay() {
    var el = document.getElementById('pc-duration');
    if (el) el.textContent = formatDuration(getReadingDuration());
  }

  function renderLoginForm(errorMsg) {
    var errHtml = errorMsg ? '<div class="pc-error">' + escapeHtml(errorMsg) + '</div>' : '';
    panel.innerHTML =
      '<div class="pc-login">' +
        '<div class="pc-login-title">登录</div>' +
        errHtml +
        '<input type="text" id="pc-login-name" class="pc-input" placeholder="用户名" autocomplete="username" />' +
        '<input type="password" id="pc-login-token" class="pc-input" placeholder="访问令牌" autocomplete="current-password" />' +
        '<button type="button" id="pc-login-btn" class="pc-login-btn">登录</button>' +
      '</div>';

    var nameInput = document.getElementById('pc-login-name');
    var tokenInput = document.getElementById('pc-login-token');
    var btn = document.getElementById('pc-login-btn');

    function doLogin() {
      var name = nameInput.value.trim();
      var token = tokenInput.value.trim();
      if (!name || !token) {
        renderLoginForm('请输入用户名和令牌');
        return;
      }
      btn.disabled = true;
      btn.textContent = '登录中…';
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, token: token })
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
        panel.innerHTML = '<div class="pc-loading">加载中…</div>';
        fetch('/api/me')
          .then(function(r) { return r.json(); })
          .then(function(meData) { renderPanel(meData); })
          .catch(function() {
            panel.innerHTML = '<div class="pc-empty">加载失败,请稍后重试</div>';
          });
      } else {
            renderLoginForm(data.error || '登录失败');
          }
        })
        .catch(function() {
          renderLoginForm('网络错误,请重试');
        });
    }

    btn.addEventListener('click', doLogin);
    tokenInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doLogin();
    });
    nameInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') tokenInput.focus();
    });
    nameInput.focus();
  }

  function renderPanel(data) {
    if (!data.authenticated) {
      renderLoginForm();
      return;
    }
    panel.innerHTML =
      '<div class="pc-name">' + escapeHtml(data.name) + '</div>' +
      '<div class="pc-row"><span>阅读时长</span><strong id="pc-duration">' + formatDuration(getReadingDuration()) + '</strong></div>' +
      '<div class="pc-row"><span>已读章节</span><strong>' + data.chaptersRead + ' 章</strong></div>' +
      '<div class="pc-row"><span>已读字数</span><strong>' + formatWords(data.totalWords) + '</strong></div>' +
      '<div class="pc-subscribe-label">订阅链接(已含 Token)</div>' +
      '<div class="pc-subscribe-url">' +
        '<code>' + escapeHtml(data.subscribeUrl) + '</code>' +
        '<button type="button" class="pc-copy" id="pc-copy">复制</button>' +
      '</div>' +
      '<button type="button" id="pc-logout" class="pc-logout-btn">退出登录</button>';

    var copyBtn = document.getElementById('pc-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var code = copyBtn.previousElementSibling;
        var url = code ? code.textContent : data.subscribeUrl;
        function done() {
          copyBtn.textContent = '已复制';
          setTimeout(function() { copyBtn.textContent = '复制'; }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, done);
        } else {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta);
          done();
        }
      });
    }

    var logoutBtn = document.getElementById('pc-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        logoutBtn.disabled = true;
        fetch('/api/logout', { method: 'POST' })
          .then(function() {
            loaded = false;
            renderLoginForm();
          })
          .catch(function() {
            logoutBtn.disabled = false;
          });
      });
    }
  }

  function openPanel() {
    if (isOpen) return;
    isOpen = true;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (!loaded) {
      loaded = true;
      panel.innerHTML = '<div class="pc-loading">加载中…</div>';
      fetch('/api/me')
        .then(function(r) { return r.json(); })
        .then(function(data) { renderPanel(data); })
        .catch(function() {
          panel.innerHTML = '<div class="pc-empty">加载失败,请稍后重试</div>';
        });
    } else {
      updateDurationDisplay();
    }
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function(e) {
    e.stopPropagation();
    if (isOpen) closePanel();
    else openPanel();
  });

  document.addEventListener('click', function(e) {
    if (isOpen && !center.contains(e.target)) closePanel();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) closePanel();
  });

  // 章节阅读页:累计阅读时长(页面可见时每 15 秒 +15s)
  var isChapterPage = /^\/novel\/\d+\/\d+/.test(window.location.pathname);
  if (isChapterPage) {
    setInterval(function() {
      if (document.hidden) return;
      var current = Number(localStorage.getItem('reading-duration')) || 0;
      localStorage.setItem('reading-duration', String(current + 15));
      if (isOpen) updateDurationDisplay();
    }, 15000);
  }
})();

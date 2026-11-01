(function () {
  'use strict';

  function getToken() {
    try { return localStorage.getItem('codexnovel_access_token') || ''; } catch (e) { return ''; }
  }

  var auth = document.querySelector('[data-client-auth]');
  var token = getToken();
  if (auth && token) {
    auth.innerHTML = '<a class="header-nav-link" href="/logout">退出</a>';
  }

  document.querySelectorAll('[data-account-entry]').forEach(function (link) {
    if (!token) link.href = '/login?next=' + encodeURIComponent('/wallet');
  });

  document.querySelectorAll('form[data-loading]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!form.checkValidity()) return;
      var button = form.querySelector('button[type="submit"]');
      if (!button || button.disabled) return;

      var label = form.getAttribute('data-loading') || '处理中…';
      var originalText = button.textContent;

      window.setTimeout(function () {
        button.textContent = label;
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        form.setAttribute('aria-busy', 'true');

        // 5 秒后自动恢复按钮状态（防止网络错误导致永久禁用）
        var timeoutId = setTimeout(function () {
          button.textContent = originalText;
          button.disabled = false;
          button.removeAttribute('aria-disabled');
          form.setAttribute('aria-busy', 'false');
        }, 5000);

        // 保存 timeout ID 以便页面跳转时清理
        form.dataset.submitTimeoutId = timeoutId;
      }, 0);
    });
  });

  // 页面卸载时清理所有定时器
  window.addEventListener('beforeunload', function () {
    document.querySelectorAll('form[data-submit-timeout-id]').forEach(function (form) {
      clearTimeout(parseInt(form.dataset.submitTimeoutId));
    });
  });
})();

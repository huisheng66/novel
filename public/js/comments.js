// 小说评论区:异步加载评论列表 + 发表评论
(function() {
  var section = document.getElementById('novel-comments');
  if (!section) return;

  var novelId = section.getAttribute('data-novel-id');
  var form = document.getElementById('comment-form');
  var nameInput = document.getElementById('comment-name');
  var contentInput = document.getElementById('comment-content');
  var list = document.getElementById('comment-list');
  var submitBtn = document.getElementById('comment-submit');
  var countEl = document.getElementById('comment-count');

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr.replace(' ', 'T'));
    var now = new Date();
    var diff = Math.floor((now - d) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
    return dateStr.slice(0, 10);
  }

  function renderComments(comments) {
    if (countEl) countEl.textContent = comments.length;
    if (comments.length === 0) {
      list.innerHTML = '<p class="comment-empty">还没有评论,来抢沙发吧</p>';
      return;
    }
    list.innerHTML = comments.map(function(c) {
      return '<div class="comment-item">' +
        '<div class="comment-meta">' +
          '<span class="comment-author">' + escapeHtml(c.name) + '</span>' +
          '<span class="comment-time">' + escapeHtml(timeAgo(c.created_at)) + '</span>' +
        '</div>' +
        '<div class="comment-content">' + escapeHtml(c.content) + '</div>' +
      '</div>';
    }).join('');
  }

  function loadComments() {
    list.innerHTML = '<p class="comment-empty">加载中…</p>';
    fetch('/api/novels/' + novelId + '/comments')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          list.innerHTML = '<p class="comment-empty">' + escapeHtml(data.error) + '</p>';
        } else {
          renderComments(data.comments || []);
        }
      })
      .catch(function() {
        list.innerHTML = '<p class="comment-empty">加载失败,请刷新重试</p>';
      });
  }

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var content = contentInput.value.trim();
    if (!content) {
      contentInput.focus();
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '发表中…';
    fetch('/api/novels/' + novelId + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        content: content
      })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          alert(data.error);
        } else {
          contentInput.value = '';
          // 重新加载评论列表以显示新评论
          loadComments();
        }
      })
      .catch(function() { alert('发表失败,请稍后重试'); })
      .finally(function() {
        submitBtn.disabled = false;
        submitBtn.textContent = '发表';
      });
  });

  loadComments();
})();

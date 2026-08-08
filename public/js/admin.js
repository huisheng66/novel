(() => {
  const workspace = document.querySelector('[data-admin-chapters]');
  if (!workspace) return;

  const novelId = workspace.dataset.novelId;
  const nextNumber = workspace.dataset.nextNumber || '1';
  const editor = document.querySelector('[data-chapter-editor]');
  const form = editor && editor.querySelector('.admin-inline-chapter-form');
  let deleteForm = document.getElementById('delete-selected-chapter');
  const numberInput = form && form.elements.chapter_number;
  const titleInput = form && form.elements.title;
  const contentInput = form && form.elements.content;
  const actions = form && form.querySelector('.admin-actions');
  const submitButton = form && form.querySelector('button[type="submit"]');
  const heading = editor && editor.querySelector('.admin-section-title h2');
  const titleActions = editor && editor.querySelector('.admin-section-title');

  if (!novelId || !editor || !form || !numberInput || !titleInput || !contentInput || !actions) return;

  let newChapterLink = titleActions.querySelector('[data-new-chapter-link], a[href*="#chapter-editor"]');
  let caption = titleActions.querySelector('[data-editor-caption], span');
  let deleteButton = actions.querySelector('[data-delete-chapter], .admin-delete-selected-chapter');
  let viewLink = actions.querySelector('[data-view-chapter], a.button-secondary');

  if (newChapterLink) newChapterLink.dataset.newChapterLink = 'true';
  if (caption) caption.dataset.editorCaption = 'true';
  if (deleteButton) deleteButton.dataset.deleteChapter = 'true';
  if (viewLink) viewLink.dataset.viewChapter = 'true';

  const createLabels = { editorTitle: '新增章节', submit: '创建章节' };
  const activeLabels = { editorTitle: '章节管理', submit: '保存章节' };

  let loadAbort = null;
  let activeChapterId = null;
  let inflightId = null;

  // 短时缓存已加载正文，来回点章节时避免重复请求
  const contentCache = new Map();
  const CONTENT_CACHE_MAX = 12;

  const setHidden = (element, isHidden) => {
    if (element) element.hidden = isHidden;
  };

  const ensureNewChapterLink = () => {
    if (newChapterLink) return newChapterLink;
    newChapterLink = document.createElement('a');
    newChapterLink.href = `/admin?novel_id=${encodeURIComponent(novelId)}#chapter-editor`;
    newChapterLink.textContent = '新建章节';
    newChapterLink.dataset.newChapterLink = 'true';
    titleActions.appendChild(newChapterLink);
    return newChapterLink;
  };

  const ensureCaption = () => {
    if (caption) return caption;
    caption = document.createElement('span');
    caption.textContent = '管理单章节的新建、修改、删除。';
    caption.dataset.editorCaption = 'true';
    titleActions.appendChild(caption);
    return caption;
  };

  const ensureDeleteForm = (chapterId) => {
    if (!deleteForm) {
      deleteForm = document.createElement('form');
      deleteForm.id = 'delete-selected-chapter';
      deleteForm.method = 'post';
      deleteForm.dataset.deleteChapterForm = 'true';
      deleteForm.addEventListener('submit', (event) => {
        if (!window.confirm('确认删除该章节？')) event.preventDefault();
      });

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'novel_id';
      input.value = novelId;
      deleteForm.appendChild(input);
      editor.appendChild(deleteForm);
    }
    deleteForm.action = `/admin/chapters/${encodeURIComponent(chapterId)}/delete`;
    return deleteForm;
  };

  const ensureEditActions = (chapter) => {
    ensureNewChapterLink();
    ensureCaption();

    if (!deleteButton) {
      deleteButton = document.createElement('button');
      deleteButton.className = 'button button-danger admin-delete-selected-chapter';
      deleteButton.type = 'submit';
      deleteButton.setAttribute('form', 'delete-selected-chapter');
      deleteButton.textContent = '删除章节';
      deleteButton.dataset.deleteChapter = 'true';
      actions.appendChild(deleteButton);
    }

    if (!viewLink) {
      viewLink = document.createElement('a');
      viewLink.className = 'button button-secondary';
      viewLink.textContent = '查看前台';
      viewLink.dataset.viewChapter = 'true';
      actions.appendChild(viewLink);
    }

    deleteButton.setAttribute('form', 'delete-selected-chapter');
    viewLink.href = `/novel/${encodeURIComponent(novelId)}/${encodeURIComponent(chapter.chapter_number)}`;
  };

  const setActiveRow = (chapterId) => {
    const id = chapterId == null ? null : String(chapterId);
    // 只改前后两行，避免遍历整页列表
    const prev = workspace.querySelector('[data-chapter-row].is-active');
    if (prev && prev.dataset.chapterId !== id) prev.classList.remove('is-active');
    if (id) {
      const next = workspace.querySelector(`[data-chapter-row][data-chapter-id="${CSS.escape(id)}"]`);
      if (next) next.classList.add('is-active');
    }
  };

  const setEditorBusy = (busy) => {
    editor.classList.toggle('is-loading', busy);
  };

  const rememberContent = (chapter) => {
    if (!chapter || chapter.id == null) return;
    const key = String(chapter.id);
    if (contentCache.has(key)) contentCache.delete(key);
    contentCache.set(key, chapter);
    while (contentCache.size > CONTENT_CACHE_MAX) {
      const oldest = contentCache.keys().next().value;
      contentCache.delete(oldest);
    }
  };

  const setEditMode = (chapter) => {
    form.action = `/admin/chapters/${encodeURIComponent(chapter.id)}`;
    numberInput.value = chapter.chapter_number;
    titleInput.value = chapter.title || '';
    // 大段正文分帧写入，减少主线程长任务卡顿
    contentInput.value = '';
    const body = chapter.content || '';
    if (body) {
      requestAnimationFrame(() => {
        if (activeChapterId === String(chapter.id)) {
          contentInput.value = body;
        }
      });
    }

    if (heading) heading.textContent = activeLabels.editorTitle;
    if (submitButton) submitButton.textContent = activeLabels.submit;

    ensureEditActions(chapter);
    ensureDeleteForm(chapter.id);
    setHidden(newChapterLink, false);
    setHidden(caption, true);
    setHidden(deleteButton, false);
    setHidden(viewLink, false);
    setActiveRow(chapter.id);
    activeChapterId = String(chapter.id);
  };

  const setCreateMode = () => {
    if (loadAbort) {
      loadAbort.abort();
      loadAbort = null;
    }
    inflightId = null;
    activeChapterId = null;
    form.action = '/admin/chapters';
    numberInput.value = nextNumber;
    titleInput.value = '';
    contentInput.value = '';

    if (heading) heading.textContent = createLabels.editorTitle;
    if (submitButton) submitButton.textContent = createLabels.submit;

    ensureNewChapterLink();
    ensureCaption();
    setHidden(newChapterLink, true);
    setHidden(caption, false);
    setHidden(deleteButton, true);
    setHidden(viewLink, true);
    setActiveRow(null);
  };

  const updateLocation = (chapterId) => {
    const url = new URL(window.location.href);
    url.searchParams.set('novel_id', novelId);
    if (chapterId) {
      url.searchParams.set('chapter_id', chapterId);
    } else {
      url.searchParams.delete('chapter_id');
    }
    url.hash = 'chapter-editor';
    // replaceState 避免连点产生一长串历史记录
    window.history.replaceState({ chapterId: chapterId || null }, '', url);
  };

  const removeChapterError = () => {
    const existing = editor.querySelector('[data-chapter-load-error]');
    if (existing) existing.remove();
  };

  const showChapterError = (chapterId, message) => {
    removeChapterError();
    const bar = document.createElement('div');
    bar.className = 'admin-alert admin-alert-error';
    bar.dataset.chapterLoadError = 'true';
    bar.style.marginBottom = '0.8rem';

    const text = document.createElement('span');
    text.textContent = `章节加载失败：${message}。`;
    bar.appendChild(text);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试';
    retry.style.marginLeft = '0.6rem';
    retry.addEventListener('click', () => {
      removeChapterError();
      loadChapter(chapterId, { skipHistory: true, force: true });
    });
    bar.appendChild(retry);

    const titleEl = editor.querySelector('.admin-section-title');
    if (titleEl && titleEl.nextElementSibling) {
      editor.insertBefore(bar, titleEl.nextElementSibling);
    } else {
      editor.prepend(bar);
    }
  };

  const loadChapter = async (chapterId, options = {}) => {
    const id = String(chapterId);
    if (!id) return;
    if (!options.force && (activeChapterId === id || inflightId === id)) return;

    // 先切高亮，立刻有反馈
    setActiveRow(id);
    removeChapterError();

    const cached = contentCache.get(id);
    if (cached && !options.force) {
      setEditMode(cached);
      if (!options.skipHistory) updateLocation(cached.id);
      return;
    }

    if (loadAbort) loadAbort.abort();
    loadAbort = new AbortController();
    inflightId = id;
    setEditorBusy(true);

    // 标题先显示，正文稍后再到
    const row = workspace.querySelector(`[data-chapter-row][data-chapter-id="${CSS.escape(id)}"]`);
    const titleEl = row && row.querySelector('.admin-chapter-title');
    const numberEl = row && row.querySelector('.admin-chapter-number');
    if (titleEl || numberEl) {
      form.action = `/admin/chapters/${encodeURIComponent(id)}`;
      if (numberEl) numberInput.value = numberEl.textContent.trim();
      if (titleEl) titleInput.value = titleEl.textContent.trim();
      contentInput.value = '加载中…';
      if (heading) heading.textContent = activeLabels.editorTitle;
      if (submitButton) submitButton.textContent = activeLabels.submit;
      ensureEditActions({ id, chapter_number: numberInput.value });
      ensureDeleteForm(id);
      setHidden(newChapterLink, false);
      setHidden(caption, true);
      setHidden(deleteButton, false);
      setHidden(viewLink, false);
    }

    try {
      const response = await fetch(
        `/admin/api/chapters/${encodeURIComponent(id)}?novel_id=${encodeURIComponent(novelId)}`,
        {
          headers: { Accept: 'application/json' },
          signal: loadAbort.signal,
          credentials: 'same-origin'
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (inflightId !== id) return;
      rememberContent(data.chapter);
      setEditMode(data.chapter);
      if (!options.skipHistory) updateLocation(data.chapter.id);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showChapterError(id, (err && err.message) || '网络错误');
    } finally {
      if (inflightId === id) {
        inflightId = null;
        setEditorBusy(false);
      }
    }
  };

  workspace.addEventListener('click', (event) => {
    const link = event.target.closest('.admin-chapter-link');
    if (!link || !workspace.contains(link)) return;

    const chapterId = link.dataset.chapterId;
    if (!chapterId) return;

    event.preventDefault();
    loadChapter(chapterId);
  });

  titleActions.addEventListener('click', (event) => {
    const link = event.target.closest('[data-new-chapter-link]');
    if (link) {
      event.preventDefault();
      setCreateMode();
      updateLocation(null);
    }
  });

  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const chapterId = params.get('chapter_id');
    if (chapterId) {
      loadChapter(chapterId, { skipHistory: true });
    } else {
      setCreateMode();
    }
  });

  // 带 chapter_id 进入时异步拉正文（首屏不再 SSR 整章 content）
  const bootId = workspace.dataset.selectedChapterId;
  if (bootId) {
    loadChapter(bootId, { skipHistory: true });
  }
})();

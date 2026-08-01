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

  const createLabels = {
    editorTitle: '新增章节',
    submit: '创建章节'
  };

  const activeLabels = {
    editorTitle: '章节管理',
    submit: '保存章节'
  };

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
    workspace.querySelectorAll('[data-chapter-row]').forEach((row) => {
      row.classList.toggle('is-active', row.dataset.chapterId === String(chapterId));
    });
  };

  const setEditorBusy = (busy) => {
    editor.classList.toggle('is-loading', busy);
    workspace.querySelectorAll('.admin-chapter-link').forEach((link) => {
      link.setAttribute('aria-disabled', busy ? 'true' : 'false');
    });
  };

  const setEditMode = (chapter) => {
    form.action = `/admin/chapters/${encodeURIComponent(chapter.id)}`;
    numberInput.value = chapter.chapter_number;
    titleInput.value = chapter.title || '';
    contentInput.value = chapter.content || '';

    if (heading) heading.textContent = activeLabels.editorTitle || '章节管理';
    if (submitButton) submitButton.textContent = activeLabels.submit || '保存章节';

    ensureEditActions(chapter);
    ensureDeleteForm(chapter.id);
    setHidden(newChapterLink, false);
    setHidden(caption, true);
    setHidden(deleteButton, false);
    setHidden(viewLink, false);
    setActiveRow(chapter.id);
  };

  const setCreateMode = () => {
    form.action = '/admin/chapters';
    numberInput.value = nextNumber;
    titleInput.value = '';
    contentInput.value = '';

    if (heading) heading.textContent = createLabels.editorTitle || '新增章节';
    if (submitButton) submitButton.textContent = createLabels.submit || '创建章节';

    ensureNewChapterLink();
    ensureCaption();
    setHidden(newChapterLink, true);
    setHidden(caption, false);
    setHidden(deleteButton, true);
    setHidden(viewLink, true);
    workspace.querySelectorAll('[data-chapter-row]').forEach((row) => row.classList.remove('is-active'));
  };

  const updateLocation = (chapterId) => {
    const url = new URL(window.location.href);
    url.searchParams.set('novel_id', novelId);
    url.searchParams.delete('chapter_page');
    url.searchParams.delete('page_size');
    if (chapterId) {
      url.searchParams.set('chapter_id', chapterId);
    } else {
      url.searchParams.delete('chapter_id');
    }
    url.hash = 'chapter-editor';
    window.history.pushState({ chapterId: chapterId || null }, '', url);
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
      loadChapter(chapterId, { skipHistory: true });
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
    setEditorBusy(true);
    removeChapterError();
    try {
      const response = await fetch(`/admin/api/chapters/${encodeURIComponent(chapterId)}?novel_id=${encodeURIComponent(novelId)}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      setEditMode(data.chapter);
      if (!options.skipHistory) updateLocation(data.chapter.id);
    } catch (err) {
      showChapterError(chapterId, err.message || '网络错误');
    } finally {
      setEditorBusy(false);
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
})();

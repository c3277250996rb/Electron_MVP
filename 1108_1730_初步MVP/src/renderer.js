const tabList = document.querySelector('#tab-list');
const addressInput = document.querySelector('#address-input');
const backButton = document.querySelector('#back-button');
const forwardButton = document.querySelector('#forward-button');
const reloadButton = document.querySelector('#reload-button');
const bookmarkButton = document.querySelector('#bookmark-button');
const bookmarksButton = document.querySelector('#bookmarks-button');
const historyButton = document.querySelector('#history-button');
const downloadsButton = document.querySelector('#downloads-button');
const errorOutput = document.querySelector('#tab-error');
const panel = document.querySelector('#browser-panel');
const panelTitle = document.querySelector('#panel-title');
const panelList = document.querySelector('#panel-list');
const clearHistoryButton = document.querySelector('#clear-history-button');
const tabApi = window.browserTabs;
const browserApi = window.browser;

let currentPanel = null;
let currentActiveTabId = null;
let currentAddressUrl = '';

function showError(error) {
  errorOutput.textContent = `操作失败：${error.message || String(error)}`;
  errorOutput.hidden = false;
}

function clearError() {
  errorOutput.textContent = '';
  errorOutput.hidden = true;
}

function runAction(action) {
  clearError();
  Promise.resolve().then(action).catch(showError);
}

function setActiveTab(tab) {
  if (!tab) {
    currentActiveTabId = null;
    currentAddressUrl = '';
    addressInput.value = '';
    backButton.disabled = true;
    forwardButton.disabled = true;
    reloadButton.disabled = true;
    bookmarkButton.disabled = true;
    bookmarkButton.setAttribute('aria-pressed', 'false');
    return;
  }

  if (
    currentActiveTabId !== tab.id ||
    currentAddressUrl !== tab.url ||
    document.activeElement !== addressInput
  ) {
    addressInput.value = tab.url;
  }
  currentActiveTabId = tab.id;
  currentAddressUrl = tab.url;
  backButton.disabled = !tab.canGoBack;
  forwardButton.disabled = !tab.canGoForward;
  reloadButton.disabled = !tab.url;
  bookmarkButton.disabled = !tab.url;
  bookmarkButton.setAttribute('aria-pressed', String(tab.isBookmarked));
  bookmarkButton.textContent = tab.isBookmarked ? '★' : '☆';
  bookmarkButton.setAttribute('aria-label', tab.isBookmarked ? '移除书签' : '添加书签');
  errorOutput.textContent = tab.error ? `页面错误：${tab.error}` : '';
  errorOutput.hidden = !tab.error;
}

function renderTabs(tabs) {
  tabList.replaceChildren();

  for (const tab of tabs) {
    const tabElement = document.createElement('div');
    tabElement.className = tab.active ? 'tab active' : 'tab';
    tabElement.setAttribute('role', 'tab');
    tabElement.setAttribute('aria-selected', String(tab.active));
    tabElement.title = tab.title;

    const indicator = document.createElement('span');
    indicator.className = 'tab-indicator';
    indicator.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = `${tab.loading ? '⟳ ' : ''}${tab.title}`;

    const closeButton = document.createElement('button');
    closeButton.className = 'tab-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', `关闭标签：${tab.title}`);
    closeButton.textContent = '×';
    closeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      runAction(() => tabApi.close(tab.id));
    });

    tabElement.append(indicator, title, closeButton);
    tabElement.addEventListener('click', () => {
      runAction(() => tabApi.activate(tab.id));
    });
    tabList.append(tabElement);
  }

  const newTabButton = document.createElement('button');
  newTabButton.className = 'new-tab';
  newTabButton.type = 'button';
  newTabButton.setAttribute('aria-label', '新建标签页');
  newTabButton.textContent = '+';
  newTabButton.addEventListener('click', () => {
    runAction(() => tabApi.create());
  });
  tabList.append(newTabButton);
  setActiveTab(tabs.find((tab) => tab.active));
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function createPanelEntry(entry, panelName) {
  const row = document.createElement('article');
  row.className = 'panel-entry';

  const details = document.createElement('div');
  details.className = 'entry-details';

  const title = document.createElement('span');
  title.className = 'entry-title';
  title.textContent = entry.title || entry.filename || entry.url;

  const subtitle = document.createElement('span');
  subtitle.className = 'entry-url';
  if (panelName === 'downloads') {
    const progress = entry.total > 0 ? ` · ${entry.progress}%` : '';
    subtitle.textContent = `${entry.stateLabel} · ${entry.filename}${progress}`;
  } else {
    subtitle.textContent = `${entry.url} · ${formatTime(panelName === 'history' ? entry.visitedAt : entry.createdAt)}`;
  }

  details.append(title, subtitle);
  row.append(details);

  if (panelName === 'downloads') {
    const openButton = document.createElement('button');
    openButton.className = 'entry-button';
    openButton.type = 'button';
    openButton.textContent = '显示位置';
    openButton.disabled = entry.state !== 'completed';
    openButton.addEventListener('click', () => {
      runAction(() => browserApi.openDownload(entry.id));
    });
    row.append(openButton);
    return row;
  }

  const openButton = document.createElement('button');
  openButton.className = 'entry-button';
  openButton.type = 'button';
  openButton.textContent = '打开';
  openButton.addEventListener('click', () => {
    runAction(async () => {
      await browserApi.setPanel(null);
      currentPanel = null;
      panel.hidden = true;
      await browserApi.navigate(entry.url);
    });
  });
  row.append(openButton);

  if (panelName === 'bookmarks') {
    const removeButton = document.createElement('button');
    removeButton.className = 'entry-button';
    removeButton.type = 'button';
    removeButton.textContent = '删除';
    removeButton.addEventListener('click', () => {
      runAction(() => browserApi.removeBookmark(entry.id));
    });
    row.append(removeButton);
  }

  return row;
}

async function refreshPanel() {
  if (!currentPanel) {
    return;
  }

  const panelAtStart = currentPanel;
  let entries;
  if (panelAtStart === 'bookmarks') {
    panelTitle.textContent = '书签';
    clearHistoryButton.hidden = true;
    entries = await browserApi.listBookmarks();
  } else if (panelAtStart === 'history') {
    panelTitle.textContent = '历史记录';
    clearHistoryButton.hidden = false;
    entries = await browserApi.listHistory();
  } else {
    panelTitle.textContent = '下载';
    clearHistoryButton.hidden = true;
    entries = await browserApi.listDownloads();
  }

  if (currentPanel !== panelAtStart) {
    return;
  }

  panelList.replaceChildren();
  if (entries.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'panel-empty';
    emptyMessage.textContent = panelAtStart === 'bookmarks'
      ? '还没有书签'
      : panelAtStart === 'history'
        ? '还没有浏览记录'
        : '当前没有下载记录';
    panelList.append(emptyMessage);
    return;
  }

  for (const entry of entries) {
    panelList.append(createPanelEntry(entry, panelAtStart));
  }
}

async function togglePanel(panelName) {
  clearError();
  const nextPanel = currentPanel === panelName ? null : panelName;
  try {
    await browserApi.setPanel(nextPanel);
    currentPanel = nextPanel;
    panel.hidden = !currentPanel;
    if (currentPanel) {
      await refreshPanel();
    }
  } catch (error) {
    showError(error);
  }
}

tabApi.onUpdate(renderTabs);
tabApi.onFocusAddress(() => {
  addressInput.focus();
  addressInput.select();
});
browserApi.onDataUpdate((section) => {
  if (currentPanel === section) {
    refreshPanel().catch(showError);
  }
});
tabApi.list().then(renderTabs).catch(showError);

document.querySelector('#address-form').addEventListener('submit', (event) => {
  event.preventDefault();
  runAction(() => browserApi.navigate(addressInput.value));
});
backButton.addEventListener('click', () => runAction(() => browserApi.back()));
forwardButton.addEventListener('click', () => runAction(() => browserApi.forward()));
reloadButton.addEventListener('click', () => runAction(() => browserApi.reload()));
bookmarkButton.addEventListener('click', () => runAction(() => browserApi.toggleBookmark()));
bookmarksButton.addEventListener('click', () => togglePanel('bookmarks'));
historyButton.addEventListener('click', () => togglePanel('history'));
downloadsButton.addEventListener('click', () => togglePanel('downloads'));
document.querySelector('#close-panel-button').addEventListener('click', () => togglePanel(currentPanel));
clearHistoryButton.addEventListener('click', () => runAction(() => browserApi.clearHistory()));
document.querySelector('#browser-panel').addEventListener('click', (event) => {
  if (event.target === panel) {
    togglePanel(currentPanel);
  }
});

bookmarkButton.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  togglePanel('bookmarks');
});

window.addEventListener('keydown', (event) => {
  const modifierPressed = window.desktop.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  if (!modifierPressed || event.altKey || event.repeat) {
    return;
  }

  let action;
  switch (event.key.toLowerCase()) {
    case 't':
      action = () => tabApi.create();
      break;
    case 'w':
      if (currentActiveTabId) {
        action = () => tabApi.close(currentActiveTabId);
      }
      break;
    case 'l':
      addressInput.focus();
      addressInput.select();
      break;
    case 'r':
      action = () => browserApi.reload();
      break;
    case 'arrowleft':
      action = () => browserApi.back();
      break;
    case 'arrowright':
      action = () => browserApi.forward();
      break;
    default:
      return;
  }

  event.preventDefault();
  if (action) {
    runAction(action);
  }
});

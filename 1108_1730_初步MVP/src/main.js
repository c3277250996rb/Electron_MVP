const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  WebContentsView,
} = require('electron');
const { MAX_HISTORY_ENTRIES, loadBrowserData, saveBrowserData } = require('./browser-data');
const { isWebUrl, normalizeAddress } = require('./browser-utils');

const CHROME_HEIGHT = 96;
const BROWSER_UI_PATH = path.join(__dirname, 'index.html');
const BROWSER_UI_URL = pathToFileURL(BROWSER_UI_PATH).href;
const NEW_TAB_PATH = path.join(__dirname, 'newtab.html');
const NEW_TAB_URL = pathToFileURL(NEW_TAB_PATH).href;
const DOWNLOAD_STATE_LABELS = {
  progressing: '下载中',
  completed: '已完成',
  cancelled: '已取消',
  interrupted: '失败',
};

let mainWindow;
let activeTabId = null;
let activePanel = null;
let browserDataPath;
let browserData = { version: 1, bookmarks: [], history: [] };
let persistenceQueue = Promise.resolve();
let waitingToQuitForPersistence = false;
const tabs = new Map();
const downloads = new Map();

function isAllowedPageUrl(rawUrl) {
  return isWebUrl(rawUrl);
}

function getTabState() {
  return [...tabs.values()].map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    active: tab.id === activeTabId,
    loading: tab.loading,
    error: tab.error,
    canGoBack: !tab.webContents.isDestroyed() && tab.webContents.navigationHistory.canGoBack(),
    canGoForward: !tab.webContents.isDestroyed() && tab.webContents.navigationHistory.canGoForward(),
    isBookmarked: browserData.bookmarks.some((bookmark) => bookmark.url === tab.url),
  }));
}

function sendTabState() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('browser-tabs:updated', getTabState());
  }
}

function sendDataUpdate(section) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('browser-data:updated', section);
  }
}

function persistBrowserData() {
  const snapshot = {
    version: 1,
    bookmarks: browserData.bookmarks.map((bookmark) => ({ ...bookmark })),
    history: browserData.history.map((entry) => ({ ...entry })),
  };
  const save = persistenceQueue.then(() => saveBrowserData(browserDataPath, snapshot));
  persistenceQueue = save.catch((error) => {
    console.error('Failed to persist browser data:', error);
  });
  return save;
}

function persistBrowserDataInBackground() {
  persistBrowserData().catch((error) => {
    const activeTab = tabs.get(activeTabId);
    if (activeTab) {
      activeTab.error = `Could not save browser data: ${error.message}`;
      sendTabState();
    }
  });
}

function layoutActiveTab() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const activeTab = tabs.get(activeTabId);
  if (!activeTab || activeTab.webContents.isDestroyed()) {
    return;
  }

  const { width, height } = mainWindow.getContentBounds();
  activeTab.view.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width,
    height: Math.max(0, height - CHROME_HEIGHT),
  });
  activeTab.view.setVisible(activePanel === null);
}

function updateTabState(tab) {
  if (tab && !tab.webContents.isDestroyed()) {
    sendTabState();
  }
}

function activateTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) {
    throw new Error('Cannot activate an unknown tab.');
  }

  const currentTab = tabs.get(activeTabId);
  if (currentTab && currentTab.id !== tabId && currentTab.attached) {
    mainWindow.contentView.removeChildView(currentTab.view);
    currentTab.attached = false;
  }

  if (!tab.attached) {
    mainWindow.contentView.addChildView(tab.view);
    tab.attached = true;
  }

  activeTabId = tabId;
  layoutActiveTab();
  sendTabState();
}

function recordVisit(tab, url) {
  if (!isWebUrl(url)) {
    return;
  }

  const entry = {
    id: randomUUID(),
    title: tab.title || url,
    url,
    visitedAt: Date.now(),
  };
  tab.url = url;
  tab.historyEntryId = entry.id;
  browserData.history.unshift(entry);
  browserData.history = browserData.history.slice(0, MAX_HISTORY_ENTRIES);
  persistBrowserDataInBackground();
  sendDataUpdate('history');
}

function setTabTitle(tab, title) {
  tab.title = title || tab.url || '新标签页';
  const historyEntry = browserData.history.find((entry) => entry.id === tab.historyEntryId);
  if (historyEntry && historyEntry.title !== tab.title) {
    historyEntry.title = tab.title;
    persistBrowserDataInBackground();
    sendDataUpdate('history');
  }
  updateTabState(tab);
}

function handleShortcut(event, input, sourceTabId) {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.alt) {
    return;
  }

  const modifierPressed = process.platform === 'darwin' ? input.meta : input.control;
  if (!modifierPressed) {
    return;
  }

  const key = input.key.toLowerCase();
  const tabId = sourceTabId || activeTabId;
  let handled = true;

  switch (key) {
    case 't':
      createTab();
      break;
    case 'w':
      if (tabId && tabs.has(tabId)) {
        closeTab(tabId);
      }
      break;
    case 'l':
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser-ui:focus-address');
      }
      break;
    case 'r': {
      const tab = tabs.get(tabId);
      if (tab && !tab.webContents.isDestroyed()) {
        tab.error = '';
        tab.webContents.reload();
      }
      break;
    }
    case 'arrowleft':
      navigateHistory(tabId, 'back');
      break;
    case 'arrowright':
      navigateHistory(tabId, 'forward');
      break;
    default:
      handled = false;
  }

  if (handled) {
    event.preventDefault();
  }
}

function attachTabHandlers(tab) {
  const { webContents } = tab;
  webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    setTabTitle(tab, title);
  });
  webContents.on('did-finish-load', () => {
    if (webContents.getURL() === NEW_TAB_URL) {
      tab.allowingInitialNewTabPage = false;
    }
  });
  webContents.on('did-start-loading', () => {
    tab.loading = true;
    updateTabState(tab);
  });
  webContents.on('did-stop-loading', () => {
    tab.loading = false;
    updateTabState(tab);
  });
  webContents.on('did-navigate', (event, url, responseCode) => {
    tab.url = isWebUrl(url) ? url : '';
    tab.error = '';
    if (isWebUrl(url) && (typeof responseCode !== 'number' || responseCode < 400)) {
      recordVisit(tab, url);
    }
    updateTabState(tab);
  });
  webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    tab.url = isWebUrl(url) ? url : '';
    if (isWebUrl(url)) {
      recordVisit(tab, url);
    }
    updateTabState(tab);
  });
  webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    tab.loading = false;
    tab.error = `${errorDescription} (${validatedURL})`;
    updateTabState(tab);
  });
  webContents.on('will-navigate', (event, url) => {
    if (
      !isAllowedPageUrl(url) &&
      !(tab.allowingInitialNewTabPage && url === NEW_TAB_URL)
    ) {
      event.preventDefault();
    }
  });
  webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && !isAllowedPageUrl(url)) {
      event.preventDefault();
    }
  });
  webContents.on('before-input-event', (event, input) => {
    handleShortcut(event, input, tab.id);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      createTab(url);
    }
    return { action: 'deny' };
  });
}

function createTab(targetUrl) {
  if (targetUrl && !isWebUrl(targetUrl)) {
    throw new Error('Only HTTP and HTTPS pages can be opened in a tab.');
  }

  const id = randomUUID();
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const tab = {
    id,
    title: '新标签页',
    url: '',
    loading: false,
    error: '',
    historyEntryId: null,
    allowingInitialNewTabPage: !targetUrl,
    view,
    webContents: view.webContents,
    attached: false,
  };

  tabs.set(id, tab);
  attachTabHandlers(tab);
  activateTab(id);

  const load = targetUrl
    ? tab.webContents.loadURL(targetUrl)
    : tab.webContents.loadFile(NEW_TAB_PATH);
  load.catch((error) => {
    if (!tab.webContents.isDestroyed()) {
      tab.loading = false;
      tab.error = error.message;
      updateTabState(tab);
    }
    console.error(`Failed to load tab ${id}:`, error);
  });

  return id;
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) {
    throw new Error('Cannot close an unknown tab.');
  }

  const wasActive = tabId === activeTabId;
  if (tab.attached && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(tab.view);
  }
  tabs.delete(tabId);
  tab.attached = false;
  if (!tab.webContents.isDestroyed()) {
    tab.webContents.close();
  }

  if (wasActive) {
    activeTabId = null;
    const fallbackTabId = [...tabs.keys()].at(-1);
    if (fallbackTabId) {
      activateTab(fallbackTabId);
      return;
    }
    createTab();
    return;
  }

  sendTabState();
}

function getActiveTab() {
  const tab = tabs.get(activeTabId);
  if (!tab || tab.webContents.isDestroyed()) {
    throw new Error('There is no active browser tab.');
  }
  return tab;
}

async function navigateActiveTab(input) {
  const tab = getActiveTab();
  const url = normalizeAddress(input);
  tab.allowingInitialNewTabPage = false;
  tab.error = '';
  tab.url = url;
  tab.loading = true;
  sendTabState();

  try {
    await tab.webContents.loadURL(url);
    if (!tab.webContents.isDestroyed()) {
      tab.webContents.focus();
    }
  } catch (error) {
    if (!tab.webContents.isDestroyed()) {
      tab.loading = false;
      tab.error = error.message;
      updateTabState(tab);
    }
    throw error;
  }
}

function navigateHistory(tabId, direction) {
  const tab = tabs.get(tabId);
  if (!tab || tab.webContents.isDestroyed()) {
    return;
  }

  if (direction === 'back' && tab.webContents.navigationHistory.canGoBack()) {
    tab.error = '';
    tab.webContents.navigationHistory.goBack();
  } else if (direction === 'forward' && tab.webContents.navigationHistory.canGoForward()) {
    tab.error = '';
    tab.webContents.navigationHistory.goForward();
  }
}

async function toggleBookmark() {
  const tab = getActiveTab();
  if (!isWebUrl(tab.url)) {
    throw new Error('Open an HTTP or HTTPS page before adding a bookmark.');
  }

  const existingIndex = browserData.bookmarks.findIndex((bookmark) => bookmark.url === tab.url);
  if (existingIndex >= 0) {
    browserData.bookmarks.splice(existingIndex, 1);
  } else {
    browserData.bookmarks.unshift({
      id: randomUUID(),
      title: tab.title || tab.url,
      url: tab.url,
      createdAt: Date.now(),
    });
  }

  await persistBrowserData();
  sendTabState();
  sendDataUpdate('bookmarks');
  return getTabState();
}

async function removeBookmark(bookmarkId) {
  const index = browserData.bookmarks.findIndex((bookmark) => bookmark.id === bookmarkId);
  if (index < 0) {
    throw new Error('Bookmark no longer exists.');
  }
  browserData.bookmarks.splice(index, 1);
  await persistBrowserData();
  sendTabState();
  sendDataUpdate('bookmarks');
}

async function clearHistory() {
  browserData.history = [];
  for (const tab of tabs.values()) {
    tab.historyEntryId = null;
  }
  await persistBrowserData();
  sendDataUpdate('history');
}

function listBookmarks() {
  return browserData.bookmarks
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt);
}

function listHistory() {
  return browserData.history.slice();
}

function listDownloads() {
  return [...downloads.values()].map(({ id, filename, url, state, received, total, startedAt }) => ({
    id,
    filename,
    url,
    state,
    stateLabel: DOWNLOAD_STATE_LABELS[state] || '未知状态',
    received,
    total,
    progress: total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : null,
    startedAt,
  }));
}

async function openDownload(downloadId) {
  const download = downloads.get(downloadId);
  if (!download || download.state !== 'completed' || !download.path) {
    throw new Error('This download is not complete or no longer available.');
  }
  await fs.access(download.path);
  shell.showItemInFolder(download.path);
}

function setActivePanel(panel) {
  if (![null, 'bookmarks', 'history', 'downloads'].includes(panel)) {
    throw new TypeError('Unknown browser panel.');
  }
  activePanel = panel;
  layoutActiveTab();
}

function assertTrustedBrowserUi(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Browser requests are only accepted from the local browser UI.');
  }
}

function registerIpcHandlers() {
  ipcMain.handle('browser-tabs:list', (event) => {
    assertTrustedBrowserUi(event);
    return getTabState();
  });
  ipcMain.handle('browser-tabs:create', (event) => {
    assertTrustedBrowserUi(event);
    return createTab();
  });
  ipcMain.handle('browser-tabs:activate', (event, tabId) => {
    assertTrustedBrowserUi(event);
    if (typeof tabId !== 'string') {
      throw new TypeError('Tab ID must be a string.');
    }
    activateTab(tabId);
  });
  ipcMain.handle('browser-tabs:close', (event, tabId) => {
    assertTrustedBrowserUi(event);
    if (typeof tabId !== 'string') {
      throw new TypeError('Tab ID must be a string.');
    }
    closeTab(tabId);
  });
  ipcMain.handle('browser:navigate', (event, input) => {
    assertTrustedBrowserUi(event);
    return navigateActiveTab(input);
  });
  ipcMain.handle('browser:back', (event) => {
    assertTrustedBrowserUi(event);
    navigateHistory(activeTabId, 'back');
  });
  ipcMain.handle('browser:forward', (event) => {
    assertTrustedBrowserUi(event);
    navigateHistory(activeTabId, 'forward');
  });
  ipcMain.handle('browser:reload', (event) => {
    assertTrustedBrowserUi(event);
    const tab = getActiveTab();
    tab.error = '';
    tab.webContents.reload();
  });
  ipcMain.handle('browser:bookmark:toggle', (event) => {
    assertTrustedBrowserUi(event);
    return toggleBookmark();
  });
  ipcMain.handle('browser:bookmarks:list', (event) => {
    assertTrustedBrowserUi(event);
    return listBookmarks();
  });
  ipcMain.handle('browser:bookmarks:remove', (event, bookmarkId) => {
    assertTrustedBrowserUi(event);
    if (typeof bookmarkId !== 'string') {
      throw new TypeError('Bookmark ID must be a string.');
    }
    return removeBookmark(bookmarkId);
  });
  ipcMain.handle('browser:history:list', (event) => {
    assertTrustedBrowserUi(event);
    return listHistory();
  });
  ipcMain.handle('browser:history:clear', (event) => {
    assertTrustedBrowserUi(event);
    return clearHistory();
  });
  ipcMain.handle('browser:downloads:list', (event) => {
    assertTrustedBrowserUi(event);
    return listDownloads();
  });
  ipcMain.handle('browser:downloads:open', (event, downloadId) => {
    assertTrustedBrowserUi(event);
    if (typeof downloadId !== 'string') {
      throw new TypeError('Download ID must be a string.');
    }
    return openDownload(downloadId);
  });
  ipcMain.handle('browser:panel:set', (event, panel) => {
    assertTrustedBrowserUi(event);
    setActivePanel(panel);
  });
}

function registerDownloadHandler() {
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const ownerTab = [...tabs.values()].find((tab) => tab.webContents === webContents);
    if (!ownerTab) {
      event.preventDefault();
      return;
    }

    const record = {
      id: randomUUID(),
      filename: item.getFilename(),
      url: item.getURL(),
      path: item.getSavePath(),
      state: 'progressing',
      received: item.getReceivedBytes(),
      total: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    downloads.set(record.id, record);
    sendDataUpdate('downloads');

    item.on('updated', (_event, state) => {
      record.filename = item.getFilename();
      record.path = item.getSavePath();
      record.state = state;
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      sendDataUpdate('downloads');
    });
    item.once('done', (_event, state) => {
      record.filename = item.getFilename();
      record.path = item.getSavePath();
      record.state = state;
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      sendDataUpdate('downloads');
    });
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    title: '轻量浏览器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== BROWSER_UI_URL) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (url !== BROWSER_UI_URL) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    handleShortcut(event, input);
  });

  mainWindow.on('resize', layoutActiveTab);
  mainWindow.on('closed', () => {
    for (const tab of tabs.values()) {
      if (!tab.webContents.isDestroyed()) {
        tab.webContents.close();
      }
    }
    tabs.clear();
    activeTabId = null;
    activePanel = null;
    mainWindow = null;
  });

  mainWindow.loadFile(BROWSER_UI_PATH).catch((error) => {
    console.error('Failed to load the browser UI:', error);
    app.exit(1);
  });

  createTab();
}

app.whenReady()
  .then(async () => {
    browserDataPath = path.join(app.getPath('userData'), 'browser-data.json');
    browserData = await loadBrowserData(browserDataPath);
    registerIpcHandlers();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerDownloadHandler();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch((error) => {
    console.error('Failed to initialize the browser:', error);
    app.exit(1);
  });

app.on('before-quit', (event) => {
  if (waitingToQuitForPersistence) {
    return;
  }
  event.preventDefault();
  waitingToQuitForPersistence = true;
  persistenceQueue.then(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

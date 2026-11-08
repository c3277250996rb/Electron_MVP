const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
});

contextBridge.exposeInMainWorld('browserTabs', {
  list: () => ipcRenderer.invoke('browser-tabs:list'),
  create: () => ipcRenderer.invoke('browser-tabs:create'),
  activate: (tabId) => ipcRenderer.invoke('browser-tabs:activate', tabId),
  close: (tabId) => ipcRenderer.invoke('browser-tabs:close', tabId),
  onUpdate: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Tab update listener must be a function.');
    }
    const listener = (_event, tabs) => callback(tabs);
    ipcRenderer.on('browser-tabs:updated', listener);
    return () => ipcRenderer.removeListener('browser-tabs:updated', listener);
  },
  onFocusAddress: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Address focus listener must be a function.');
    }
    const listener = () => callback();
    ipcRenderer.on('browser-ui:focus-address', listener);
    return () => ipcRenderer.removeListener('browser-ui:focus-address', listener);
  },
});

contextBridge.exposeInMainWorld('browser', {
  navigate: (input) => ipcRenderer.invoke('browser:navigate', input),
  back: () => ipcRenderer.invoke('browser:back'),
  forward: () => ipcRenderer.invoke('browser:forward'),
  reload: () => ipcRenderer.invoke('browser:reload'),
  toggleBookmark: () => ipcRenderer.invoke('browser:bookmark:toggle'),
  listBookmarks: () => ipcRenderer.invoke('browser:bookmarks:list'),
  removeBookmark: (bookmarkId) => ipcRenderer.invoke('browser:bookmarks:remove', bookmarkId),
  listHistory: () => ipcRenderer.invoke('browser:history:list'),
  clearHistory: () => ipcRenderer.invoke('browser:history:clear'),
  listDownloads: () => ipcRenderer.invoke('browser:downloads:list'),
  openDownload: (downloadId) => ipcRenderer.invoke('browser:downloads:open', downloadId),
  setPanel: (panel) => ipcRenderer.invoke('browser:panel:set', panel),
  onDataUpdate: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Browser data update listener must be a function.');
    }
    const listener = (_event, section) => callback(section);
    ipcRenderer.on('browser-data:updated', listener);
    return () => ipcRenderer.removeListener('browser-data:updated', listener);
  },
});

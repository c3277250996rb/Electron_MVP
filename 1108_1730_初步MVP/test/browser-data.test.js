const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_HISTORY_ENTRIES,
  loadBrowserData,
  saveBrowserData,
} = require('../src/browser-data');

test('loads empty data when no user data file exists', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'electron-browser-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  assert.deepEqual(await loadBrowserData(path.join(directory, 'browser-data.json')), {
    version: 1,
    bookmarks: [],
    history: [],
  });
});

test('persists bookmarks and history and caps history at 1000 entries', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'electron-browser-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'browser-data.json');
  const history = Array.from({ length: MAX_HISTORY_ENTRIES + 2 }, (_, index) => ({
    id: `history-${index}`,
    title: `Page ${index}`,
    url: `https://example.com/${index}`,
    visitedAt: index,
  }));
  const data = {
    version: 1,
    bookmarks: [{
      id: 'bookmark-1',
      title: 'Example',
      url: 'https://example.com/',
      createdAt: 1,
    }],
    history,
  };

  await saveBrowserData(filePath, data);
  const saved = await loadBrowserData(filePath);
  assert.deepEqual(saved.bookmarks, data.bookmarks);
  assert.equal(saved.history.length, MAX_HISTORY_ENTRIES);
  assert.equal(saved.history[0].id, history[0].id);
});

test('reports malformed persisted data instead of silently replacing it', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'electron-browser-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'browser-data.json');
  await fs.writeFile(filePath, '{invalid', 'utf8');

  await assert.rejects(loadBrowserData(filePath), /not valid JSON/);
});

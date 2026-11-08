const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_HISTORY_ENTRIES = 1000;

function createEmptyBrowserData() {
  return {
    version: 1,
    bookmarks: [],
    history: [],
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function validateRecord(record, kind) {
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.id !== 'string' ||
    !record.id ||
    typeof record.title !== 'string' ||
    !isHttpUrl(record.url)
  ) {
    throw new Error(`Browser data contains an invalid ${kind} record.`);
  }

  const timeField = kind === 'bookmark' ? 'createdAt' : 'visitedAt';
  if (!Number.isFinite(record[timeField])) {
    throw new Error(`Browser data contains an invalid ${kind} timestamp.`);
  }
}

function validateBrowserData(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    data.version !== 1 ||
    !Array.isArray(data.bookmarks) ||
    !Array.isArray(data.history)
  ) {
    throw new Error('Browser data file has an unsupported or invalid format.');
  }

  for (const bookmark of data.bookmarks) {
    validateRecord(bookmark, 'bookmark');
  }
  for (const entry of data.history) {
    validateRecord(entry, 'history');
  }
}

async function loadBrowserData(filePath) {
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return createEmptyBrowserData();
    }
    throw new Error(`Could not read browser data from ${filePath}.`, { cause: error });
  }

  let data;
  try {
    data = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Browser data file is not valid JSON: ${filePath}.`, { cause: error });
  }

  validateBrowserData(data);
  return {
    version: 1,
    bookmarks: data.bookmarks,
    history: data.history.slice(0, MAX_HISTORY_ENTRIES),
  };
}

async function saveBrowserData(filePath, data) {
  validateBrowserData(data);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const snapshot = {
    version: 1,
    bookmarks: data.bookmarks,
    history: data.history.slice(0, MAX_HISTORY_ENTRIES),
  };
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        console.error(`Could not remove temporary browser data file ${temporaryPath}:`, cleanupError);
      }
    }
    throw new Error(`Could not save browser data to ${filePath}.`, { cause: error });
  }
}

module.exports = {
  MAX_HISTORY_ENTRIES,
  createEmptyBrowserData,
  loadBrowserData,
  saveBrowserData,
};

const assert = require('node:assert/strict');
const test = require('node:test');
const { isWebUrl, normalizeAddress } = require('../src/browser-utils');

test('normalizes HTTP and HTTPS addresses', () => {
  assert.equal(normalizeAddress('https://example.com/path'), 'https://example.com/path');
  assert.equal(normalizeAddress('example.com'), 'https://example.com/');
  assert.equal(normalizeAddress('localhost:3000'), 'https://localhost:3000/');
  assert.equal(normalizeAddress('127.0.0.1:8080'), 'https://127.0.0.1:8080/');
});

test('converts plain text into a DuckDuckGo search', () => {
  assert.equal(
    normalizeAddress('electron browser'),
    'https://duckduckgo.com/?q=electron%20browser',
  );
  assert.equal(normalizeAddress('C++ is useful'), 'https://duckduckgo.com/?q=C%2B%2B%20is%20useful');
});

test('rejects unsupported URL schemes and credentialed addresses', () => {
  for (const value of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    'https://user:password@example.com',
    'https:example.com',
  ]) {
    assert.throws(() => normalizeAddress(value), /HTTP|HTTPS/i);
  }
});

test('validates web URLs without allowing credentials or other schemes', () => {
  assert.equal(isWebUrl('https://example.com'), true);
  assert.equal(isWebUrl('http://user@example.com'), false);
  assert.equal(isWebUrl('file:///tmp/page.html'), false);
});

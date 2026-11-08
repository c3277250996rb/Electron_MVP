const net = require('node:net');

const SEARCH_URL = 'https://duckduckgo.com/?q=';
const DISALLOWED_SCHEMES = /^(?:about|blob|chrome|data|devtools|file|ftp|javascript|mailto|view-source):/i;
const SCHEME_PREFIX = /^[a-z][a-z\d+.-]*:/i;
const HOST_AND_PORT = /^[^/?#\s]+:\d+(?:[/?#]|$)/;

function isWebUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '';
  } catch {
    return false;
  }
}

function normalizeAddress(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Address must be text.');
  }

  const value = input.trim();
  if (!value) {
    throw new Error('Enter a website address or search query.');
  }
  if (value.length > 2048) {
    throw new Error('Address or search query is too long.');
  }
  if (DISALLOWED_SCHEMES.test(value)) {
    throw new Error('Only HTTP and HTTPS pages are supported.');
  }
  if (/^https?:/i.test(value)) {
    if (!/^https?:\/\//i.test(value) || !isWebUrl(value)) {
      throw new Error('Enter a valid HTTP or HTTPS address.');
    }
    return new URL(value).href;
  }
  if (SCHEME_PREFIX.test(value) && !HOST_AND_PORT.test(value) && !/\s/.test(value)) {
    throw new Error('Only HTTP and HTTPS pages are supported.');
  }

  if (!/\s/.test(value)) {
    try {
      const url = new URL(`https://${value}`);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      if (
        url.username === '' &&
        url.password === '' &&
        (hostname === 'localhost' || hostname.includes('.') || net.isIP(hostname) !== 0)
      ) {
        return url.href;
      }
    } catch {
      // Non-address input is handled as a search query.
    }
  }

  return `${SEARCH_URL}${encodeURIComponent(value)}`;
}

module.exports = {
  isWebUrl,
  normalizeAddress,
};

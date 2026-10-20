export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function request(method, url, body, { timeout = 0 } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  // A time limit guarantees a request (e.g. a file upload) always ends with a result or a clear message.
  const controller = timeout ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  if (controller) opts.signal = controller.signal;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (error) {
    if (error && error.name === 'AbortError') throw new ApiError(0, 'This is taking too long. Check your internet connection and try again.');
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    let message = (data && data.error) || `Request failed (${res.status}).`;
    if (res.status === 413 && !(data && data.error)) message = 'This file is too large to upload. Choose a smaller file, or take a photo of the document instead.';
    const err = new ApiError(res.status, message, data && data.fields);
    if (res.status === 401 && api.onUnauthorized) api.onUnauthorized(err);
    throw err;
  }
  return data;
}

export const api = {
  onUnauthorized: null,
  get: (u, o) => request('GET', u, undefined, o),
  post: (u, b = {}, o) => request('POST', u, b, o),
  put: (u, b = {}, o) => request('PUT', u, b, o),
  del: (u, o) => request('DELETE', u, undefined, o),
};

export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

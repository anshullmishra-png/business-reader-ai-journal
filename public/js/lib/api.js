// fetch wrapper for the API. Throws an Error carrying the server's message.
// Sends the reader's timezone so "today" and streaks follow their clock.
import { busy } from './topbar.js';

export async function api(path, { method = 'GET', body, signal } = {}) {
  const done = method === 'GET' ? () => {} : busy();
  try {
    return await request(path, { method, body, signal });
  } finally {
    done();
  }
}

async function request(path, { method, body, signal }) {
  const headers = { 'X-TZ-Offset': String(new Date().getTimezoneOffset()) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    // Session expired mid-use: send them to sign in (but not from the auth calls themselves).
    if (res.status === 401 && data?.code === 'signed_out' && path !== '/me' && !location.pathname.startsWith('/sign')) {
      location.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
    }
    const err = new Error(data?.error ?? `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

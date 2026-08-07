// Thin HTTP client for the admin/quiz APIs.
const BASE = '/api';

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (basePin && !opts.noPin) headers['x-admin-pin'] = basePin;
  const res = await fetch(BASE + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

let basePin = null;
export const setAdminPin = (pin) => { basePin = pin; };

export const api = {
  listQuizzes: () => request('/quizzes'),
  createQuiz: (title) => request('/quizzes', { method: 'POST', body: JSON.stringify({ title }) }),
  getQuiz: (id) => request('/quizzes/' + id),
  saveQuiz: (quiz) => request('/quizzes/' + quiz.id, { method: 'PUT', body: JSON.stringify(quiz) }),
  deleteQuiz: (id) => request('/quizzes/' + id, { method: 'DELETE' }),
  createSession: (quizId) => request('/sessions', { method: 'POST', body: JSON.stringify({ quizId }) }),
  changePin: (currentPin, newPin) => request('/admin/pin', { method: 'POST', body: JSON.stringify({ currentPin, newPin }) }),
  health: () => fetch('/healthz').then((r) => r.json()),
};
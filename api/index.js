import app from '../server/index.js';

export default function handler(req, res) {
  const rewrittenUrl = new URL(req.url, 'http://localhost');
  const originalPath = rewrittenUrl.searchParams.get('__path') || '';
  rewrittenUrl.searchParams.delete('__path');
  const query = rewrittenUrl.searchParams.toString();

  req.url = `/${originalPath}${query ? `?${query}` : ''}`;
  return app(req, res);
}

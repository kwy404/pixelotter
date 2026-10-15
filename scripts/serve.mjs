// A small static server for docs/, mounted at /pixelotter/ like GitHub Pages.
// Usage: node scripts/serve.mjs [port]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../docs', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wasm': 'application/wasm',
  '.pxo': 'application/octet-stream',
};

export function startServer(port = 0) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '/pixelotter') {
      res.writeHead(302, { Location: '/pixelotter/' });
      return res.end();
    }
    if (!path.startsWith('/pixelotter/')) {
      res.writeHead(404);
      return res.end('Not found');
    }
    path = path.slice('/pixelotter'.length);
    let file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403);
      return res.end();
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      try {
        return createReadStream(join(root, '404.html')).pipe(res);
      } catch {
        return res.end('Not found');
      }
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const server = await startServer(Number(process.argv[2]) || 8080);
  console.log(`Serving docs at http://localhost:${server.address().port}/pixelotter/`);
}

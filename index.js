const fs = require('fs');
const path = require('path');
const apiHandler = require('./api/index');

// Ensure Vercel nft bundler traces these static assets
const _assetTrace = [
  path.join(__dirname, 'index.html'),
  path.join(__dirname, 'style.css'),
  path.join(__dirname, 'js', 'app.js'),
  path.join(__dirname, 'js', 'firebase-config.js'),
  path.join(__dirname, 'girl_drinking_shake.jpg'),
  path.join(__dirname, 'pouch_rose_milk.jpg')
];

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

module.exports = (req, res) => {
  const rawUrl = (req.headers && (req.headers['x-matched-path'] || req.headers['x-forwarded-uri'])) || req.url || '/';
  const reqPath = decodeURI(rawUrl.split('?')[0]);

  // Handle all API calls
  if (reqPath.startsWith('/api')) {
    return apiHandler(req, res);
  }

  // Handle Homepage
  if (reqPath === '/' || reqPath === '/index.html') {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(fs.readFileSync(indexPath));
      return;
    }
  }

  // Handle Static Files (CSS, JS, Frames, Images)
  const relativePath = reqPath.replace(/^\/+/, '');
  const filePath = path.join(__dirname, relativePath);

  if (fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.jpg' || ext === '.png' || ext === '.webp' 
            ? 'public, max-age=86400, immutable' 
            : 'public, max-age=3600'
        });
        res.end(fs.readFileSync(filePath));
        return;
      }
    } catch (e) {
      // Fall through to 404
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found: ' + reqPath);
};

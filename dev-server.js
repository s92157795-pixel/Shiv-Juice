const http = require('http');
const fs = require('fs');
const path = require('path');
const apiHandler = require('./api/index');
const orderSummaryService = require('./api/order-summary-service');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const FALLBACK_FRAMES_DIR = 'c:/Users/shiv/Downloads/ezgif-5175a26bed708a9b-jpg';
const SHOP_LOCATION = 'Shiv Juice Center, Sonia Vihar 3rd Pusta, Delhi - 110094';

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=UTF-8'
};

const requestHandler = (req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);

  // Route all /api/* requests to self-contained api/index handler
  if (reqPath.startsWith('/api/') || reqPath === '/api') {
    return apiHandler(req, res);
  }

  // CORS Headers for static assets
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Static File Serving
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(PUBLIC_DIR, reqPath);

  // Fallback to frames source folder if needed
  if (reqPath.startsWith('/frames/') && !fs.existsSync(filePath)) {
    const frameFileName = path.basename(reqPath);
    const altPath = path.join(FALLBACK_FRAMES_DIR, frameFileName);
    if (fs.existsSync(altPath)) {
      filePath = altPath;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqPath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Access-Control-Allow-Origin': '*'
    };

    if (ext === '.jpg' || ext === '.png' || ext === '.webp') {
      headers['Cache-Control'] = 'public, max-age=86400';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
};

const server = http.createServer(requestHandler);

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Local dev server running at http://localhost:${PORT}/`);
    console.log(`Shop: ${SHOP_LOCATION}`);
    console.log(`Batch notifications targeted for: kanhaiyapandat4@gmail.com (every 5-6 orders)`);
  });
}

module.exports = requestHandler;

const requestHandler = require('../server');

module.exports = (req, res) => {
  try {
    return requestHandler(req, res);
  } catch (err) {
    console.error('[SERVERLESS FUNCTION ERROR]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }));
    }
  }
};

// Configure Vercel serverless function to preserve raw streaming body for requestHandler
module.exports.config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

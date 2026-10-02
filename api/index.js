const requestHandler = require('../server');

module.exports = (req, res) => {
  return requestHandler(req, res);
};

// Configure Vercel serverless function to preserve raw streaming body for requestHandler
module.exports.config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'ok',
    message: 'Zero-config Vercel Serverless Function is working perfectly!',
    timestamp: new Date().toISOString()
  }));
};

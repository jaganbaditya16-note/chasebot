// Local dev server (zero deps): node server.js  ->  http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path'), api = require('./api/index.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res);
  const f = path.join(__dirname, 'public', req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('content-type', types[path.extname(f)] || 'text/plain'); fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log('ChaseBot on http://localhost:' + (process.env.PORT || 3000)));

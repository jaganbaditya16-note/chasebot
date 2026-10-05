const http=require('http'),fs=require('fs'),path=require('path'),api=require('./api/index-v3.js');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const routes={'/':'index-v3.html','/pay.html':'pay-v3.html'};
http.createServer((req,res)=>{
  if(req.url.startsWith('/api/'))return api(req,res);
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=routes[pathname]||pathname.replace(/^\//,'');
  const safe=path.join(__dirname,'public',file);
  if(!safe.startsWith(path.join(__dirname,'public'))||!fs.existsSync(safe)){res.statusCode=404;return res.end('Not found')}
  res.setHeader('content-type',types[path.extname(safe)]||'text/plain; charset=utf-8');
  fs.createReadStream(safe).pipe(res);
}).listen(process.env.PORT||3000,()=>console.log('ChaseBot on http://localhost:'+(process.env.PORT||3000)));

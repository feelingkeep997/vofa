// 内置静态服务器：桌面版用 http://127.0.0.1:<随机端口> 加载前端
// 比 file:// 稳：模块/CORS 都不闹脾气，而且 localhost 是安全上下文，Web Serial 才放行
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/**
 * @param {string} root 静态目录
 * @param {number} [port] 0 = 随机端口
 * @returns {Promise<{ port: number, close: () => void }>}
 */
function startStaticServer(root, port = 0) {
  const base = path.resolve(root)
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = '/'
      try {
        rel = decodeURIComponent((req.url || '/').split('?')[0])
      } catch {
        res.writeHead(400).end('bad request')
        return
      }
      if (rel.endsWith('/')) rel += 'index.html'
      const file = path.resolve(base, '.' + rel)
      // 防目录穿越：要带路径分隔符，否则 dist-xxx 这类同名前缀的兄弟目录会被放行
      if (file !== base && !file.startsWith(base + path.sep)) {
        res.writeHead(403).end('forbidden')
        return
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
          return
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        res.end(data)
      })
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => server.close(),
      })
    })
  })
}

module.exports = { startStaticServer }

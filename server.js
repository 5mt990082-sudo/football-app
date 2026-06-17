const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;  // 對齊 Railway 對外設定的 Port 3000

// ── 讀取 Anthropic API 金鑰 ──
// 優先用環境變數 ANTHROPIC_API_KEY；若沒有，改讀同資料夾的 anthropic-key.txt
function loadAnthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  try {
    const keyPath = path.join(__dirname, 'anthropic-key.txt');
    if (fs.existsSync(keyPath)) {
      const k = fs.readFileSync(keyPath, 'utf8').trim();
      if (k) return k;
    }
  } catch (e) { /* 忽略 */ }
  return '';
}
const ANTHROPIC_API_KEY = loadAnthropicKey();

// ── OddsPapi 盤口金鑰（從環境變數讀取）──
const ODDSPAPI_KEY = (process.env.ODDSPAPI_KEY || '').trim();

// ── CORS headers ──
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-apisports-key');
}

// ── HTTPS proxy helper ──
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── Serve HTML file ──
  if (pathname === '/' || pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── Proxy: API-Football（通用，可轉發任何端點）──
  // 前端呼叫 /api/football/fixtures?... 或 /api/football/fixtures/headtohead?...
  if (pathname.startsWith('/api/football/')) {
    const apiKey = req.headers['x-apisports-key'];
    const endpoint = pathname.replace('/api/football', ''); // 例如 /fixtures 或 /fixtures/headtohead
    const query = parsed.search || '';
    try {
      const result = await httpsRequest({
        hostname: 'v3.football.api-sports.io',
        path: endpoint + query,
        method: 'GET',
        headers: { 'x-apisports-key': apiKey }
      });
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Proxy: OddsPapi 盤口（金鑰由伺服器附加，前端看不到）──
  // 前端呼叫 /api/odds/odds-by-tournaments?bookmaker=pinnacle&tournamentIds=X
  if (pathname.startsWith('/api/odds/')) {
    if (!ODDSPAPI_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '伺服器未設定 ODDSPAPI_KEY 環境變數' }));
      return;
    }
    const endpoint = pathname.replace('/api/odds', ''); // 例如 /odds-by-tournaments
    const q = parsed.search || '';
    const sep = q ? '&' : '?';
    try {
      const result = await httpsRequest({
        hostname: 'api.oddspapi.io',
        path: '/v4' + endpoint + q + sep + 'apiKey=' + encodeURIComponent(ODDSPAPI_KEY),
        method: 'GET'
      });
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Proxy: Anthropic Claude ──
  if (pathname === '/api/claude') {
    if (!ANTHROPIC_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '伺服器未設定 ANTHROPIC_API_KEY 環境變數' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const result = await httpsRequest({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body)
          }
        }, body);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n✅ 足球 AI 預測伺服器已啟動！`);
  console.log(`🌐 請用瀏覽器開啟：http://localhost:${PORT}`);
  console.log(`🔑 Anthropic 金鑰：${ANTHROPIC_API_KEY ? '已設定 ✓' : '未設定 ✗（請設環境變數，或在同資料夾建立 anthropic-key.txt）'}`);
  console.log(`🎲 OddsPapi 金鑰：${ODDSPAPI_KEY ? '已設定 ✓' : '未設定 ✗（盤口自動偵測停用，可手動勾選）'}`);
  console.log(`\n按 Ctrl+C 停止伺服器\n`);
});

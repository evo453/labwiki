/**
 * LabWiki - 实验室知识库后端
 * 架构：优先 PostgreSQL（Railway 云部署），本地开发回退 JSON 文件
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DATABASE_URL = process.env.DATABASE_URL;

// ===== PostgreSQL 初始化 =====
let pool = null;
if (DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const isPg = !!pool;

async function initDb() {
  if (!isPg) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category_id TEXT,
        type TEXT DEFAULT 'article',
        summary TEXT,
        content TEXT,
        code_lang TEXT,
        link_url TEXT,
        file_name TEXT,
        file_data TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        children JSONB DEFAULT '[]'
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL
      )`);

    const r = await client.query(`SELECT * FROM settings WHERE key='site'`);
    if (r.rowCount === 0) {
      await client.query(`INSERT INTO settings (key, value) VALUES ('site', $1)`,
        [JSON.stringify({ siteName: '实验室知识库', adminUser: 'admin302', adminPass: '302302302' })]);
    }
  } finally {
    client.release();
  }
}

// ===== 工具函数 =====
function readLocal(file) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) {
    if (file === 'articles.json') return [];
    if (file === 'categories.json') return [];
    if (file === 'settings.json') return { siteName: '实验室知识库', adminUser: 'admin302', adminPass: '302302302' };
    return null;
  }
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeLocal(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// ===== 数据访问层（统一接口）=====
const db = {
  // 文章
  async getArticles() {
    if (isPg) {
      const res = await pool.query('SELECT * FROM articles ORDER BY created_at DESC');
      return res.rows.map(r => rowToArticle(r)));
    }
    return readLocal('articles.json') || [];
  },

  async getArticle(id) {
    if (isPg) {
      const res = await pool.query('SELECT * FROM articles WHERE id=$1', [id]);
      return res.rows[0] ? rowToArticle(res.rows[0]) : null;
    }
    const articles = readLocal('articles.json') || [];
    return articles.find(a => a.id === id) || null;
  },

  async createArticle(data) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const now = new Date().toISOString();
    const article = {
      id, title: data.title || '无标题', categoryId: data.categoryId || '',
      type: data.type || 'article', summary: data.summary || '', content: data.content || '',
      codeLang: data.codeLang || '', linkUrl: data.linkUrl || '',
      fileName: data.fileName || '', fileData: data.fileData || '',
      createdAt: now, updatedAt: now
    };
    if (isPg) {
      await pool.query(
        `INSERT INTO articles (id,title,category_id,type,summary,content,code_lang,link_url,file_name,file_data,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, article.title, article.categoryId, article.type, article.summary,
         article.content, article.codeLang, article.linkUrl, article.fileName,
         article.fileData, article.createdAt, article.updatedAt]
      );
    } else {
      const articles = readLocal('articles.json') || [];
      articles.push(article);
      writeLocal('articles.json', articles);
    }
    return article;
  },

  async updateArticle(id, data) {
    const now = new Date().toISOString();
    if (isPg) {
      const fields = [];
      const vals = [id];
      const map = { title:'title', categoryId:'category_id', type:'type', summary:'summary',
                    content:'content', codeLang:'code_lang', linkUrl:'link_url',
                    fileName:'file_name', fileData:'file_data' };
      let i = 2;
      for (const [k, col] of Object.entries(map)) {
        if (data[k] !== undefined) { fields.push(`${col}=$${i++}`); vals.push(data[k]); }
      }
      fields.push(`updated_at=$${i}`); vals.push(now);
      await pool.query(`UPDATE articles SET ${fields.join(',')} WHERE id=$1`, vals);
    } else {
      const articles = readLocal('articles.json') || [];
      const idx = articles.findIndex(a => a.id === id);
      if (idx !== -1) { Object.assign(articles[idx], data, { updatedAt: now }); writeLocal('articles.json', articles); }
    }
  },

  async deleteArticle(id) {
    if (isPg) await pool.query('DELETE FROM articles WHERE id=$1', [id]);
    else {
      let articles = readLocal('articles.json') || [];
      articles = articles.filter(a => a.id !== id);
      writeLocal('articles.json', articles);
    }
  },

  // 分类
  async getCategories() {
    if (isPg) {
      const res = await pool.query('SELECT * FROM categories ORDER BY name');
      return res.rows.map(r => ({ id: r.id, name: r.name, children: r.children || [] }));
    }
    return readLocal('categories.json') || [];
  },

  async createCategory(data) {
    const id = Date.now().toString(36);
    const cat = { id, name: data.name || '新分类', children: data.children || [] };
    if (isPg) await pool.query('INSERT INTO categories (id,name,children) VALUES ($1,$2,$3)', [id, cat.name, JSON.stringify(cat.children)]);
    else { const cats = readLocal('categories.json') || []; cats.push(cat); writeLocal('categories.json', cats); }
    return cat;
  },

  async updateCategory(id, data) {
    if (isPg) {
      const sets = [];
      const vals = [id];
      let i = 2;
      if (data.name !== undefined) { sets.push(`name=$${i++}`); vals.push(data.name); }
      if (data.children !== undefined) { sets.push(`children=$${i++}`); vals.push(JSON.stringify(data.children)); }
      await pool.query(`UPDATE categories SET ${sets.join(',')} WHERE id=$1`, vals);
    } else {
      const cats = readLocal('categories.json') || [];
      const idx = cats.findIndex(c => c.id === id);
      if (idx !== -1) { Object.assign(cats[idx], data); writeLocal('categories.json', cats); }
    }
  },

  async deleteCategory(id) {
    if (isPg) {
      await pool.query('DELETE FROM articles WHERE category_id=$1', [id]);
      await pool.query('DELETE FROM categories WHERE id=$1', [id]);
    } else {
      let cats = readLocal('categories.json') || [];
      cats = cats.filter(c => c.id !== id);
      writeLocal('categories.json', cats);
      let articles = readLocal('articles.json') || [];
      articles = articles.filter(a => a.categoryId !== id);
      writeLocal('articles.json', articles);
    }
  },

  // 设置
  async getSettings() {
    if (isPg) {
      const res = await pool.query(`SELECT value FROM settings WHERE key='site'`);
      return res.rows[0] ? res.rows[0].value : { siteName: '实验室知识库', adminUser: 'admin302', adminPass: '302302302' };
    }
    return readLocal('settings.json') || { siteName: '实验室知识库', adminUser: 'admin302', adminPass: '302302302' };
  },

  async setSettings(data) {
    if (isPg) {
      const current = await this.getSettings();
      const merged = { ...current, ...data };
      await pool.query(`UPDATE settings SET value=$1 WHERE key='site'`, [JSON.stringify(merged)]);
    } else {
      const s = readLocal('settings.json') || {};
      Object.assign(s, data);
      writeLocal('settings.json', s);
    }
  }
};

function rowToArticle(r) {
  return {
    id: r.id, title: r.title, categoryId: r.category_id, type: r.type,
    summary: r.summary, content: r.content, codeLang: r.code_lang,
    linkUrl: r.link_url, fileName: r.file_name, fileData: r.file_data,
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

// ===== HTTP 服务器 =====
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 静态文件
  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
                    '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
                    '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif',
                    '.svg':'image/svg+xml', '.ico':'image/x-icon' };
    try {
      if (fs.statSync(filePath).isDirectory()) filePath += '/index.html';
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    } catch { res.writeHead(404); res.end('Not Found'); }
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const body = (req.method !== 'GET' && req.method !== 'DELETE') ? await parseBody(req) : null;

    // 路由
    if (pathname === '/api/articles' && req.method === 'GET') {
      res.end(JSON.stringify(await db.getArticles()));
    }
    else if (pathname.match(/^\/api\/articles\/[^\/]+$/) && req.method === 'GET') {
      const article = await db.getArticle(pathname.split('/').pop());
      article ? res.end(JSON.stringify(article)) : res.writeHead(404).end('{}');
    }
    else if (pathname === '/api/articles' && req.method === 'POST') {
      const article = await db.createArticle(body);
      res.end(JSON.stringify({ success: true, article }));
    }
    else if (pathname.match(/^\/api\/articles\/[^\/]+$/) && req.method === 'PUT') {
      await db.updateArticle(pathname.split('/').pop(), body);
      res.end(JSON.stringify({ success: true }));
    }
    else if (pathname.match(/^\/api\/articles\/[^\/]+$/) && req.method === 'DELETE') {
      await db.deleteArticle(pathname.split('/').pop());
      res.end(JSON.stringify({ success: true }));
    }
    else if (pathname === '/api/categories' && req.method === 'GET') {
      res.end(JSON.stringify(await db.getCategories()));
    }
    else if (pathname === '/api/categories' && req.method === 'POST') {
      res.end(JSON.stringify({ success: true, category: await db.createCategory(body) }));
    }
    else if (pathname.match(/^\/api\/categories\/[^\/]+$/) && req.method === 'PUT') {
      await db.updateCategory(pathname.split('/').pop(), body);
      res.end(JSON.stringify({ success: true }));
    }
    else if (pathname.match(/^\/api\/categories\/[^\/]+$/) && req.method === 'DELETE') {
      await db.deleteCategory(pathname.split('/').pop());
      res.end(JSON.stringify({ success: true }));
    }
    else if (pathname === '/api/login' && req.method === 'POST') {
      const settings = await db.getSettings();
      body.password === settings.adminPass && body.username === settings.adminUser
        ? res.end(JSON.stringify({ success: true }))
        : res.end(JSON.stringify({ success: false, error: '用户名或密码错误' }));
    }
    else if (pathname === '/api/settings' && req.method === 'GET') {
      const s = await db.getSettings();
      delete s.adminPass;
      res.end(JSON.stringify(s));
    }
    else if (pathname === '/api/settings' && req.method === 'PUT') {
      await db.setSettings(body);
      res.end(JSON.stringify({ success: true }));
    }
    else {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    console.error('API error:', err);
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
});

// ===== 启动 =====
(async () => {
  if (isPg) { await initDb(); console.log('[DB] PostgreSQL connected'); }
  else { console.log('[DB] Using local JSON files'); }
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();

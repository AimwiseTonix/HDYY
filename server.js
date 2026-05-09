const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

[DATA_DIR, UPLOADS_DIR, PUBLIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const STORY_FILE = path.join(DATA_DIR, 'story.json');

if (!fs.existsSync(STORY_FILE)) {
  fs.writeFileSync(STORY_FILE, JSON.stringify({ startVideo: null, nodes: {} }, null, 2));
}

function loadStory() {
  return JSON.parse(fs.readFileSync(STORY_FILE, 'utf-8'));
}

function saveStory(data) {
  fs.writeFileSync(STORY_FILE, JSON.stringify(data, null, 2));
}

// Multer config
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + encodeURIComponent(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// ---------- Admin Auth ----------
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'hdyy2026';

function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="HDYY Admin"');
    return res.status(401).send('Unauthorized');
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="HDYY Admin"');
    return res.status(401).send('Unauthorized');
  }
  next();
}

// Protect admin routes
app.all('/admin.html', adminAuth);
app.all('/api/admin/*', adminAuth);

// Static files (after auth middleware for admin)
app.use(express.static(PUBLIC_DIR));

// ---------- Admin APIs ----------

app.post('/api/admin/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  res.json({ filename: req.file.filename, originalName: req.file.originalname });
});

app.get('/api/admin/videos', (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR).map(f => ({
    filename: f,
    path: `/uploads/${f}`,
    url: `/api/video/${f}`,
  }));
  res.json(files);
});

app.delete('/api/admin/videos/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    const story = loadStory();
    if (story.startVideo === req.params.filename) story.startVideo = null;
    delete story.nodes[req.params.filename];
    Object.values(story.nodes).forEach(node => {
      if (node.choices) {
        node.choices = node.choices.filter(c => c.nextVideo !== req.params.filename);
      }
    });
    saveStory(story);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Video not found' });
  }
});

app.get('/api/admin/story', (req, res) => res.json(loadStory()));

app.put('/api/admin/story', (req, res) => {
  const { startVideo, nodes } = req.body;
  const story = { startVideo, nodes: nodes || {} };
  saveStory(story);
  res.json({ success: true, story });
});

// ---------- Game API ----------

app.get('/api/story', (req, res) => res.json(loadStory()));

// ---------- Deploy Webhook ----------
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'hdyy_deploy_2026';
const PROJECT_DIR = __dirname;

app.post('/api/deploy', (req, res) => {
  const token = req.headers['x-webhook-token'] || req.query.token;
  if (token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const steps = [
    'git fetch origin master',
    'git reset --hard origin/master',
    'npm install --production',
    'pm2 restart hdyy',
  ];
  const cmd = steps.join(' && ');

  exec(cmd, { cwd: PROJECT_DIR, timeout: 120000 }, (err, stdout, stderr) => {
    res.json({
      success: !err,
      output: stdout.trim(),
      error: stderr ? stderr.trim() : null,
    });
  });
});

// ---------- HTTP server + WebSocket ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'play' && msg.filename) {
      const filePath = path.join(UPLOADS_DIR, msg.filename);
      if (!fs.existsSync(filePath)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Video not found' }));
        return;
      }

      const fileSize = fs.statSync(filePath).size;
      ws.send(JSON.stringify({ type: 'start', size: fileSize }));
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

      stream.on('data', (chunk) => {
        if (ws.readyState === 1) ws.send(chunk);
      });

      stream.on('end', () => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'done' }));
      });

      stream.on('error', () => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: 'Read error' }));
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`HDYY Interactive Film running at http://localhost:${PORT}`);
});

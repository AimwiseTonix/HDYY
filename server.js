const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
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
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

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

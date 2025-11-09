require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const bcrypt = require('bcrypt');
const db = require('./db');
const { exportParticipantsCSV } = require('./utils/csv');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({ secret: process.env.SESSION_SECRET || 'devsecret', resave: false, saveUninitialized: false, cookie: { secure: false } }));

const joinLimiter = rateLimit({ windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), max: parseInt(process.env.RATE_LIMIT_MAX || '5'), standardHeaders: true, legacyHeaders: false });

const ensureAdmin = (req, res, next) => { if (req.session && req.session.adminId) return next(); res.redirect('/admin/login'); };

// Landing page
app.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, title, description, start_at, end_at FROM giveaways WHERE end_at IS NULL OR end_at > ? ORDER BY start_at DESC').all(Date.now());
  res.render('index', { giveaways: rows, PUBLIC_URL: process.env.PUBLIC_URL });
});

// Giveaway page
app.get('/giveaway/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).send('Giveaway not found');
  const participants = db.prepare('SELECT * FROM participants WHERE giveaway_id = ? ORDER BY created_at DESC').all(g.id);
  const winners = db.prepare('SELECT w.*, p.name FROM winners w JOIN participants p ON w.participant_id = p.id WHERE w.giveaway_id = ?').all(g.id);
  res.render('giveaway', { g, participants, winners, now: Date.now() });
});

// Join giveaway
app.post('/giveaway/:id/join', joinLimiter, (req, res) => {
  const { name, contact, note } = req.body;
  const g = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).send('Giveaway not found');
  if (g.end_at && Date.now() > g.end_at) return res.status(400).send('Giveaway already ended');
  db.prepare('INSERT INTO participants (giveaway_id, name, contact, note, created_at) VALUES (?, ?, ?, ?, ?)').run(g.id, name, contact, note||'', Date.now());
  res.redirect(`/giveaway/${g.id}`);
});

// Admin routes
app.get('/admin/login', (req, res) => res.render('admin/login'));
app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  const row = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!row) return res.render('admin/login', { error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) return res.render('admin/login', { error: 'Invalid credentials' });
  req.session.adminId = row.id;
  res.redirect('/admin/dashboard');
});
app.get('/admin/logout', (req, res) => { req.session.destroy(()=>res.redirect('/')); });

app.get('/admin/dashboard', ensureAdmin, (req, res) => {
  const giveaways = db.prepare('SELECT * FROM giveaways ORDER BY created_at DESC').all();
  res.render('admin/dashboard', { giveaways });
});

// Create
app.get('/admin/giveaways/create', ensureAdmin, (req, res) => res.render('admin/create'));
app.post('/admin/giveaways/create', ensureAdmin, (req, res) => {
  const id = nanoid(10);
  const { title, description, start_at, end_at, max_winners } = req.body;
  const startTs = start_at ? Date.parse(start_at) : Date.now();
  const endTs = end_at ? Date.parse(end_at) : null;
  db.prepare('INSERT INTO giveaways (id, title, description, start_at, end_at, max_winners, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, title, description, startTs, endTs, parseInt(max_winners)||1, Date.now());
  res.redirect('/admin/dashboard');
});

// Edit
app.get('/admin/giveaways/:id/edit', ensureAdmin, (req, res) => {
  const g = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(req.params.id);
  if (!g) return res.redirect('/admin/dashboard');
  res.render('admin/edit', { g });
});
app.post('/admin/giveaways/:id/edit', ensureAdmin, (req, res) => {
  const { title, description, start_at, end_at, max_winners } = req.body;
  const startTs = start_at ? Date.parse(start_at) : Date.now();
  const endTs = end_at ? Date.parse(end_at) : null;
  db.prepare('UPDATE giveaways SET title=?, description=?, start_at=?, end_at=?, max_winners=? WHERE id=?')
    .run(title, description, startTs, endTs, parseInt(max_winners)||1, req.params.id);
  res.redirect('/admin/dashboard');
});

// Participants
app.get('/admin/giveaways/:id/participants', ensureAdmin, (req, res) => {
  const participants = db.prepare('SELECT * FROM participants WHERE giveaway_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.render('admin/participants', { participants, giveawayId: req.params.id });
});

// Export participants CSV
app.get('/admin/giveaways/:id/participants/export', ensureAdmin, (req, res) => {
  const participants = db.prepare('SELECT * FROM participants WHERE giveaway_id = ? ORDER BY created_at DESC').all(req.params.id);
  const csv = exportParticipantsCSV(participants);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="participants_${req.params.id}.csv"`);
  res.send(csv);
});

// Draw winners
app.post('/admin/giveaways/:id/draw', ensureAdmin, (req, res) => {
  const g = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(req.params.id);
  if (!g) return res.redirect('/admin/dashboard');
  const participants = db.prepare('SELECT * FROM participants WHERE giveaway_id = ?').all(g.id);
  if (!participants.length) return res.redirect(`/admin/giveaways/${g.id}/participants`);
  const winnersCount = Math.min(g.max_winners || 1, participants.length);
  let arr = participants.slice();
  for (let i = arr.length -1; i>0; i--) { const j = Math.floor(Math.random()*(i+1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  const winners = arr.slice(0, winnersCount);
  const insert = db.prepare('INSERT INTO winners (giveaway_id, participant_id, created_at) VALUES (?, ?, ?)');
  winners.forEach(w => insert.run(g.id, w.id, Date.now()));
  res.redirect(`/admin/giveaways/${g.id}/winners`);
});

app.get('/admin/giveaways/:id/winners', ensureAdmin, (req, res) => {
  const winners = db.prepare('SELECT w.*, p.name, p.contact FROM winners w JOIN participants p ON w.participant_id = p.id WHERE w.giveaway_id = ? ORDER BY w.created_at DESC').all(req.params.id);
  res.render('admin/winners', { winners, giveawayId: req.params.id });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));

require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const bcrypt = require('bcrypt');
const getDB = require('./db');
const { exportParticipantsCSV } = require('./utils/csv');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'devsecret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

const joinLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '5'),
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware: ensure admin session
const ensureAdmin = (req, res, next) => {
  if (req.session && req.session.adminId) return next();
  res.redirect('/admin/login');
};

// ✅ Utility wrapper to auto-inject async DB instance
function withDB(handler) {
  return async (req, res, next) => {
    try {
      req.db = await getDB();
      await handler(req, res, next);
    } catch (err) {
      console.error('DB error:', err);
      res.status(500).send('Internal Server Error');
    }
  };
}

// Landing page
app.get(
  '/',
  withDB(async (req, res) => {
    const rows = await req.db.all(
      `SELECT id, title, description, start_at, end_at FROM giveaways 
       WHERE end_at IS NULL OR end_at > ? ORDER BY start_at DESC`,
      Date.now()
    );
    res.render('index', { giveaways: rows, PUBLIC_URL: process.env.PUBLIC_URL });
  })
);

// Giveaway page
app.get(
  '/giveaway/:id',
  withDB(async (req, res) => {
    const g = await req.db.get('SELECT * FROM giveaways WHERE id = ?', req.params.id);
    if (!g) return res.status(404).send('Giveaway not found');
    const participants = await req.db.all(
      'SELECT * FROM participants WHERE giveaway_id = ? ORDER BY created_at DESC',
      g.id
    );
    const winners = await req.db.all(
      'SELECT w.*, p.name FROM winners w JOIN participants p ON w.participant_id = p.id WHERE w.giveaway_id = ?',
      g.id
    );
    res.render('giveaway', { g, participants, winners, now: Date.now() });
  })
);

// Join giveaway
app.post(
  '/giveaway/:id/join',
  joinLimiter,
  withDB(async (req, res) => {
    const { name, contact, note } = req.body;
    const g = await req.db.get('SELECT * FROM giveaways WHERE id = ?', req.params.id);
    if (!g) return res.status(404).send('Giveaway not found');
    if (g.end_at && Date.now() > g.end_at)
      return res.status(400).send('Giveaway already ended');

    await req.db.run(
      'INSERT INTO participants (giveaway_id, name, contact, note, created_at) VALUES (?, ?, ?, ?, ?)',
      g.id,
      name,
      contact,
      note || '',
      Date.now()
    );
    res.redirect(`/giveaway/${g.id}`);
  })
);

// ---------------- ADMIN ROUTES ----------------

// Login page
app.get('/admin/login', (req, res) => res.render('admin/login'));

// Login handler
app.post(
  '/admin/login',
  withDB(async (req, res) => {
    const { email, password } = req.body;
    const row = await req.db.get('SELECT * FROM admins WHERE email = ?', email);
    if (!row) return res.render('admin/login', { error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) return res.render('admin/login', { error: 'Invalid credentials' });
    req.session.adminId = row.id;
    res.redirect('/admin/dashboard');
  })
);

// Logout
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Dashboard
app.get(
  '/admin/dashboard',
  ensureAdmin,
  withDB(async (req, res) => {
    const giveaways = await req.db.all('SELECT * FROM giveaways ORDER BY created_at DESC');
    res.render('admin/dashboard', { giveaways });
  })
);

// Create giveaway
app.get('/admin/giveaways/create', ensureAdmin, (req, res) =>
  res.render('admin/create')
);
app.post(
  '/admin/giveaways/create',
  ensureAdmin,
  withDB(async (req, res) => {
    const id = nanoid(10);
    const { title, description, start_at, end_at, max_winners } = req.body;
    const startTs = start_at ? Date.parse(start_at) : Date.now();
    const endTs = end_at ? Date.parse(end_at) : null;

    await req.db.run(
      `INSERT INTO giveaways (id, title, description, start_at, end_at, max_winners, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      description,
      startTs,
      endTs,
      parseInt(max_winners) || 1,
      Date.now()
    );

    res.redirect('/admin/dashboard');
  })
);

// Edit giveaway
app.get(
  '/admin/giveaways/:id/edit',
  ensureAdmin,
  withDB(async (req, res) => {
    const g = await req.db.get('SELECT * FROM giveaways WHERE id = ?', req.params.id);
    if (!g) return res.redirect('/admin/dashboard');
    res.render('admin/edit', { g });
  })
);
app.post(
  '/admin/giveaways/:id/edit',
  ensureAdmin,
  withDB(async (req, res) => {
    const { title, description, start_at, end_at, max_winners } = req.body;
    const startTs = start_at ? Date.parse(start_at) : Date.now();
    const endTs = end_at ? Date.parse(end_at) : null;

    await req.db.run(
      `UPDATE giveaways 
       SET title=?, description=?, start_at=?, end_at=?, max_winners=? 
       WHERE id=?`,
      title,
      description,
      startTs,
      endTs,
      parseInt(max_winners) || 1,
      req.params.id
    );

    res.redirect('/admin/dashboard');
  })
);

// Participants
app.get(
  '/admin/giveaways/:id/participants',
  ensureAdmin,
  withDB(async (req, res) => {
    const participants = await req.db.all(
      'SELECT * FROM participants WHERE giveaway_id = ? ORDER BY created_at DESC',
      req.params.id
    );
    res.render('admin/participants', { participants, giveawayId: req.params.id });
  })
);

// Export participants
app.get(
  '/admin/giveaways/:id/participants/export',
  ensureAdmin,
  withDB(async (req, res) => {
    const participants = await req.db.all(
      'SELECT * FROM participants WHERE giveaway_id = ? ORDER BY created_at DESC',
      req.params.id
    );
    const csv = exportParticipantsCSV(participants);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="participants_${req.params.id}.csv"`
    );
    res.send(csv);
  })
);

// Draw winners
app.post(
  '/admin/giveaways/:id/draw',
  ensureAdmin,
  withDB(async (req, res) => {
    const g = await req.db.get('SELECT * FROM giveaways WHERE id = ?', req.params.id);
    if (!g) return res.redirect('/admin/dashboard');

    const participants = await req.db.all(
      'SELECT * FROM participants WHERE giveaway_id = ?',
      g.id
    );
    if (!participants.length)
      return res.redirect(`/admin/giveaways/${g.id}/participants`);

    const winnersCount = Math.min(g.max_winners || 1, participants.length);
    const shuffled = participants.sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, winnersCount);

    for (const w of winners) {
      await req.db.run(
        'INSERT INTO winners (giveaway_id, participant_id, created_at) VALUES (?, ?, ?)',
        g.id,
        w.id,
        Date.now()
      );
    }

    res.redirect(`/admin/giveaways/${g.id}/winners`);
  })
);

// Winners
app.get(
  '/admin/giveaways/:id/winners',
  ensureAdmin,
  withDB(async (req, res) => {
    const winners = await req.db.all(
      `SELECT w.*, p.name, p.contact 
       FROM winners w 
       JOIN participants p ON w.participant_id = p.id 
       WHERE w.giveaway_id = ? 
       ORDER BY w.created_at DESC`,
      req.params.id
    );
    res.render('admin/winners', { winners, giveawayId: req.params.id });
  })
);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));

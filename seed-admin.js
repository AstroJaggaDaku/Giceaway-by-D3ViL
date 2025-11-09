require('dotenv').config();
const db = require('./db');
const bcrypt = require('bcrypt');
(async ()=>{
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const pwd = process.env.ADMIN_PASSWORD || 'changeme';
  const hash = await bcrypt.hash(pwd, 10);
  try { db.prepare('INSERT OR IGNORE INTO admins (email, password_hash) VALUES (?, ?)').run(email, hash); console.log('Admin seeded:', email); } catch(e){ console.error(e); }
  process.exit(0);
})();

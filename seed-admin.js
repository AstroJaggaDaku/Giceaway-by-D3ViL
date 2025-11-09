require('dotenv').config();
const bcrypt = require('bcrypt');
const getDB = require('./db');

(async () => {
  try {
    const db = await getDB();

    const email = process.env.ADMIN_EMAIL || 'admin@example.com';
    const pwd = process.env.ADMIN_PASSWORD || 'changeme';
    const hash = await bcrypt.hash(pwd, 10);

    await db.run(
      'INSERT OR IGNORE INTO admins (email, password_hash) VALUES (?, ?)',
      [email, hash]
    );

    console.log('✅ Admin seeded successfully:', email);
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
  } finally {
    process.exit(0);
  }
})();

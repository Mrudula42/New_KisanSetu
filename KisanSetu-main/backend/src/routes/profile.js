import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT user_id, full_name, phone, village, district, preferred_language, created_at
       FROM farmer_profiles
       WHERE user_id = ?`,
      [req.user.id]
    );
    return res.json({
      profile: rows[0] || null,
      account: { email: req.user.email, name: req.user.name },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const village = typeof body.village === 'string' ? body.village.trim() : '';
  const district = typeof body.district === 'string' ? body.district.trim() : '';
  const language = ['en', 'hi', 'mr'].includes(body.preferred_language)
    ? body.preferred_language
    : 'en';

  if (fullName.length < 2 || fullName.length > 100) {
    return res.status(422).json({ error: 'Enter your full name (2–100 characters).' });
  }
  if (phone && !/^[+0-9 ()-]{7,20}$/.test(phone)) {
    return res.status(422).json({ error: 'Enter a valid phone number.' });
  }
  if (village.length > 120 || district.length > 120) {
    return res.status(422).json({ error: 'Village and district must be 120 characters or fewer.' });
  }

  try {
    await pool.execute(
      `INSERT INTO farmer_profiles
         (user_id, full_name, phone, village, district, preferred_language)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         phone = VALUES(phone),
         village = VALUES(village),
         district = VALUES(district),
         preferred_language = VALUES(preferred_language)`,
      [req.user.id, fullName, phone, village, district, language]
    );
    const [rows] = await pool.execute(
      `SELECT user_id, full_name, phone, village, district, preferred_language, created_at
       FROM farmer_profiles
       WHERE user_id = ?`,
      [req.user.id]
    );
    return res.json({ profile: rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, booking_id, title, message, category, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    return res.json({ notifications: rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/', async (req, res, next) => {
  const id = Number(req.body?.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(422).json({ error: 'Choose a valid notification.' });
  }
  try {
    const [result] = await pool.execute(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!result.affectedRows) {
      const [rows] = await pool.execute(
        'SELECT id, is_read FROM notifications WHERE id = ? AND user_id = ?',
        [id, req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Notification not found.' });
      return res.json({ notification: rows[0] });
    }
    return res.json({ notification: { id, is_read: true } });
  } catch (error) {
    return next(error);
  }
});

export default router;

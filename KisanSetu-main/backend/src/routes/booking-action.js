import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

function indiaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

router.post('/', async (req, res, next) => {
  const id = Number(req.body?.booking_id);
  const action = typeof req.body?.action === 'string' ? req.body.action.toUpperCase() : '';
  if (!Number.isSafeInteger(id) || id < 1 || !['CHECK_IN', 'CANCEL'].includes(action)) {
    return res.status(422).json({ error: 'Choose a valid booking action.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, token, status, procurement_date
       FROM bookings
       WHERE id = ? AND user_id = ?
       FOR UPDATE`,
      [id, req.user.id]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Booking not found.' });
    }
    const booking = rows[0];
    if (action === 'CHECK_IN') {
      if (String(booking.procurement_date).slice(0, 10) !== indiaDate()) {
        await connection.rollback();
        return res.status(409).json({ error: 'Check-in is available on your booking date.' });
      }
      if (!['BOOKED', 'WAITING'].includes(booking.status)) {
        await connection.rollback();
        return res.status(409).json({ error: 'This booking cannot be checked in from its current status.' });
      }
      const [result] = await connection.execute(
        `UPDATE bookings
         SET status = 'CHECKED_IN', checked_in_at = COALESCE(checked_in_at, UTC_TIMESTAMP(3))
         WHERE id = ? AND user_id = ? AND status IN ('BOOKED', 'WAITING')`,
        [id, req.user.id]
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(409).json({ error: 'The booking has already changed. Refresh your list.' });
      }
    } else {
      if (booking.status !== 'BOOKED') {
        await connection.rollback();
        return res.status(409).json({ error: 'Only a booking that has not checked in can be cancelled.' });
      }
      const [result] = await connection.execute(
        `UPDATE bookings
         SET status = 'CANCELLED'
         WHERE id = ? AND user_id = ? AND status = 'BOOKED'`,
        [id, req.user.id]
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(409).json({ error: 'The booking has already changed. Refresh your list.' });
      }
    }

    await connection.execute(
      `INSERT INTO booking_events (booking_id, actor_id, event_type, details)
       VALUES (?, ?, ?, ?)`,
      [id, req.user.id, action, action === 'CHECK_IN' ? 'Farmer checked in' : 'Farmer cancelled booking']
    );
    await connection.commit();
    return res.json({
      ok: true,
      message: action === 'CHECK_IN' ? 'Check-in complete. You are in the queue.' : 'Booking cancelled.',
      token: booking.token,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    connection?.release();
  }
});

export default router;

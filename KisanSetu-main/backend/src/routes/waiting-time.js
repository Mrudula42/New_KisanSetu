import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

router.get('/', async (req, res, next) => {
  const id = Number(req.query.booking_id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(422).json({ error: 'A valid booking is required.' });
  }
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.quantity_kg, b.status, b.procurement_date, b.centre_id,
              b.slot_start, b.is_emergency, b.created_at,
              c.emergency_priority_enabled,
              (SELECT COUNT(*)
               FROM bookings q
               WHERE q.centre_id = b.centre_id
                 AND q.procurement_date = b.procurement_date
                 AND q.status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
                 AND (
                   (c.emergency_priority_enabled AND q.is_emergency)
                     > (c.emergency_priority_enabled AND b.is_emergency)
                   OR (
                     (c.emergency_priority_enabled AND q.is_emergency)
                       = (c.emergency_priority_enabled AND b.is_emergency)
                     AND (
                       q.slot_start < b.slot_start
                       OR (q.slot_start = b.slot_start AND q.created_at < b.created_at)
                     )
                   )
                 )
              ) AS people_ahead,
              (SELECT COUNT(*)
               FROM bookings q
               WHERE q.centre_id = b.centre_id
                 AND q.procurement_date = b.procurement_date
                 AND q.status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
              ) AS queue_length
       FROM bookings b
       JOIN procurement_centres c ON c.id = b.centre_id
       WHERE b.id = ? AND b.user_id = ?
       LIMIT 1`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found.' });
    const booking = rows[0];
    const ahead = Number(booking.people_ahead || 0);
    let minutes = Math.max(
      0,
      Math.round(ahead * 12 + Number(booking.quantity_kg || 0) / 250 * 4)
    );
    let method = 'Fallback estimate based on queue position, 12-minute average processing time, and produce quantity.';
    const configuredUrl = process.env.AI_SERVICE_URL?.trim();
    if (configuredUrl) {
      try {
        const baseUrl = new URL(configuredUrl);
        const response = await fetch(new URL('/predict-wait', baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            people_ahead: ahead,
            queue_length: Number(booking.queue_length || 0),
            quantity_kg: Number(booking.quantity_kg || 0),
            status: booking.status,
            procurement_date: booking.procurement_date,
            slot_start: booking.slot_start,
            centre_id: booking.centre_id,
          }),
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const prediction = await response.json();
          const suggested = Number(prediction.estimated_wait_minutes);
          if (Number.isFinite(suggested) && suggested >= 0 && suggested <= 1440) {
            minutes = Math.round(suggested);
            method = 'Configured external AI service';
          }
        }
      } catch (error) {
        console.warn('Optional wait-time service unavailable:', error.message);
      }
    }
    return res.json({
      booking_id: booking.id,
      estimated_wait_minutes: minutes,
      people_ahead: ahead,
      queue_length: Number(booking.queue_length || 0),
      method,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

const QUEUE_STATUSES = ['BOOKED', 'CHECKED_IN', 'WAITING', 'IN_PROGRESS', 'QUALITY_TESTING', 'PROCUREMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const QUALITY_STATUSES = ['PENDING', 'TESTING', 'PASSED', 'REJECTED'];
const PROCUREMENT_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];
const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED'];

router.get('/', async (_req, res, next) => {
  try {
    const [[metrics]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM farmer_profiles) AS total_farmers,
         (SELECT COUNT(*) FROM bookings
          WHERE procurement_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
            AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')) AS todays_bookings,
         (SELECT COUNT(*) FROM bookings
          WHERE status IN ('CHECKED_IN', 'WAITING', 'IN_PROGRESS', 'QUALITY_TESTING', 'PROCUREMENT')) AS active_queue,
         (SELECT COUNT(*) FROM bookings
          WHERE status = 'COMPLETED'
            AND procurement_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))) AS completed_today,
         (SELECT COUNT(*) FROM bookings
          WHERE payment_status IN ('PENDING', 'PROCESSING') AND status = 'COMPLETED') AS pending_payments,
         (SELECT COUNT(*) FROM bookings
          WHERE is_emergency = TRUE
            AND procurement_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
            AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')) AS emergency_bookings,
         (SELECT COUNT(*) FROM procurement_centres WHERE is_active = TRUE) AS active_centres,
         COALESCE(ROUND(
           100.0 * (
             SELECT COUNT(*) FROM bookings
             WHERE procurement_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
               AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
           ) / NULLIF((SELECT SUM(max_farmers_day) FROM procurement_centres WHERE is_active = TRUE), 0)
         ), 0) AS centre_utilization`
    );
    const [bookings] = await pool.query(
      `SELECT b.id, b.token, b.user_id, b.procurement_date, b.slot_start, b.slot_end,
              b.quantity, b.unit, b.quantity_kg, b.is_emergency, b.status,
              b.quality_status, b.quality_grade, b.quality_remarks,
              b.procurement_status, b.procurement_remarks, b.payment_status,
              b.payment_amount, b.payment_reference, b.payment_remarks, b.created_at,
              COALESCE(f.full_name, 'Farmer account') AS farmer_name,
              COALESCE(f.phone, '') AS farmer_phone,
              p.crop_name, c.name AS centre_name
       FROM bookings b
       JOIN farmer_produce p ON p.id = b.produce_id
       JOIN procurement_centres c ON c.id = b.centre_id
       LEFT JOIN farmer_profiles f ON f.user_id = b.user_id
       ORDER BY b.procurement_date,
                (c.emergency_priority_enabled AND b.is_emergency) DESC,
                b.slot_start, b.created_at ASC
       LIMIT 200`
    );
    const [centres] = await pool.query(
      `SELECT id, name, location, operating_days, opening_time, closing_time,
              slot_duration_minutes, max_farmers_day, max_quantity_kg_day,
              max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg,
              emergency_max_farmers_day, is_active, emergency_priority_enabled
       FROM procurement_centres
       ORDER BY name`
    );
    const [trend] = await pool.query(
      `SELECT procurement_date,
              COUNT(*) AS bookings,
              SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN is_emergency = TRUE THEN 1 ELSE 0 END) AS emergency
       FROM bookings
       WHERE procurement_date >= DATE_SUB(
         DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')),
         INTERVAL 6 DAY
       )
       GROUP BY procurement_date
       ORDER BY procurement_date`
    );
    return res.json({ metrics, bookings, centres, trend });
  } catch (error) {
    return next(error);
  }
});

router.patch('/', async (req, res, next) => {
  const body = req.body || {};
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(422).json({ error: 'Select a valid booking.' });
  }

  const status = body.status == null ? null : String(body.status).toUpperCase();
  const quality = body.quality_status == null ? null : String(body.quality_status).toUpperCase();
  const procurement = body.procurement_status == null ? null : String(body.procurement_status).toUpperCase();
  const payment = body.payment_status == null ? null : String(body.payment_status).toUpperCase();
  if (status && !QUEUE_STATUSES.includes(status)) return res.status(422).json({ error: 'Invalid queue status.' });
  if (quality && !QUALITY_STATUSES.includes(quality)) return res.status(422).json({ error: 'Invalid quality status.' });
  if (procurement && !PROCUREMENT_STATUSES.includes(procurement)) return res.status(422).json({ error: 'Invalid procurement status.' });
  if (payment && !PAYMENT_STATUSES.includes(payment)) return res.status(422).json({ error: 'Invalid payment status.' });
  if (!status && !quality && !procurement && !payment
    && body.quality_grade === undefined && body.quality_remarks === undefined
    && body.procurement_remarks === undefined && body.payment_amount === undefined
    && body.payment_reference === undefined && body.payment_remarks === undefined) {
    return res.status(422).json({ error: 'Choose at least one booking field to update.' });
  }

  const amount = body.payment_amount == null || body.payment_amount === ''
    ? null
    : Number(body.payment_amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000_000)) {
    return res.status(422).json({ error: 'Payment amount must be zero or more.' });
  }
  const grade = typeof body.quality_grade === 'string' ? body.quality_grade.trim().slice(0, 40) : null;
  const qualityRemarks = typeof body.quality_remarks === 'string' ? body.quality_remarks.trim().slice(0, 500) : null;
  const procurementRemarks = typeof body.procurement_remarks === 'string' ? body.procurement_remarks.trim().slice(0, 500) : null;
  const paymentReference = typeof body.payment_reference === 'string' ? body.payment_reference.trim().slice(0, 120) : null;
  const paymentRemarks = typeof body.payment_remarks === 'string' ? body.payment_remarks.trim().slice(0, 500) : null;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [currentRows] = await connection.execute(
      `SELECT id, user_id, centre_id, procurement_date, token
       FROM bookings
       WHERE id = ?
       FOR UPDATE`,
      [id]
    );
    if (!currentRows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Booking not found.' });
    }
    await connection.execute(
      `UPDATE bookings SET
         status = COALESCE(?, status),
         quality_status = COALESCE(?, quality_status),
         quality_grade = COALESCE(?, quality_grade),
         quality_remarks = COALESCE(?, quality_remarks),
         quality_tested_at = CASE
           WHEN ? IN ('PASSED', 'REJECTED') THEN COALESCE(quality_tested_at, UTC_TIMESTAMP(3))
           ELSE quality_tested_at
         END,
         procurement_status = COALESCE(?, procurement_status),
         procurement_remarks = COALESCE(?, procurement_remarks),
         payment_status = COALESCE(?, payment_status),
         payment_amount = COALESCE(?, payment_amount),
         payment_reference = COALESCE(?, payment_reference),
         payment_remarks = COALESCE(?, payment_remarks),
         payment_date = CASE
           WHEN ? = 'PAID' THEN COALESCE(payment_date, UTC_TIMESTAMP(3))
           ELSE payment_date
         END,
         checked_in_at = CASE
           WHEN ? = 'CHECKED_IN' THEN COALESCE(checked_in_at, UTC_TIMESTAMP(3))
           ELSE checked_in_at
         END
       WHERE id = ?`,
      [
        status, quality, grade, qualityRemarks, quality,
        procurement, procurementRemarks, payment, amount, paymentReference,
        paymentRemarks, payment, status, id,
      ]
    );
    const [updatedRows] = await connection.execute(
      `SELECT id, user_id, centre_id, procurement_date, token, status,
              quality_status, procurement_status, payment_status
       FROM bookings
       WHERE id = ?`,
      [id]
    );
    const booking = updatedRows[0];
    const changed = status || quality || procurement || payment || 'UPDATED';
    await connection.execute(
      `INSERT INTO booking_events (booking_id, actor_id, event_type, details)
       VALUES (?, ?, ?, 'Updated by procurement administrator')`,
      [id, req.user.id, changed]
    );
    const changeDescription = status
      ? `queue ${status.toLowerCase()}`
      : quality
        ? `quality ${quality.toLowerCase()}`
        : procurement
          ? `procurement ${procurement.toLowerCase()}`
          : payment
            ? `payment ${payment.toLowerCase()}`
            : 'booking details changed';
    const category = status === 'CANCELLED' || quality === 'REJECTED' || payment === 'FAILED'
      ? 'urgent'
      : 'info';
    await connection.execute(
      `INSERT INTO notifications (user_id, booking_id, title, message, category)
       VALUES (?, ?, 'KisanSetu booking update', ?, ?)`,
      [
        booking.user_id,
        id,
        `Token ${booking.token} update: ${changeDescription}.`,
        category,
      ]
    );
    await connection.commit();
    return res.json({ booking, message: 'Booking information updated.' });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    connection?.release();
  }
});

export default router;

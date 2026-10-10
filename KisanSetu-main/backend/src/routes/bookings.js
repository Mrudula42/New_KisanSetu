import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];
const CAPACITY_EXCLUDED_STATUSES = ['CANCELLED', 'NO_SHOW'];

function minutesOf(value) {
  const match = String(value).slice(0, 5).match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function timeOf(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function indiaDateAndMinute(now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now).split(':').map(Number);
  return { date, minute: parts[0] * 60 + parts[1] };
}

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT b.id, b.token, b.centre_id, b.procurement_date, b.slot_start, b.slot_end,
              b.quantity, b.unit, b.quantity_kg, b.is_emergency, b.status,
              b.quality_status, b.quality_grade, b.quality_remarks, b.quality_tested_at,
              b.procurement_status, b.procurement_remarks, b.payment_status,
              b.payment_amount, b.payment_reference, b.payment_remarks,
              b.payment_date, b.checked_in_at, b.created_at,
              c.name AS centre_name, c.location AS centre_location,
              c.emergency_priority_enabled, p.crop_name,
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
              (SELECT q.token
               FROM bookings q
               WHERE q.centre_id = b.centre_id
                 AND q.procurement_date = b.procurement_date
                 AND q.status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
               ORDER BY (c.emergency_priority_enabled AND q.is_emergency) DESC,
                        q.slot_start, q.created_at
               LIMIT 1
              ) AS current_token
       FROM bookings b
       JOIN procurement_centres c ON c.id = b.centre_id
       JOIN farmer_produce p ON p.id = b.produce_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    return res.json({
      bookings: rows.map((booking) => ({
        ...booking,
        estimated_wait_minutes: Math.max(
          0,
          Math.round(Number(booking.people_ahead || 0) * 12 + Number(booking.quantity_kg || 0) / 250 * 4)
        ),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const produceId = Number(body.produce_id);
  const centreId = Number(body.centre_id);
  const date = typeof body.procurement_date === 'string' ? body.procurement_date : '';
  const start = typeof body.slot_start === 'string' ? body.slot_start : '';
  const emergency = body.is_emergency === true;
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null;

  if (!Number.isSafeInteger(produceId) || produceId < 1
    || !Number.isSafeInteger(centreId) || centreId < 1) {
    return res.status(422).json({ error: 'Choose your produce and a procurement centre.' });
  }
  if (!parsedDate || !Number.isFinite(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date
    || date < indiaDateAndMinute().date) {
    return res.status(422).json({ error: 'Choose today or a future date.' });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
    return res.status(422).json({ error: 'Choose a valid time slot.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [produceRows] = await connection.execute(
      `SELECT id, crop_name, quantity, unit, quantity_kg, perishability, urgency
       FROM farmer_produce
       WHERE id = ? AND user_id = ?
       FOR UPDATE`,
      [produceId, req.user.id]
    );
    if (!produceRows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Produce not found. Refresh your produce list.' });
    }
    const crop = produceRows[0];

    const [centreRows] = await connection.execute(
      `SELECT id, name, operating_days, opening_time, closing_time,
              slot_duration_minutes, max_farmers_day, max_quantity_kg_day,
              max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg,
              emergency_max_farmers_day, is_active
       FROM procurement_centres
       WHERE id = ?
       FOR UPDATE`,
      [centreId]
    );
    if (!centreRows.length || !centreRows[0].is_active) {
      await connection.rollback();
      return res.status(404).json({ error: 'This procurement centre is not available.' });
    }
    const centre = centreRows[0];
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsedDate.getUTCDay()];
    if (!centre.operating_days.includes(dayName)) {
      await connection.rollback();
      return res.status(422).json({ error: 'This centre is closed on that day.' });
    }

    const open = minutesOf(centre.opening_time);
    const close = minutesOf(centre.closing_time);
    const duration = Number(centre.slot_duration_minutes);
    const startMinute = minutesOf(start);
    const endMinute = startMinute + duration;
    if (!Number.isFinite(startMinute) || startMinute < open || endMinute > close
      || (startMinute - open) % duration !== 0) {
      await connection.rollback();
      return res.status(422).json({ error: 'That slot is outside the centre hours. Choose one of the listed slots.' });
    }
    const now = indiaDateAndMinute();
    if (date === now.date && startMinute <= now.minute) {
      await connection.rollback();
      return res.status(422).json({ error: 'That time has already passed today. Choose a later available slot.' });
    }
    if (emergency && !(crop.perishability === 'HIGH' && ['HIGH', 'CRITICAL'].includes(crop.urgency))) {
      await connection.rollback();
      return res.status(422).json({ error: 'Emergency booking is only for highly perishable, high-urgency produce.' });
    }

    const [existing] = await connection.execute(
      `SELECT id
       FROM bookings
       WHERE user_id = ? AND procurement_date = ?
         AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
       LIMIT 1`,
      [req.user.id, date]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'You already have an active booking for this date.' });
    }

    const [dayRows] = await connection.execute(
      `SELECT
         SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN 1 ELSE 0 END) AS day_farmers,
         COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN quantity_kg ELSE 0 END), 0) AS day_kg,
         SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') AND is_emergency = TRUE THEN 1 ELSE 0 END) AS emergency_farmers,
         COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') AND is_emergency = TRUE THEN quantity_kg ELSE 0 END), 0) AS emergency_kg
       FROM bookings
       WHERE centre_id = ? AND procurement_date = ?`,
      [centreId, date]
    );
    const day = dayRows[0];
    const [slotRows] = await connection.execute(
      `SELECT slot_start,
         SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN 1 ELSE 0 END) AS farmers,
         COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN quantity_kg ELSE 0 END), 0) AS kg
       FROM bookings
       WHERE centre_id = ? AND procurement_date = ?
       GROUP BY slot_start`,
      [centreId, date]
    );
    const bySlot = new Map(slotRows.map((row) => [String(row.slot_start).slice(0, 5), row]));
    const regularDayAvailable = Number(day.day_farmers) < Number(centre.max_farmers_day)
      && Number(day.day_kg) + Number(crop.quantity_kg)
        <= Number(centre.max_quantity_kg_day) - Number(centre.emergency_reserved_kg);
    let regularSlotAvailable = false;
    if (regularDayAvailable) {
      for (let slotMinute = open; slotMinute + duration <= close; slotMinute += duration) {
        const row = bySlot.get(timeOf(slotMinute)) || { farmers: 0, kg: 0 };
        if (Number(row.farmers) < Number(centre.max_farmers_slot)
          && Number(row.kg) + Number(crop.quantity_kg) <= Number(centre.max_quantity_kg_slot)) {
          regularSlotAvailable = true;
          break;
        }
      }
    }

    if (emergency && regularSlotAvailable) {
      await connection.rollback();
      return res.status(422).json({ error: 'A regular slot still has capacity. Please book it normally; emergency capacity is reserved for cases with no regular space.' });
    }

    const slot = bySlot.get(start) || { farmers: 0, kg: 0 };
    const slotHasCapacity = Number(slot.farmers) < Number(centre.max_farmers_slot)
      && Number(slot.kg) + Number(crop.quantity_kg) <= Number(centre.max_quantity_kg_slot);
    const dayHasCapacity = Number(day.day_farmers) < Number(centre.max_farmers_day)
      && Number(day.day_kg) + Number(crop.quantity_kg) <= Number(centre.max_quantity_kg_day);
    const emergencyHasCapacity = Number(day.emergency_farmers) < Number(centre.emergency_max_farmers_day)
      && Number(day.emergency_kg) + Number(crop.quantity_kg) <= Number(centre.emergency_reserved_kg);
    if (!slotHasCapacity || !dayHasCapacity
      || (emergency ? !emergencyHasCapacity : !regularDayAvailable)) {
      await connection.rollback();
      return res.status(409).json({ error: 'Capacity changed or another active booking already exists for this date. Refresh availability and try another slot.' });
    }

    const token = `T${randomBytes(5).toString('hex').toUpperCase()}`;
    const [inserted] = await connection.execute(
      `INSERT INTO bookings
         (user_id, produce_id, centre_id, procurement_date, slot_start, slot_end,
          quantity, unit, quantity_kg, is_emergency, token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, produceId, centreId, date, start,
        `${timeOf(endMinute)}:00`, crop.quantity, crop.unit, crop.quantity_kg, emergency, token,
      ]
    );
    const bookingId = inserted.insertId;
    await connection.execute(
      `INSERT INTO booking_events (booking_id, actor_id, event_type, details)
       VALUES (?, ?, 'BOOKED', ?)`,
      [bookingId, req.user.id, emergency ? 'Emergency booking created' : 'Regular booking created']
    );
    await connection.execute(
      `INSERT INTO notifications (user_id, booking_id, title, message, category)
       VALUES (?, ?, ?, ?, ?)`,
      [
        req.user.id,
        bookingId,
        emergency ? 'Emergency token confirmed' : 'Booking confirmed',
        `Your token ${token} is confirmed for ${centre.name}.`,
        emergency ? 'urgent' : 'success',
      ]
    );
    await connection.commit();

    return res.status(201).json({
      booking: {
        id: bookingId,
        token,
        centre_id: centreId,
        centre_name: centre.name,
        crop_name: crop.crop_name,
        procurement_date: date,
        slot_start: start,
        slot_end: `${timeOf(endMinute)}:00`,
        quantity: crop.quantity,
        unit: crop.unit,
        quantity_kg: crop.quantity_kg,
        is_emergency: emergency,
        status: 'BOOKED',
      },
      message: 'Booking confirmed. Your digital token has been generated.',
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Capacity changed or another active booking already exists for this date. Refresh availability and try another slot.' });
    }
    return next(error);
  } finally {
    connection?.release();
  }
});

export default router;

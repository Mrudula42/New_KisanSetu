import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

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
  const centreId = Number(req.query.centre_id);
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const requestedKg = req.query.quantity_kg === undefined ? 0 : Number(req.query.quantity_kg);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null;

  if (!Number.isSafeInteger(centreId) || centreId < 1 || !parsedDate
    || !Number.isFinite(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date) {
    return res.status(422).json({ error: 'Choose a valid centre and date.' });
  }
  if (!Number.isFinite(requestedKg) || requestedKg < 0 || requestedKg > 100_000_000) {
    return res.status(422).json({ error: 'Choose a valid produce quantity.' });
  }

  try {
    const [centres] = await pool.execute(
      `SELECT id, operating_days, opening_time, closing_time, slot_duration_minutes,
              max_farmers_day, max_quantity_kg_day, max_farmers_slot,
              max_quantity_kg_slot, emergency_reserved_kg, emergency_max_farmers_day
       FROM procurement_centres
       WHERE id = ? AND is_active = TRUE`,
      [centreId]
    );
    if (!centres.length) {
      return res.status(404).json({ error: 'Centre not found.' });
    }
    const centre = centres[0];
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsedDate.getUTCDay()];
    if (!centre.operating_days.includes(dayName)) {
      return res.json({
        slots: [],
        closed: true,
        message: 'This centre is closed on the selected day.',
      });
    }

    const [[day]] = await pool.execute(
      `SELECT
         SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN 1 ELSE 0 END) AS farmers,
         COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN quantity_kg ELSE 0 END), 0) AS kg,
         SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') AND is_emergency = TRUE THEN 1 ELSE 0 END) AS emergency_farmers,
         COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') AND is_emergency = TRUE THEN quantity_kg ELSE 0 END), 0) AS emergency_kg
       FROM bookings
       WHERE centre_id = ? AND procurement_date = ?`,
      [centreId, date]
    );
    const [slotRows] = await pool.execute(
      `SELECT slot_start,
         SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN 1 ELSE 0 END) AS farmers,
         COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'NO_SHOW') THEN quantity_kg ELSE 0 END), 0) AS kg
       FROM bookings
       WHERE centre_id = ? AND procurement_date = ?
       GROUP BY slot_start`,
      [centreId, date]
    );
    const bySlot = new Map(slotRows.map((row) => [String(row.slot_start).slice(0, 5), row]));
    const open = minutesOf(centre.opening_time);
    const close = minutesOf(centre.closing_time);
    const duration = Number(centre.slot_duration_minutes);
    const now = indiaDateAndMinute();
    const slots = [];

    for (let start = open; start + duration <= close; start += duration) {
      const key = timeOf(start);
      const row = bySlot.get(key) || { farmers: 0, kg: 0 };
      const farmers = Number(row.farmers);
      const kg = Number(row.kg);
      const isPast = date === now.date && start <= now.minute;
      const available = !isPast
        && Number(day.farmers) < Number(centre.max_farmers_day)
        && Number(day.kg) + requestedKg <= Number(centre.max_quantity_kg_day) - Number(centre.emergency_reserved_kg)
        && farmers < Number(centre.max_farmers_slot)
        && kg + requestedKg <= Number(centre.max_quantity_kg_slot);
      slots.push({
        start: key,
        end: timeOf(start + duration),
        available,
        emergency_possible: false,
        recommended: false,
        load_score: farmers / Number(centre.max_farmers_slot)
          + (kg + requestedKg) / Number(centre.max_quantity_kg_slot),
        booked_farmers: farmers,
        booked_kg: kg,
        remaining_farmers: Math.max(0, Number(centre.max_farmers_slot) - farmers),
        remaining_kg: Math.max(0, Number(centre.max_quantity_kg_slot) - kg),
      });
    }

    const hasRegularSlot = slots.some((slot) => slot.available);
    const preferred = slots
      .filter((slot) => slot.available)
      .sort((a, b) => a.load_score - b.load_score || a.start.localeCompare(b.start))[0];
    if (preferred) preferred.recommended = true;

    for (const slot of slots) {
      const row = bySlot.get(slot.start) || { farmers: 0, kg: 0 };
      slot.emergency_possible = !hasRegularSlot
        && !(date === now.date && minutesOf(slot.start) <= now.minute)
        && Number(day.farmers) < Number(centre.max_farmers_day)
        && Number(day.kg) + requestedKg <= Number(centre.max_quantity_kg_day)
        && Number(day.emergency_farmers) < Number(centre.emergency_max_farmers_day)
        && Number(day.emergency_kg) + requestedKg <= Number(centre.emergency_reserved_kg)
        && Number(row.farmers) < Number(centre.max_farmers_slot)
        && Number(row.kg) + requestedKg <= Number(centre.max_quantity_kg_slot);
    }

    return res.json({
      slots,
      centre_id: centreId,
      date,
      closed: false,
      requested_quantity_kg: requestedKg,
      recommended_slot: preferred ? preferred.start : null,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function validate(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const openingTime = typeof body.opening_time === 'string' ? body.opening_time.slice(0, 5) : '';
  const closingTime = typeof body.closing_time === 'string' ? body.closing_time.slice(0, 5) : '';
  const duration = Number(body.slot_duration_minutes ?? 30);
  const maxFarmersDay = Number(body.max_farmers_day ?? 100);
  const maxQuantityDay = Number(body.max_quantity_kg_day ?? 20_000);
  const maxFarmersSlot = Number(body.max_farmers_slot ?? 10);
  const maxQuantitySlot = Number(body.max_quantity_kg_slot ?? 2_500);
  const emergencyKg = Number(body.emergency_reserved_kg ?? 0);
  const emergencyFarmers = Number(body.emergency_max_farmers_day ?? 0);
  const operatingDays = Array.isArray(body.operating_days)
    ? [...new Set(body.operating_days.filter((day) => DAYS.includes(day)))]
    : DAYS.slice(0, 6);

  if (name.length < 3 || name.length > 100 || location.length < 3 || location.length > 200) {
    return { error: 'Enter a centre name and location.' };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(openingTime)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closingTime)
    || openingTime >= closingTime) {
    return { error: 'Opening time must be before closing time.' };
  }
  if (![duration, maxFarmersDay, maxQuantityDay, maxFarmersSlot, maxQuantitySlot, emergencyKg, emergencyFarmers].every(Number.isFinite)
    || !Number.isInteger(duration) || duration < 10 || duration > 240
    || !Number.isInteger(maxFarmersDay) || maxFarmersDay < 1
    || maxQuantityDay <= 0
    || !Number.isInteger(maxFarmersSlot) || maxFarmersSlot < 1
    || maxQuantitySlot <= 0) {
    return { error: 'Enter valid slot and capacity values.' };
  }
  if (emergencyKg < 0 || emergencyFarmers < 0 || emergencyKg > maxQuantityDay) {
    return { error: 'Emergency reservation must fit inside total daily capacity.' };
  }
  if (!operatingDays.length) return { error: 'Choose at least one operating day.' };

  return {
    name,
    location,
    openingTime,
    closingTime,
    duration,
    maxFarmersDay,
    maxQuantityDay,
    maxFarmersSlot,
    maxQuantitySlot,
    emergencyKg,
    emergencyFarmers,
    operatingDays,
    isActive: body.is_active !== false,
    emergencyPriority: body.emergency_priority_enabled === true,
  };
}

router.post('/', async (req, res, next) => {
  const value = validate(req.body || {});
  if (value.error) return res.status(422).json({ error: value.error });
  try {
    const [result] = await pool.execute(
      `INSERT INTO procurement_centres
         (name, location, operating_days, opening_time, closing_time,
          slot_duration_minutes, max_farmers_day, max_quantity_kg_day,
          max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg,
          emergency_max_farmers_day, is_active, emergency_priority_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        value.name, value.location, JSON.stringify(value.operatingDays),
        value.openingTime, value.closingTime, value.duration,
        value.maxFarmersDay, value.maxQuantityDay, value.maxFarmersSlot,
        value.maxQuantitySlot, value.emergencyKg, value.emergencyFarmers,
        value.isActive, value.emergencyPriority,
      ]
    );
    const [rows] = await pool.execute(
      `SELECT id, name, location, operating_days, opening_time, closing_time,
              slot_duration_minutes, max_farmers_day, max_quantity_kg_day,
              max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg,
              emergency_max_farmers_day, is_active, emergency_priority_enabled
       FROM procurement_centres
       WHERE id = ?`,
      [result.insertId]
    );
    return res.status(201).json({ centre: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A procurement centre with that name already exists.' });
    }
    return next(error);
  }
});

router.patch('/', async (req, res, next) => {
  const body = req.body || {};
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(422).json({ error: 'Choose a valid centre.' });
  }
  const value = validate(body);
  if (value.error) return res.status(422).json({ error: value.error });
  try {
    const [result] = await pool.execute(
      `UPDATE procurement_centres SET
         name = ?, location = ?, operating_days = ?, opening_time = ?, closing_time = ?,
         slot_duration_minutes = ?, max_farmers_day = ?, max_quantity_kg_day = ?,
         max_farmers_slot = ?, max_quantity_kg_slot = ?, emergency_reserved_kg = ?,
         emergency_max_farmers_day = ?, is_active = ?, emergency_priority_enabled = ?
       WHERE id = ?`,
      [
        value.name, value.location, JSON.stringify(value.operatingDays),
        value.openingTime, value.closingTime, value.duration,
        value.maxFarmersDay, value.maxQuantityDay, value.maxFarmersSlot,
        value.maxQuantitySlot, value.emergencyKg, value.emergencyFarmers,
        value.isActive, value.emergencyPriority, id,
      ]
    );
    if (!result.affectedRows) {
      const [rows] = await pool.execute('SELECT id FROM procurement_centres WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Centre not found.' });
    }
    const [rows] = await pool.execute(
      `SELECT id, name, location, operating_days, opening_time, closing_time,
              slot_duration_minutes, max_farmers_day, max_quantity_kg_day,
              max_farmers_slot, max_quantity_kg_slot, emergency_reserved_kg,
              emergency_max_farmers_day, is_active, emergency_priority_enabled
       FROM procurement_centres
       WHERE id = ?`,
      [id]
    );
    return res.json({ centre: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A procurement centre with that name already exists.' });
    }
    return next(error);
  }
});

export default router;

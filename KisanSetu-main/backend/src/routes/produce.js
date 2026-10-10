import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, crop_name, quantity, unit, quantity_kg, harvest_date,
              perishability, urgency, description, created_at
       FROM farmer_produce
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json({ produce: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const crop = typeof body.crop_name === 'string' ? body.crop_name.trim() : '';
  const quantity = Number(body.quantity);
  const unit = body.unit;
  const quantityKg = unit === 'quintal' ? quantity * 100 : quantity;
  const perishability = ['LOW', 'MEDIUM', 'HIGH'].includes(body.perishability)
    ? body.perishability
    : 'LOW';
  const urgency = ['NORMAL', 'HIGH', 'CRITICAL'].includes(body.urgency)
    ? body.urgency
    : 'NORMAL';
  const description = typeof body.description === 'string'
    ? body.description.trim().slice(0, 500)
    : '';
  let harvestDate = null;
  if (typeof body.harvest_date === 'string' && body.harvest_date !== '') {
    const parsedHarvestDate = /^\d{4}-\d{2}-\d{2}$/.test(body.harvest_date)
      ? new Date(`${body.harvest_date}T00:00:00.000Z`)
      : null;
    if (!parsedHarvestDate
      || !Number.isFinite(parsedHarvestDate.getTime())
      || parsedHarvestDate.toISOString().slice(0, 10) !== body.harvest_date) {
      return res.status(422).json({ error: 'Enter a valid harvest date.' });
    }
    harvestDate = body.harvest_date;
  }

  if (crop.length < 2 || crop.length > 80) {
    return res.status(422).json({ error: 'Enter a valid crop name.' });
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
    return res.status(422).json({ error: 'Quantity must be greater than zero.' });
  }
  if (!['kg', 'quintal'].includes(unit)) {
    return res.status(422).json({ error: 'Choose kg or quintal as the unit.' });
  }
  if (!Number.isFinite(quantityKg) || quantityKg > 100_000_000) {
    return res.status(422).json({ error: 'Quantity is too large.' });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO farmer_produce
         (user_id, crop_name, quantity, unit, quantity_kg, harvest_date,
          perishability, urgency, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, crop, quantity, unit, quantityKg, harvestDate, perishability, urgency, description]
    );
    const [rows] = await pool.execute(
      `SELECT id, crop_name, quantity, unit, quantity_kg, harvest_date,
              perishability, urgency, description, created_at
       FROM farmer_produce
       WHERE id = ? AND user_id = ?`,
      [result.insertId, req.user.id]
    );
    return res.status(201).json({ produce: rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;

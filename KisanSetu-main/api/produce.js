import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET','POST'];

export default async function (req, res) {
  const userId = String(req.user.id);
  try {
    if (req.method === 'GET') {
      const { rows } = await db.query('SELECT id, crop_name, quantity, unit, quantity_kg, harvest_date, perishability, urgency, description, created_at FROM farmer_produce WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
      return res.json({ produce: rows });
    }
    const body = req.body || {};
    const crop = typeof body.crop_name === 'string' ? body.crop_name.trim() : '';
    const quantity = Number(body.quantity);
    const unit = body.unit;
    const kg = unit === 'quintal' ? quantity * 100 : quantity;
    const perishability = ['LOW','MEDIUM','HIGH'].includes(body.perishability) ? body.perishability : 'LOW';
    const urgency = ['NORMAL','HIGH','CRITICAL'].includes(body.urgency) ? body.urgency : 'NORMAL';
    const description = typeof body.description === 'string' ? body.description.trim().slice(0,500) : '';
    const harvestDate = typeof body.harvest_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.harvest_date) ? body.harvest_date : null;
    if (crop.length < 2 || crop.length > 80) return res.status(422).json({ error: 'Enter a valid crop name.' });
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) return res.status(422).json({ error: 'Quantity must be greater than zero.' });
    if (!['kg','quintal'].includes(unit)) return res.status(422).json({ error: 'Choose kg or quintal as the unit.' });
    if (kg > 100000000) return res.status(422).json({ error: 'Quantity is too large.' });
    const { rows } = await db.query(
      `INSERT INTO farmer_produce (user_id,crop_name,quantity,unit,quantity_kg,harvest_date,perishability,urgency,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,crop_name,quantity,unit,quantity_kg,harvest_date,perishability,urgency,description,created_at`,
      [userId,crop,quantity,unit,kg,harvestDate,perishability,urgency,description]
    );
    return res.status(201).json({ produce: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Produce could not be saved. Please try again.' });
  }
}
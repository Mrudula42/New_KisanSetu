import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.location, c.operating_days, c.opening_time, c.closing_time,
              c.slot_duration_minutes, c.max_farmers_day, c.max_quantity_kg_day,
              c.max_farmers_slot, c.max_quantity_kg_slot, c.emergency_reserved_kg,
              c.emergency_max_farmers_day, c.is_active,
              count(b.id) FILTER (WHERE b.procurement_date = CURRENT_DATE AND b.status NOT IN ('CANCELLED','NO_SHOW'))::int AS booked_farmers_today,
              COALESCE(sum(b.quantity_kg) FILTER (WHERE b.procurement_date = CURRENT_DATE AND b.status NOT IN ('CANCELLED','NO_SHOW')),0)::numeric AS booked_kg_today
       FROM procurement_centres c LEFT JOIN bookings b ON b.centre_id = c.id
       WHERE c.is_active = true GROUP BY c.id ORDER BY c.name`
    );
    return res.json({ centres: rows });
  } catch (e) {
    return res.status(500).json({ error: 'Centres could not be loaded. Please try again.' });
  }
}
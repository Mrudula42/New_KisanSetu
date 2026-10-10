import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticate, requireRole } from '../middleware/authentication.js';

const router = Router();
router.use(authenticate, requireRole('FARMER'));

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.location, c.operating_days, c.opening_time, c.closing_time,
              c.slot_duration_minutes, c.max_farmers_day, c.max_quantity_kg_day,
              c.max_farmers_slot, c.max_quantity_kg_slot, c.emergency_reserved_kg,
              c.emergency_max_farmers_day, c.is_active,
              SUM(CASE
                WHEN b.procurement_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
                  AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
                THEN 1 ELSE 0
              END) AS booked_farmers_today,
              COALESCE(SUM(CASE
                WHEN b.procurement_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))
                  AND b.status NOT IN ('CANCELLED', 'NO_SHOW')
                THEN b.quantity_kg ELSE 0
              END), 0) AS booked_kg_today
       FROM procurement_centres c
       LEFT JOIN bookings b ON b.centre_id = c.id
       WHERE c.is_active = TRUE
       GROUP BY c.id
       ORDER BY c.name`
    );
    return res.json({ centres: rows });
  } catch (error) {
    return next(error);
  }
});

export default router;

import { db, config } from 'hatchable';

export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  const id = Number(req.query && req.query.booking_id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(422).json({ error: 'A valid booking is required.' });
  try {
    const { rows } = await db.query(
      `SELECT b.id,b.quantity_kg,b.status,b.procurement_date,b.centre_id,b.slot_start,b.created_at,
        (SELECT count(*)::int FROM bookings q WHERE q.centre_id=b.centre_id AND q.procurement_date=b.procurement_date AND q.status NOT IN ('COMPLETED','CANCELLED','NO_SHOW') AND (q.slot_start < b.slot_start OR (q.slot_start=b.slot_start AND q.created_at < b.created_at))) AS people_ahead,
        (SELECT count(*)::int FROM bookings q WHERE q.centre_id=b.centre_id AND q.procurement_date=b.procurement_date AND q.status NOT IN ('COMPLETED','CANCELLED','NO_SHOW')) AS queue_length
       FROM bookings b WHERE b.id=$1 AND b.user_id=$2`, [id,String(req.user.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found.' });
    const b = rows[0];
    const ahead = Number(b.people_ahead || 0);
    let minutes = Math.max(0,Math.round(ahead*12 + Number(b.quantity_kg || 0)/250*4));
    let method = 'Fallback estimate based on queue position, 12-minute average processing time, and produce quantity.';
    try {
      const endpoint = await config.get('ai_service_url');
      if (endpoint) {
        const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        const response = await fetch(base + '/predict-wait', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({people_ahead:ahead,queue_length:Number(b.queue_length||0),quantity_kg:Number(b.quantity_kg||0),status:b.status,procurement_date:b.procurement_date,slot_start:b.slot_start,centre_id:b.centre_id}) });
        if (response.ok) {
          const prediction = await response.json();
          const suggested = Number(prediction.estimated_wait_minutes);
          if (Number.isFinite(suggested) && suggested >= 0 && suggested <= 1440) { minutes = Math.round(suggested); method = 'Configured external AI service'; }
        }
      }
    } catch (_) { /* prediction is optional; keep the main queue available */ }
    return res.json({ booking_id:b.id,estimated_wait_minutes:minutes,people_ahead:ahead,queue_length:Number(b.queue_length || 0),method });
  } catch (e) {
    return res.status(500).json({ error: 'Waiting time is temporarily unavailable.' });
  }
}
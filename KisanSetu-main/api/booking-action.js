import { db, events } from 'hatchable';

export const access = 'user';
export const methods = ['POST'];

export default async function (req, res) {
  const userId = String(req.user.id);
  const body = req.body || {};
  const id = Number(body.booking_id);
  const action = String(body.action || '').toUpperCase();
  if (!Number.isSafeInteger(id) || id < 1 || !['CHECK_IN','CANCEL'].includes(action)) return res.status(422).json({ error: 'Choose a valid booking action.' });
  try {
    const current = await db.query('SELECT id,token,status,procurement_date,centre_id,slot_start FROM bookings WHERE id=$1 AND user_id=$2', [id,userId]);
    if (!current.rows.length) return res.status(404).json({ error: 'Booking not found.' });
    const booking = current.rows[0];
    if (action === 'CHECK_IN') {
      const localToday = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      if (String(booking.procurement_date).slice(0,10) !== localToday) return res.status(409).json({ error: 'Check-in is available on your booking date.' });
      if (!['BOOKED','WAITING'].includes(booking.status)) return res.status(409).json({ error: 'This booking cannot be checked in from its current status.' });
      const result = await db.query("UPDATE bookings SET status='CHECKED_IN',checked_in_at=COALESCE(checked_in_at,now()),updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('BOOKED','WAITING') RETURNING id,token,status", [id,userId]);
      if (!result.rows.length) return res.status(409).json({ error: 'The booking has already changed. Refresh your list.' });
    } else {
      if (booking.status !== 'BOOKED') return res.status(409).json({ error: 'Only a booking that has not checked in can be cancelled.' });
      const result = await db.query("UPDATE bookings SET status='CANCELLED',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='BOOKED' RETURNING id,token,status", [id,userId]);
      if (!result.rows.length) return res.status(409).json({ error: 'The booking has already changed. Refresh your list.' });
    }
    await db.query('INSERT INTO booking_events (booking_id,actor_id,event_type,details) VALUES ($1,$2,$3,$4)', [id,userId,action,action === 'CHECK_IN' ? 'Farmer checked in' : 'Farmer cancelled booking']);
    try { await events.publish('kisansetu-queue','booking_updated',{ id, action }); } catch (_) {}
    try { await events.publish('user:' + userId,'booking_updated',{ id, action }); } catch (_) {}
    try { await events.publish('centre:' + booking.centre_id,'booking_updated',{ id, action }); } catch (_) {}
    try {
      const affected = await db.query("SELECT DISTINCT user_id FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date AND status NOT IN ('CANCELLED','NO_SHOW')", [booking.centre_id,booking.procurement_date]);
      for (const row of affected.rows) { try { await events.publish('user:' + row.user_id,'queue_changed',{ id }); } catch (_) {} }
    } catch (_) {}
    return res.json({ ok: true, message: action === 'CHECK_IN' ? 'Check-in complete. You are in the queue.' : 'Booking cancelled.', token: booking.token });
  } catch (e) {
    return res.status(500).json({ error: 'The booking action could not be completed.' });
  }
}
import { db, events } from 'hatchable';

export const access = 'admin';
export const methods = ['GET','PATCH'];
const TERMINAL = "'COMPLETED','CANCELLED','NO_SHOW'";
const QUEUE_STATUSES = ['BOOKED','CHECKED_IN','WAITING','IN_PROGRESS','QUALITY_TESTING','PROCUREMENT','COMPLETED','CANCELLED','NO_SHOW'];
const QUALITY = ['PENDING','TESTING','PASSED','REJECTED'];
const PROCUREMENT = ['PENDING','IN_PROGRESS','COMPLETED'];
const PAYMENT = ['PENDING','PROCESSING','PAID','FAILED'];

export default async function (req, res) {
  try {
    if (req.method === 'GET') {
      const metricsSql = "SELECT " +
        "(SELECT count(*)::int FROM farmer_profiles) AS total_farmers," +
        "(SELECT count(*)::int FROM bookings WHERE procurement_date=CURRENT_DATE AND status NOT IN (" + TERMINAL + ")) AS todays_bookings," +
        "(SELECT count(*)::int FROM bookings WHERE status IN ('CHECKED_IN','WAITING','IN_PROGRESS','QUALITY_TESTING','PROCUREMENT')) AS active_queue," +
        "(SELECT count(*)::int FROM bookings WHERE status='COMPLETED' AND procurement_date=CURRENT_DATE) AS completed_today," +
        "(SELECT count(*)::int FROM bookings WHERE payment_status IN ('PENDING','PROCESSING') AND status='COMPLETED') AS pending_payments," +
        "(SELECT count(*)::int FROM bookings WHERE is_emergency=true AND procurement_date=CURRENT_DATE AND status NOT IN (" + TERMINAL + ")) AS emergency_bookings," +
        "(SELECT count(*)::int FROM procurement_centres WHERE is_active=true) AS active_centres," +
        "(SELECT COALESCE(round(100.0*count(*) FILTER (WHERE status NOT IN (" + TERMINAL + ")) / NULLIF((SELECT sum(max_farmers_day) FROM procurement_centres WHERE is_active=true),0)),0)::int FROM bookings WHERE procurement_date=CURRENT_DATE) AS centre_utilization";
      const bookingsSql = "SELECT b.id,b.token,b.user_id,b.procurement_date,b.slot_start,b.slot_end,b.quantity,b.unit,b.quantity_kg,b.is_emergency,b.status,b.quality_status,b.quality_grade,b.quality_remarks,b.procurement_status,b.procurement_remarks,b.payment_status,b.payment_amount,b.payment_reference,b.payment_remarks,b.created_at,COALESCE(f.full_name,'Farmer account') AS farmer_name,COALESCE(f.phone,'') AS farmer_phone,p.crop_name,c.name AS centre_name FROM bookings b JOIN farmer_produce p ON p.id=b.produce_id JOIN procurement_centres c ON c.id=b.centre_id LEFT JOIN farmer_profiles f ON f.user_id=b.user_id ORDER BY b.procurement_date,(c.emergency_priority_enabled AND b.is_emergency) DESC,b.slot_start,b.created_at ASC LIMIT 200";
      const trendSql = "SELECT procurement_date,count(*)::int AS bookings,count(*) FILTER (WHERE status='COMPLETED')::int AS completed,count(*) FILTER (WHERE is_emergency)::int AS emergency FROM bookings WHERE procurement_date >= CURRENT_DATE - INTERVAL '6 days' GROUP BY procurement_date ORDER BY procurement_date";
      const [metrics, bookings, centres, trend] = await Promise.all([
        db.query(metricsSql),
        db.query(bookingsSql),
        db.query('SELECT id,name,location,operating_days,opening_time,closing_time,slot_duration_minutes,max_farmers_day,max_quantity_kg_day,max_farmers_slot,max_quantity_kg_slot,emergency_reserved_kg,emergency_max_farmers_day,is_active,emergency_priority_enabled FROM procurement_centres ORDER BY name'),
        db.query(trendSql)
      ]);
      return res.json({ metrics: metrics.rows[0], bookings: bookings.rows, centres: centres.rows, trend: trend.rows });
    }

    const body = req.body || {};
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(422).json({ error: 'Select a valid booking.' });
    const status = body.status == null ? null : String(body.status).toUpperCase();
    const quality = body.quality_status == null ? null : String(body.quality_status).toUpperCase();
    const procurement = body.procurement_status == null ? null : String(body.procurement_status).toUpperCase();
    const payment = body.payment_status == null ? null : String(body.payment_status).toUpperCase();
    if (status && !QUEUE_STATUSES.includes(status)) return res.status(422).json({ error: 'Invalid queue status.' });
    if (quality && !QUALITY.includes(quality)) return res.status(422).json({ error: 'Invalid quality status.' });
    if (procurement && !PROCUREMENT.includes(procurement)) return res.status(422).json({ error: 'Invalid procurement status.' });
    if (payment && !PAYMENT.includes(payment)) return res.status(422).json({ error: 'Invalid payment status.' });
    const amount = body.payment_amount == null || body.payment_amount === '' ? null : Number(body.payment_amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > 100000000000)) return res.status(422).json({ error: 'Payment amount must be zero or more.' });
    const grade = typeof body.quality_grade === 'string' ? body.quality_grade.trim().slice(0,40) : null;
    const qRemarks = typeof body.quality_remarks === 'string' ? body.quality_remarks.trim().slice(0,500) : null;
    const pRemarks = typeof body.procurement_remarks === 'string' ? body.procurement_remarks.trim().slice(0,500) : null;
    const payRef = typeof body.payment_reference === 'string' ? body.payment_reference.trim().slice(0,120) : null;
    const payRemarks = typeof body.payment_remarks === 'string' ? body.payment_remarks.trim().slice(0,500) : null;
    const sql = "UPDATE bookings SET status=COALESCE($2,status),quality_status=COALESCE($3,quality_status)," +
      "quality_grade=COALESCE($4,quality_grade),quality_remarks=COALESCE($5,quality_remarks)," +
      "quality_tested_at=CASE WHEN $3 IN ('PASSED','REJECTED') THEN now() ELSE quality_tested_at END," +
      "procurement_status=COALESCE($6,procurement_status),procurement_remarks=COALESCE($7,procurement_remarks)," +
      "payment_status=COALESCE($8,payment_status),payment_amount=COALESCE($9,payment_amount),payment_reference=COALESCE($10,payment_reference),payment_remarks=COALESCE($11,payment_remarks)," +
      "payment_date=CASE WHEN $8='PAID' THEN COALESCE(payment_date,now()) ELSE payment_date END," +
      "checked_in_at=CASE WHEN $2='CHECKED_IN' THEN COALESCE(checked_in_at,now()) ELSE checked_in_at END,updated_at=now() " +
      "WHERE id=$1 RETURNING id,user_id,centre_id,procurement_date,token,status,quality_status,procurement_status,payment_status";
    const result = await db.query(sql, [id,status,quality,grade,qRemarks,procurement,pRemarks,payment,amount,payRef,payRemarks]);
    if (!result.rows.length) return res.status(404).json({ error: 'Booking not found.' });
    const booking = result.rows[0];
    const changed = status || quality || procurement || payment || 'UPDATED';
    await db.query('INSERT INTO booking_events (booking_id,actor_id,event_type,details) VALUES ($1,$2,$3,$4)', [id,String(req.member && req.member.id || 'admin'),String(changed),'Updated by procurement administrator']);
    const msg = 'Token ' + booking.token + ' update: ' + (status ? 'queue ' + status.toLowerCase() : quality ? 'quality ' + quality.toLowerCase() : procurement ? 'procurement ' + procurement.toLowerCase() : payment ? 'payment ' + payment.toLowerCase() : 'booking details changed') + '.';
    await db.query('INSERT INTO notifications (user_id,booking_id,title,message,category) VALUES ($1,$2,$3,$4,$5)', [booking.user_id,id,'KisanSetu booking update',msg,status === 'CANCELLED' || quality === 'REJECTED' || payment === 'FAILED' ? 'urgent' : 'info']);
    try { await events.publish('kisansetu-queue','booking_updated',{ id, status: booking.status }); } catch (_) {}
    try { await events.publish('centre:' + booking.centre_id,'booking_updated',{ id, status: booking.status }); } catch (_) {}
    try { await events.publish('user:' + booking.user_id,'booking_updated',{ id, status: booking.status }); } catch (_) {}
    try { await events.publish('kisansetu-queue','notification_created',{ id }); } catch (_) {}
    try { await events.publish('user:' + booking.user_id,'notification_created',{ id }); } catch (_) {}
    try {
      const affected = await db.query("SELECT DISTINCT user_id FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date AND status NOT IN ('CANCELLED','NO_SHOW')", [booking.centre_id, booking.procurement_date]);
      for (const row of affected.rows) { try { await events.publish('user:' + row.user_id,'queue_changed',{ id }); } catch (_) {} }
    } catch (_) {}
    return res.json({ booking, message: 'Booking information updated.' });
  } catch (e) {
    return res.status(500).json({ error: 'The booking update failed. Please retry.' });
  }
}
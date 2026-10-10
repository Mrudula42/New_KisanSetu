import { db, events } from 'hatchable';

export const access = 'user';
export const methods = ['GET','POST'];
const ACTIVE = "'COMPLETED','CANCELLED','NO_SHOW'";
const CAPACITY_EXCLUDED = "'CANCELLED','NO_SHOW'";

export default async function (req, res) {
  const userId = String(req.user.id);
  try {
    if (req.method === 'GET') {
      const { rows } = await db.query(
        `SELECT b.id,b.token,b.centre_id,b.procurement_date,b.slot_start,b.slot_end,b.quantity,b.unit,b.quantity_kg,b.is_emergency,b.status,b.quality_status,b.quality_grade,b.quality_remarks,b.quality_tested_at,b.procurement_status,b.procurement_remarks,b.payment_status,b.payment_amount,b.payment_reference,b.payment_remarks,b.payment_date,b.checked_in_at,b.created_at,
                c.name AS centre_name,c.location AS centre_location,c.emergency_priority_enabled,p.crop_name,
                (SELECT count(*)::int FROM bookings q WHERE q.centre_id=b.centre_id AND q.procurement_date=b.procurement_date AND q.status NOT IN (${ACTIVE}) AND ((c.emergency_priority_enabled AND q.is_emergency) > (c.emergency_priority_enabled AND b.is_emergency) OR ((c.emergency_priority_enabled AND q.is_emergency) = (c.emergency_priority_enabled AND b.is_emergency) AND (q.slot_start < b.slot_start OR (q.slot_start=b.slot_start AND q.created_at < b.created_at))))) AS people_ahead,
                (SELECT q.token FROM bookings q WHERE q.centre_id=b.centre_id AND q.procurement_date=b.procurement_date AND q.status NOT IN (${ACTIVE}) ORDER BY (c.emergency_priority_enabled AND q.is_emergency) DESC,q.slot_start,q.created_at LIMIT 1) AS current_token
         FROM bookings b JOIN procurement_centres c ON c.id=b.centre_id JOIN farmer_produce p ON p.id=b.produce_id
         WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 100`, [userId]
      );
      return res.json({ bookings: rows.map(b => ({ ...b, estimated_wait_minutes: Math.max(0, Math.round(Number(b.people_ahead || 0) * 12 + Number(b.quantity_kg || 0) / 250 * 4)) })) });
    }
    const body = req.body || {};
    const produceId = Number(body.produce_id);
    const centreId = Number(body.centre_id);
    const date = typeof body.procurement_date === 'string' ? body.procurement_date : '';
    const start = typeof body.slot_start === 'string' ? body.slot_start : '';
    const emergency = body.is_emergency === true;
    if (!Number.isSafeInteger(produceId) || produceId < 1 || !Number.isSafeInteger(centreId) || centreId < 1) return res.status(422).json({ error: 'Choose your produce and a procurement centre.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T23:59:59Z').getTime() < Date.now()) return res.status(422).json({ error: 'Choose today or a future date.' });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return res.status(422).json({ error: 'Choose a valid time slot.' });
    const produceResult = await db.query('SELECT id,crop_name,quantity,unit,quantity_kg,perishability,urgency FROM farmer_produce WHERE id=$1 AND user_id=$2', [produceId,userId]);
    if (!produceResult.rows.length) return res.status(404).json({ error: 'Produce not found. Refresh your produce list.' });
    const crop = produceResult.rows[0];
    const centreResult = await db.query('SELECT * FROM procurement_centres WHERE id=$1 AND is_active=true', [centreId]);
    if (!centreResult.rows.length) return res.status(404).json({ error: 'This procurement centre is not available.' });
    const centre = centreResult.rows[0];
    const dayDate = new Date(date + 'T12:00:00Z');
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayDate.getUTCDay()];
    if (!(centre.operating_days || []).includes(dayName)) return res.status(422).json({ error: 'This centre is closed on that day.' });
    const mins = t => { const m = String(t).slice(0,5).match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1])*60+Number(m[2]) : NaN; };
    const startMins = mins(start), open = mins(centre.opening_time), close = mins(centre.closing_time), duration = Number(centre.slot_duration_minutes);
    const endMins = startMins + duration;
    if (!Number.isFinite(startMins) || startMins < open || endMins > close || (startMins-open) % duration !== 0) return res.status(422).json({ error: 'That slot is outside the centre hours. Choose one of the listed slots.' });
    const localNow = new Date();
    const localDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(localNow);
    const localClock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(localNow).split(':').map(Number);
    if (date === localDate && startMins <= localClock[0]*60+localClock[1]) return res.status(422).json({ error: 'That time has already passed today. Choose a later available slot.' });
    const pad = n => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0');
    const end = pad(endMins);
    if (emergency && !(crop.perishability === 'HIGH' && ['HIGH','CRITICAL'].includes(crop.urgency))) return res.status(422).json({ error: 'Emergency booking is only for highly perishable, high-urgency produce.' });
    if (emergency) {
      const load = await db.query(
        `SELECT count(*) FILTER (WHERE status NOT IN (${CAPACITY_EXCLUDED}))::int AS total_farmers,
                COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN (${CAPACITY_EXCLUDED})),0)::numeric AS total_kg,
                count(*) FILTER (WHERE status NOT IN (${CAPACITY_EXCLUDED}) AND slot_start=$3::time)::int AS slot_farmers,
                COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN (${CAPACITY_EXCLUDED}) AND slot_start=$3::time),0)::numeric AS slot_kg
         FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date`, [centreId,date,start]
      );
      const l = load.rows[0];
      const slotLoads = await db.query(
        "SELECT slot_start,count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW'))::int AS farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW')),0)::numeric AS kg FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date GROUP BY slot_start",
        [centreId,date]
      );
      const slotMap = Object.fromEntries(slotLoads.rows.map(row => [String(row.slot_start).slice(0,5),row]));
      const regularDayStillAvailable = Number(l.total_farmers) < Number(centre.max_farmers_day) && Number(l.total_kg)+Number(crop.quantity_kg) <= Number(centre.max_quantity_kg_day)-Number(centre.emergency_reserved_kg);
      let regularSlotStillAvailable = false;
      if (regularDayStillAvailable) {
        for (let slotMinute = open; slotMinute + duration <= close; slotMinute += duration) {
          const key = pad(slotMinute);
          const row = slotMap[key] || {farmers:0,kg:0};
          if (Number(row.farmers) < Number(centre.max_farmers_slot) && Number(row.kg)+Number(crop.quantity_kg) <= Number(centre.max_quantity_kg_slot)) {
            regularSlotStillAvailable = true;
            break;
          }
        }
      }
      if (regularSlotStillAvailable) return res.status(422).json({ error: 'A regular slot still has capacity. Please book it normally; emergency capacity is reserved for cases with no regular space.' });
    }
    const transaction = await db.transaction([
      { sql: 'SELECT id FROM procurement_centres WHERE id=$1 FOR UPDATE', params: [centreId] },
      { sql: `WITH load AS (
          SELECT c.id,c.is_active,c.max_farmers_day,c.max_quantity_kg_day,c.max_farmers_slot,c.max_quantity_kg_slot,c.emergency_reserved_kg,c.emergency_max_farmers_day,
                 count(b.id) FILTER (WHERE b.status NOT IN (${CAPACITY_EXCLUDED}))::int AS day_farmers,
                 COALESCE(sum(b.quantity_kg) FILTER (WHERE b.status NOT IN (${CAPACITY_EXCLUDED})),0)::numeric AS day_kg,
                 count(b.id) FILTER (WHERE b.status NOT IN (${CAPACITY_EXCLUDED}) AND b.slot_start=$5::time)::int AS slot_farmers,
                 COALESCE(sum(b.quantity_kg) FILTER (WHERE b.status NOT IN (${CAPACITY_EXCLUDED}) AND b.slot_start=$5::time),0)::numeric AS slot_kg,
                 count(b.id) FILTER (WHERE b.status NOT IN (${CAPACITY_EXCLUDED}) AND b.is_emergency)::int AS emergency_farmers,
                 COALESCE(sum(b.quantity_kg) FILTER (WHERE b.status NOT IN (${CAPACITY_EXCLUDED}) AND b.is_emergency),0)::numeric AS emergency_kg
          FROM procurement_centres c LEFT JOIN bookings b ON b.centre_id=c.id AND b.procurement_date=$4::date
          WHERE c.id=$3 GROUP BY c.id
        )
        INSERT INTO bookings (user_id,produce_id,centre_id,procurement_date,slot_start,slot_end,quantity,unit,quantity_kg,is_emergency,token)
        SELECT $2,$1,l.id,$4::date,$5::time,$6::time,p.quantity,p.unit,p.quantity_kg,$7,
               'T' || lpad(nextval('kisan_token_seq')::text,3,'0')
        FROM load l JOIN farmer_produce p ON p.id=$1 AND p.user_id=$2
        WHERE l.is_active=true
          AND NOT EXISTS (SELECT 1 FROM bookings prior WHERE prior.user_id=$2 AND prior.procurement_date=$4::date AND prior.status NOT IN (${ACTIVE}))
          AND CASE WHEN $7::boolean THEN
             p.perishability='HIGH' AND p.urgency IN ('HIGH','CRITICAL')
             AND l.day_farmers < l.max_farmers_day AND l.day_kg+p.quantity_kg <= l.max_quantity_kg_day
             AND l.emergency_farmers < l.emergency_max_farmers_day AND l.emergency_kg+p.quantity_kg <= l.emergency_reserved_kg
          ELSE
             l.day_farmers < l.max_farmers_day AND l.day_kg+p.quantity_kg <= l.max_quantity_kg_day-l.emergency_reserved_kg
             AND l.slot_farmers < l.max_farmers_slot AND l.slot_kg+p.quantity_kg <= l.max_quantity_kg_slot
          END
        RETURNING id,token,procurement_date,slot_start,slot_end,status,is_emergency`,
        params: [produceId,userId,centreId,date,start,end,emergency]
      }
    ]);
    const created = transaction.results[1] && transaction.results[1].rows && transaction.results[1].rows[0];
    if (!created) return res.status(409).json({ error: 'Capacity changed or another active booking already exists for this date. Refresh availability and try another slot.' });
    await db.query('INSERT INTO booking_events (booking_id,actor_id,event_type,details) VALUES ($1,$2,$3,$4)', [created.id,userId,'BOOKED',emergency ? 'Emergency booking created' : 'Regular booking created']);
    await db.query('INSERT INTO notifications (user_id,booking_id,title,message,category) VALUES ($1,$2,$3,$4,$5)', [userId,created.id,emergency ? 'Emergency token confirmed' : 'Booking confirmed','Your token ' + created.token + ' is confirmed for ' + centre.name + '.',emergency ? 'urgent' : 'success']);
    try { await events.publish('kisansetu-queue','booking_created',{ id: created.id }); } catch (_) {}
    try { await events.publish('user:' + userId,'booking_created',{ id: created.id }); } catch (_) {}
    try {
      const impacted = await db.query('SELECT DISTINCT user_id FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date AND status NOT IN (\'CANCELLED\',\'NO_SHOW\')', [centreId,date]);
      for (const row of impacted.rows) { try { await events.publish('user:' + row.user_id,'queue_changed',{ id: created.id }); } catch (_) {} }
    } catch (_) {}
    return res.status(201).json({ booking: { ...created, centre_name: centre.name, crop_name: crop.crop_name, quantity: crop.quantity, unit: crop.unit, quantity_kg: crop.quantity_kg }, message: 'Booking confirmed. Your digital token has been generated.' });
  } catch (e) {
    return res.status(500).json({ error: 'Booking could not be completed. Your capacity has not been reserved. Please retry.' });
  }
}
import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  const centreId = Number(req.query && req.query.centre_id);
  const date = String(req.query && req.query.date || '');
  if (!Number.isSafeInteger(centreId) || centreId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(422).json({ error: 'Choose a valid centre and date.' });
  try {
    const result = await db.query('SELECT * FROM procurement_centres WHERE id=$1 AND is_active=true', [centreId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Centre not found.' });
    const c = result.rows[0];
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
    if (!(c.operating_days || []).includes(dayName)) return res.json({ slots: [], closed: true, message: 'This centre is closed on the selected day.' });
    const loadResult = await db.query(
      "SELECT slot_start,count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW'))::int AS farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW')),0)::numeric AS kg,count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency)::int AS emergency_farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency),0)::numeric AS emergency_kg FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date GROUP BY slot_start",
      [centreId,date]
    );
    const dayResult = await db.query(
      "SELECT count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW'))::int AS farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW')),0)::numeric AS kg,count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency)::int AS emergency_farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency),0)::numeric AS emergency_kg FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date",
      [centreId,date]
    );
    const day = dayResult.rows[0];
    const requestedKg = Number(req.query && req.query.quantity_kg || 0);
    if (!Number.isFinite(requestedKg) || requestedKg < 0 || requestedKg > 100000000) return res.status(422).json({ error: 'Choose a valid produce quantity.' });
    const bySlot = {};
    for (const row of loadResult.rows) bySlot[String(row.slot_start).slice(0,5)] = row;
    const toMinutes = v => { const a=String(v).slice(0,5).split(':').map(Number); return a[0]*60+a[1]; };
    const time = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    const open = toMinutes(c.opening_time), close = toMinutes(c.closing_time), duration=Number(c.slot_duration_minutes);
    const now = new Date();
    const localDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const localClock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now).split(':').map(Number);
    const currentMinute = localClock[0]*60+localClock[1];
    const slots = [];
    for (let start=open; start+duration<=close; start+=duration) {
      const key=time(start), row=bySlot[key] || {farmers:0,kg:0};
      const farmers=Number(row.farmers), kg=Number(row.kg);
      const isPast = date===localDate && start<=currentMinute;
      const regularAvailable = !isPast && Number(day.farmers)<Number(c.max_farmers_day) && Number(day.kg)+requestedKg<=Number(c.max_quantity_kg_day)-Number(c.emergency_reserved_kg) && farmers<Number(c.max_farmers_slot) && kg+requestedKg<=Number(c.max_quantity_kg_slot);
      const loadScore = farmers/Number(c.max_farmers_slot) + (kg+requestedKg)/Number(c.max_quantity_kg_slot);
      slots.push({start:key,end:time(start+duration),available:regularAvailable,emergency_possible:false,recommended:false,load_score:loadScore,booked_farmers:farmers,booked_kg:kg,remaining_farmers:Math.max(0,Number(c.max_farmers_slot)-farmers),remaining_kg:Math.max(0,Number(c.max_quantity_kg_slot)-kg)});
    }
    const hasRegularSlot = slots.some(s=>s.available);
    const preferred = slots.filter(s=>s.available).sort((a,b)=>a.load_score-b.load_score || a.start.localeCompare(b.start))[0];
    if (preferred) preferred.recommended=true;
    for (const s of slots) {
      const row=bySlot[s.start] || {farmers:0,kg:0};
      s.emergency_possible = !hasRegularSlot &&
        !(date===localDate && toMinutes(s.start)<=currentMinute) &&
        Number(day.farmers)<Number(c.max_farmers_day) &&
        Number(day.kg)+requestedKg<=Number(c.max_quantity_kg_day) &&
        Number(day.emergency_farmers)<Number(c.emergency_max_farmers_day) &&
        Number(day.emergency_kg)+requestedKg<=Number(c.emergency_reserved_kg) &&
        Number(row.farmers)<Number(c.max_farmers_slot) &&
        Number(row.kg)+requestedKg<=Number(c.max_quantity_kg_slot);
    }
    return res.json({slots,centre_id:centreId,date,closed:false,requested_quantity_kg:requestedKg,recommended_slot:preferred?preferred.start:null});
  } catch (e) {
    return res.status(500).json({ error: 'Slot availability could not be loaded.' });
  }
}
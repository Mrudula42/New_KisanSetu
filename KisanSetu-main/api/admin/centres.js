import { db, events } from 'hatchable';

export const access = 'admin';
export const methods = ['POST','PATCH'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function validate(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const open = typeof body.opening_time === 'string' ? body.opening_time.slice(0,5) : '';
  const close = typeof body.closing_time === 'string' ? body.closing_time.slice(0,5) : '';
  const duration = Number(body.slot_duration_minutes || 30);
  const farmers = Number(body.max_farmers_day || 100);
  const kg = Number(body.max_quantity_kg_day || 20000);
  const slotFarmers = Number(body.max_farmers_slot || 10);
  const slotKg = Number(body.max_quantity_kg_slot || 2500);
  const emergencyKg = Number(body.emergency_reserved_kg || 0);
  const emergencyFarmers = Number(body.emergency_max_farmers_day || 0);
  const days = Array.isArray(body.operating_days) ? body.operating_days.filter(d => DAYS.includes(d)) : DAYS.slice(0,6);
  if (name.length < 3 || name.length > 100 || location.length < 3 || location.length > 200) return { error: 'Enter a centre name and location.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close) || open >= close) return { error: 'Opening time must be before closing time.' };
  if (![duration,farmers,kg,slotFarmers,slotKg].every(Number.isFinite) || duration < 10 || duration > 240 || farmers < 1 || kg <= 0 || slotFarmers < 1 || slotKg <= 0) return { error: 'Enter valid slot and capacity values.' };
  if (emergencyKg < 0 || emergencyFarmers < 0 || emergencyKg > kg) return { error: 'Emergency reservation must fit inside total daily capacity.' };
  if (!days.length) return { error: 'Choose at least one operating day.' };
  return { name,location,open,close,duration,farmers,kg,slotFarmers,slotKg,emergencyKg,emergencyFarmers,days,is_active:body.is_active !== false,emergency_priority_enabled:body.emergency_priority_enabled === true };
}

export default async function (req, res) {
  const body = req.body || {};
  const value = validate(body);
  if (value.error) return res.status(422).json({ error: value.error });
  try {
    let rows;
    if (req.method === 'POST') {
      const result = await db.query(
        'INSERT INTO procurement_centres (name,location,operating_days,opening_time,closing_time,slot_duration_minutes,max_farmers_day,max_quantity_kg_day,max_farmers_slot,max_quantity_kg_slot,emergency_reserved_kg,emergency_max_farmers_day,is_active,emergency_priority_enabled) VALUES ($1,$2,$3,$4::time,$5::time,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,name,location,operating_days,opening_time,closing_time,slot_duration_minutes,max_farmers_day,max_quantity_kg_day,max_farmers_slot,max_quantity_kg_slot,emergency_reserved_kg,emergency_max_farmers_day,is_active,emergency_priority_enabled',
        [value.name,value.location,value.days,value.open,value.close,value.duration,value.farmers,value.kg,value.slotFarmers,value.slotKg,value.emergencyKg,value.emergencyFarmers,value.is_active,value.emergency_priority_enabled]
      ); rows = result.rows;
    } else {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(422).json({ error: 'Choose a valid centre.' });
      const result = await db.query(
        'UPDATE procurement_centres SET name=$2,location=$3,operating_days=$4,opening_time=$5::time,closing_time=$6::time,slot_duration_minutes=$7,max_farmers_day=$8,max_quantity_kg_day=$9,max_farmers_slot=$10,max_quantity_kg_slot=$11,emergency_reserved_kg=$12,emergency_max_farmers_day=$13,is_active=$14,emergency_priority_enabled=$15,updated_at=now() WHERE id=$1 RETURNING id,name,location,operating_days,opening_time,closing_time,slot_duration_minutes,max_farmers_day,max_quantity_kg_day,max_farmers_slot,max_quantity_kg_slot,emergency_reserved_kg,emergency_max_farmers_day,is_active,emergency_priority_enabled',
        [id,value.name,value.location,value.days,value.open,value.close,value.duration,value.farmers,value.kg,value.slotFarmers,value.slotKg,value.emergencyKg,value.emergencyFarmers,value.is_active,value.emergency_priority_enabled]
      ); rows = result.rows;
      if (!rows.length) return res.status(404).json({ error: 'Centre not found.' });
    }
    try { await events.publish('kisansetu-queue','centre_updated',{ id: rows[0].id }); } catch (_) {}
    return res.status(req.method === 'POST' ? 201 : 200).json({ centre: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Centre details could not be saved.' });
  }
}
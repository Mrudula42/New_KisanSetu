import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET','POST'];

export default async function (req, res) {
  const user = req.user;
  try {
    if (req.method === 'GET') {
      const { rows } = await db.query('SELECT user_id, full_name, phone, village, district, preferred_language, created_at FROM farmer_profiles WHERE user_id = $1', [String(user.id)]);
      return res.json({ profile: rows[0] || null, account: { email: user.email || '', name: user.name || '' } });
    }
    const body = req.body || {};
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    const district = typeof body.district === 'string' ? body.district.trim() : '';
    const language = ['en','hi','mr'].includes(body.preferred_language) ? body.preferred_language : 'en';
    if (fullName.length < 2 || fullName.length > 100) return res.status(422).json({ error: 'Enter your full name (2–100 characters).' });
    if (phone && !/^[+0-9 ()-]{7,20}$/.test(phone)) return res.status(422).json({ error: 'Enter a valid phone number.' });
    const { rows } = await db.query(
      `INSERT INTO farmer_profiles (user_id, full_name, phone, village, district, preferred_language)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET full_name=EXCLUDED.full_name, phone=EXCLUDED.phone,
       village=EXCLUDED.village, district=EXCLUDED.district, preferred_language=EXCLUDED.preferred_language, updated_at=now()
       RETURNING user_id, full_name, phone, village, district, preferred_language, created_at`,
      [String(user.id), fullName, phone, village, district, language]
    );
    return res.json({ profile: rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Your profile could not be saved. Please try again.' });
  }
}
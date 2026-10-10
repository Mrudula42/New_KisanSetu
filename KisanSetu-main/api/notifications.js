import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET','PATCH'];

export default async function (req, res) {
  const userId = String(req.user.id);
  try {
    if (req.method === 'GET') {
      const { rows } = await db.query('SELECT id,booking_id,title,message,category,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId]);
      return res.json({ notifications: rows });
    }
    const id = Number((req.body || {}).id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(422).json({ error: 'Choose a valid notification.' });
    const result = await db.query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING id,is_read', [id,userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Notification not found.' });
    return res.json({ notification: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'Notifications could not be loaded.' });
  }
}
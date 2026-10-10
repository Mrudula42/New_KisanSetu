import { db, events } from 'hatchable';

export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  const userId = String(req.user.id);
  try {
    return res.json(await events.grant(['user:' + userId]));
  } catch (e) {
    return res.status(500).json({ error: 'Live updates are temporarily unavailable.' });
  }
}
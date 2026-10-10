import { createHash } from 'node:crypto';
import { pool } from '../config/database.js';

export const SESSION_COOKIE = 'kisansetu_session';

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function authenticate(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 40) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.role, p.full_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN farmer_profiles p ON p.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [hashSessionToken(token)]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }

    const user = rows[0];
    req.user = {
      id: String(user.id),
      email: user.email,
      role: user.role,
      name: user.full_name || '',
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'You are not authorized to access this resource.' });
    }
    return next();
  };
}

export { hashSessionToken };

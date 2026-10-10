import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../config/database.js';
import { authenticate, hashSessionToken, SESSION_COOKIE } from '../middleware/authentication.js';

const router = Router();
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Wait a few minutes and try again.' },
});

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_LIFETIME_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

function validateEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function validatePassword(value) {
  return typeof value === 'string'
    && value.length >= 12
    && Buffer.byteLength(value, 'utf8') <= 72;
}

function publicUser(row) {
  return {
    id: String(row.id),
    email: row.email,
    name: row.full_name || '',
    role: row.role,
  };
}

async function createSession(connection, userId) {
  const token = randomBytes(32).toString('base64url');
  await connection.execute(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))`,
    [hashSessionToken(token), userId]
  );
  return token;
}

router.post('/register', authRateLimit, async (req, res, next) => {
  const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = validateEmail(req.body?.email);
  const password = req.body?.password;

  if (fullName.length < 2 || fullName.length > 100) {
    return res.status(422).json({ error: 'Enter your full name (2–100 characters).' });
  }
  if (!email) {
    return res.status(422).json({ error: 'Enter a valid email address.' });
  }
  if (!validatePassword(password)) {
    return res.status(422).json({ error: 'Choose a password of 12 or more characters (maximum 72 bytes).' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [userResult] = await connection.execute(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash]
    );
    const userId = String(userResult.insertId);
    await connection.execute(
      'INSERT INTO farmer_profiles (user_id, full_name) VALUES (?, ?)',
      [userId, fullName]
    );
    const token = await createSession(connection, userId);
    await connection.commit();
    setSessionCookie(res, token);
    return res.status(201).json({
      user: { id: userId, email, name: fullName, role: 'FARMER' },
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/login', authRateLimit, async (req, res, next) => {
  const email = validateEmail(req.body?.email);
  const password = req.body?.password;
  if (!email || typeof password !== 'string' || password.length > 72) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.password_hash, u.role, p.full_name
       FROM users u
       LEFT JOIN farmer_profiles p ON p.user_id = u.id
       WHERE u.email = ?
       LIMIT 1`,
      [email]
    );
    const user = rows[0];
    if (!user) {
      await bcrypt.hash(password, 12);
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const connection = await pool.getConnection();
    let token;
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
      token = await createSession(connection, user.id);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    setSessionCookie(res, token);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', (req, res) => {
  if (!req.cookies?.[SESSION_COOKIE]) {
    return res.json({ user: null });
  }
  return authenticate(req, res, () => res.json({ user: req.user }));
});

router.post('/logout', async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  try {
    if (typeof token === 'string' && token.length >= 40) {
      await pool.execute(
        'DELETE FROM sessions WHERE token_hash = ?',
        [hashSessionToken(token)]
      );
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/database.js';
import { hiddenQuestion } from './hidden-input.js';

function question(prompt) {
  const terminal = createInterface({ input: stdin, output: stdout });
  return terminal.question(prompt).finally(() => terminal.close());
}

async function main() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('This command runs only when NODE_ENV=development.');
  }

  const email = (await question('Administrator email: ')).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }

  const [existingRows] = await pool.execute(
    `SELECT u.id, u.role, p.full_name
     FROM users u
     LEFT JOIN farmer_profiles p ON p.user_id = u.id
     WHERE u.email = ?
     LIMIT 1`,
    [email]
  );
  const existing = existingRows[0];

  if (existing?.role === 'FARMER') {
    const confirmation = (await question(
      `This email belongs to a FARMER account. Type PROMOTE to make only ${email} an administrator: `
    )).trim();
    if (confirmation !== 'PROMOTE') {
      throw new Error('Promotion was not confirmed; no account was changed.');
    }
  } else if (!existing) {
    const confirmation = (await question(
      `Create a new ADMIN account for ${email}? Type CREATE to continue: `
    )).trim();
    if (confirmation !== 'CREATE') {
      throw new Error('Creation was not confirmed; no account was changed.');
    }
  } else {
    const confirmation = (await question(
      `Reset the password and revoke sessions for existing ADMIN ${email}? Type RESET to continue: `
    )).trim();
    if (confirmation !== 'RESET') {
      throw new Error('Reset was not confirmed; no account was changed.');
    }
  }

  const fullName = existing?.full_name
    || (await question('Administrator display name: ')).trim();
  if (fullName.length < 2 || fullName.length > 100) {
    throw new Error('Enter a display name between 2 and 100 characters.');
  }

  const password = await hiddenQuestion('New password (minimum 12 characters; input hidden): ');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Choose a password of at least 12 characters and no more than 72 UTF-8 bytes.');
  }
  const confirmation = await hiddenQuestion('Re-enter new password: ');
  if (password !== confirmation) {
    throw new Error('The passwords did not match; no account was changed.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let userId;

    if (existing) {
      userId = existing.id;
      await connection.execute(
        `UPDATE users
         SET password_hash = ?, role = 'ADMIN'
         WHERE id = ?`,
        [passwordHash, userId]
      );
      await connection.execute(
        `INSERT INTO farmer_profiles (user_id, full_name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
        [userId, fullName]
      );
    } else {
      const [result] = await connection.execute(
        `INSERT INTO users (email, password_hash, role)
         VALUES (?, ?, 'ADMIN')`,
        [email, passwordHash]
      );
      userId = result.insertId;
      await connection.execute(
        'INSERT INTO farmer_profiles (user_id, full_name) VALUES (?, ?)',
        [userId, fullName]
      );
    }

    await connection.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  console.log(`Administrator account is ready for ${email}. Sign in at http://localhost:8000/admin.`);
  console.log('The password and password hash were not displayed. Existing sessions for this account were revoked.');
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

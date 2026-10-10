import mysql from 'mysql2/promise';

const requiredDatabaseSettings = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingSettings = requiredDatabaseSettings.filter((name) => !process.env[name]);

if (missingSettings.length > 0) {
  throw new Error(`Missing required database settings: ${missingSettings.join(', ')}`);
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
});

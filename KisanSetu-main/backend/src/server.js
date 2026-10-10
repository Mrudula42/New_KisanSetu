import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pool } from './config/database.js';
import bookingActionRouter from './routes/booking-action.js';
import bookingsRouter from './routes/bookings.js';
import centresRouter from './routes/centres.js';
import adminBoardRouter from './routes/admin-board.js';
import adminCentresRouter from './routes/admin-centres.js';
import authRouter from './routes/auth.js';
import notificationsRouter from './routes/notifications.js';
import produceRouter from './routes/produce.js';
import profileRouter from './routes/profile.js';
import slotsRouter from './routes/slots.js';
import waitingTimeRouter from './routes/waiting-time.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:8000';

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: frontendOrigin,
  credentials: true,
}));
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    && req.headers.origin
    && req.headers.origin !== frontendOrigin) {
    return res.status(403).json({ error: 'This origin is not allowed to modify local KisanSetu data.' });
  }
  return next();
});
app.use(cookieParser());
app.use(express.json({ limit: '20kb' }));

app.use('/api/auth', authRouter);
app.use('/api/centres', centresRouter);
app.use('/api/profile', profileRouter);
app.use('/api/produce', produceRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/booking-action', bookingActionRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/ai/waiting-time', waitingTimeRouter);
app.use('/api/admin/board', adminBoardRouter);
app.use('/api/admin/centres', adminCentresRouter);

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  }

  if (error.code) {
    console.error('Request failed:', error.code);
  } else {
    console.error('Request failed:', error.message);
  }

  return res.status(500).json({ error: 'The request could not be completed.' });
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`KisanSetu API listening on http://localhost:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; closing the API server.`);
  server.close(async (error) => {
    await pool.end();
    if (error) {
      console.error('API server shutdown failed:', error.message);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

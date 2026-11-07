import 'dotenv/config';

const env = process.env;

export const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT || 3000),
  tz: env.TZ || 'Africa/Nairobi',
  databaseUrl: env.DATABASE_URL || 'postgres://rent:rent@localhost:5432/rent_dev',
  jwtSecret: env.JWT_SECRET || '',
  publicUrl: (env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
  mpesa: {
    env: env.MPESA_ENV || 'sandbox',
    consumerKey: env.MPESA_CONSUMER_KEY || '',
    consumerSecret: env.MPESA_CONSUMER_SECRET || '',
    shortcode: env.MPESA_SHORTCODE || '174379',
    passkey: env.MPESA_PASSKEY || '',
    webhookSecret: env.MPESA_WEBHOOK_SECRET || '',
    callbackBaseUrl: (env.MPESA_CALLBACK_BASE_URL || '').replace(/\/$/, ''),
  },
  sms: {
    username: env.AT_USERNAME || 'sandbox',
    apiKey: env.AT_API_KEY || '',
    senderId: env.AT_SENDER_ID || '',
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'rent@example.com',
  },
  reminders: {
    beforeDays: 3,
    overdueDays: [1, 3, 7, 14],
  },
  retention: {
    archiveDays: 60, // vacated tenant records are deleted after this many days
    logDays: 365, // activity log entries older than this are deleted
  },
  disableJobs: env.DISABLE_JOBS === 'true',
};

/** Fail fast on unsafe configuration. */
export function assertConfig() {
  if (!config.jwtSecret || config.jwtSecret.length < 16) {
    throw new Error('JWT_SECRET must be set to a random string of at least 16 characters.');
  }
}

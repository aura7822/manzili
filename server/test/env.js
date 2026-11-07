// Must be imported before any app module so config picks these values up.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://rent:rent@localhost:5432/rent_test';
process.env.JWT_SECRET = 'test-secret-test-secret-123456';
process.env.MPESA_CONSUMER_KEY = 'key';
process.env.MPESA_CONSUMER_SECRET = 'secret';
process.env.MPESA_PASSKEY = 'passkey';
process.env.MPESA_WEBHOOK_SECRET = 'whsec_test';
process.env.MPESA_CALLBACK_BASE_URL = 'https://example.test';
process.env.TZ = 'Africa/Nairobi';
process.env.AT_API_KEY = 'test-sms-key';

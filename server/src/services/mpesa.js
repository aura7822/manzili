import { config } from '../config.js';

const cache = { token: null, expiresAt: 0 };

const baseUrl = () =>
  config.mpesa.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

/** YYYYMMDDHHmmss in Africa/Nairobi, as Daraja expects. */
function timestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

function password(ts) {
  const { shortcode, passkey } = config.mpesa;
  return Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');
}

async function accessToken() {
  if (cache.token && Date.now() < cache.expiresAt) return cache.token;

  const { consumerKey, consumerSecret } = config.mpesa;
  const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error(`M-Pesa auth failed (${res.status})`);

  const data = await res.json();
  cache.token = data.access_token;
  cache.expiresAt = Date.now() + 50 * 60 * 1000;
  return cache.token;
}

async function post(path, body) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

// Exported as an object so tests can replace the methods.
export const mpesa = {
  isConfigured() {
    const m = config.mpesa;
    return Boolean(m.consumerKey && m.consumerSecret && m.passkey && m.webhookSecret && m.callbackBaseUrl);
  },

  callbackUrl() {
    return `${config.mpesa.callbackBaseUrl}/api/webhooks/mpesa/${config.mpesa.webhookSecret}/stk`;
  },

  /** Start an STK Push. `amount` must be a whole number of shillings. */
  async stkPush({ phone, amount, reference, description }) {
    const ts = timestamp();
    return post('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: config.mpesa.shortcode,
      Password: password(ts),
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: config.mpesa.shortcode,
      PhoneNumber: phone,
      CallBackURL: this.callbackUrl(),
      AccountReference: String(reference).slice(0, 12),
      TransactionDesc: String(description).slice(0, 13),
    });
  },

  async stkQuery(checkoutRequestId) {
    const ts = timestamp();
    return post('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: config.mpesa.shortcode,
      Password: password(ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    });
  },
};

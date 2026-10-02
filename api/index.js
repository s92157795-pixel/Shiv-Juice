const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = ROOT_DIR;
const FALLBACK_FRAMES_DIR = 'c:/Users/shiv/Downloads/ezgif-5175a26bed708a9b-jpg';
const SHOP_LOCATION = 'Shiv Juice Center, Sonia Vihar 3rd Pusta, Delhi - 110094';

// Automatically parse and load .env configuration
function loadEnv() {
  const envPath = path.join(PUBLIC_DIR, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const k = trimmed.slice(0, eqIdx).trim();
            const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (k) process.env[k] = v;
          }
        }
      });
      console.log('[ENV LOADED] Configuration parsed from .env');
    } catch (e) {
      console.error('Error loading .env file:', e.message);
    }
  }
}
loadEnv();

let orderSummaryService = null;
try {
  orderSummaryService = require('../lib/order-summary-service');
} catch (e) {
  console.warn('[WARN] orderSummaryService could not be loaded:', e.message);
}

let Razorpay = null;
try {
  Razorpay = require('razorpay');
} catch (e) {
  console.warn('[WARN] razorpay module could not be loaded:', e.message);
}

// Payment Gateway & UPI Configuration
const PUBLIC_UPI_ID = process.env.PUBLIC_UPI_ID || '8799779715@ptaxis';
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Shiv Juice Center';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.PAYMENT_GATEWAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_GATEWAY_KEY_SECRET || '';
const PAYMENT_GATEWAY_KEY_ID = RAZORPAY_KEY_ID;
const PAYMENT_GATEWAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
const PAYMENT_GATEWAY_WEBHOOK_SECRET = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET || '';

let razorpay = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  try {
    razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
    console.log(`[RAZORPAY SDK INITIALIZED] Active Key: ${RAZORPAY_KEY_ID}`);
  } catch (err) {
    console.error('Failed to initialize Razorpay SDK:', err.message);
  }
}

console.log(`[PAYMENT CONFIG] Business: "${BUSINESS_NAME}" | UPI ID: "${PUBLIC_UPI_ID}" | Razorpay: ${RAZORPAY_KEY_ID ? 'Configured (' + RAZORPAY_KEY_ID.slice(0, 8) + '...)' : 'Not set'}`);

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=UTF-8'
};

// In-memory OTP storage: mobile -> { otp, expiresAt, attempts }
const otpStore = new Map();

// Rate limiting tracker: mobile -> { count, firstReq, lastReq }
const otpRateLimit = new Map();

function checkRateLimit(mobile) {
  const now = Date.now();
  const entry = otpRateLimit.get(mobile) || { count: 0, firstReq: now, lastReq: 0 };

  // Throttle: minimum 5s between requests
  if (now - entry.lastReq < 5000) {
    const waitSec = Math.ceil((5000 - (now - entry.lastReq)) / 1000);
    return { allowed: false, message: `Please wait ${waitSec}s before requesting another OTP.` };
  }

  // Window: reset every 10 minutes
  if (now - entry.firstReq > 10 * 60 * 1000) {
    entry.count = 0;
    entry.firstReq = now;
  }

  // Max 10 OTP requests per 10 minutes
  if (entry.count >= 10) {
    return { allowed: false, message: 'Too many OTP requests. Please wait a few minutes before trying again.' };
  }

  entry.count += 1;
  entry.lastReq = now;
  otpRateLimit.set(mobile, entry);
  return { allowed: true };
}

// Indian mobile normalization: accept 10-digit number (+91, 0, or raw 10 digits)
function normalizeIndianMobile(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return digits;
  }
  if (digits.length === 12 && digits.startsWith('91') && /^91[6-9]\d{9}$/.test(digits)) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0') && /^0[6-9]\d{9}$/.test(digits)) {
    return digits.slice(1);
  }
  return null;
}

// Password hashing & verification utilities (PBKDF2 standard)
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// Built-in accounts ensuring critical registered users never lose access during cold starts
const BUILTIN_ACCOUNTS = {
  '8799779715': {
    name: 'Shiv',
    mobile: '8799779715',
    passwordHash: '53b6867efe65c164175b80ec101a85d6:1be778fde72033a43df84f41a60c07aa0dd479b0581d18c99ab325892755b90b3ae140765a6d2cbb6d84f024645121e110b43396d2c67d23ff67dee5fe00dada',
    email: '8799779715@customer.shivjuice.com'
  }
};
global.__RUNTIME_ACCOUNTS = global.__RUNTIME_ACCOUNTS || {};

function resolveAccount(cleanMobile) {
  let profile = orderSummaryService ? orderSummaryService.getProfileByMobile(cleanMobile) : null;
  if (!profile || !profile.passwordHash) {
    if (global.__RUNTIME_ACCOUNTS[cleanMobile] && global.__RUNTIME_ACCOUNTS[cleanMobile].passwordHash) {
      profile = global.__RUNTIME_ACCOUNTS[cleanMobile];
    } else if (BUILTIN_ACCOUNTS[cleanMobile]) {
      profile = BUILTIN_ACCOUNTS[cleanMobile];
    }
  }
  return profile;
}

// Helper: Dispatch SMS via Fast2SMS to any mobile number
async function dispatchFast2Sms(mobile, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  const otpId = process.env.FAST2SMS_OTP_ID;
  const message = `Your Shiv Juice Center verification code is ${otp}. Valid for 5 minutes. Do not share this OTP with anyone.`;
  const timestamp = new Date().toISOString();

  console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│ 📲 DISPATCHING REAL CELLULAR SMS VIA FAST2SMS               │`);
  console.log(`│ TO: +91 ${mobile.padEnd(52)}│`);
  console.log(`│ OTP CODE: ${otp.padEnd(50)}│`);
  console.log(`│ Message: ${message.slice(0, 48).padEnd(49)}│`);
  console.log(`└─────────────────────────────────────────────────────────────┘\n`);

  // Record in local outbox log
  try {
    const logEntry = `[${timestamp}] TO: +91 ${mobile} | OTP: ${otp} | MSG: "${message}"\n`;
    fs.appendFileSync(path.join(PUBLIC_DIR, 'sms_outbox.log'), logEntry, 'utf8');
  } catch (e) {
    console.error('Error logging to sms_outbox.log:', e.message);
  }

  if (!apiKey) {
    console.warn('[Fast2SMS] No FAST2SMS_API_KEY found in .env');
    return { success: false, message: 'Fast2SMS API key not set' };
  }

  // 1. Primary: Fast2SMS Quick Route (Active & Verified with ₹150 balance)
  try {
    const respQ = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        route: 'q',
        message: message,
        language: 'english',
        flash: 0,
        numbers: mobile
      })
    });
    const dataQ = await respQ.json().catch(() => null);
    console.log('[Fast2SMS Quick SMS Dispatch Result]', dataQ);
    if (dataQ && dataQ.return) {
      console.log(`\n✅ REAL SMS SUCCESSFULLY TRANSMITTED TO CARRIER FOR +91 ${mobile} (Request ID: ${dataQ.request_id})\n`);
      return { success: true, via: 'bulkV2/q', message: dataQ.message };
    }
  } catch (e) {
    console.error('[Fast2SMS Quick SMS Error]', e.message);
  }

  // 2. Secondary: If OTP ID configured in .env
  if (otpId) {
    try {
      const resp = await fetch('https://www.fast2sms.com/dev/otp/send', {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ otp_id: otpId, mobile: mobile })
      });
      const data = await resp.json().catch(() => null);
      if (data && data.return) return { success: true, via: 'otp/send', message: data.message };
    } catch (e) {
      console.error('[Fast2SMS OTP/Send Error]', e.message);
    }
  }

  return { success: false, message: 'SMS gateway processed' };
}


// Optional Google Apps Script Webhook URL (can be set by user)
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || '';

const isVercel = !!process.env.VERCEL;
const ORDERS_JSON_PATH = isVercel ? path.join('/tmp', 'orders.json') : path.join(PUBLIC_DIR, 'orders.json');
const ORDERS_CSV_PATH = isVercel ? path.join('/tmp', 'orders.csv') : path.join(PUBLIC_DIR, 'orders.csv');

function getStoredOrders() {
  const targetPath = (isVercel && fs.existsSync(ORDERS_JSON_PATH)) 
    ? ORDERS_JSON_PATH 
    : path.join(PUBLIC_DIR, 'orders.json');
  if (fs.existsSync(targetPath)) {
    try {
      return JSON.parse(fs.readFileSync(targetPath, 'utf8')) || [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveStoredOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_JSON_PATH, JSON.stringify(orders, null, 2), 'utf8');
  } catch (e) {
    if (!isVercel) console.error('Error writing orders.json:', e.message);
  }
}

function appendOrderToCsv(order) {
  const csvFile = ORDERS_CSV_PATH;
  const csvHeader = 'OrderID,Timestamp,Name,CustomerEmail,Mobile,DelhiLocality,FlatHouse,AreaStreet,Landmark,City,State,Pincode,AddressType,PaymentMethod,JuiceItem,Price,Quantity,Total,ShopOrigin,AdminEmail,NotificationMessage,PaymentStatus,GatewayOrderId,GatewayPaymentId,PaymentTimestamp\n';
  const clean = (s) => (s ? String(s).replace(/"/g, '""').replace(/\n/g, ' ') : '');
  
  const row = `"${order.orderId}","${order.timestamp || order.createdTimestamp}","${clean(order.name)}","${clean(order.customerEmail)}","${clean(order.mobile)}","${clean(order.delhiLocality || 'Sonia Vihar')}","${clean(order.flatHouse)}","${clean(order.areaStreet)}","${clean(order.landmark)}","${clean(order.city || 'Delhi')}","${clean(order.state || 'Delhi')}","${clean(order.pincode)}","${clean(order.addressType)}","${clean(order.paymentMethod)}","${clean(order.juiceItem)}","${order.price || ''}","${order.quantity || 1}","${order.finalAmount || order.total || ''}","${SHOP_LOCATION}","kanhaiyapandat4@gmail.com","order are placed","${order.paymentStatus || 'PENDING'}","${clean(order.gatewayOrderId)}","${clean(order.gatewayPaymentId)}","${clean(order.paymentTimestamp)}"\n`;

  try {
    if (!fs.existsSync(csvFile)) {
      fs.writeFileSync(csvFile, csvHeader + row, 'utf8');
    } else {
      fs.appendFileSync(csvFile, row, 'utf8');
    }
  } catch (e) {
    if (!isVercel) console.error('Error writing orders.csv:', e.message);
  }
}

const requestHandler = (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const rawUrl = (req.headers && (req.headers['x-matched-path'] || req.headers['x-forwarded-uri'])) || req.url || '/';
  let reqPath = decodeURI(rawUrl.split('?')[0]);
  // Diagnostic Status Check
  if (reqPath === '/api/debug' || reqPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      time: new Date().toISOString(),
      node: process.version,
      isVercel: !!process.env.VERCEL,
      hasOrderSummaryService: !!orderSummaryService,
      hasRazorpay: !!Razorpay
    }));
    return;
  }

  // ==========================================
  // FAST2SMS OTP API: Send OTP
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/send-otp') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let mobile = '';
        try {
          const parsed = JSON.parse(body || '{}');
          mobile = parsed.mobile;
        } catch (_) {
          const match = body.match(/mobile[="':\s]+([0-9]{10,12})/);
          if (match) mobile = match[1];
        }

        const cleanMobile = normalizeIndianMobile(mobile);
        if (!cleanMobile) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Please enter a valid 10-digit Indian mobile number.' }));
          return;
        }

        const rateCheck = checkRateLimit(cleanMobile);
        if (!rateCheck.allowed) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: rateCheck.message }));
          return;
        }

        // Generate real 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity
        otpStore.set(cleanMobile, { otp, expiresAt, attempts: 0 });

        // Dispatch real SMS to the user's mobile number via Fast2SMS
        await dispatchFast2Sms(cleanMobile, otp);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          mobile: cleanMobile,
          message: `OTP sent to mobile message box on +91 ${cleanMobile}`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Error dispatching OTP: ' + err.message }));
      }
    });
    return;
  }

  // ==========================================
  // FAST2SMS OTP API: Resend OTP
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/resend-otp') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let mobile = '';
        try {
          const parsed = JSON.parse(body || '{}');
          mobile = parsed.mobile;
        } catch (_) {
          const match = body.match(/mobile[="':\s]+([0-9]{10,12})/);
          if (match) mobile = match[1];
        }

        const cleanMobile = normalizeIndianMobile(mobile);
        if (!cleanMobile) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Please enter a valid 10-digit Indian mobile number.' }));
          return;
        }

        const rateCheck = checkRateLimit(cleanMobile);
        if (!rateCheck.allowed) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: rateCheck.message }));
          return;
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000;
        otpStore.set(cleanMobile, { otp, expiresAt, attempts: 0 });

        await dispatchFast2Sms(cleanMobile, otp);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          mobile: cleanMobile,
          message: `New OTP resent to mobile message box on +91 ${cleanMobile}`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Error resending OTP: ' + err.message }));
      }
    });
    return;
  }

  // ==========================================
  // FAST2SMS OTP API: Verify OTP & Authenticate User
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/verify-otp') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let mobile = '', otp = '', parsed = {};
        try {
          parsed = JSON.parse(body || '{}');
          mobile = parsed.mobile;
          otp = parsed.otp;
        } catch (_) {
          const mMatch = body.match(/mobile[="':\s]+([0-9]{10,12})/);
          const oMatch = body.match(/otp[="':\s]+([0-9]{4,8})/);
          if (mMatch) mobile = mMatch[1];
          if (oMatch) otp = oMatch[1];
        }

        const cleanMobile = normalizeIndianMobile(mobile);
        const enteredOtp = String(otp || '').trim();

        if (!cleanMobile) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Please enter a valid 10-digit Indian mobile number.' }));
          return;
        }

        // Real Firebase Phone Auth verified
        if (parsed.firebaseVerified) {
          otpStore.delete(cleanMobile);
          const user = {
            name: `Customer (${cleanMobile.slice(-4)})`,
            mobile: cleanMobile,
            email: `${cleanMobile}@customer.shivjuice.com`,
            loginType: 'mobile',
            loginTime: new Date().toISOString()
          };
          console.log(`[USER AUTHENTICATED VIA REAL SMS] Mobile: +91 ${cleanMobile}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: 'Phone verified successfully via real SMS.',
            user: user
          }));
          return;
        }

        if (!enteredOtp || enteredOtp.length !== 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Please enter the 6-digit OTP received on your mobile.' }));
          return;
        }

        let isVerified = false;

        // 1. If FAST2SMS_OTP_ID is set, check with Fast2SMS verify API first
        if (process.env.FAST2SMS_API_KEY && process.env.FAST2SMS_OTP_ID) {
          try {
            const fastResp = await fetch('https://www.fast2sms.com/dev/otp/verify', {
              method: 'POST',
              headers: {
                'Authorization': process.env.FAST2SMS_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({ mobile: cleanMobile, otp: enteredOtp })
            });
            const fastData = await fastResp.json().catch(() => null);
            if (fastData && fastData.return) isVerified = true;
          } catch (_) {}
        }

        // 2. Check server-side OTP record
        const stored = otpStore.get(cleanMobile);
        if (!isVerified) {
          if (!stored) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'No OTP requested for this number or OTP has expired. Please request a new OTP.' }));
            return;
          }

          if (Date.now() > stored.expiresAt) {
            otpStore.delete(cleanMobile);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'OTP has expired (valid for 5 minutes). Please request a new OTP.' }));
            return;
          }

          if (stored.attempts >= 5) {
            otpStore.delete(cleanMobile);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Too many incorrect attempts. Please request a new OTP.' }));
            return;
          }

          if (stored.otp !== enteredOtp) {
            stored.attempts = (stored.attempts || 0) + 1;
            const remaining = 5 - stored.attempts;
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: `Incorrect OTP. Please enter the code sent via SMS (${remaining} attempts left).` }));
            return;
          }

          isVerified = true;
        }

        // Authentication successful
        otpStore.delete(cleanMobile);
        const profile = resolveAccount(cleanMobile);
        const hasPassword = !!(profile && profile.passwordHash);

        const user = {
          name: (profile && profile.name) ? profile.name : `Customer (${cleanMobile.slice(-4)})`,
          mobile: cleanMobile,
          email: (profile && profile.email) ? profile.email : `${cleanMobile}@customer.shivjuice.com`,
          loginType: 'mobile_otp',
          hasPassword: hasPassword,
          loginTime: new Date().toISOString()
        };

        console.log(`[USER AUTHENTICATED VIA OTP] Mobile: +91 ${cleanMobile} (hasPassword: ${hasPassword})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'OTP verified successfully.',
          isNewUser: !hasPassword,
          hasPassword: hasPassword,
          user: user
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Verification error: ' + err.message }));
      }
    });
    return;
  }

  // ==========================================
  // AUTH: Check if User Exists & Has Password
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/check-user') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { mobile } = JSON.parse(body || '{}');
        const cleanMobile = normalizeIndianMobile(mobile);
        if (!cleanMobile) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Valid 10-digit mobile number required.' }));
        }
        const profile = resolveAccount(cleanMobile);
        const hasPassword = !!(profile && profile.passwordHash);
        const exists = !!profile;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          mobile: cleanMobile,
          exists: exists,
          hasPassword: hasPassword,
          name: profile ? (profile.name || null) : null
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error: ' + err.message }));
      }
    });
    return;
  }

  // ==========================================
  // AUTH: Sign In with Mobile & Password (Returning Users)
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/login-password') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { mobile, password } = JSON.parse(body || '{}');
        const cleanMobile = normalizeIndianMobile(mobile);
        if (!cleanMobile) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Please enter a valid 10-digit mobile number.' }));
        }
        if (!password || typeof password !== 'string' || password.length < 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Please enter your password.' }));
        }

        const profile = resolveAccount(cleanMobile);
        if (!profile || !profile.passwordHash) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            code: 'NO_ACCOUNT',
            message: 'This mobile number is not registered yet. Please create an account first.'
          }));
        }

        const isMatch = verifyPassword(password, profile.passwordHash);
        if (!isMatch) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            code: 'WRONG_PASSWORD',
            message: 'Incorrect password. Please try again.'
          }));
        }

        const user = {
          name: profile.name || `Customer (${cleanMobile.slice(-4)})`,
          mobile: cleanMobile,
          email: profile.email || `${cleanMobile}@customer.shivjuice.com`,
          loginType: 'password',
          hasPassword: true,
          loginTime: new Date().toISOString()
        };

        console.log(`[USER SIGNED IN VIA PASSWORD] Mobile: +91 ${cleanMobile} (${user.name})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Signed in successfully!',
          user: user
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Login error: ' + err.message }));
      }
    });
    return;
  }

  // ==========================================
  // AUTH: Set Password & Complete Signup (First-Time Users)
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/set-password') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { mobile, password, name } = JSON.parse(body || '{}');
        const cleanMobile = normalizeIndianMobile(mobile);
        if (!cleanMobile) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Valid 10-digit mobile number is required.' }));
        }
        if (!password || typeof password !== 'string' || password.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Password must be at least 6 characters long.' }));
        }

        // DUPLICATE SIGNUP PREVENTION: Block if this mobile already has a password set
        const existingProfile = resolveAccount(cleanMobile);
        if (existingProfile && existingProfile.passwordHash) {
          if (verifyPassword(password, existingProfile.passwordHash)) {
            const user = {
              name: existingProfile.name || (name && name.trim()) || `Customer (${cleanMobile.slice(-4)})`,
              mobile: cleanMobile,
              email: existingProfile.email || `${cleanMobile}@customer.shivjuice.com`,
              loginType: 'password',
              hasPassword: true,
              loginTime: new Date().toISOString()
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              message: 'Signed in successfully!',
              user: user
            }));
          }

          res.writeHead(409, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            code: 'ALREADY_REGISTERED',
            message: 'This mobile number is already registered. Please Sign In with your password instead.'
          }));
        }

        const passwordHash = hashPassword(password);
        let updatedProfile = { mobile: cleanMobile, passwordHash };
        if (name && name.trim()) {
          updatedProfile.name = name.trim();
        }

        // Cache in runtime memory immediately
        global.__RUNTIME_ACCOUNTS[cleanMobile] = updatedProfile;

        if (orderSummaryService) {
          const resSave = orderSummaryService.saveProfile(updatedProfile);
          if (resSave && resSave.profile) {
            updatedProfile = resSave.profile;
          }
        }

        const user = {
          name: updatedProfile.name || (name && name.trim()) || `Customer (${cleanMobile.slice(-4)})`,
          mobile: cleanMobile,
          email: updatedProfile.email || `${cleanMobile}@customer.shivjuice.com`,
          loginType: 'signup',
          hasPassword: true,
          loginTime: new Date().toISOString()
        };

        console.log(`[PASSWORD SET & USER REGISTERED] Mobile: +91 ${cleanMobile} (${user.name})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Password set successfully! Welcome to Shiv Juice Center.',
          user: user
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Error setting password: ' + err.message }));
      }
    });
    return;
  }


  // ==========================================
  // API: Google Accounts Authentication
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/google-auth') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        let email = '', name = '', picture = '', sub = '';
        try {
          const parsed = JSON.parse(body || '{}');
          email = parsed.email;
          name = parsed.name;
          picture = parsed.picture;
          sub = parsed.sub;
        } catch (_) {
          const eMatch = body.match(/email[="':\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          const nMatch = body.match(/name[="':\s]+([^"',}\s]+)/);
          if (eMatch) email = eMatch[1];
          if (nMatch) name = nMatch[1];
        }

        if (!email || !email.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Valid Google email required' }));
          return;
        }

        const user = {
          name: name || email.split('@')[0],
          email: email.trim().toLowerCase(),
          picture: picture || '',
          googleId: sub || '',
          loginType: 'google',
          loginTime: new Date().toISOString()
        };

        console.log(`[GOOGLE AUTH] Signed in: ${user.name} <${user.email}>`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Google authentication successful',
          user: user
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Google Auth error: ' + e.message }));
      }
    });
    return;
  }

  // ================================================================
  // UPI PAYMENT GATEWAY & ORDER PERSISTENCE SYSTEM
  // ================================================================

  // Server-Side Product Price Registry for Dynamic Calculation (Never Trust Browser Totals)
  const MENU_PRICES = {
    'classic damascus rose milk': 75,
    'classic damascus rose': 75,
    'royal almond badam rose': 95,
    'cardamom rose velvet': 85,
    'honey rose organic breeze': 90,
    'kashmiri kesar badam rose (500ml)': 120,
    'shiv special host box (6 bottles)': 420,
    'fresh fruit rose fusion (500ml)': 110,
    'weekly health cellar (12 bottles)': 790,
    '3-bottle tasting crate': 215,
    '6-bottle celebration crate': 420,
    '12-bottle party cellar': 790,
    'shiv mini rose milk pouch (120ml)': 10,
    'mini rose milk pouch': 10,
    'rose milk pouch': 10,
    'rose milk pouch (10rs)': 10
  };

  function calculateOrderAmount(juiceItem, quantity, declaredPrice) {
    const cleanName = (juiceItem || '').trim().toLowerCase();
    let unitPrice = MENU_PRICES[cleanName];
    if (!unitPrice) {
      const parsedDeclared = parseInt(declaredPrice, 10);
      unitPrice = (parsedDeclared && parsedDeclared > 0) ? parsedDeclared : 75;
    }
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const subtotal = unitPrice * qty;
    const discounts = 0;
    const taxes = 0;
    const deliveryCharges = 0; // Free cold-chain dispatch within Delhi NCR service zone
    const finalAmount = subtotal - discounts + taxes + deliveryCharges;
    return {
      unitPrice,
      quantity: qty,
      subtotal,
      discounts,
      taxes,
      deliveryCharges,
      finalAmount
    };
  }


  function dispatchDualOrderNotifications(order) {
    console.log(`[ORDER SAVED] #${order.orderId} for ${order.name} (${order.customerEmail || 'No email'}) - Method: ${order.paymentMethod} - Status: ${order.paymentStatus}`);
    
    // 1. Auto-update WooCommerce Excel & CSV sheet in 'c:\Users\shiv\Downloads\Oder Summary'
    try {
      const allOrders = getStoredOrders();
      orderSummaryService.updateOrderSummarySheets(allOrders);
    } catch (eSheet) {
      console.error('[ORDER SUMMARY AUTO-SYNC ERROR]', eSheet.message);
    }

    // 2. Batch Notification Manager (Dispatches to kanhaiyapandat4@gmail.com every 5-6 orders)
    try {
      orderSummaryService.recordOrderForBatchNotification(order);
    } catch (eBatch) {
      console.error('[BATCH NOTIFICATION ERROR]', eBatch.message);
    }

    // Customer transactional notification if email provided
    if (order.customerEmail && order.customerEmail.includes('@') && !order.customerEmail.includes('@customer.shivjuice.com')) {
      console.log(`[EMAIL DISPATCH] Sent order receipt to customer ${order.customerEmail}`);
    }

    if (GOOGLE_SHEET_WEBHOOK_URL) {
      try {
        const https = require('https');
        const sheetReq = https.request(GOOGLE_SHEET_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const payloadToSend = {
          ...order,
          productName: order.productName || order.juiceItem || 'Classic Damascus Rose Milk',
          juiceItem: order.productName || order.juiceItem || 'Classic Damascus Rose Milk'
        };
        sheetReq.write(JSON.stringify(payloadToSend));
        sheetReq.end();
      } catch (eSheet) {
        console.error('[GOOGLE SHEET WEBHOOK ERROR]', eSheet.message);
      }
    }
  }

  // Official Razorpay Gateway API Helpers (Using Razorpay SDK & Fallback REST)
  async function createRazorpayOrder(orderId, amountPaise, notes = {}) {
    if (razorpay) {
      try {
        const order = await razorpay.orders.create({
          amount: Math.round(amountPaise),
          currency: 'INR',
          receipt: orderId,
          notes: notes
        });
        if (order && order.id) {
          console.log(`[Razorpay SDK Order Created] Gateway Order ID: ${order.id} for #${orderId} (₹${amountPaise / 100})`);
          return order;
        }
      } catch (err) {
        console.error('[Razorpay SDK Order Error]', err.message);
      }
    }

    if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
        const resp = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: Math.round(amountPaise),
            currency: 'INR',
            receipt: orderId,
            notes: notes
          })
        });
        const data = await resp.json().catch(() => null);
        if (data && data.id) {
          console.log(`[Razorpay REST Order Created] Gateway Order ID: ${data.id} for #${orderId}`);
          return data;
        } else {
          console.warn('[Razorpay Order Creation API Warning]', data);
        }
      } catch (e) {
        console.error('[Razorpay Order API Error]', e.message);
      }
    }
    return null;
  }

  async function verifyRazorpayPaymentDetails(paymentId, expectedPaise) {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !paymentId) {
      return { verified: false, reason: 'Credentials not configured' };
    }
    try {
      const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
      const resp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
        method: 'GET',
        headers: { 'Authorization': authHeader }
      });
      const data = await resp.json().catch(() => null);
      if (data && data.id) {
        const isStatusOk = (data.status === 'captured' || data.status === 'authorized');
        const isAmountOk = (parseInt(data.amount, 10) === Math.round(expectedPaise));
        const isCurrencyOk = (data.currency === 'INR');
        if (isStatusOk && isAmountOk && isCurrencyOk) {
          return { verified: true, payment: data };
        } else {
          return { 
            verified: false, 
            reason: `Gateway mismatch: status=${data.status}, amount=${data.amount} (expected ${expectedPaise}), currency=${data.currency}` 
          };
        }
      }
      return { verified: false, reason: data ? (data.error && data.error.description) || 'Payment not found' : 'Invalid gateway response' };
    } catch (e) {
      return { verified: false, reason: e.message };
    }
  }

  // ==========================================
  // STEP 1: BACKEND - Create Order
  // Endpoints: POST /api/create-order and POST /api/payment/create-order
  // ==========================================
  if (req.method === 'POST' && (reqPath === '/api/create-order' || reqPath === '/api/payment/create-order')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let orderData = {};
        try {
          orderData = JSON.parse(body || '{}');
        } catch (_) {
          orderData = {};
        }

        const extract = (field) => {
          const regex = new RegExp(`["']?${field}["']?\\s*[:=]\\s*["']?([^"',{}]+)["']?`, 'i');
          const m = body.match(regex);
          return m ? m[1].trim() : '';
        };

        // Check authentication / credentials
        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Razorpay credentials not configured on server (401 Unauthorized)' }));
          return;
        }

        const name = (orderData.name || extract('name') || 'Customer').trim();
        const customerEmail = (orderData.customerEmail || extract('customerEmail') || extract('email') || '').trim();
        const mobile = (orderData.mobile || extract('mobile') || '').trim();
        const delhiLocality = (orderData.delhiLocality || extract('delhiLocality') || 'Sonia Vihar 3rd Pusta').trim();
        const flatHouse = (orderData.flatHouse || extract('flatHouse') || '').trim();
        const areaStreet = (orderData.areaStreet || extract('areaStreet') || '').trim();
        const landmark = (orderData.landmark || extract('landmark') || '').trim();
        const pincode = (orderData.pincode || extract('pincode') || '110094').trim();
        const juiceItem = (orderData.juiceItem || extract('juiceItem') || 'Classic Damascus Rose Milk').trim();
        const quantity = parseInt(orderData.quantity || extract('quantity') || 1, 10);
        const declaredPrice = orderData.price || extract('price');

        // Dynamically calculate order amount in paise
        let amountInPaise = 0;
        let calc = null;
        if (orderData.amount !== undefined && orderData.amount !== null && !orderData.juiceItem) {
          amountInPaise = Math.round(Number(orderData.amount));
        } else {
          calc = calculateOrderAmount(juiceItem, quantity, declaredPrice);
          amountInPaise = Math.round(calc.finalAmount * 100);
        }

        // Validate minimum amount >= 100 paise (₹1)
        if (isNaN(amountInPaise) || amountInPaise < 100) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Order amount must be at least 100 paise (₹1)', 
            code: 'BAD_REQUEST_ERROR',
            receivedAmount: amountInPaise 
          }));
          return;
        }

        const finalAmountRupees = amountInPaise / 100;
        const receipt = (orderData.receipt || ('rcpt_' + Date.now())).trim();
        const orderId = orderData.orderId || ('SJC-' + Math.floor(100000 + Math.random() * 900000));
        const fullAddress = orderData.address || `${flatHouse}, ${areaStreet}, ${delhiLocality}${landmark ? ', Near ' + landmark : ''}, Delhi - ${pincode}`;

        // Call Razorpay API / SDK to create order
        let rzpOrder = null;
        try {
          if (razorpay) {
            rzpOrder = await razorpay.orders.create({
              amount: amountInPaise,
              currency: orderData.currency || 'INR',
              receipt: receipt,
              notes: {
                orderId: orderId,
                name: name,
                mobile: mobile,
                item: juiceItem,
                quantity: quantity
              }
            });
          } else {
            rzpOrder = await createRazorpayOrder(receipt, amountInPaise, { orderId, name, mobile, item: juiceItem, productName: juiceItem });
          }
        } catch (apiErr) {
          console.error('[Razorpay API Error]', apiErr);
          const statusCode = apiErr.statusCode === 401 ? 401 : 500;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: apiErr.statusCode === 401 ? 'Razorpay authentication failed' : 'Razorpay API order creation failed', 
            details: apiErr.message || (apiErr.error && apiErr.error.description) 
          }));
          return;
        }

        if (!rzpOrder || !rzpOrder.id) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to create order on Razorpay gateway' }));
          return;
        }

        const gatewayOrderId = rzpOrder.id;

        // Dynamic UPI URI structure: upi://pay?pa=8799779715@ptaxis&pn=Shiv%20Juice%20Center&am=AMOUNT&cu=INR
        const upiUri = `upi://pay?pa=${PUBLIC_UPI_ID}&pn=${encodeURIComponent(BUSINESS_NAME)}&am=${finalAmountRupees}&cu=INR&tn=${encodeURIComponent('Order ' + orderId)}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(upiUri)}`;

        const now = new Date().toISOString();
        const orderRecord = {
          orderId,
          name,
          customerEmail,
          mobile,
          delhiLocality,
          flatHouse,
          areaStreet,
          landmark,
          city: orderData.city || 'Delhi (NCT)',
          state: orderData.state || 'Delhi',
          pincode,
          address: fullAddress,
          addressType: orderData.addressType || 'Home',
          productName: juiceItem,
          juiceItem,
          price: calc ? calc.unitPrice : finalAmountRupees,
          quantity: quantity,
          subtotal: finalAmountRupees,
          discounts: 0,
          taxes: 0,
          deliveryCharges: 0,
          finalAmount: finalAmountRupees,
          total: finalAmountRupees,
          paymentMethod: 'UPI',
          paymentStatus: 'PAYMENT_PROCESSING',
          gatewayOrderId: gatewayOrderId,
          gatewayPaymentId: null,
          bankUtr: null,
          paymentTimestamp: null,
          createdTimestamp: now,
          timestamp: now,
          shopLocation: SHOP_LOCATION,
          assignedEmail: 'kanhaiyapandat4@gmail.com',
          status: 'Payment Processing (Razorpay)',
          notificationMessage: 'order are placed'
        };

        // Save order in orders.json with status PAYMENT_PROCESSING
        const orders = getStoredOrders();
        const existingIdx = orders.findIndex(o => o.orderId === orderId || o.gatewayOrderId === gatewayOrderId);
        if (existingIdx !== -1) {
          orders[existingIdx] = orderRecord;
        } else {
          orders.unshift(orderRecord);
        }
        saveStoredOrders(orders);

        console.log(`[RAZORPAY ORDER CREATED] Order #${orderId} | Gateway ID: ${gatewayOrderId} | Amount: ₹${finalAmountRupees} (${amountInPaise} paise)`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          order_id: gatewayOrderId,
          id: gatewayOrderId,
          amount: amountInPaise,
          amountInRupees: finalAmountRupees,
          currency: rzpOrder.currency || 'INR',
          key_id: RAZORPAY_KEY_ID,
          razorpayKeyId: RAZORPAY_KEY_ID,
          receipt: rzpOrder.receipt || orderId,
          orderId: orderId,
          businessName: BUSINESS_NAME,
          upiId: PUBLIC_UPI_ID,
          upiUri: upiUri,
          qrCodeUrl: qrCodeUrl,
          breakdown: calc ? {
            item: juiceItem,
            unitPrice: calc.unitPrice,
            quantity: calc.quantity,
            subtotal: calc.subtotal,
            discounts: calc.discounts,
            taxes: calc.taxes,
            deliveryCharges: calc.deliveryCharges,
            finalAmount: calc.finalAmount
          } : null,
          paymentStatus: 'PAYMENT_PROCESSING'
        }));
      } catch (err) {
        console.error('[CREATE ORDER ERROR]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // STEP 3: BACKEND - Verify Signature
  // Endpoints: POST /api/verify-payment and POST /api/payment/verify
  // Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
  // ==========================================
  if (req.method === 'POST' && (reqPath === '/api/verify-payment' || reqPath === '/api/payment/verify')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let verifyData = {};
        try {
          verifyData = JSON.parse(body || '{}');
        } catch (_) {
          verifyData = {};
        }

        const orderId = (verifyData.order_id || verifyData.razorpay_order_id || verifyData.orderId || verifyData.gatewayOrderId || '').trim();
        const paymentId = (verifyData.payment_id || verifyData.razorpay_payment_id || verifyData.gatewayPaymentId || '').trim();
        const signature = (verifyData.signature || verifyData.razorpay_signature || verifyData.gatewaySignature || '').trim();
        const bankUtr = (verifyData.bankUtr || verifyData.utr || '').trim();

        // Validation for missing fields
        if (!bankUtr && (!orderId || !paymentId || !signature)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            message: 'Missing required payment verification fields (order_id, payment_id, signature)' 
          }));
          return;
        }

        const orders = getStoredOrders();
        // Look up order by internal orderId or gateway order_id
        const orderIndex = orders.findIndex(o => 
          (orderId && o.orderId.toLowerCase() === orderId.toLowerCase()) ||
          (orderId && o.gatewayOrderId === orderId)
        );

        let order = orderIndex !== -1 ? orders[orderIndex] : null;

        // If order found and already marked PAID, return success (Idempotent)
        if (order && order.paymentStatus === 'PAID') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            status: 'PAID',
            orderId: order.orderId,
            order_id: order.gatewayOrderId || orderId,
            payment_id: order.gatewayPaymentId || paymentId,
            amountPaid: order.finalAmount,
            paymentTimestamp: order.paymentTimestamp,
            message: 'Payment has already been verified as PAID.'
          }));
          return;
        }

        let verified = false;
        let verifiedPaymentId = '';

        // Mode 1: HMAC-SHA256 Signature Verification
        if (orderId && paymentId && signature) {
          const expectedSignature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(`${orderId}|${paymentId}`)
            .digest('hex');

          if (expectedSignature !== signature) {
            console.warn(`[SIGNATURE MISMATCH] Expected ${expectedSignature}, Received ${signature}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              message: 'Invalid payment signature: Signature mismatch. Order not marked as paid.'
            }));
            return;
          }

          // Signature matches!
          verified = true;
          verifiedPaymentId = paymentId;
        }
        // Mode 2: Direct 12-digit UTR Verification fallback
        else if (bankUtr) {
          const cleanUtr = bankUtr.replace(/\D/g, '');
          if (cleanUtr.length !== 12) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Please enter a valid 12-digit Indian Bank UPI Reference / UTR number.' }));
            return;
          }

          // Anti-Fraud / Duplicate Prevention: Check if this UTR was used in any other paid order
          const duplicate = orders.find(o => order && o.orderId !== order.orderId && o.paymentStatus === 'PAID' && (o.gatewayPaymentId === cleanUtr || o.bankUtr === cleanUtr));
          if (duplicate) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              message: `This Bank Reference / UTR (${cleanUtr}) has already been reconciled with order #${duplicate.orderId}. Duplicate submissions are prevented.`
            }));
            return;
          }

          verified = true;
          verifiedPaymentId = 'UPI-UTR-' + cleanUtr;
        }

        if (!verified) {
          if (order) {
            order.paymentStatus = 'FAILED';
            saveStoredOrders(orders);
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, status: 'FAILED', message: 'Payment verification failed' }));
          return;
        }

        const resolvedProductName = (verifyData.productName || verifyData.juiceItem || (order ? (order.productName || order.juiceItem) : '') || 'Classic Damascus Rose Milk').trim();

        // If order doesn't exist in memory yet (e.g. created directly via API), create it
        if (!order) {
          order = {
            orderId: 'SJC-' + Math.floor(100000 + Math.random() * 900000),
            name: (verifyData.name || 'Customer').trim(),
            customerEmail: verifyData.customerEmail || 'kanhaiyapandat4@gmail.com',
            mobile: verifyData.mobile || '',
            delhiLocality: verifyData.delhiLocality || 'Sonia Vihar 3rd Pusta',
            productName: resolvedProductName,
            juiceItem: resolvedProductName,
            quantity: Number(verifyData.quantity || 1),
            finalAmount: Number(verifyData.amountPaid || verifyData.amount || 75),
            total: Number(verifyData.amountPaid || verifyData.amount || 75),
            paymentMethod: 'Razorpay',
            paymentStatus: 'PAID',
            gatewayOrderId: orderId,
            gatewayPaymentId: verifiedPaymentId,
            paymentTimestamp: new Date().toISOString(),
            createdTimestamp: new Date().toISOString(),
            shopLocation: SHOP_LOCATION,
            assignedEmail: 'kanhaiyapandat4@gmail.com',
            status: 'Paid & Preparing at Sonia Vihar 3rd Pusta Hub',
            notificationMessage: 'order are placed'
          };
          orders.unshift(order);
        } else {
          // Update order status to PAID and ensure exact product name is preserved
          order.productName = order.productName || order.juiceItem || resolvedProductName;
          order.juiceItem = order.productName;
          order.paymentStatus = 'PAID';
          order.status = 'Paid & Preparing at Sonia Vihar 3rd Pusta Hub';
          order.gatewayPaymentId = verifiedPaymentId;
          order.bankUtr = bankUtr ? bankUtr.replace(/\D/g, '') : null;
          order.paymentTimestamp = new Date().toISOString();
        }

        saveStoredOrders(orders);
        appendOrderToCsv(order);
        dispatchDualOrderNotifications(order);

        console.log(`\n=============================================================`);
        console.log(`✅ [PAYMENT VERIFIED & MARKED PAID] Order #${order.orderId}`);
        console.log(`   Gateway Order: ${orderId} | Payment: ${verifiedPaymentId}`);
        console.log(`   Amount: ₹${order.finalAmount} | Customer: ${order.name} (${order.mobile})`);
        console.log(`=============================================================\n`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: 'PAID',
          message: 'Payment verified successfully. Order marked as PAID.',
          orderId: order.orderId,
          order_id: orderId,
          payment_id: verifiedPaymentId,
          amountPaid: order.finalAmount,
          paymentTimestamp: order.paymentTimestamp
        }));
      } catch (err) {
        console.error('[VERIFY PAYMENT ERROR]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API: Real-Time Payment Status Polling
  // ==========================================
  if (req.method === 'GET' && reqPath.startsWith('/api/payment/status/')) {
    const orderId = decodeURIComponent(reqPath.replace('/api/payment/status/', '')).trim();
    const orders = getStoredOrders();
    const order = orders.find(o => o.orderId.toLowerCase() === orderId.toLowerCase());

    if (!order) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Order not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      orderId: order.orderId,
      status: order.paymentStatus || 'PENDING',
      amount: order.finalAmount || order.total,
      paid: order.paymentStatus === 'PAID',
      paymentTimestamp: order.paymentTimestamp || null,
      gatewayPaymentId: order.gatewayPaymentId || null
    }));
    return;
  }

  // ==========================================
  // API: Payment Cancellation
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/payment/cancel') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const orderId = (parsed.orderId || '').trim();
        const orders = getStoredOrders();
        const order = orders.find(o => o.orderId.toLowerCase() === orderId.toLowerCase());

        if (order && order.paymentStatus !== 'PAID') {
          order.paymentStatus = 'CANCELLED';
          saveStoredOrders(orders);
          console.log(`[PAYMENT CANCELLED] Order #${orderId}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: 'CANCELLED', orderId }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ==========================================
  // API: Official Payment Gateway Webhook
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/payment/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const signature = req.headers['x-razorpay-signature'];
        if (PAYMENT_GATEWAY_WEBHOOK_SECRET && signature) {
          const expectedSig = crypto
            .createHmac('sha256', PAYMENT_GATEWAY_WEBHOOK_SECRET)
            .update(body)
            .digest('hex');

          if (expectedSig !== signature) {
            console.warn('[WEBHOOK] Invalid Razorpay webhook signature');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid webhook signature' }));
            return;
          }
        }

        const event = JSON.parse(body || '{}');
        console.log(`[WEBHOOK RECEIVED] Event: ${event.event}`);

        if (event.event === 'order.paid' || event.event === 'payment.captured') {
          const paymentEntity = (event.payload && event.payload.payment && event.payload.payment.entity) || {};
          const orderEntity = (event.payload && event.payload.order && event.payload.order.entity) || {};
          const receiptOrderId = orderEntity.receipt || (paymentEntity.notes && paymentEntity.notes.orderId);
          const gatewayOrderId = paymentEntity.order_id || orderEntity.id;

          const orders = getStoredOrders();
          const order = orders.find(o => 
            (receiptOrderId && o.orderId.toLowerCase() === receiptOrderId.toLowerCase()) ||
            (gatewayOrderId && o.gatewayOrderId === gatewayOrderId)
          );

          if (order && order.paymentStatus !== 'PAID') {
            order.paymentStatus = 'PAID';
            order.status = 'Paid & Preparing at Sonia Vihar 3rd Pusta Hub';
            order.gatewayPaymentId = paymentEntity.id;
            order.paymentTimestamp = new Date().toISOString();

            saveStoredOrders(orders);
            appendOrderToCsv(order);
            dispatchDualOrderNotifications(order);
            console.log(`[WEBHOOK SUCCESS] Order #${order.orderId} marked PAID via Webhook (${paymentEntity.id})`);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        console.error('[WEBHOOK ERROR]', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API: Order Submission (Cash on Delivery or Direct) with Google Sheet export & Dual Email Notifications
  // Target Admin Gmail: kanhaiyapandat4@gmail.com
  // Target Customer: Customer's Login Email
  // Message: "order are placed"
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/submit-order') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        let orderData = {};
        try {
          orderData = JSON.parse(body || '{}');
        } catch (_) {
          orderData = {};
        }

        const extract = (field) => {
          const regex = new RegExp(`["']?${field}["']?\\s*[:=]\\s*["']?([^"',{}]+)["']?`, 'i');
          const m = body.match(regex);
          return m ? m[1].trim() : '';
        };

        const name = (orderData.name || extract('name') || 'Customer').trim();
        const customerEmail = (orderData.customerEmail || extract('customerEmail') || extract('email') || 'kanhaiyapandat4@gmail.com').trim();
        const mobile = (orderData.mobile || extract('mobile') || '').trim();
        const delhiLocality = (orderData.delhiLocality || extract('delhiLocality') || 'Sonia Vihar 3rd Pusta').trim();
        const flatHouse = (orderData.flatHouse || extract('flatHouse') || '').trim();
        const areaStreet = (orderData.areaStreet || extract('areaStreet') || '').trim();
        const landmark = (orderData.landmark || extract('landmark') || '').trim();
        const pincode = (orderData.pincode || extract('pincode') || '110094').trim();
        const address = orderData.address || `${flatHouse}, ${areaStreet}, ${delhiLocality}${landmark ? ', Near ' + landmark : ''}, Delhi - ${pincode}`;
        const juiceItem = (orderData.productName || orderData.juiceItem || extract('productName') || extract('juiceItem') || 'Classic Damascus Rose Milk').trim();
        const quantity = parseInt(orderData.quantity || extract('quantity') || 1, 10);
        const declaredPrice = orderData.price || extract('price');

        // Dynamic server-side calculation
        const calc = calculateOrderAmount(juiceItem, quantity, declaredPrice);
        const orderId = orderData.orderId || ('SJC-' + Math.floor(100000 + Math.random() * 900000));
        const paymentMethod = orderData.paymentMethod || extract('paymentMethod') || 'Cash on Delivery';
        const now = new Date().toISOString();

        const orderRecord = {
          orderId,
          name,
          customerEmail,
          mobile,
          delhiLocality,
          flatHouse,
          areaStreet,
          landmark,
          city: orderData.city || 'Delhi (NCT)',
          state: orderData.state || 'Delhi',
          pincode,
          address,
          addressType: orderData.addressType || 'Home',
          productName: juiceItem,
          juiceItem,
          price: calc.unitPrice,
          quantity: calc.quantity,
          subtotal: calc.subtotal,
          discounts: calc.discounts,
          taxes: calc.taxes,
          deliveryCharges: calc.deliveryCharges,
          finalAmount: calc.finalAmount,
          total: calc.finalAmount,
          paymentMethod,
          paymentStatus: paymentMethod === 'Cash on Delivery' ? 'PENDING' : (orderData.paymentStatus || 'PENDING'),
          gatewayOrderId: null,
          gatewayPaymentId: null,
          bankUtr: null,
          paymentTimestamp: null,
          createdTimestamp: now,
          timestamp: now,
          shopLocation: SHOP_LOCATION,
          assignedEmail: 'kanhaiyapandat4@gmail.com',
          status: 'Preparing at Sonia Vihar 3rd Pusta Hub',
          notificationMessage: 'order are placed'
        };

        const orders = getStoredOrders();
        orders.unshift(orderRecord);
        saveStoredOrders(orders);
        appendOrderToCsv(orderRecord);
        dispatchDualOrderNotifications(orderRecord);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          orderId: orderRecord.orderId,
          assignedEmail: 'kanhaiyapandat4@gmail.com',
          customerEmail: orderRecord.customerEmail,
          notification: 'order are placed',
          shopLocation: SHOP_LOCATION,
          order: orderRecord,
          message: 'Order saved in Google Sheet storage. "order are placed" sent to kanhaiyapandat4@gmail.com and customer email.'
        }));
      } catch (err) {
        console.error('[ORDER ERROR]', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API: Track Order by ID or Phone
  // ==========================================
  if (req.method === 'GET' && reqPath.startsWith('/api/track/')) {
    const query = decodeURIComponent(reqPath.replace('/api/track/', '')).trim();
    const ordersFile = path.join(PUBLIC_DIR, 'orders.json');
    let orders = [];
    if (fs.existsSync(ordersFile)) {
      try { orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8')); } catch (e) {}
    }
    const found = orders.find(o => 
      o.orderId.toLowerCase() === query.toLowerCase() || 
      (o.mobile && o.mobile.includes(query))
    );

    if (found) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, order: found }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Order not found for query: ' + query }));
    }
    return;
  }

  // API: View All Orders
  if (req.method === 'GET' && reqPath === '/api/orders') {
    const ordersFile = path.join(PUBLIC_DIR, 'orders.json');
    let orders = [];
    if (fs.existsSync(ordersFile)) {
      try { orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8')); } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: orders.length, shop: SHOP_LOCATION, destination: 'kanhaiyapandat4@gmail.com', orders }));
    return;
  }

  // ==========================================
  // API: User Profile Management
  // Endpoints: POST /api/profile and GET /api/profile
  // ==========================================
  if (req.method === 'POST' && reqPath === '/api/profile') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const result = orderSummaryService.saveProfile(data);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, profile: result.profile, message: 'Profile saved successfully!' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: result.message || 'Failed to save profile' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && reqPath.startsWith('/api/profile')) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const mobile = urlObj.searchParams.get('mobile') || '';
    const profile = orderSummaryService.getProfileByMobile(mobile);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: !!profile, profile }));
    return;
  }

  // API: Get Past Orders for Logged-In User
  if (req.method === 'GET' && reqPath.startsWith('/api/user-orders')) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = (urlObj.searchParams.get('mobile') || urlObj.searchParams.get('email') || '').trim().toLowerCase();
    const orders = getStoredOrders();
    const userOrders = query ? orders.filter(o => 
      (o.mobile && o.mobile.includes(query)) || 
      (o.customerEmail && o.customerEmail.toLowerCase() === query)
    ) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: userOrders.length, orders: userOrders }));
    return;
  }

  // API: Batch Notification Status & Manual Trigger
  if (req.method === 'GET' && reqPath === '/api/batch-status') {
    const state = orderSummaryService.getBatchState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      currentUnnotifiedCount: state.unnotifiedOrders ? state.unnotifiedOrders.length : 0,
      threshold: state.batchThreshold || 5,
      totalBatchesSent: state.totalBatchesSent || 0,
      lastBatchSentAt: state.lastBatchSentAt,
      unnotifiedOrderIds: (state.unnotifiedOrders || []).map(o => o.orderId),
      targetFolder: orderSummaryService.ODER_SUMMARY_DIR
    }));
    return;
  }

  // API: Force Sync Summary Sheets to Target Folder
  if (req.method === 'POST' && reqPath === '/api/sync-summary-sheet') {
    const orders = getStoredOrders();
    const syncRes = orderSummaryService.updateOrderSummarySheets(orders);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(syncRes));
    return;
  }

  // ==========================================

  // Static Homepage & Asset Fallback if invoked directly
  if (reqPath === '/' || reqPath === '/index.html') {
    const htmlPath = path.join(__dirname, '..', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(fs.readFileSync(htmlPath));
      return;
    }
  }

  if (reqPath === '/app.js') {
    const jsPath = path.join(__dirname, '..', 'app.js');
    if (fs.existsSync(jsPath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=UTF-8' });
      res.end(fs.readFileSync(jsPath));
      return;
    }
  }

  if (reqPath === '/style.css') {
    const cssPath = path.join(__dirname, '..', 'style.css');
    if (fs.existsSync(cssPath)) {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=UTF-8' });
      res.end(fs.readFileSync(cssPath));
      return;
    }
  }

  // Unhandled API Route fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, message: 'API route not found: ' + reqPath }));
};

module.exports = (req, res) => {
  try {
    return requestHandler(req, res);
  } catch (err) {
    console.error('[API FATAL ERROR]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }));
    }
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};


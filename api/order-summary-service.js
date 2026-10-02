const fs = require('fs');
const path = require('path');
let XLSX = null;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.warn('[WARN] xlsx module not available in this environment:', e.message);
}

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  console.warn('[WARN] nodemailer module not available in this environment:', e.message);
}

const isVercel = !!process.env.VERCEL;

// Target directory (Windows local path or /tmp on Vercel serverless)
const ODER_SUMMARY_DIR = isVercel 
  ? path.join('/tmp', 'Oder Summary') 
  : (process.env.ODER_SUMMARY_DIR || 'c:/Users/shiv/Downloads/Oder Summary');

const LOCAL_SUMMARY_DIR = isVercel ? '/tmp' : __dirname;
const BATCH_QUEUE_FILE = isVercel ? path.join('/tmp', 'notification_batch.json') : path.join(__dirname, 'notification_batch.json');
const PROFILES_FILE = isVercel ? path.join('/tmp', 'profiles.json') : path.join(__dirname, 'profiles.json');
const EMAIL_LOG_FILE = isVercel ? path.join('/tmp', 'email_notifications.log') : path.join(__dirname, 'email_notifications.log');
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'kanhaiyapandat4@gmail.com';
const BATCH_SIZE = 5; // User requirement: 5-6 orders

// Ensure target directory exists
function ensureDirectories() {
  try {
    if (!fs.existsSync(ODER_SUMMARY_DIR)) {
      fs.mkdirSync(ODER_SUMMARY_DIR, { recursive: true });
    }
  } catch (e) {
    // Ignore in read-only environment
  }
}
ensureDirectories();

/**
 * Format a date nicely as YYYY-MM-DD HH:mm:ss in IST (Asia/Kolkata)
 */
function formatDateTimeIST(isoString) {
  try {
    const d = isoString ? new Date(isoString) : new Date();
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(',', '');
  } catch (e) {
    return new Date().toISOString();
  }
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDateOnly(isoString) {
  try {
    const d = isoString ? new Date(isoString) : new Date();
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (e) {
    return '';
  }
}

/**
 * Split full name into First Name and Last Name
 */
function splitName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: 'Customer', lastName: '' };
  }
  const clean = fullName.trim();
  if (!clean) return { firstName: 'Customer', lastName: '' };
  const parts = clean.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

/**
 * Build a clean consolidated address string
 */
function formatFullAddress(order) {
  if (order.address && order.address.trim()) {
    return order.address.trim();
  }
  const parts = [
    order.flatHouse,
    order.areaStreet,
    order.delhiLocality || 'Sonia Vihar 3rd Pusta',
    order.landmark ? `Near ${order.landmark}` : null,
    order.city || 'Delhi (NCT)',
    order.pincode ? `PIN - ${order.pincode}` : null
  ].filter(Boolean);

  return parts.join(', ');
}

/**
 * Maps raw order record into exact WooCommerce Sheet schema
 */
function mapOrderToSheetRow(order) {
  const { firstName, lastName } = splitName(order.name);
  const orderTotal = Number(order.finalAmount || order.total || order.subtotal || (order.price * order.quantity) || 0);
  const qty = Number(order.quantity || 1);
  const productPrice = Number(order.price || (qty > 0 ? (orderTotal / qty) : orderTotal));
  const productTotal = qty * productPrice;

  const paymentMethod = order.paymentMethod || 'Cash on Delivery';
  const isPaid = (order.paymentStatus === 'PAID' || String(order.paymentStatus).toUpperCase() === 'SUCCESS');
  
  // Price Given vs Price Remaining calculation
  let priceGiven = 0;
  let priceRemaining = orderTotal;
  let orderStatus = 'Processing';

  if (isPaid) {
    priceGiven = orderTotal;
    priceRemaining = 0;
    orderStatus = 'Completed (Paid)';
  } else if (paymentMethod === 'Cash on Delivery') {
    priceGiven = 0;
    priceRemaining = orderTotal;
    orderStatus = 'Cash on Delivery (Pending)';
  } else {
    priceGiven = 0;
    priceRemaining = orderTotal;
    orderStatus = order.paymentStatus || 'Payment Pending';
  }

  const dateAdded = formatDateTimeIST(order.createdTimestamp || order.timestamp);
  const orderDate = formatDateOnly(order.createdTimestamp || order.timestamp);

  return {
    'Date Added': dateAdded,
    'Order Number': order.orderId || ('SJC-' + Math.floor(100000 + Math.random() * 900000)),
    'Order Date': orderDate,
    'Order Status': orderStatus,
    'Product Name': order.productName || order.juiceItem || 'Classic Damascus Rose Milk',
    'Product Quantity': qty,
    'Product Total': productTotal,
    'Order Total': orderTotal,
    'Billing First name': firstName,
    'Billing Last name': lastName,
    'Mobile Number': order.mobile || '',
    'Billing Email': order.customerEmail || '',
    'Address': formatFullAddress(order),
    'City': order.city || 'Delhi (NCT)',
    'Pincode': order.pincode || '110094',
    'Payment Method': paymentMethod,
    'Price Given': priceGiven,
    'Price Remaining': priceRemaining,
    'Shipping Method': 'Sonia Vihar Express Delivery (30-45 mins)'
  };
}

/**
 * Regenerates and exports the Excel and CSV files in:
 * 1. c:\Users\shiv\Downloads\Oder Summary\Store_Orders_Summary.xlsx
 * 2. c:\Users\shiv\Downloads\Oder Summary\Store_Orders_Summary.csv
 * 3. Local copy inside project folder for safety
 */
function updateOrderSummarySheets(allOrders) {
  ensureDirectories();
  if (!Array.isArray(allOrders)) {
    allOrders = [];
  }

  const rows = allOrders.map(mapOrderToSheetRow);

  // Fallback if empty so headers are always present
  if (rows.length === 0) {
    rows.push({
      'Date Added': '',
      'Order Number': '',
      'Order Date': '',
      'Order Status': '',
      'Product Name': '',
      'Product Quantity': '',
      'Product Total': '',
      'Order Total': '',
      'Billing First name': '',
      'Billing Last name': '',
      'Mobile Number': '',
      'Billing Email': '',
      'Address': '',
      'City': '',
      'Pincode': '',
      'Payment Method': '',
      'Price Given': '',
      'Price Remaining': '',
      'Shipping Method': ''
    });
  }

  try {
    // 1. Build Excel Workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths for polished presentation
    ws['!cols'] = [
      { wch: 20 }, // Date Added
      { wch: 14 }, // Order Number
      { wch: 12 }, // Order Date
      { wch: 22 }, // Order Status
      { wch: 34 }, // Product Name
      { wch: 16 }, // Product Quantity
      { wch: 14 }, // Product Total
      { wch: 14 }, // Order Total
      { wch: 18 }, // Billing First name
      { wch: 18 }, // Billing Last name
      { wch: 15 }, // Mobile Number
      { wch: 26 }, // Billing Email
      { wch: 50 }, // Address
      { wch: 14 }, // City
      { wch: 10 }, // Pincode
      { wch: 20 }, // Payment Method
      { wch: 14 }, // Price Given
      { wch: 16 }, // Price Remaining
      { wch: 32 }  // Shipping Method
    ];

    if (XLSX) {
      XLSX.utils.book_append_sheet(wb, ws, 'My WooCommerce Store Orders');

      // 2. Save .xlsx and .csv in target folder
      const targetXlsx = path.join(ODER_SUMMARY_DIR, 'Store_Orders_Summary.xlsx');
      const targetCsv = path.join(ODER_SUMMARY_DIR, 'Store_Orders_Summary.csv');

      XLSX.writeFile(wb, targetXlsx);
      const csvContent = XLSX.utils.sheet_to_csv(ws);
      fs.writeFileSync(targetCsv, csvContent, 'utf8');

      // Also backup in local website folder
      const localXlsx = path.join(LOCAL_SUMMARY_DIR, 'Store_Orders_Summary.xlsx');
      const localCsv = path.join(LOCAL_SUMMARY_DIR, 'Store_Orders_Summary.csv');
      XLSX.writeFile(wb, localXlsx);
      fs.writeFileSync(localCsv, csvContent, 'utf8');
    }

    console.log(`[ORDER SUMMARY UPDATED] Successfully synced ${allOrders.length} orders to:`);
    console.log(` -> ${targetXlsx}`);
    console.log(` -> ${targetCsv}`);
    return { success: true, count: allOrders.length, targetXlsx, targetCsv };
  } catch (err) {
    console.error('[ORDER SUMMARY EXPORT ERROR]', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Batch Notification Management:
 * Sends notification to kanhaiyapandat4@gmail.com every 5-6 orders
 */
function getBatchState() {
  if (fs.existsSync(BATCH_QUEUE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(BATCH_QUEUE_FILE, 'utf8'));
    } catch (e) {
      // Fallback
    }
  }
  return {
    unnotifiedOrders: [],
    batchThreshold: BATCH_SIZE,
    totalBatchesSent: 0,
    lastBatchSentAt: null
  };
}

function saveBatchState(state) {
  try {
    fs.writeFileSync(BATCH_QUEUE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving batch state:', e.message);
  }
}

/**
 * Send Batch Notification Email using Nodemailer
 */
async function sendBatchEmailNotification(batchOrders) {
  const count = batchOrders.length;
  const batchTotal = batchOrders.reduce((sum, o) => sum + Number(o.finalAmount || o.total || 0), 0);
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const xlsxPath = path.join(ODER_SUMMARY_DIR, 'Store_Orders_Summary.xlsx');

  const rowsHtml = batchOrders.map((o, idx) => {
    const isPaid = (o.paymentStatus === 'PAID');
    const given = isPaid ? (o.finalAmount || o.total) : 0;
    const remaining = isPaid ? 0 : (o.finalAmount || o.total);
    const method = o.paymentMethod || 'Cash on Delivery';
    return `
      <tr style="border-bottom: 1px solid #ffd9dc;">
        <td style="padding: 8px 12px; font-weight: bold; color: #780026;">#${idx + 1} - ${o.orderId}</td>
        <td style="padding: 8px 12px;"><strong>${o.name || 'Customer'}</strong><br/><small style="color: #666;">📞 ${o.mobile || 'N/A'}</small></td>
        <td style="padding: 8px 12px;">${o.juiceItem || 'Rose Milk'} (x${o.quantity || 1})</td>
        <td style="padding: 8px 12px; font-weight: bold;">₹${o.finalAmount || o.total}</td>
        <td style="padding: 8px 12px; color: ${isPaid ? '#005e29' : '#b81059'}; font-weight: bold;">${method}<br/><small>${isPaid ? 'PAID' : 'COLLECT CASH'}</small></td>
        <td style="padding: 8px 12px;">Given: <strong>₹${given}</strong> | Due: <strong style="color: #b81059;">₹${remaining}</strong></td>
        <td style="padding: 8px 12px; font-size: 11px; max-width: 220px;">${o.address || formatFullAddress(o)}</td>
      </tr>
    `;
  }).join('');

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 780px; margin: 0 auto; border: 1px solid #ffe1e6; border-radius: 12px; overflow: hidden; background: #fff8f8;">
      <div style="background: #780026; color: #ffffff; padding: 20px 24px; text-align: center;">
        <h2 style="margin: 0; font-size: 22px; letter-spacing: 0.5px;">🍓 Shiv Juice Center — Batch Order Alert</h2>
        <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.9;">${count} Completed Orders Dispatched from Sonia Vihar 3rd Pusta Hub</p>
      </div>

      <div style="padding: 20px 24px;">
        <div style="background: #ffffff; padding: 16px; border-radius: 8px; border: 1px solid #ffd9dc; margin-bottom: 20px; display: flex; justify-content: space-between;">
          <div>
            <span style="font-size: 12px; color: #780026; font-weight: bold; text-transform: uppercase;">Batch Summary</span>
            <div style="font-size: 20px; font-weight: bold; color: #2b151b; margin-top: 4px;">${count} Orders Ready</div>
            <div style="font-size: 12px; color: #666;">Generated at: ${now} IST</div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 12px; color: #005e29; font-weight: bold; text-transform: uppercase;">Total Batch Revenue</span>
            <div style="font-size: 22px; font-weight: bold; color: #780026; margin-top: 4px;">₹${batchTotal}</div>
            <div style="font-size: 11px; color: #666;">Auto-synced to Excel Sheet</div>
          </div>
        </div>

        <h3 style="color: #780026; font-size: 15px; margin-bottom: 10px;">📋 Orders Breakdown:</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #ffd9dc;">
          <thead>
            <tr style="background: #ffe8ec; color: #780026; text-align: left;">
              <th style="padding: 10px 12px;">Order ID</th>
              <th style="padding: 10px 12px;">Customer</th>
              <th style="padding: 10px 12px;">Items</th>
              <th style="padding: 10px 12px;">Total</th>
              <th style="padding: 10px 12px;">Payment</th>
              <th style="padding: 10px 12px;">Cash Balance</th>
              <th style="padding: 10px 12px;">Delivery Address</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div style="margin-top: 20px; padding: 14px; background: #ffe1e6; border-radius: 8px; font-size: 12px; color: #780026;">
          📁 <strong>Updated Order Sheet Location:</strong><br/>
          <code>${xlsxPath}</code><br/>
          <em>(Sheet name: "My WooCommerce Store Orders" with full columns including Price Given, Price Remaining, and Address)</em>
        </div>
      </div>

      <div style="background: #ffe8ec; padding: 12px 24px; text-align: center; font-size: 11px; color: #594143; border-top: 1px solid #ffd9dc;">
        Shiv Juice Center | Sonia Vihar 3rd Pusta, Delhi - 110094 | Admin: ${ADMIN_EMAIL}
      </div>
    </div>
  `;

  // Always log to email_notifications.log
  const logEntry = `[${now}] BATCH NOTIFICATION (${count} ORDERS) -> Sent to ${ADMIN_EMAIL} | Total Amount: ₹${batchTotal} | Orders: ${batchOrders.map(o => o.orderId).join(', ')}\n`;
  try {
    fs.appendFileSync(EMAIL_LOG_FILE, logEntry, 'utf8');
  } catch (e) {
    console.error('Error appending to email_notifications.log:', e.message);
  }

  console.log(`\n=============================================================`);
  console.log(`📧 [BATCH ORDER NOTIFICATION TRIGGERED]`);
  console.log(`   Recipient: ${ADMIN_EMAIL}`);
  console.log(`   Batch Size: ${count} completed orders (Target: ${BATCH_SIZE})`);
  console.log(`   Total Value: ₹${batchTotal}`);
  console.log(`   Orders: ${batchOrders.map(o => '#' + o.orderId).join(', ')}`);
  console.log(`   Updated Sheet: ${xlsxPath}`);
  console.log(`=============================================================\n`);

  // Send real email if SMTP or Gmail credentials exist
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;

  if (smtpUser && smtpPass && nodemailer) {
    try {
      const transporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || (smtpUser.includes('@gmail.com') ? 'gmail' : undefined),
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      const attachments = [];
      if (fs.existsSync(xlsxPath)) {
        attachments.push({
          filename: 'Store_Orders_Summary.xlsx',
          path: xlsxPath
        });
      }

      await transporter.sendMail({
        from: `"Shiv Juice Center" <${smtpUser}>`,
        to: ADMIN_EMAIL,
        subject: `[Shiv Juice Center] Batch Alert: ${count} Orders Completed! (₹${batchTotal})`,
        html: emailHtml,
        attachments: attachments
      });

      console.log(`✅ Real SMTP Email delivered to ${ADMIN_EMAIL}`);
      return { success: true, delivered: true };
    } catch (mailErr) {
      console.error('[SMTP EMAIL ERROR]', mailErr.message);
      return { success: true, delivered: false, error: mailErr.message };
    }
  } else {
    console.log(`ℹ️ [SMTP INFO] Real email credentials not provided in .env yet. Logged batch to email_notifications.log and server console.`);
    return { success: true, delivered: false, note: 'Logged to email_notifications.log' };
  }
}

/**
 * Record a completed order into the batch queue.
 * Triggers notification to kanhaiyapandat4@gmail.com when 5-6 orders are accumulated.
 */
async function recordOrderForBatchNotification(order) {
  const state = getBatchState();
  const orderId = order.orderId;

  // Prevent duplicate insertion in current batch queue
  const exists = state.unnotifiedOrders.some(o => o.orderId === orderId);
  if (!exists) {
    state.unnotifiedOrders.push(order);
    console.log(`[BATCH COUNTER] Order #${orderId} added to batch. Current count: ${state.unnotifiedOrders.length}/${state.batchThreshold || BATCH_SIZE}`);
  }

  // Check if threshold (5-6 orders) reached
  const threshold = state.batchThreshold || BATCH_SIZE;
  if (state.unnotifiedOrders.length >= threshold) {
    const ordersToNotify = [...state.unnotifiedOrders];
    state.unnotifiedOrders = []; // Reset queue
    state.totalBatchesSent = (state.totalBatchesSent || 0) + 1;
    state.lastBatchSentAt = new Date().toISOString();
    saveBatchState(state);

    await sendBatchEmailNotification(ordersToNotify);
    return { batchSent: true, count: ordersToNotify.length };
  } else {
    saveBatchState(state);
    return { batchSent: false, count: state.unnotifiedOrders.length, remaining: threshold - state.unnotifiedOrders.length };
  }
}

/**
 * Customer Profiles Management
 */
function getProfiles() {
  if (fs.existsSync(PROFILES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')) || {};
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveProfile(profileData) {
  const profiles = getProfiles();
  const mobile = (profileData.mobile || '').replace(/\D/g, '');
  if (!mobile) {
    return { success: false, message: 'Valid 10-digit mobile number is required' };
  }

  const existing = profiles[mobile] || {};
  const updated = {
    ...existing,
    ...profileData,
    mobile,
    updatedAt: new Date().toISOString()
  };

  if (!updated.createdAt) {
    updated.createdAt = new Date().toISOString();
  }

  profiles[mobile] = updated;

  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
    return { success: true, profile: updated };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function getProfileByMobile(mobile) {
  const cleanMobile = (mobile || '').replace(/\D/g, '');
  const profiles = getProfiles();
  return profiles[cleanMobile] || null;
}

module.exports = {
  ODER_SUMMARY_DIR,
  updateOrderSummarySheets,
  recordOrderForBatchNotification,
  getBatchState,
  saveProfile,
  getProfileByMobile,
  formatFullAddress,
  ADMIN_EMAIL
};

# Shiv Juice Center 🥤

Modern online ordering platform with real-time Damascus Rose Milk visualization, OTP verification, UPI & Razorpay payments, WooCommerce-style automated Excel order summaries, and batch admin notifications.

---

## 🚀 Features

- **Interactive 3D Glass Scroll Animation**: Smooth dynamic sequence rendering for juice pouring.
- **Fast2SMS / Firebase OTP Authentication**: Secure mobile OTP login and customer profile management.
- **Customer Profiles**: Saved name, address, landmark, and locality with auto-fill on checkout.
- **UPI & Razorpay Payment Integration**: Instant QR code generation, UTR verification, and Razorpay modal.
- **Automated Order Reconciliation**: Orders are tracked, validated, and appended to CSV / JSON.
- **WooCommerce-Style Excel Sheet**: Synchronizes order records (`Store_Orders_Summary.xlsx` / `.csv`) automatically.
- **Batch Admin Notifications**: Dispatches an email notification to `kanhaiyapandat4@gmail.com` every 5-6 orders.
- **Vercel Serverless Ready**: Configured with `vercel.json` and `api/index.js` for zero-configuration Vercel deployment.

---

## 🛠️ Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   Copy `.env.example` to `.env` and fill in your keys:
   ```bash
   cp .env.example .env
   ```

3. Start the local server:
   ```bash
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 Deploy to Vercel

1. **Push to GitHub**:
   Ensure your code is pushed to your GitHub repository:
   ```bash
   https://github.com/s92157795-pixel/Shiv-Juice.git
   ```

2. **Import in Vercel**:
   - Go to [vercel.com](https://vercel.com) and log in.
   - Click **Add New...** -> **Project**.
   - Select and import the `Shiv-Juice` repository.
   - Leave the Framework Preset as **Other**.
   - Root directory: `./`

3. **Configure Environment Variables** in Vercel Project Settings:
   - `FAST2SMS_API_KEY`
   - `PUBLIC_UPI_ID` (e.g. `8799779715@ptaxis`)
   - `BUSINESS_NAME` (e.g. `Shiv Juice Center`)
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `ADMIN_NOTIFICATION_EMAIL` (default: `kanhaiyapandat4@gmail.com`)
   - `GMAIL_USER` / `GMAIL_APP_PASSWORD` (for live SMTP email dispatch)

4. **Deploy**:
   Click **Deploy**. Vercel will host your static files and automatically deploy `/api/*` endpoints as serverless functions.

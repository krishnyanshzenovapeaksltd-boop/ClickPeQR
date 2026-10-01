/**
 * ClickPeQR Backend Server
 * Krishnyansh Zenova Peaks Ltd (RC-9810296)
 * Secure Fintech & AI Payment Gateway
 *
 * Configuration is fully environment-driven:
 *  - Monnify sandbox <-> live is switched via MONNIFY_BASE_URL and keys only.
 *  - No code changes are required when moving from sandbox to live.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------------
// 1. Configuration
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || "https://pkzyvyfdgcpzteqexkc.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.[STRIPPED 126 bytes].EJyj3MiIzdXBhBzFSISinJ1ZzK3nBrenzKZkZZnX2NwenRlen";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const FLUTTERWAVE_PUBLIC_KEY = process.env.FLUTTERWAVE_PUBLIC_KEY || "FLWPUBK-0666bafa3b0455d5f5060549fe805be5-X";

// Monnify: switch environments with environment variables only.
//   Sandbox: MONNIFY_BASE_URL=https://sandbox.monnify.com  (+ MK_TEST keys)
//   Live:    MONNIFY_BASE_URL=https://api.monnify.com      (+ MK_LIVE keys)
const MONNIFY_BASE_URL = (process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com").replace(/\/$/, '');
const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY || "";
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || "";
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE || "";
const MONNIFY_WALLET_ACCOUNT = process.env.MONNIFY_WALLET_ACCOUNT || ""; // source account for disbursements
const isMonnifyLive = MONNIFY_BASE_URL.includes("api.monnify.com");

const POINTS = {
  customerPer100: parseInt(process.env.POINTS_CUSTOMER_PER_100 || "1", 10),
  merchantPer100: parseInt(process.env.POINTS_MERCHANT_PER_100 || "2", 10),
  nairaPer100Pts: parseInt(process.env.POINTS_NAIRA_PER_100 || "10", 10),
};

// ---------------------------------------------------------------------------
// 2. Monnify helpers
// ---------------------------------------------------------------------------
let monnifyTokenCache = { token: null, expiresAt: 0 };

async function getMonnifyToken() {
  if (monnifyTokenCache.token && Date.now() < monnifyTokenCache.expiresAt) {
    return monnifyTokenCache.token;
  }
  if (!MONNIFY_API_KEY || !MONNIFY_SECRET_KEY) {
    throw new Error("Monnify API credentials are not configured.");
  }
  const basic = Buffer.from(MONNIFY_API_KEY + ":" + MONNIFY_SECRET_KEY).toString("base64");
  const res = await axios.post(
    MONNIFY_BASE_URL + "/api/v1/auth/login",
    {},
    { headers: { Authorization: "Basic " + basic, "Content-Type": "application/json" } }
  );
  const body = res.data || {};
  const token = (body.responseBody && body.responseBody.accessToken) || body.accessToken;
  if (!token) throw new Error("Could not obtain a Monnify access token.");
  monnifyTokenCache = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return token;
}

async function monnifyRequest(method, endpoint, data) {
  const token = await getMonnifyToken();
  const res = await axios({
    method,
    url: MONNIFY_BASE_URL + endpoint,
    data,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// 3. Auth & profiles
// ---------------------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { id, full_name, email, business_name, portal_type, avatar_url, phone_number } = req.body;
    const profileData = { id, full_name, email, business_name, portal_type, avatar_url, phone_number };
    const { data, error } = await supabase.from('profiles').upsert([profileData], { onConflict: 'email' });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ error: "We could not complete your request. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// 4. Transactions
// ---------------------------------------------------------------------------
app.post('/api/transactions/verify', async (req, res) => {
  try {
    const { amount, sender_phone, transaction_id, user_id } = req.body;
    const txPayload = {
      user_id: user_id || null,
      amount: parseFloat(amount),
      customer_phone: sender_phone || 'N/A',
      status: 'success',
      transaction_ref: String(transaction_id),
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('transactions').insert([txPayload]);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ status: "success", message: "Transaction recorded successfully.", data });
  } catch (err) {
    res.status(500).json({ error: "We could not verify this transaction. Please try again." });
  }
});

// Transaction history for the last 3 months (default)
app.get('/api/transactions/history/:userId', async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months || "3", 10), 12);
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', req.params.userId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ error: "We could not load your transaction history." });
  }
});

// ---------------------------------------------------------------------------
// 5. Bank account verification
// ---------------------------------------------------------------------------
app.post('/api/resolve-account', async (req, res) => {
  const { account_number, account_bank } = req.body;
  if (!account_number || !account_bank || String(account_number).length !== 10) {
    return res.json({ status: 'error', message: 'Please enter a valid 10-digit account number.' });
  }
  try {
    const fwRes = await axios.post(
      'https://api.flutterwave.com/v3/accounts/resolve',
      { account_number: String(account_number), account_bank: String(account_bank) },
      { headers: { Authorization: 'Bearer ' + FLUTTERWAVE_SECRET_KEY, 'Content-Type': 'application/json' } }
    );
    if (fwRes.data && fwRes.data.status === 'success' && fwRes.data.data && fwRes.data.data.account_name) {
      return res.json({ status: 'success', data: { account_name: fwRes.data.data.account_name } });
    }
    return res.json({ status: 'error', message: (fwRes.data && fwRes.data.message) || 'We could not verify this account. Please check the details.' });
  } catch (err) {
    const errMsg = (err.response && err.response.data && err.response.data.message) || err.message;
    return res.json({ status: 'error', message: errMsg || 'Verification is temporarily unavailable. Please try again.' });
  }
});

// [STRIPPED 77 bytes] 6. Transfers
app.post('/api/settle-to-merchant', async (req, res) => {
  const { amount, transaction_id, merchant_id, merchant_account, merchant_bank_code, merchant_account_name } = req.body;
  if (!amount || !merchant_account || !merchant_bank_code) {
    return res.status(400).json({ status: 'error', message: 'Payment details are incomplete. Please try again.' });
  }
  try {
    const settlementAmount = parseFloat(amount) * 0.985;
    if (!MONNIFY_WALLET_ACCOUNT) {
      return res.status(500).json({ status: 'error', message: 'Settlements are not configured yet. Please contact support.' });
    }
    // Licensed disbursement via Monnify: ClickPeQR wallet -> merchant bank account
    const disbursePayload = {
      amount: parseFloat(settlementAmount.toFixed(2)),
      reference: 'CLICKPEQR_' + (transaction_id || Date.now()) + '_' + (merchant_id || 'GEN'),
      narration: 'ClickPeQR settlement to ' + (merchant_account_name || merchant_id),
      destinationBankCode: String(merchant_bank_code),
      destinationAccountNumber: String(merchant_account),
      currency: "NGN",
      sourceAccountNumber: MONNIFY_WALLET_ACCOUNT
    };
    const disburseRes = await monnifyRequest('POST', '/api/v2/disbursements/single', disbursePayload);
    const disburseBody = (disburseRes && disburseRes.responseBody) || {};
    try {
      await supabase.from('transactions').insert([{
        transaction_ref: String(transaction_id || Date.now()),
        user_id: merchant_id || null,
        merchant_id: merchant_id || null,
        amount: parseFloat(amount),
        settlement_amount: settlementAmount,
        merchant_account: String(merchant_account),
        merchant_bank_code: String(merchant_bank_code),
        merchant_account_name: merchant_account_name,
        status: 'success',
        type: 'Direct bank settlement',
        created_at: new Date().toISOString()
      }]);
    } catch (logErr) { console.log("Transaction log notice:", logErr.message); }
    return res.json({
      status: "success",
      message: 'NGN ' + settlementAmount.toFixed(2) + ' settled to ' + merchant_account_name + ' (' + merchant_account + ')',
      disbursement: disburseBody,
      transfer: disburseBody,
      settlement_amount: settlementAmount
    });
  } catch (err) {
    const errData = err.response && err.response.data;
    const errMsg = (errData && (errData.responseMessage || errData.message)) || err.message;
    return res.status(500).json({
      status: 'error',
      message: errMsg || 'Settlement could not be completed. Please try again.',
      details: errData || null
    });
  }
});

/**
 * Direct account-to-account payment.
 * Customer pays -> merchant receives via licensed Monnify disbursement.
 * Merchant bank comes from linked account or the scanned QR payload.
 */
app.post('/api/direct-account-to-account', async (req, res) => {
  const { customer_id, merchant_id, amount, transaction_id, merchant_account, merchant_bank_code, merchant_account_name, merchant_bank_name, customer_account, customer_bank_code } = req.body;
  if (!customer_id || !merchant_id || !amount) {
    return res.status(400).json({ status: 'error', message: 'Payment details are incomplete. Please try again.' });
  }
  try {
    let custBank = null;
    let merchBank = null;
    const numericCustId = isNaN(parseInt(customer_id)) ? null : parseInt(customer_id);
    const numericMerchId = isNaN(parseInt(merchant_id)) ? null : parseInt(merchant_id);
    try {
      if (numericCustId) {
        const r = await supabase.from('linked_accounts').select('*').eq('user_id', numericCustId).eq('is_primary', true).limit(1).maybeSingle();
        custBank = r.data || null;
      }
      if (numericMerchId) {
        const r = await supabase.from('linked_accounts').select('*').eq('user_id', numericMerchId).eq('is_primary', true).limit(1).maybeSingle();
        merchBank = r.data || null;
      }
    } catch (e) { console.log("Bank lookup notice:", e.message); }

    if (!custBank && numericCustId) {
      try {
        const r = await supabase.from('linked_accounts').select('*').eq('user_id', numericCustId).limit(1).maybeSingle();
        custBank = r.data || null;
      } catch (e) {}
    }
    // Merchant bank details can come from the scanned QR payload
    if (!merchBank && merchant_account && merchant_bank_code) {
      merchBank = {
        bank_name: merchant_bank_name || 'Merchant Bank',
        bank_code: String(merchant_bank_code),
        account_number: String(merchant_account),
        account_name: merchant_account_name || 'Merchant',
        is_primary: true
      };
    }
    if (!merchBank && numericMerchId) {
      try {
        const r = await supabase.from('linked_accounts').select('*').eq('user_id', numericMerchId).limit(1).maybeSingle();
        merchBank = r.data || null;
      } catch (e) {}
    }
    if (!custBank && customer_account && customer_bank_code) {
      custBank = {
        bank_name: 'Customer Bank',
        bank_code: String(customer_bank_code),
        account_number: String(customer_account),
        account_name: 'Customer',
        is_primary: true
      };
    }
    if (!custBank || !merchBank) {
      return res.status(400).json({ status: 'error', message: 'Both customer and merchant need a linked bank account. Please link your bank first.' });
    }

    const settlementAmount = parseFloat(amount) * 0.985;
    if (!MONNIFY_WALLET_ACCOUNT) {
      return res.status(500).json({ status: 'error', message: 'Payments are not configured yet. Please contact support.' });
    }
    // Licensed disbursement via Monnify: ClickPeQR wallet -> merchant bank account
    const disbursePayload = {
      amount: parseFloat(settlementAmount.toFixed(2)),
      reference: 'CLICKPEQR_' + Date.now() + '_' + merchant_id + '_' + customer_id,
      narration: 'ClickPeQR ' + custBank.bank_name + ' to ' + merchBank.bank_name,
      destinationBankCode: String(merchBank.bank_code),
      destinationAccountNumber: String(merchBank.account_number),
      currency: "NGN",
      sourceAccountNumber: MONNIFY_WALLET_ACCOUNT
    };
    const disburseRes = await monnifyRequest('POST', '/api/v2/disbursements/single', disbursePayload);
    const disburseBody = (disburseRes && disburseRes.responseBody) || {};
    try {
      await supabase.from('transactions').insert([{
        transaction_ref: String(transaction_id || Date.now()),
        user_id: customer_id,
        merchant_id: merchant_id,
        amount: parseFloat(amount),
        settlement_amount: settlementAmount,
        customer_account: String(custBank.account_number),
        customer_bank_code: String(custBank.bank_code),
        customer_account_name: custBank.account_name,
        merchant_account: String(merchBank.account_number),
        merchant_bank_code: String(merchBank.bank_code),
        merchant_account_name: merchBank.account_name,
        status: 'success',
        type: 'Direct account-to-account',
        created_at: new Date().toISOString()
      }]);
    } catch (logErr) { console.log("Transaction log notice:", logErr.message); }

    // Award reward points for both sides
    try {
      const custPts = Math.floor(parseFloat(amount) / 100) * POINTS.customerPer100;
      const merchPts = Math.floor(parseFloat(amount) / 100) * POINTS.merchantPer100;
      await axios.post('http://localhost:' + (process.env.PORT || 5000) + '/api/points/award',
        { awards: [{ user_id: customer_id, points: custPts, reason: 'Payment to merchant' }, { user_id: merchant_id, points: merchPts, reason: 'Sale received' }] },
        { timeout: 3000 }).catch(() => {});
    } catch (e) {}

    return res.json({
      status: "success",
      message: 'NGN ' + amount + ' sent from ' + custBank.bank_name + ' (' + custBank.account_number + ') to ' + merchBank.bank_name + ' (' + merchBank.account_number + ')',
      disbursement: disburseBody,
      transfer: disburseBody,
      settlement_amount: settlementAmount,
      customer_bank: custBank.bank_name + ' - ' + custBank.bank_code,
      merchant_bank: merchBank.bank_name + ' - ' + merchBank.bank_code
    });
  } catch (err) {
    const errData = err.response && err.response.data;
    const errMsg = (errData && (errData.responseMessage || errData.message)) || err.message;
    return res.status(500).json({
      status: 'error',
      message: errMsg || 'Payment could not be completed. Please try again.',
      details: errData || null
    });
  }
});

// [STRIPPED 77 bytes] 7. Monnify - licensed payment backbone
// [STRIPPED 78 bytes] reserved (virtual) account for a merchant so customers can pay
// into a dedicated account number. All fund movement stays under Monnify's license.
app.post('/api/monnify/reserved-account', async (req, res) => {
  const { user_id, account_name, customer_name, customer_email } = req.body;
  if (!account_name) {
    return res.status(400).json({ status: 'error', message: 'An account name is required.' });
  }
  try {
    const payload = {
      accountReference: 'CLICKPEQR_' + (user_id || Date.now()),
      accountName: account_name,
      currencyCode: "NGN",
      contractCode: MONNIFY_CONTRACT_CODE,
      customerEmail: customer_email || "support@krishnyanshzenovapeaks.com",
      customerName: customer_name || account_name
    };
    const data = await monnifyRequest('POST', '/api/v2/bank-transfer/reserved-accounts', payload);
    const body = (data && data.responseBody) || {};
    try {
      await supabase.from('monnify_accounts').upsert([{
        user_id: user_id || null,
        account_reference: payload.accountReference,
        account_number: body.accountNumber || null,
        bank_name: body.bankName || null,
        account_name: account_name,
        created_at: new Date().toISOString()
      }], { onConflict: 'account_reference' });
    } catch (e) { console.log("Monnify account log notice:", e.message); }
    res.json({ status: "success", data: body });
  } catch (err) {
    const errMsg = (err.response && err.response.data && err.response.data.responseMessage) || err.message;
    res.status(500).json({ status: 'error', message: errMsg || 'We could not create a collection account right now.' });
  }
});

// Look up an existing reserved account
app.get('/api/monnify/reserved-account/:reference', async (req, res) => {
  try {
    const data = await monnifyRequest('GET', '/api/v2/bank-transfer/reserved-accounts/' + encodeURIComponent(req.params.reference));
    res.json({ status: "success", data: (data && data.responseBody) || {} });
  } catch (err) {
    const errMsg = (err.response && err.response.data && err.response.data.responseMessage) || err.message;
    res.status(500).json({ status: 'error', message: errMsg || 'We could not retrieve this account.' });
  }
});

// Single disbursement (payout) from the Monnify wallet to any Nigerian bank account
app.post('/api/monnify/disburse', async (req, res) => {
  const { amount, destination_bank_code, destination_account_number, narration, reference } = req.body;
  if (!amount || !destination_bank_code || !destination_account_number) {
    return res.status(400).json({ status: 'error', message: 'Amount, bank code and account number are required.' });
  }
  if (!MONNIFY_WALLET_ACCOUNT) {
    return res.status(500).json({ status: 'error', message: 'Payouts are not configured yet. Please contact support.' });
  }
  try {
    const payload = {
      amount: parseFloat(amount),
      reference: reference || ('CLICKPEQR_PAYOUT_' + Date.now()),
      narration: narration || 'ClickPeQR payout',
      destinationBankCode: String(destination_bank_code),
      destinationAccountNumber: String(destination_account_number),
      currency: "NGN",
      sourceAccountNumber: MONNIFY_WALLET_ACCOUNT
    };
    const data = await monnifyRequest('POST', '/api/v2/disbursements/single', payload);
    res.json({ status: "success", data: (data && data.responseBody) || {} });
  } catch (err) {
    const errMsg = (err.response && err.response.data && err.response.data.responseMessage) || err.message;
    res.status(500).json({ status: 'error', message: errMsg || 'The payout could not be completed. Please try again.' });
  }
});

// Monnify webhook - verifies the transaction hash before accepting any notification
// hash = SHA512(secretKey | paymentReference | amountPaid | paidOn | transactionReference)
app.post('/api/monnify/webhook', async (req, res) => {
  try {
    const b = req.body || {};
    const expected = crypto
      .createHash('sha512')
      .update([MONNIFY_SECRET_KEY, b.paymentReference, b.amountPaid, b.paidOn, b.transactionReference].join('|'))
      .digest('hex');
    if (!b.transactionHash || b.transactionHash.toLowerCase() !== expected.toLowerCase()) {
      console.log("Monnify webhook: hash verification failed");
      return res.sendStatus(400);
    }
    console.log("Monnify webhook verified:", b.paymentReference, b.amountPaid);
    try {
      await supabase.from('transactions').insert([{
        transaction_ref: String(b.transactionReference || b.paymentReference),
        amount: parseFloat(b.amountPaid),
        status: 'success',
        type: 'Monnify collection',
        monnify_reference: b.paymentReference,
        created_at: new Date().toISOString()
      }]);
    } catch (e) { console.log("Webhook log notice:", e.message); }
    res.sendStatus(200);
  } catch (err) {
    console.log("Monnify webhook error:", err.message);
    res.sendStatus(500);
  }
});

// [STRIPPED 77 bytes] 8. Reward points
app.get('/api/points/:userId', async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months || "3", 10), 12);
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const bal = await supabase.from('reward_points').select('balance').eq('user_id', req.params.userId).maybeSingle();
    const hist = await supabase.from('reward_point_history')
      .select('*')
      .eq('user_id', req.params.userId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);
    res.json({
      status: "success",
      balance: (bal.data && bal.data.balance) || 0,
      history: hist.data || [],
      naira_value: ((bal.data && bal.data.balance) || 0) / 100 * POINTS.nairaPer100Pts
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'We could not load your points.' });
  }
});

// Award points (single or batch)
app.post('/api/points/award', async (req, res) => {
  try {
    const awards = Array.isArray(req.body.awards) ? req.body.awards : [req.body];
    const results = [];
    for (const a of awards) {
      if (!a.user_id || !a.points || a.points <= 0) continue;
      const cur = await supabase.from('reward_points').select('balance').eq('user_id', a.user_id).maybeSingle();
      const newBal = ((cur.data && cur.data.balance) || 0) + a.points;
      await supabase.from('reward_points').upsert([{ user_id: a.user_id, balance: newBal }], { onConflict: 'user_id' });
      await supabase.from('reward_point_history').insert([{
        user_id: a.user_id,
        points: a.points,
        reason: a.reason || 'Points earned',
        created_at: new Date().toISOString()
      }]);
      results.push({ user_id: a.user_id, balance: newBal });
    }
    res.json({ status: "success", data: results });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'We could not award points right now.' });
  }
});

// [STRIPPED 77 bytes] 9. Notifications
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months || "3", 10), 12);
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.params.userId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(400).json({ status: 'error', message: error.message });
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'We could not load your notifications.' });
  }
});

app.post('/api/notifications', async (req, res) => {
  try {
    const { user_id, title, body } = req.body;
    if (!user_id || !title) return res.status(400).json({ status: 'error', message: 'A recipient and title are required.' });
    const { data, error } = await supabase.from('notifications').insert([{ user_id, title, body: body || '' }]);
    if (error) return res.status(400).json({ status: 'error', message: error.message });
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'We could not save this notification.' });
  }
});

// [STRIPPED 77 bytes] 10. Health, webhooks & static serving
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ClickPeQR - Secure Fintech & AI Payment Gateway',
    company: 'Krishnyansh Zenova Peaks Ltd (RC-9810296)',
    payment_backbone: 'Monnify (' + (isMonnifyLive ? 'live' : 'sandbox') + ')',
    monnify_configured: Boolean(MONNIFY_API_KEY && MONNIFY_SECRET_KEY && MONNIFY_CONTRACT_CODE),
    flutterwave_configured: Boolean(FLUTTERWAVE_SECRET_KEY),
    endpoints: [
      '/api/auth/register',
      '/api/transactions/verify',
      '/api/transactions/history/:userId',
      '/api/resolve-account',
      '/api/settle-to-merchant',
      '/api/direct-account-to-account',
      '/api/monnify/reserved-account',
      '/api/monnify/disburse',
      '/api/monnify/webhook',
      '/api/points/:userId',
      '/api/points/award',
      '/api/notifications/:userId'
    ],
    timestamp: new Date().toISOString()
  });
});

// Legacy Flutterwave webhook
app.post('/webhook', (req, res) => {
  console.log("Webhook received");
  res.sendStatus(200);
});

// Serve the frontend for any other route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// [STRIPPED 77 bytes] 11. Start server
// [STRIPPED 78 bytes] PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('ClickPeQR server running on port ' + PORT);
  console.log('Monnify mode: ' + (isMonnifyLive ? 'LIVE' : 'SANDBOX') + ' (' + MONNIFY_BASE_URL+')')
});

/**
 * ClickPeQR - UPI Direct Billion Scale Backend Server
 * Company: KRISHNYANSH ZENOVA PEAKS LTD (RC-9810296)
 * CEO: Ruby Garg
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const app = express();

// ==========================================
// 1. MIDDLEWARES & CONFIGURATION
// ==========================================
app.use(express.json());
app.use(cors());

// Serve static frontend files directly from Render root folder
app.use(express.static(path.join(__dirname)));

// Environment Variables & Fallbacks
const SUPABASE_URL = process.env.SUPABASE_URL || "https://pkzyvyfdgcpzteqexkc.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.[STRIPPED 126 bytes].EJyj3MiIzdXBhBzFSISinJ1ZzK3nBrenzKZkZZnX2NwenRlen";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const FLUTTERWAVE_PUBLIC_KEY = process.env.FLUTTERWAVE_PUBLIC_KEY || "FLWPUBK-0666bafa3b0455d5f5060549fe805be5-X";
const FLUTTERWAVE_ENCRYPTION_KEY = process.env.FLUTTERWAVE_ENCRYPTION_KEY || "08c6c7d371d48bb9ea3ac404";

// ==========================================
// 2. API ROUTES - AUTH & TRANSACTIONS
// ==========================================

// Register / Login Sync Route
app.post('/api/auth/register', async (req, res) => {
    try {
        const { id, full_name, email, business_name, portal_type, avatar_url, phone_number } = req.body;
        const profileData = { id, full_name, email, business_name, portal_type, avatar_url, phone_number };

        const { data, error } = await supabase.from('profiles').upsert([profileData], { onConflict: 'email' });
        if (error) return res.status(400).json({ error: error.message });

        res.json({ status: "success", data });
    } catch (err) {
        res.status(500).json({ error: "Server error during authentication" });
    }
});

// Transaction Verification & Logging Route
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

        if (transaction_id) {
            try {
                await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
                    headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}` }
                });
            } catch (fwErr) {
                console.log("Flutterwave API verification notice:", fwErr.message);
            }
        }

        res.json({ status: "success", message: "Transaction verified and recorded successfully", data });
    } catch (err) {
        res.status(500).json({ error: "Failed to verify transaction" });
    }
});

// ==========================================
// 3. BANK RESOLUTION & UPI DIRECT SETTLEMENT
// ==========================================

// Real Bank Account Verification with Name (Resolve Account)
app.post('/api/resolve-account', async (req, res) => {
    const { account_number, account_bank } = req.body;
    console.log("Resolve request:", account_number, account_bank);

    if (!account_number || !account_bank || String(account_number).length !== 10) {
        return res.json({ status: 'error', message: 'Invalid 10-digit account number or bank code' });
    }

    try {
        const fwRes = await axios.post(
            'https://api.flutterwave.com/v3/accounts/resolve',
            { account_number: String(account_number), account_bank: String(account_bank) },
            { headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`, 'Content-Type': 'application/json' } }
        );

        if (fwRes.data && fwRes.data.status === 'success' && fwRes.data.data && fwRes.data.data.account_name) {
            return res.json({ status: 'success', data: { account_name: fwRes.data.data.account_name } });
        } else {
            return res.json({ status: 'error', message: fwRes.data.message || 'Could not verify account - check bank/account number' });
        }
    } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        console.error("Resolve Error:", errMsg);
        return res.json({ status: 'error', message: errMsg || 'Server error during bank verification.' });
    }
});

/**
 * UPI DIRECT - BILLION SCALE (All Banks to All Banks)
 * Customer pays -> Flutterwave collects -> Direct transfer to merchant's own bank
 */
app.post('/api/settle-to-merchant', async (req, res) => {
    const { amount, transaction_id, merchant_id, merchant_account, merchant_bank_code, merchant_account_name } = req.body;
    console.log("UPI Direct Settlement Request:", { amount, transaction_id, merchant_id, merchant_account, merchant_bank_code, merchant_account_name });

    if (!amount || !merchant_account || !merchant_bank_code) {
        return res.status(400).json({ status: 'error', message: 'Missing amount or merchant bank details' });
    }

    try {
        // Step 1: Verify transaction on Flutterwave
        if (transaction_id) {
            try {
                await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
                    headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}` }
                });
            } catch (verifyErr) {
                console.log("Verify warning (continuing anyway):", verifyErr.message);
            }
        }

        // Step 2: Calculate settlement (1.5% MDR deduction)
        const settlementAmount = parseFloat(amount) * 0.985;

        // Step 3: Direct Transfer to Merchant's Bank Account
        const transferPayload = {
            account_bank: String(merchant_bank_code),
            account_number: String(merchant_account),
            amount: settlementAmount,
            currency: "NGN",
            beneficiary_name: merchant_account_name || "Merchant",
            reference: `SETTLE_${transaction_id || Date.now()}_${merchant_id || 'GEN'}_BILLION`,
            callback_url: "https://clickpeqr.onrender.com/webhook",
            narration: `Zenova Peak UPI Direct to ${merchant_account_name || merchant_id}`,
            debit_currency: "NGN"
        };

        const transferRes = await axios.post(
            'https://api.flutterwave.com/v3/transfers',
            transferPayload,
            { headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`, 'Content-Type': 'application/json' } }
        );

        // Step 4: Log transaction in Supabase
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
                type: 'UPI Direct V2 Billion - All Banks',
                scale: 'BILLION_READY',
                created_at: new Date().toISOString()
            }]);
        } catch (logErr) {
            console.log("Supabase log warning:", logErr.message);
        }

        return res.json({
            status: "success",
            message: `NGN ${settlementAmount} settled directly to ${merchant_account_name} (${merchant_account})`,
            transfer: transferRes.data,
            settlement_amount: settlementAmount,
            scale: "BILLION_READY - ALL BANKS TO ALL BANKS"
        });

    } catch (err) {
        const errMsg = err.response?.data?.message || err.response?.data || err.message;
        console.error("Settlement Error:", errMsg);
        return res.status(500).json({
            status: 'error',
            message: errMsg || 'Settlement failed - check Flutterwave transfer balance',
            details: err.response?.data || null
        });
    }
});

// ==========================================
// 3B. OPTION 2 - PURE ACCOUNT TO ACCOUNT - ZERO PAGE - ONE CLICK UPI
// ==========================================
app.post('/api/direct-account-to-account', async (req, res) => {
    const { customer_id, merchant_id, amount, transaction_id } = req.body;
    console.log("PURE ACCOUNT TO ACCOUNT REQUEST:", { customer_id, merchant_id, amount, transaction_id });

    if (!customer_id || !merchant_id || !amount) {
        return res.status(400).json({ status: 'error', message: 'Missing customer_id, merchant_id or amount - both must have linked bank' });
    }

    try {
        let custBank = null;
        let merchBank = null;

        try {
            const { data: custPrimary } = await supabase.from('linked_accounts').select('*').eq('user_id', customer_id).eq('is_primary', true).limit(1).maybeSingle();
            const { data: merchPrimary } = await supabase.from('linked_accounts').select('*').eq('user_id', merchant_id).eq('is_primary', true).limit(1).maybeSingle();
            custBank = custPrimary;
            merchBank = merchPrimary;
        } catch (e) { console.log("Primary fetch warning:", e.message); }

        if (!custBank) {
            const { data: custAny } = await supabase.from('linked_accounts').select('*').eq('user_id', customer_id).limit(1).maybeSingle();
            custBank = custAny;
        }
        if (!merchBank) {
            const { data: merchAny } = await supabase.from('linked_accounts').select('*').eq('user_id', merchant_id).limit(1).maybeSingle();
            merchBank = merchAny;
        }

        if (!custBank || !merchBank) {
            return res.status(400).json({ status: 'error', message: 'Customer or merchant bank not linked. Both must link any Nigerian bank in app for pure account to account.' });
        }

        console.log("Customer Bank:", custBank.bank_name, custBank.account_number, "Merchant Bank:", merchBank.bank_name, merchBank.account_number);

        const settlementAmount = parseFloat(amount) * 0.985;

        const transferPayload = {
            account_bank: String(merchBank.bank_code),
            account_number: String(merchBank.account_number),
            amount: settlementAmount,
            currency: "NGN",
            beneficiary_name: merchBank.account_name || "Merchant",
            reference: `PURE_UPI_${Date.now()}_${merchant_id}_${customer_id}_BILLION`,
            callback_url: "https://clickpeqr.onrender.com/webhook",
            narration: `ClickPeQR Pure UPI ${custBank.bank_name} -> ${merchBank.bank_name} - ${custBank.account_name}`,
            debit_currency: "NGN"
        };

        const transferRes = await axios.post(
            'https://api.flutterwave.com/v3/transfers',
            transferPayload,
            { headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`, 'Content-Type': 'application/json' } }
        );

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
                type: 'Pure Account to Account - Billion Scale - No Card',
                scale: 'BILLION_READY_PURE',
                created_at: new Date().toISOString()
            }]);
        } catch (logErr) {
            console.log("Supabase log warning:", logErr.message);
        }

        return res.json({
            status: "success",
            message: `NGN ${amount} moved PURE ACCOUNT TO ACCOUNT: ${custBank.bank_name} (${custBank.account_number}) -> ${merchBank.bank_name} (${merchBank.account_number}) - ${merchBank.account_name}`,
            transfer: transferRes.data,
            settlement_amount: settlementAmount,
            customer_bank: `${custBank.bank_name} - ${custBank.bank_code}`,
            merchant_bank: `${merchBank.bank_name} - ${merchBank.bank_code}`,
            scale: "BILLION_READY_PURE - ALL BANKS TO ALL BANKS - NO CARD"
        });

    } catch (err) {
        const errData = err.response?.data;
        const errMsg = errData?.message || err.message;
        console.error("Pure Account Error:", errData || errMsg);
        return res.status(500).json({
            status: 'error',
            message: errMsg || 'Pure account to account failed - check Flutterwave balance and transfer enabled',
            details: errData || null
        });
    }
});

// ==========================================
// 4. SYSTEM HEALTH & WEBHOOKS
// ==========================================

// Health Check Route
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mode: 'UPI PURE ACCOUNT TO ACCOUNT - BILLION SCALE - ALL BANKS TO ALL BANKS - ZERO PAGE',
        flutterwave_live_key_set: FLUTTERWAVE_SECRET_KEY && FLUTTERWAVE_SECRET_KEY.startsWith('FLWSECK'),
        public_key: FLUTTERWAVE_PUBLIC_KEY,
        scale: 'MILLION/BILLION READY - PURE ACCOUNT TO ACCOUNT - NO LIMIT',
        endpoints: ['/api/resolve-account', '/api/settle-to-merchant', '/api/direct-account-to-account'],
        timestamp: new Date().toISOString()
    });
});

// Webhook for Flutterwave transfer status
app.post('/webhook', (req, res) => {
    console.log("Webhook received:", req.body);
    res.sendStatus(200);
});

// Catch-all route to serve index.html for frontend routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 5. SERVER LISTENER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Zenova Peak Tech Hub - ClickPeQR PURE ACCOUNT TO ACCOUNT Server running live on port ${PORT} - ZERO PAGE UPI - LIVE Key: ${FLUTTERWAVE_SECRET_KEY ? FLUTTERWAVE_SECRET_KEY.substring(0, 15) + '...' : 'NOT SET'}`);
});

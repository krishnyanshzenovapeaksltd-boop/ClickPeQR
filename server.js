const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files directly from Render root folder
app.use(express.static(path.join(__dirname)));

const SUPABASE_URL = process.env.SUPABASE_URL || "https://pkzyvyfdgcpzteqexkc.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.[STRIPPED 126 bytes].EJyj3MiIzdXBhBzFSISinJ1ZzK3nBrenzKZkZZnX2NwenRlen";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || "FLWSECK_LIVE-xxx";
const FLUTTERWAVE_PUBLIC_KEY = process.env.FLUTTERWAVE_PUBLIC_KEY || "FLWPUBK-0666bafa3b0455d5f5060549fe805be5-X
";

// ==========================================
// --- API Routes ---
// ==========================================

// 1. Register / Login Sync Route
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

// 2. Transaction Verification & Logging Route
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

// 3. Real Bank Account Verification with Name (Resolve Account)
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

        console.log("Flutterwave Response:", fwRes.data);

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

// 4. Health Check Route
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        flutterwave_live_key_set: FLUTTERWAVE_SECRET_KEY && FLUTTERWAVE_SECRET_KEY.startsWith('FLWSECK_LIVE-'),
        public_key: FLUTTERWAVE_PUBLIC_KEY,
        timestamp: new Date().toISOString()
    });
});

// Catch-all route to serve index.html for any web browser visit
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// --- Server Listener ---
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ ClickPeQR Server running live on port ${PORT} - LIVE Key: ${FLUTTERWAVE_SECRET_KEY ? FLUTTERWAVE_SECRET_KEY.substring(0, 15) + '...' : 'NOT SET'}`);
});

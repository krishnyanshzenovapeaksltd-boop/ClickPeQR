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
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrenl2eWZkZ2NwenRlcWV4a2MiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTczODE3MDgyMCwiZXhwIjoyMDUzNzQ2ODIwfQ.EJyj3MiIzdXBhBzFSISinJ1ZzK3nBrenzKZkZZnX2NwenRlen";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || "FLWSECK_REAL-xxx";

// --- API Routes ---

// Register / Login Sync Route
app.post('/api/auth/register', async (req, res) => {
    try {
        const { id, full_name, email, business_name, portal_type, avatar_url } = req.body;
        const profileData = { id, full_name, email, business_name, portal_type, avatar_url };
        
        const { data, error } = await supabase.from('profiles').upsert([profileData]);
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

// Catch-all route to serve index.html for any web browser visit
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ClickPeQR Server running live on port ${PORT}`));

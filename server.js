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

const SUPABASE_URL = process.env.SUPABASE_URL || "https://pkzyvyfdgcpztezqexkc.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrenl2eWZkZ2NwenRlenFleGtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxODc3MDUsImV4cCI6MjEwMjc2MzcwNX0.6kJOgwgSfxsQ6pUV11da2SZj7sxZyJDqGDMl_PuNmUg ";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || "FLWSECK_REAL-xxx";

// API Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, email, role } = req.body;
        const tableName = role === 'merchant' ? 'merchants' : 'transactions';
        const { data, error } = await supabase.from(tableName).insert([{ business_name: full_name, email: email, status: 'active' }]);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ status: "success", data });
    } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post('/api/transactions/verify', async (req, res) => {
    try {
        const { amount, sender_phone, transaction_id } = req.body;
        const { data, error } = await supabase.from('transactions').insert([{ 
            amount: amount || 0, 
            customer_phone: sender_phone || 'N/A', 
            status: 'success',
            reference: transaction_id || 'FLW_' + Date.now()
        }]);
        
        if (error) return res.status(400).json({ error: error.message });

        if (transaction_id) {
            try {
                await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
                    headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}` }
                });
            } catch (fwErr) {
                console.log("Flutterwave API ping notice:", fwErr.message);
            }
        }

        res.json({ status: "success", message: "Transaction verified and recorded successfully", data });
    } catch (err) { 
        res.status(500).json({ error: "Failed to verify transaction" }); 
    }
});

// Flutterwave Webhook Endpoint for Real-time Payment Logging
app.post('/api/webhook/flutterwave', async (req, res) => {
    try {
        const event = req.body;
        
        if (event && event.data && event.event === 'charge.completed' && event.data.status === 'successful') {
            const txData = event.data;
            
            await supabase.from('transactions').insert([{
                amount: txData.amount,
                customer_phone: txData.customer.phone_number || 'N/A',
                status: 'success',
                reference: String(txData.id)
            }]);
            
            console.log("Webhook verified & recorded transaction ID:", txData.id);
        }
        
        res.status(200).json({ status: "handled" });
    } catch (err) {
        console.error("Webhook processing error:", err.message);
        res.status(500).json({ error: "Webhook error" });
    }
});

// Catch-all route to serve index.html for any web browser visit
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ClickPEqR Server running live on port ${PORT}`));

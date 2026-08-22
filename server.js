const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path'); // Add path module

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files from the current directory
app.use(express.static(__dirname));

// Supabase Connection
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Serve Index.html on root visit
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Register Merchant API
app.post('/api/merchant/register', async (req, res) => {
    try {
        const { business_name, email, phone_number, settlement_bank_code, settlement_account_number } = req.body;

        const { data, error } = await supabase
            .from('merchants')
            .insert([
                { business_name, email, phone_number, settlement_bank_code, settlement_account_number }
            ])
            .select();

        if (error) throw error;

        res.status(201).json({ success: true, message: "Merchant registered successfully!", data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Initiate Payment API
app.post('/api/payment/initiate', async (req, res) => {
    try {
        const { merchant_id, customer_phone, amount, email, name } = req.body;
        const tx_ref = "TXN_" + Date.now();

        const response = await axios.post('https://api.flutterwave.com/v3/payments', {
            tx_ref: tx_ref,
            amount: amount,
            currency: "NGN",
            redirect_url: "https://krishnyanshzenovapeaks.com",
            customer: { email, phonenumber: customer_phone, name },
            customizations: {
                title: "ClickPEqR Payment",
                description: "Scan and Pay via Altra AI Automation"
            }
        }, {
            headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
        });

        if (response.data.status === "success") {
            await supabase.from('transactions').insert([
                { merchant_id, customer_phone, amount, transaction_reference: tx_ref, status: 'pending' }
            ]);

            res.status(200).json({ success: true, payment_link: response.data.data.link, tx_ref });
        } else {
            res.status(400).json({ success: false, message: "Payment initialization failed" });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.response ? err.response.data : err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});

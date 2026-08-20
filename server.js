const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Supabase Connection
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Test Route
app.get('/', (req, res) => {
    res.json({ message: "ClickPEqR Backend is running successfully!" });
});

// 1. Register Merchant API (Merchant Mode ke liye)
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const SUPABASE_URL = process.env.SUPABASE_URL || "https://pkzyvyfdgcpztezqexkc.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "YOUR_SUPABASE_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.get('/', (req, res) => {
    res.json({ status: "success", message: "ClickPEqR Production Backend is live and secure!" });
});

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
        const { amount, sender_phone } = req.body;
        const { data, error } = await supabase.from('transactions').insert([{ amount: amount || 0, customer_phone: sender_phone || 'N/A', status: 'success' }]);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ status: "success", data });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ClickPEqR Server running live on port ${PORT}`));

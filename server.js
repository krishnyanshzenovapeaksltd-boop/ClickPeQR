const express = require('express');
const cors = require('cors');
const axios = require('axios');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5000;

// Base route to check if server is working
app.get('/', (req, res) => {
    res.json({ message: "ClickPEqR Node.js Backend is running successfully!" });
});

// Original Payment Route
app.post('/api/initiate-payment', async (req, res) => {
    try {
        const { amount, email, name, phone } = req.body;
        const response = await axios.post('https://api.flutterwave.com/v3/payments', {
            tx_ref: "clickpeqr_" + Date.now(),
            amount: amount,
            currency: "NGN",
            customer: { email, name, phone_number: phone },
            customizations: { title: "ClickPEqR Payment", description: "Seamless QR code payment" }
        }, {
            headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
        });
        res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
});

// NEW: Dynamic QR Code Generation Route for Merchants
app.post('/api/generate-qr', async (req, res) => {
    try {
        const { amount, email, name, phone } = req.body;

        // 1. Initialize payment with Flutterwave to get a checkout link
        const response = await axios.post('https://api.flutterwave.com/v3/payments', {
            tx_ref: "clickpeqr_qr_" + Date.now(),
            amount: amount,
            currency: "NGN",
            customer: { email, name, phone_number: phone },
            customizations: { 
                title: "ClickPEqR Merchant Scan & Pay", 
                description: "Direct Bank-to-Bank Transfer" 
            }
        }, {
            headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
        });

        const paymentLink = response.data.data.link;

        // 2. Convert the checkout link into a scannable QR code image (Base64)
        const qrCodeImage = await QRCode.toDataURL(paymentLink);

        // 3. Send back the link and the QR image to the client/frontend
        res.status(200).json({ 
            success: true, 
            paymentLink: paymentLink, 
            qrCodeImage: qrCodeImage 
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
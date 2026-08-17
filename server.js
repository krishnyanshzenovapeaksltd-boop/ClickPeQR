// Dynamic QR Code Generation Route for Merchants
app.post('/api/generate-qr', async (req, res) => {
    try {
        const { amount, email, name, phone } = req.body;

        const response = await axios.post('https://api.flutterwave.com/v3/payments', {
            tx_ref: "clickpeqr_qr_" + Date.now(),
            amount: amount,
            currency: "NGN",
            redirect_url: "https://example.com", // <-- ADD THIS LINE
            customer: { email, name, phone_number: phone },
            customizations: { 
                title: "ClickPEqR Merchant Scan & Pay", 
                description: "Direct Bank-to-Bank Transfer" 
            }
        }, {
            headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
        });

        const paymentLink = response.data.data.link;
        const qrCodeImage = await QRCode.toDataURL(paymentLink);

        res.status(200).json({ 
            success: true, 
            paymentLink: paymentLink, 
            qrCodeImage: qrCodeImage 
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
});

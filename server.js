const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Laravel webhook url
const API_KEY = process.env.API_KEY || 'default-secret-key'; // security key

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // helps run on low memory (Render Free tier)
            '--disable-gpu'
        ],
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable'
    }
});

client.on('qr', (qr) => {
    console.log('Scan the QR code below to link your WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Client is ready and connected!');
});

// Handle incoming messages
client.on('message', async (msg) => {
    // Ignore group chats
    if (msg.from.endsWith('@g.us')) return;

    console.log(`Received message from ${msg.from}: ${msg.body}`);

    if (WEBHOOK_URL) {
        try {
            // Forward payload in Fonnte format:
            // sender: 62812...
            // message: text
            // device: our connected number
            const sender = msg.from.replace('@c.us', '');
            const device = client.info.wid.user;

            await axios.post(WEBHOOK_URL, {
                sender: sender,
                message: msg.body,
                device: device
            });
        } catch (error) {
            console.error('Failed to forward message to Laravel webhook:', error.message);
        }
    }
});

// Endpoint to send message
app.post('/send-message', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== API_KEY) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const { target, message } = req.body;
    if (!target || !message) {
        return res.status(400).json({ status: false, message: 'Missing target or message' });
    }

    try {
        // Format number to WhatsApp format (e.g. 0812... -> 62812...@c.us)
        let formattedNumber = target.replace(/[^0-9]/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substr(1);
        }
        if (!formattedNumber.endsWith('@c.us')) {
            formattedNumber = formattedNumber + '@c.us';
        }

        await client.sendMessage(formattedNumber, message);
        console.log(`Sent message to ${formattedNumber}: ${message}`);
        res.json({ status: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Failed to send message:', error.message);
        res.status(500).json({ status: false, message: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', client: client.info ? 'connected' : 'disconnected' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    client.initialize();
});

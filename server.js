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

let latestQr = null;

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--disable-extensions',
            '--mute-audio',
            '--no-first-run',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--blink-settings=imagesEnabled=false' // Mematikan loading gambar untuk menghemat RAM
        ],
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable'
    }
});

client.on('qr', (qr) => {
    latestQr = qr;
    console.log('Scan the QR code on the main web page (URL) to link your WhatsApp.');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    latestQr = null;
    console.log('WhatsApp Client is ready and connected!');
});

client.on('authenticated', () => {
    latestQr = null;
    console.log('WhatsApp Client authenticated!');
});

client.on('disconnected', () => {
    latestQr = null;
    console.log('WhatsApp Client disconnected!');
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
            const device = client.info ? client.info.wid.user : '';

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

app.get('/qr-code-raw', (req, res) => {
    res.json({ qr: latestQr, connected: !!client.info });
});

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>WhatsApp Gateway Status</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 40px; background: #f4f7f6; color: #333; }
                    h1 { color: #25d366; margin-bottom: 20px; }
                    .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); display: inline-block; max-width: 500px; min-width: 320px; }
                    #qrcode { margin: 20px auto; display: inline-block; padding: 10px; background: white; border: 1px solid #ddd; min-height: 256px; }
                    .status { font-weight: bold; padding: 5px 12px; border-radius: 20px; font-size: 14px; }
                    .connected { background: #e8f5e9; color: #2e7d32; }
                    .disconnected { background: #ffebee; color: #c62828; }
                    .loading { color: #888; }
                </style>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            </head>
            <body>
                <div class="card">
                    <h1>🟢 WhatsApp Gateway</h1>
                    <div id="status-container" style="margin-bottom: 20px;">
                        Status: <span id="status-label" class="status loading">Memuat...</span>
                    </div>
                    <div id="qr-container" style="display: none;">
                        <p>Silakan pindai kode QR di bawah menggunakan WhatsApp Anda (Perangkat Tertaut):</p>
                        <div id="qrcode"></div>
                        <p style="font-size: 12px; color: #666;">QR Code diperbarui otomatis.</p>
                    </div>
                    <div id="connected-container" style="display: none;">
                        <p style="font-size: 18px; color: #2e7d32;">🎉 WhatsApp Anda telah terhubung dan siap digunakan!</p>
                    </div>
                </div>

                <script>
                    let qrcodeGenerator = null;
                    let currentQr = null;

                    function checkStatus() {
                        fetch('/qr-code-raw')
                            .then(res => res.json())
                            .then(data => {
                                const statusLabel = document.getElementById('status-label');
                                const qrContainer = document.getElementById('qr-container');
                                const connectedContainer = document.getElementById('connected-container');

                                if (data.connected) {
                                    statusLabel.textContent = 'TERHUBUNG';
                                    statusLabel.className = 'status connected';
                                    qrContainer.style.display = 'none';
                                    connectedContainer.style.display = 'block';
                                } else {
                                    statusLabel.textContent = 'BELUM TERHUBUNG';
                                    statusLabel.className = 'status disconnected';
                                    connectedContainer.style.display = 'none';

                                    if (data.qr) {
                                        qrContainer.style.display = 'block';
                                        if (currentQr !== data.qr) {
                                            currentQr = data.qr;
                                            document.getElementById('qrcode').innerHTML = '';
                                            qrcodeGenerator = new QRCode(document.getElementById('qrcode'), {
                                                text: data.qr,
                                                width: 256,
                                                height: 256,
                                                colorDark : "#000000",
                                                colorLight : "#ffffff",
                                                correctLevel : QRCode.CorrectLevel.H
                                            });
                                        }
                                    } else {
                                        qrContainer.style.display = 'none';
                                        document.getElementById('qrcode').innerHTML = '<p class="loading">Menunggu browser memuat WhatsApp Web...</p>';
                                    }
                                }
                            })
                            .catch(err => console.error('Error checking status:', err));
                    }

                    // Poll status every 3 seconds
                    checkStatus();
                    setInterval(checkStatus, 3000);
                </script>
            </body>
        </html>
    `);
});

app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', client: client.info ? 'connected' : 'disconnected' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', client: client.info ? 'connected' : 'disconnected' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    client.initialize();
});

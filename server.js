const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Laravel webhook url
const API_KEY = process.env.API_KEY || 'default-secret-key'; // security key

let sock = null;
let qrCodeData = null;
let connectionStatus = 'DISCONNECTED';

async function connectToWhatsApp() {
    // Session state directory
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    // Create WhatsApp socket client
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), // Disable verbose logs to prevent spam and save CPU
        printQRInTerminal: true
    });

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

    // Monitor connection events
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('WhatsApp connection closed. Reconnecting:', shouldReconnect, lastDisconnect.error);
            connectionStatus = 'DISCONNECTED';
            qrCodeData = null;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Client is ready and connected!');
            connectionStatus = 'CONNECTED';
            qrCodeData = null;
        }
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            // Ignore messages sent by ourselves
            if (msg.key.fromMe) continue;
            
            // Ignore group messages
            if (msg.key.remoteJid.endsWith('@g.us')) continue;

            const sender = msg.key.remoteJid.replace('@s.whatsapp.net', '');
            const messageContent = msg.message?.conversation || 
                                   msg.message?.extendedTextMessage?.text || 
                                   '';

            if (!messageContent) continue;

            console.log(`Received message from ${sender}: ${messageContent}`);

            if (WEBHOOK_URL) {
                try {
                    // Forward to Laravel webhook in Fonnte format:
                    // sender: 62812...
                    // message: text
                    // device: bot's own number
                    const botJid = sock.user && sock.user.id ? sock.user.id.split(':')[0] : '';
                    await axios.post(WEBHOOK_URL, {
                        sender: sender,
                        message: messageContent,
                        device: botJid
                    });
                } catch (error) {
                    console.error('Failed to forward message to Laravel webhook:', error.message);
                }
            }
        }
    });
}

// Endpoint to send message (called by Laravel)
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
        if (connectionStatus !== 'CONNECTED' || !sock) {
            return res.status(503).json({ status: false, message: 'WhatsApp client is not connected' });
        }

        // Format target number (e.g. 0812... -> 62812...@s.whatsapp.net)
        let formattedNumber = target.replace(/[^0-9]/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substr(1);
        }
        if (!formattedNumber.endsWith('@s.whatsapp.net')) {
            formattedNumber = formattedNumber + '@s.whatsapp.net';
        }

        await sock.sendMessage(formattedNumber, { text: message });
        console.log(`Sent message to ${formattedNumber}: ${message}`);
        res.json({ status: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Failed to send message:', error.message);
        res.status(500).json({ status: false, message: error.message });
    }
});

// Endpoint for frontend status check
app.get('/qr-code-raw', (req, res) => {
    res.json({ qr: qrCodeData, connected: connectionStatus === 'CONNECTED' });
});

// Web interface
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
                    <h1>🟢 WhatsApp Gateway (Baileys)</h1>
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
                                        document.getElementById('qrcode').innerHTML = '<p class="loading">Menunggu sistem membuat QR Code...</p>';
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
    res.json({ status: 'ok', connected: connectionStatus === 'CONNECTED' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connected: connectionStatus === 'CONNECTED' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    connectToWhatsApp();
});

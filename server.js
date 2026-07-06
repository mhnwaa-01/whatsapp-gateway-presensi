const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Laravel webhook url
const API_KEY = process.env.API_KEY || 'default-secret-key'; // security key

let sock = null;
let qrCodeImage = '';
let connectionStatus = 'Menunggu inisialisasi WhatsApp...';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // Mengambil versi WhatsApp Web terbaru
    const { version, isLatest } = await fetchLatestWaWebVersion();
    console.log(`Menggunakan WA Web versi v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        browser: ['Mac OS', 'Desktop', '3.0'],
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    // EVENT: KONEKSI UPDATE (QR & Status)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                qrCodeImage = await qrcode.toDataURL(qr);
                connectionStatus = 'Silakan scan QR Code untuk login.';
                console.log('QR Code baru berhasil di-generate untuk Web.');
            } catch (err) {
                console.error('Gagal membuat gambar QR', err);
            }
        }

        if (connection === 'close') {
            qrCodeImage = '';
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Alasan:', lastDisconnect.error?.message);

            if (shouldReconnect) {
                connectionStatus = 'Koneksi terputus. Mencoba menghubungkan kembali...';
                console.log(connectionStatus);
                connectToWhatsApp();
            } else {
                connectionStatus = 'Sesi Invalid / Logout. Silakan hapus folder auth_info_baileys dan scan ulang.';
                console.log(connectionStatus);
            }
        } else if (connection === 'open') {
            connectionStatus = '✅ Terhubung! Bot WhatsApp siap digunakan.';
            qrCodeImage = '';
            console.log(connectionStatus);
        }
    });

    // EVENT: UPDATE KREDENSIAL
    sock.ev.on('creds.update', saveCreds);

    // EVENT: PESAN MASUK (Meneruskan ke Webhook Laravel)
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            // Abaikan jika pesan dikirim oleh bot sendiri
            if (msg.key.fromMe) continue;
            
            // Abaikan pesan grup
            if (msg.key.remoteJid.endsWith('@g.us')) continue;

            // Gunakan senderPn (nomor HP asli) jika tersedia untuk mengatasi JID berformat @lid
            const senderJid = msg.key.senderPn || msg.key.remoteJid;
            const sender = senderJid.split('@')[0];
            const messageContent = msg.message?.conversation || 
                                   msg.message?.extendedTextMessage?.text || 
                                   '';

            if (!messageContent) continue;

            console.log(`Pesan masuk dari ${sender} (JID Asli: ${msg.key.remoteJid}): ${messageContent}`);

            if (WEBHOOK_URL) {
                try {
                    // Meneruskan data ke Laravel dalam format payload Fonnte
                    const botJid = sock.user && sock.user.id ? sock.user.id.split(':')[0] : '';
                    await axios.post(WEBHOOK_URL, {
                        sender: sender,
                        message: messageContent,
                        device: botJid
                    });
                } catch (error) {
                    const errorDetail = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
                    console.error('Gagal meneruskan pesan ke Webhook Laravel:', errorDetail);
                }
            }
        }
    });
}

// Endpoint untuk mengirim pesan (dipanggil oleh Laravel)
app.post('/send-message', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== API_KEY) {
        console.warn(`[API] Peringatan: Akses ditolak untuk /send-message. Header Auth: "${authHeader}", Kunci yang diharapkan: "${API_KEY}"`);
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const { target, message } = req.body;
    if (!target || !message) {
        return res.status(400).json({ status: false, message: 'Missing target or message' });
    }

    try {
        if (connectionStatus !== '✅ Terhubung! Bot WhatsApp siap digunakan.' || !sock) {
            return res.status(503).json({ status: false, message: 'WhatsApp client is not connected' });
        }

        // Format nomor target ke format JID (contoh: 0812... -> 62812...@s.whatsapp.net)
        let formattedNumber = target.replace(/[^0-9]/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substr(1);
        }
        if (!formattedNumber.endsWith('@s.whatsapp.net')) {
            formattedNumber = formattedNumber + '@s.whatsapp.net';
        }

        await sock.sendMessage(formattedNumber, { text: message });
        console.log(`Pesan terkirim ke ${formattedNumber}: ${message}`);
        res.json({ status: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Gagal mengirim pesan:', error.message);
        res.status(500).json({ status: false, message: error.message });
    }
});

// Endpoint untuk status koneksi raw (opsional)
app.get('/qr-code-raw', (req, res) => {
    res.json({ 
        qr: qrCodeImage, 
        connected: connectionStatus === '✅ Terhubung! Bot WhatsApp siap digunakan.' 
    });
});

// Endpoint untuk diagnosa koneksi webhook ke Laravel
app.get('/debug-env', async (req, res) => {
    let webhookStatus = 'Not Tested';
    let webhookError = null;

    if (WEBHOOK_URL) {
        try {
            // Test pinging the webhook URL with a POST request with empty body
            await axios.post(WEBHOOK_URL, {}, { timeout: 3000 });
            webhookStatus = 'Success (Pings OK)';
        } catch (err) {
            webhookStatus = `Failed`;
            webhookError = err.response ? `${err.response.status} - ${JSON.stringify(err.response.data)}` : err.message;
        }
    } else {
        webhookStatus = 'WEBHOOK_URL is not set';
    }

    res.json({
        connectionStatus,
        WEBHOOK_URL: WEBHOOK_URL || 'Not Defined',
        API_KEY: API_KEY ? `${API_KEY.substring(0, 3)}***` : 'Not Defined',
        webhookStatus,
        webhookError
    });
});

// Tampilan Halaman Web Utama
app.get('/', (req, res) => {
    let htmlContent = `
        <html>
        <head>
            <title>WhatsApp Gateway Status</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; background: #f4f7f6; color: #333; }
                .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); display: inline-block; max-width: 500px; min-width: 320px; }
                .status { font-size: 1.2em; font-weight: bold; margin-bottom: 20px; color: #25d366; }
                img { border: 2px solid #ddd; border-radius: 8px; padding: 10px; background: white; margin-top: 10px; }
            </style>
            <meta http-equiv="refresh" content="5">
        </head>
        <body>
            <div class="card">
                <h1>WhatsApp Gateway (Baileys)</h1>
                <div class="status">${connectionStatus}</div>
    `;

    if (qrCodeImage) {
        htmlContent += `
            <p>Pindai QR Code di bawah dengan WhatsApp Anda (Perangkat Tertaut):</p>
            <img src="${qrCodeImage}" alt="QR Code WhatsApp" />
        `;
    } else if (connectionStatus.includes('Terhubung')) {
        htmlContent += `
            <p style="color: #2e7d32;">🎉 WhatsApp Anda telah terhubung dan siap digunakan!</p>
        `;
    }

    htmlContent += `
            </div>
        </body>
        </html>
    `;

    res.send(htmlContent);
});

app.listen(PORT, () => {
    console.log(`Server web mendengarkan di port ${PORT}`);
    connectToWhatsApp();
});

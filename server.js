const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeImage = '';
let connectionStatus = 'Menunggu inisialisasi WhatsApp...';

// ========================================================
// 1. LOGIKA BOT WHATSAPP
// ========================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // MENGAMBIL VERSI WHATSAPP WEB TERBARU 
    const { version, isLatest } = await fetchLatestWaWebVersion();
    console.log(`Menggunakan WA Web versi v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version, // <-- WAJIB: Masukkan versi terbaru ke konfigurasi socket
        auth: state,
        browser: ['Mac OS', 'Desktop', '3.0'], 
        printQRInTerminal: true 
    });

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
            connectionStatus = 'Koneksi terputus. Mencoba menghubungkan kembali...';
            qrCodeImage = ''; 
            console.log(connectionStatus);
            // Panggil ulang fungsi untuk reconnect
            connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = '✅ Terhubung! Bot WhatsApp siap digunakan.';
            qrCodeImage = ''; 
            console.log(connectionStatus);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ========================================================
// 2. SETUP SERVER HTTP UNTUK RENDER.COM
// ========================================================
app.get('/', (req, res) => {
    let htmlContent = `
        <html>
        <head>
            <title>WhatsApp Gateway</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
                .status { font-size: 1.2em; font-weight: bold; margin-bottom: 20px; }
                img { border: 2px solid #ddd; border-radius: 8px; padding: 10px; }
            </style>
            <meta http-equiv="refresh" content="3">
        </head>
        <body>
            <h1>WhatsApp Gateway Server</h1>
            <div class="status">${connectionStatus}</div>
    `;

    if (qrCodeImage) {
        htmlContent += `<img src="${qrCodeImage}" alt="QR Code WhatsApp" />`;
    }

    htmlContent += `
        </body>
        </html>
    `;

    res.send(htmlContent);
});

app.listen(PORT, () => {
    console.log(`Server web mendengarkan di port ${PORT}`);
    connectToWhatsApp(); 
});

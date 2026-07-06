const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Variabel global untuk menyimpan status dan gambar QR
let qrCodeImage = '';
let connectionStatus = 'Menunggu inisialisasi WhatsApp...';

// ========================================================
// 1. LOGIKA BOT WHATSAPP
// ========================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        // Menyamar sebagai MacOS untuk menghindari blokir WhatsApp
        browser: ['Mac OS', 'Desktop', '3.0'], 
        printQRInTerminal: true // Tetap print di log Render sebagai cadangan
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Jika ada QR baru dari WhatsApp, ubah jadi gambar Base64
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
            qrCodeImage = ''; // Hapus QR lama
            console.log(connectionStatus);
            connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = '✅ Terhubung! Bot WhatsApp siap digunakan.';
            qrCodeImage = ''; // Hapus QR karena sudah login
            console.log(connectionStatus);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ========================================================
// 2. SETUP SERVER HTTP UNTUK RENDER.COM
// ========================================================
app.get('/', (req, res) => {
    // Tampilan antarmuka HTML sederhana
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

    // Jika ada gambar QR, tampilkan di web
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
    // Mulai koneksi WhatsApp setelah server jalan
    connectToWhatsApp(); 
});

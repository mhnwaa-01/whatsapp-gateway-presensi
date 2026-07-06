const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');

// ========================================================
// 1. SETUP SERVER HTTP UNTUK RENDER.COM
// Render mewajibkan aplikasi mendengarkan suatu port
// ========================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot WhatsApp berjalan dengan baik!');
});

app.listen(PORT, () => {
    console.log(`Server web mendengarkan di port ${PORT}`);
});


// ========================================================
// 2. LOGIKA BOT WHATSAPP
// ========================================================
async function connectToWhatsApp() {
    // Menyimpan sesi login agar tidak perlu scan terus selama folder tidak terhapus
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        // Menyamar sebagai MacOS untuk menghindari blokir (Error 405) dari WhatsApp
        browser: ['Mac OS', 'Desktop', '3.0'], 
        // Mematikan QR bawaan karena sudah deprecated
        printQRInTerminal: false 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Print QR Code secara manual ke terminal (Logs di Render)
        if (qr) {
            console.log('Silakan scan QR Code ini di aplikasi WhatsApp Anda:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            console.log('Koneksi terputus. Mencoba menghubungkan kembali...');
            // Panggil fungsi ini lagi untuk auto-reconnect
            connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Bot berhasil terhubung ke WhatsApp!');
        }
    });

    // Simpan kredensial saat ada pembaruan sesi
    sock.ev.on('creds.update', saveCreds);
}

// Jalankan bot
connectToWhatsApp();

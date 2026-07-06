const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino'); // Tambahkan pino untuk mengatur log

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
        version,
        auth: state,
        browser: ['Mac OS', 'Desktop', '3.0'], 
        printQRInTerminal: true,
        // Gunakan logger silent agar terminal tidak dibanjiri log sinkronisasi
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
            
            // Cek apakah alasan disconnect karena logout (sesi tidak valid)
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            console.log('Koneksi terputus. Alasan:', lastDisconnect.error?.message);
            
            if (shouldReconnect) {
                connectionStatus = 'Koneksi terputus. Mencoba menghubungkan kembali...';
                console.log(connectionStatus);
                connectToWhatsApp(); // Reconnect otomatis
            } else {
                connectionStatus = 'Sesi Invalid / Logout. Silakan hapus folder auth_info_baileys dan scan ulang.';
                console.log(connectionStatus);
                // Jika masuk ke sini, JANGAN panggil connectToWhatsApp(). 
                // Kamu harus hapus folder auth secara manual.
            }
        } else if (connection === 'open') {
            connectionStatus = '✅ Terhubung! Bot WhatsApp siap digunakan.';
            qrCodeImage = ''; 
            console.log(connectionStatus);
        }
    });

    // EVENT: UPDATE KREDENSIAL
    sock.ev.on('creds.update', saveCreds);

    // EVENT: PESAN MASUK (Ini yang sebelumnya kurang!)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        // Abaikan pesan dari bot itu sendiri atau pesan kosong
        if (!msg.message || msg.key.fromMe) return;

        // Ambil isi teks dari pesan
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const sender = msg.key.remoteJid;

        console.log(`Pesan masuk dari ${sender}: ${text}`);

        // Routing perintah dasar
        switch (text.toLowerCase()) {
            case 'halo':
                await sock.sendMessage(sender, { text: 'Halo! Ada yang bisa bot bantu?' });
                break;
            case '/izin':
                await sock.sendMessage(sender, { text: 'Silakan kirimkan format izin:\nNama: \nKelas: \nAlasan:' });
                break;
            case '/sakit':
                await sock.sendMessage(sender, { text: 'Silakan kirimkan format sakit dan lampirkan foto surat dokter jika ada.' });
                break;
            case '/rekap':
                await sock.sendMessage(sender, { text: 'Fitur rekap sedang dalam pengembangan.' });
                break;
        }
    });
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

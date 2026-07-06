const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino'); 

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeImage = '';
let connectionStatus = 'Menunggu inisialisasi WhatsApp...';

// ========================================================
// DATABASE SIMULASI (Ganti dengan kueri MySQL/MongoDB milikmu nanti)
// ========================================================
const databaseSiswa = {
    // Kunci menggunakan format nomor WA internasional tanpa '+'
    "6281776800015": { nama: "Siswa Penguji", kelas: "12 RPL 1" },
    "6281234567890": { nama: "Budi Santoso", kelas: "11 TKJ 2" }
};

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

    // EVENT: PESAN MASUK (Sudah di-update dengan logika pengenalan nomor HP)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const senderJid = msg.key.remoteJid; 
        
        // Ekstrak hanya nomor HP tanpa '@s.whatsapp.net'
        const senderNumber = senderJid.split('@')[0]; 

        console.log(`Pesan masuk dari ${senderNumber}: ${text}`);

        // Cek data siswa di database simulasi
        const dataSiswa = databaseSiswa[senderNumber];

        // Routing perintah dasar
        switch (text.toLowerCase()) {
            case 'halo':
                if (dataSiswa) {
                    await sock.sendMessage(senderJid, { text: `Halo ${dataSiswa.nama}! Ada yang bisa bot bantu?` });
                } else {
                    await sock.sendMessage(senderJid, { text: 'Halo! Ada yang bisa bot bantu?' });
                }
                break;

            case '/izin':
                if (dataSiswa) {
                    await sock.sendMessage(senderJid, { 
                        text: `Halo *${dataSiswa.nama}* dari kelas *${dataSiswa.kelas}*.\n\nData kamu sudah dikenali sistem. Silakan balas dengan alasan izin kamu hari ini:` 
                    });
                } else {
                    await sock.sendMessage(senderJid, { 
                        text: 'Nomor kamu belum terdaftar di database kami. Silakan kirimkan format manual:\nNama: \nKelas: \nAlasan:' 
                    });
                }
                break;

            case '/sakit':
                if (dataSiswa) {
                    await sock.sendMessage(senderJid, { 
                        text: `Halo *${dataSiswa.nama}* (Kelas *${dataSiswa.kelas}*).\n\nSemoga lekas sembuh! Silakan kirimkan foto surat dokter untuk melengkapi keterangan sakit kamu.` 
                    });
                } else {
                    await sock.sendMessage(senderJid, { 
                        text: 'Nomor belum terdaftar. Silakan kirimkan format sakit manual beserta foto surat dokter.' 
                    });
                }
                break;

            case '/rekap':
                await sock.sendMessage(senderJid, { text: 'Fitur rekap sedang dalam pengembangan.' });
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

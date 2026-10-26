# Support FAQ / Tanya Jawab

Buyers (Penyewa) and operators (Penyelenggara). Details: [user-guide.en.md](user-guide.en.md), [user-guide.id.md](user-guide.id.md). Internal runbooks: `.artifacts/12-support-playbook.md`.

## Buyers / Penyewa

**1. I cannot sign in. / Saya tidak bisa masuk.**
EN: Check email and password. After 8 failed tries wait 15 minutes. Accounts that are suspended cannot sign in; contact an admin.
ID: Periksa email dan kata sandi. Setelah 8 kali gagal, tunggu 15 menit. Akun yang ditangguhkan tidak dapat masuk; hubungi admin.

**2. It says I lack permission. / Muncul pesan tidak punya izin.**
EN: Sign out and sign in again; permissions are read at sign-in. Still failing: contact support.
ID: Keluar lalu masuk lagi; izin dibaca saat masuk. Jika masih gagal, hubungi dukungan.

**3. The map shows no route for A to Z. / Peta tidak menampilkan rute A ke Z.**
EN: No link has capacity for that pair. Lower **Min. capacity**, try another pair or the marketplace list. The search is recorded so operators can add capacity.
ID: Belum ada link dengan kapasitas untuk pasangan itu. Kurangi **Kapasitas min.**, coba pasangan lain atau daftar marketplace. Pencarian dicatat agar penyelenggara dapat menambah kapasitas.

**3b. Why "Indicative"? / Mengapa "Indikatif"?**
EN: Multi-hop routes add up separate links; price and latency are not an end-to-end offer. Reservations are made per link.
ID: Rute multi-hop menjumlahkan link terpisah; harga dan latensi bukan penawaran ujung ke ujung. Reservasi dilakukan per link.

**4. My reservation expired. / Reservasi saya kedaluwarsa.**
EN: Payment must finish before the hold ends (default 15 minutes). Add the link to the cart again. If you paid and it still expired, send us the reservation ID.
ID: Pembayaran harus selesai sebelum penahanan berakhir (bawaan 15 menit). Tambahkan link ke keranjang lagi. Jika sudah membayar, kirim ID reservasi kepada kami.

**5. I cannot report an issue. / Saya tidak bisa melaporkan masalah.**
EN: Only renters (paid or confirmed reservation) can open a ticket, with at most 2 open tickets per link. Automatic System tickets already cover detected outages.
ID: Hanya penyewa (reservasi dibayar/terkonfirmasi) yang dapat membuat tiket, maksimal 2 tiket terbuka per link. Tiket Sistem otomatis sudah mencakup gangguan yang terdeteksi.

**6. "Not yet rated" on a link. / "Belum dinilai" pada link.**
EN: Not a bad score: there is not enough measurement history (default 50 samples over 7 days) or the operator sends no telemetry.
ID: Bukan skor buruk: riwayat pengukuran belum cukup (bawaan 50 sampel dalam 7 hari) atau penyelenggara tidak mengirim telemetri.

**7. Why is the score high for a new link? / Mengapa skor tinggi untuk link baru?**
EN: Uptime counts days without measurements as up, so young histories can look better than they are. Read it together with the sample count.
ID: Uptime menghitung hari tanpa pengukuran sebagai aktif, sehingga riwayat baru bisa tampak lebih baik. Baca bersama jumlah sampel.

## Operators / Penyelenggara

**8. AI insights say "rule-based" or "Not enough data". / Insight AI "rule-based" atau "Data belum cukup".**
EN: "rule-based" means no language-model key is configured; the numbers are the same, computed from platform data. "Not enough data" shows what is needed (searches, rentals, at least 3 rented links). One report per 10 minutes.
ID: "rule-based" berarti kunci model bahasa tidak dikonfigurasi; angkanya sama, dihitung dari data platform. "Data belum cukup" menampilkan kebutuhannya (pencarian, sewa, minimal 3 link tersewa). Satu laporan per 10 menit.

**9. My links are not syncing. / Link saya tidak sinkron.**
EN: Open API integrations, read the last error in **Sync history**, fix the cause (URL, credentials, mapping), then press **Sync now**. After 5 failures the integration is marked ERROR. Without a telemetry mapping links cannot be rated.
ID: Buka Integrasi API, baca galat terakhir di **Riwayat sinkron**, perbaiki penyebabnya (URL, kredensial, pemetaan), lalu tekan **Sinkron sekarang**. Setelah 5 kegagalan integrasi ditandai ERROR. Tanpa pemetaan telemetri link tidak dapat dinilai.

**10. Ticket deadlines and my score. / Tenggat tiket dan skor saya.**
EN: Acknowledge and resolve within the due times (SEV1 15 min / 4 h, SEV2 1 h / 8 h, SEV3 4 h / 24 h by default); misses are recorded as SLA breaches and lower the ticket-handling score.
ID: Akui dan selesaikan sebelum tenggat (bawaan SEV1 15 mnt / 4 jam, SEV2 1 jam / 8 jam, SEV3 4 jam / 24 jam); keterlambatan tercatat sebagai pelanggaran SLA dan menurunkan skor penanganan tiket.

**Contact / Kontak**: report with your email, role, time (WIB), page and the message shown (screenshot). Jangan kirim kata sandi atau token. / Never send passwords or tokens.

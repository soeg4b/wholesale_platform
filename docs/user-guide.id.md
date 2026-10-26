# Panduan pengguna (Bahasa Indonesia)

Wholesale Network Marketplace: penyewa (pembeli) mencari dan menyewa link telekomunikasi, penyelenggara (penjual) menjualnya dan mendapat saran AI, admin mengelola platform. Antarmuka dwibahasa: pindah **ID / EN** di bilah atas kapan saja (setelah masuk, bahasa mengikuti preferensi profil Anda). Versi Inggris: [user-guide.en.md](user-guide.en.md).

Bagian layar yang diberi lencana **Data demo** memuat data demo yang dibuat otomatis (riwayat, pencarian, tiket), sehingga angkanya hanya ilustrasi.

## 1. Memulai

1. Buka aplikasi web (demo lokal: http://localhost:3000), pilih **Masuk** atau **Daftar** (pilih *penyewa* atau *penyelenggara*; penyelenggara harus disetujui admin sebelum dapat menayangkan link).
2. Setelah masuk, penyewa diarahkan ke **Peta** (`/explore`), penyelenggara ke **Dasbor Penyelenggara**, admin ke **Admin**.
3. Akun demo (kata sandi `Demo@12345`): penyewa `buyer@demo.wnmp.test`, penyelenggara `operator@nusalink.wnmp.test` dan `operator@garuda.wnmp.test`, admin `admin@demo.wnmp.test`.
4. Jika muncul pesan tidak punya izin tepat setelah sistem di-seed ulang, keluar lalu masuk kembali.

## 2. Penyewa (pembeli)

### 2.1 Mencari rute di peta (Peta)

1. Buka **Peta**. Peta Indonesia menampilkan titik untuk setiap kota yang punya link aktif; ketebalan garis menunjukkan konektivitas antar dua kota.
   - Garis biru tebal: kapasitas tersedia. Garis putus-putus abu-abu: tidak ada kapasitas. Garis kuning tebal berlabel **HOT**: link atau rute laris. Titik berongga: tidak ada kapasitas tersedia di kota itu. Garis lurus hanya menunjukkan konektivitas, bukan jalur kabel fisik (jalur KMZ ada di halaman detail link). Buka **Legenda peta** di bawah peta untuk penjelasan yang sama.
2. Klik satu kota sebagai **A-End** (asal), lalu kota kedua sebagai **Z-End** (tujuan). Klik kota terpilih sekali lagi untuk membatalkannya. Lebih suka keyboard? Gunakan pilihan **A-End** dan **Z-End** di atas peta (angka dalam kurung = jumlah link); **Tukar A dan Z** dan **Hapus pilihan** ada di sebelahnya. **Min. kapasitas** (Gbps) menyaring link yang tidak mampu menyediakan kapasitas itu. **Lihat sebagai daftar** membuka daftar marketplace. Pilihan Anda tersimpan di alamat halaman sehingga bisa disimpan atau dibagikan.
3. Panel kanan (**Ringkasan rute**) menampilkan rute yang ditemukan. Urutkan menurut *Rekomendasi* (segmen paling sedikit, lalu harga), *Harga terendah*, *Latensi terendah*, *Skor performa* atau *Paling laris*.

Setiap kartu rute menampilkan:

| Elemen | Arti |
| --- | --- |
| **Langsung** / **n segmen** | satu link, atau rangkaian link melalui kota perantara (maksimal 3 segmen secara default) |
| **Indikatif** | rute multi-segmen: harga, latensi, dan kapasitas adalah penjumlahan per segmen, bukan penawaran dan bukan jaminan ujung-ke-ujung |
| **HOT +n%** | banyak pembeli mengincar link atau rute ini dibanding periode sebelumnya, atau kapasitas menipis. Rute multi-segmen tidak pernah ditandai hot |
| **Harga / bulan** | kombinasi pilihan segmen dari termurah hingga termahal, setelah aturan harga penyelenggara (kontrak 12 bulan) |
| **Latensi terbaik**, **Kapasitas tersedia** | dari data penyelenggara; "tidak ada data" bila tidak dilaporkan |
| Chip promo (bintang) | promo dan diskon aktif yang berlaku untuk penyelenggara atau link pada rute |
| Chip performa | skor performa (lihat 2.3) atau **Belum dinilai** |
| `SLA n%`, **Redundansi**, **KMZ**, `+ Jalur cadangan / Monitoring / SLA premium ...` | kemampuan: ketersediaan kontraktual, tingkat redundansi, jalur fisik tersedia, layanan add-on yang ditawarkan penyelenggara |

**Lihat segmen & pilihan** membuka tiap segmen beserta link kandidat (penyelenggara, harga, latensi, kapasitas, skor); klik kandidat untuk membuka link. Reservasi dilakukan **per segmen**.

Tanpa pilihan, panel menampilkan **Link terlaris saat ini** (beserta tren dan harga) dan **Promo aktif**. Bila tidak ada rute dengan kapasitas, muncul "Belum ada kapasitas tersedia A → Z"; pencarian itu dicatat tanpa identitas sebagai permintaan yang belum terpenuhi agar penyelenggara dapat menambah kapasitas. Nilai **Min. kapasitas** yang terlalu tinggi juga dapat menyebabkan kondisi ini: turunkan untuk melihat opsi yang lebih kecil.

### 2.2 Membandingkan, mereservasi, dan membayar

1. **Marketplace** menampilkan link dengan filter (asal, tujuan, penyelenggara, kategori, kapasitas minimum, latensi maksimum, harga maksimum, hanya yang tersedia) dan pengurutan. Kartu menampilkan chip performa dan lencana peta bila ada rute KMZ.
2. Buka sebuah link: rute di peta (dari KMZ penyelenggara), spesifikasi, tren latensi, kartu **performa**, dan tingkat harga untuk 1, 12, 24, dan 36 bulan. Pilih jangka waktu lalu **Tambah ke keranjang** (khusus penyewa; satu mata uang per keranjang).
3. **Keranjang** menampilkan subtotal, pajak, dan total. **Checkout** menghitung ulang harga sesuai aturan terkini dan meminta setiap penyelenggara menahan (mengunci) link selama waktu terbatas (default 15 menit). Anda diarahkan ke halaman pembayaran (pada demo berupa halaman sandbox untuk mensimulasikan sukses atau gagal). Bayar sebelum penahanan berakhir (**Bayar sekarang** di halaman reservasi): reservasi yang tidak dibayar kedaluwarsa dan link dilepas.
4. **Reservasi** menampilkan status: *Menunggu pembayaran*, *Dibayar*, *Dikonfirmasi*, *Kedaluwarsa*, *Dibatalkan*, *Gagal*. Anda dapat membatalkan selama menunggu pembayaran.

### 2.3 Memahami skor performa

Pada setiap link yang sudah dinilai (halaman detail, kartu marketplace, chip rute) Anda melihat skor 0-100 dari empat komponen: **Stabilitas latensi**, **Ketersediaan terukur**, **Penanganan tiket**, **Sisa kapasitas**. Kartu detail juga menampilkan uptime terukur terhadap target SLA, latensi rata-rata/p50/p95/jitter, outage, dan statistik tiket (jumlah, terbuka, MTTA waktu respons, MTTR waktu penyelesaian, tingkat pelanggaran SLA).

- **Belum dinilai** berarti riwayat pengukuran belum cukup (butuh cukup sampel selama beberapa hari) atau penyelenggara tidak melaporkan telemetri. Ini bukan skor buruk.
- Segera setelah penilaian pertama, skor hanya ditampilkan ke penjual selama masa pratinjau; pembeli melihatnya sesudahnya.
- Angka tingkat tiket baru muncul bila jumlah tiket cukup bermakna.
- Nilai "terukur" berasal dari telemetri otomatis saat sinkronisasi dengan penyelenggara, bukan dari laporan pelanggan. Hari tanpa telemetri tidak dihitung sebagai downtime, jadi riwayat yang masih pendek bisa tampak lebih baik daripada kenyataan.
- Lencana **Data demo** menandakan data demo ikut dihitung.

### 2.4 Analisis AI

Buka **Analisis AI**, jelaskan kebutuhan Anda dengan kalimat biasa (misalnya "Cari rute terbaik 10G dari Jakarta ke Surabaya latensi di bawah 10 ms") lalu tekan **Analisis**. Anda mendapat opsi berperingkat dari data platform, jalur yang direkomendasikan dan cadangan, analisis biaya-manfaat, rekomendasi redundansi, prediksi latensi, dan risiko. Opsi dapat ditampilkan di peta. Label **Mesin** menunjukkan apakah teks ditulis model bahasa atau mesin berbasis aturan; angka selalu berasal dari data platform. Ada batas per jam untuk setiap pengguna.

### 2.5 Melaporkan masalah dan melacak tiket

Anda dapat membuat tiket untuk link yang Anda sewa (reservasi berstatus dibayar atau dikonfirmasi):

1. Di halaman detail link tekan **Laporkan masalah**, pilih jenis (*Degradasi*, *Outage*, *Lainnya*) dan tingkat (SEV1 paling mendesak sampai SEV3), isi judul (3-160 karakter) dan deskripsi (minimal 10 karakter), lalu **Kirim tiket**.
2. Anda dibawa ke halaman tiket: tahapan status (*Terbuka - Diterima - Dikerjakan - Selesai - Ditutup*), batas waktu respons dan penyelesaian dengan hitung mundur, serta riwayat. Penyelenggara dapat menambahkan **Balasan publik penyelenggara** (terlihat oleh Anda, satu per tiket). Catatan internal penyelenggara tidak pernah ditampilkan kepada Anda.
3. Saat penyelenggara menandai *Selesai*, tekan **Konfirmasi selesai** untuk menutup, atau **Buka kembali** bila masalah berlanjut. Tiket berstatus selesai ditutup otomatis setelah 72 jam.
4. **Tiket** di bilah atas menampilkan tiket Anda dengan filter (status, jenis, sumber).

Batasan: maksimal 2 tiket terbuka per link. Bila platform sendiri mendeteksi outage atau degradasi, tiket *Sistem* dibuat otomatis untuk penyelenggara; Anda tidak perlu melaporkan insiden yang sama.

## 3. Penyelenggara (penjual)

Buka **Dasbor Penyelenggara**. Spanduk menginformasikan bila akun Anda menunggu persetujuan atau ditolak (beserta alasannya). Tab: **Insight AI**, **Link saya**, **Performa**, **Tiket**, **Integrasi API**, **KMZ / Peta**, **Aturan harga**, **Add-on**.

### 3.1 Insight AI

Tekan **Buat analisis sekarang** (satu laporan per 10 menit secara default). Laporan berisi **Ringkasan AI** (lencana *Mesin* menunjukkan `rule-based` atau nama model bahasa) dengan hingga lima tindakan berprioritas, dan tiga bagian. Setiap temuan punya rincian **Dasar angka** dan tingkat keparahan (informasi, perlu perhatian, prioritas tinggi). Bagian yang datanya kurang menampilkan "Data belum cukup: butuh X, baru Y" alih-alih menebak.

1. **Permintaan, tren & risiko kongesti**: *Rute paling dicari*, *Link terlaris*, *Permintaan naik* (tren dibanding 7 hari sebelumnya), *Potensi kongesti* (utilisasi waspada/tinggi, beban berkelanjutan, dan perkiraan indikatif hari menuju penuh beserta kualitas kecocokannya), *Permintaan belum terpenuhi* (rute pada kota Anda yang dicari pembeli tetapi tanpa kapasitas tersedia).
2. **Peluang add-on dari link yang disewa**: berdasarkan link Anda yang sedang disewa (minimal 3 link tersewa), sistem menyarankan jenis add-on (misalnya jalur cadangan untuk link redundansi rendah, upgrade kapasitas untuk link berutilisasi tinggi, SLA premium bila uptime di bawah SLA, monitoring, proteksi DDoS untuk IP transit). Yang ditampilkan hanya **jumlah** penyewa, bukan identitasnya. Tombolnya **Buka katalog add-on** bila Anda sudah punya add-on yang cocok (tawarkan kepada penyewa tersebut) atau **Buat add-on** bila belum.
3. **Link yang perlu perbaikan**: uptime rendah terhadap SLA, latensi tidak stabil, pelanggaran SLA pada tiket, skor performa rendah, harga jauh di atas atau di bawah median rute (minimal 3 link pembanding), data tidak tersinkron 24 jam, belum ada rute KMZ, belum ada telemetri.

Semua ambang batas adalah pengaturan platform. Fakta dihitung dari data platform; model bahasa, bila dikonfigurasi, hanya menulis teks ringkasan.

### 3.2 Performa

Tab **Performa** adalah tabel semua link Anda: utilisasi, skor beserta komponennya, uptime, latensi, KPI tiket, dan permintaan (aktivitas, tren, **HOT**). Gunakan untuk melihat link mana yang dinilai kuat atau lemah oleh pembeli. Rincian lengkap hanya untuk link Anda sendiri; untuk link pesaing hanya skor utama yang terlihat.

### 3.3 Tiket

Tab **Tiket** menampilkan tiket pada link Anda (dari pembeli, dari Anda, dan tiket *Sistem* otomatis). Buka tiket untuk bertindak:

- **Terima** (menghentikan jam respons), **Mulai kerjakan**, **Tandai selesai**. Patuhi batas waktu: keterlambatan tercatat sebagai pelanggaran SLA dan menurunkan skor penanganan tiket Anda.
- Tambahkan komentar, catatan internal (tidak terlihat pembeli), atau satu **Balasan publik penyelenggara** untuk pembeli.
- Tiket sistem dibuat saat telemetri menunjukkan outage (secara default 2 sampel gagal berturut-turut) atau degradasi (default 3), naik dari degradasi ke outage, dan selesai sendiri setelah 3 sampel baik. Kejadian berulang dalam 30 menit membuka kembali tiket yang sama.
- Anda juga dapat membuat tiket sendiri untuk salah satu link Anda.

### 3.4 Add-on

Di **Add-on** buat, ubah, aktifkan/nonaktifkan, dan hapus layanan add-on (jenis, nama dan deskripsi dwibahasa, harga tampilan, satuan). Pembeli melihatnya sebagai chip kemampuan pada rute penyelenggara Anda. Add-on hanya untuk tampilan dan saran: belum ada alur pembelian, pembeli bertanya melalui reservasi.

### 3.5 Link, integrasi, KMZ, dan harga

- **Link saya**: link manual (dapat diubah) dan link terkelola API (kolom teknis berasal dari API penyelenggara; Anda dapat mengubah status, nama, deskripsi). Membuat link memerlukan akun yang sudah disetujui.
- **Integrasi API**: hubungkan API inventori Anda (URL dasar, autentikasi, endpoint, pemetaan field, pemetaan telemetri opsional, polling atau webhook). Gunakan **Uji koneksi** untuk uji coba, **Sinkron sekarang**, dan **Riwayat sinkron**. Kredensial disimpan terenkripsi dan tidak ditampilkan lagi. Tanpa pemetaan telemetri, link Anda tidak dapat dinilai.
- **KMZ / Peta**: unggah berkas KMZ, KML, atau GeoJSON (maks. 20 MB), pilih fitur, dan kaitkan ke sebuah link agar pembeli dapat melihat jalur fisiknya.
- **Aturan harga**: penimpaan harga dasar, diskon volume atau jangka waktu, tingkat kapasitas, biaya tambahan, dan **promosi** (opsional berlaku dari/sampai, per link atau semua link). Aturan diterapkan menurut prioritas. Diskon dan promosi muncul sebagai chip promo di peta.

## 4. Admin

Buka **Admin**. Tab: **Ringkasan**, **Penyelenggara**, **Pengguna**, **Buku besar**, **Sinkronisasi**, **Tiket**, **Pengaturan**.

- **Penyelenggara**: setujui atau tolak penyelenggara baru (penolakan wajib disertai alasan). Hanya link penyelenggara yang disetujui yang terlihat oleh pembeli.
- **Pengguna**: tangguhkan atau aktifkan akun (bukan akun Anda sendiri). Penangguhan berlaku pada saat masuk berikutnya.
- **Buku besar**: telusuri log transaksi anti-ubah per jenis peristiwa dan tekan **Verifikasi rantai hash** untuk memeriksanya.
- **Sinkronisasi**: kesehatan sinkronisasi API penyelenggara.
- **Tiket**: semua tiket platform; **Hitung ulang kualitas** menghitung ulang skor dan menjalankan deteksi insiden untuk semua link aktif.
- **Pengaturan**: ubah pengaturan runtime (ambang hot, performa, tiket/SLA, kongesti, insight, explorer, saklar demo, penyedia pembayaran dan AI, pajak, waktu penguncian). Perubahan berlaku dalam sekitar satu menit. Daftar lengkap kunci ada di [settings.md](settings.md) (dalam bahasa Inggris). Bentuk JSON yang salah diabaikan dengan peringatan dan nilai default dipakai.
- Promo tingkat platform dapat ditambahkan melalui pengaturan `promo.platform`.

## 5. Pemecahan masalah

| Situasi | Yang perlu dilakukan |
| --- | --- |
| Peta kosong | Belum ada link aktif milik penyelenggara yang disetujui, atau data penyelenggara tidak memiliki koordinat. |
| Sebuah kota tidak ada di pilihan | Hanya kota berkoordinat pada link aktif penyelenggara yang disetujui yang muncul. |
| "Belum dinilai" berkepanjangan | Penyelenggara tidak melaporkan telemetri, atau riwayat terlalu pendek (default: 50 sampel selama 7 hari). |
| Tidak bisa melaporkan masalah | Hanya penyewa dengan reservasi dibayar atau dikonfirmasi pada link itu yang bisa; bisa juga sudah ada 2 tiket terbuka. |
| Reservasi kedaluwarsa | Pembayaran tidak selesai dalam waktu penahanan; tambahkan link ke keranjang lagi. |
| Insight berkata "Data belum cukup" | Pencarian, penyewaan, atau link tersewa belum cukup; ambangnya dapat dikonfigurasi. |
| Label berbahasa Inggris pada mode Indonesia | Judul tiket Sistem otomatis dan pesan riwayatnya hanya berbahasa Inggris (celah yang diketahui). |
| Galat izin setelah pembaruan platform | Keluar lalu masuk kembali. |

## 6. Istilah

**A-End / Z-End**: kota asal / tujuan sebuah rute. **Segmen (leg)**: satu link antara dua kota pada rute multi-segmen. **Hot**: permintaan tinggi dan naik secara tidak biasa, atau kapasitas menipis. **Permintaan belum terpenuhi**: pencarian rute tanpa kapasitas tersedia. **SLA**: janji ketersediaan dan waktu respons. **MTTA / MTTR**: rata-rata waktu menerima / menyelesaikan tiket. **Telemetri**: pengukuran otomatis latensi, packet loss, dan status. **Buku besar (ledger)**: log audit append-only berantai hash.

# JGVRP Speedometer HUD (layout pill)

File: `index.html`, `styles.css`, `script.js` (+ opsional `logo.png`, folder `fonts/`).

## Menjalankan
- **Demo di browser:** buka `index.html?demo` (data simulasi, tombol tema tampil, tekan `T` untuk ganti tema).
- **Game / FiveM NUI:** buka tanpa `?demo`. Tidak ada data palsu; HUD hanya bergerak dari pemanggilan fungsi / pesan NUI.
- `window.HUD_MODE` bernilai `'demo'` atau `'game'`.

## Ukuran, posisi, warna
Semua di bagian `:root` pada `styles.css`:
- `--scale` ukuran keseluruhan (1 = 1200 px lebar), `--offset-bottom`, `--offset-side` jarak dari tepi layar.
- `--speed-size` ukuran angka speed, `--logo-size` ukuran logo intro.
- Posisi: default kanan bawah. Ubah dengan `<body data-anchor="center">` / `"left"`, atau lewat URL `?anchor=center`, `?scale=0.5`.
- Warna aksen: 5 tema di array `THEMES` (`script.js`). Pilih lewat `?theme=red`, `setTheme('red')`, atau `nextTheme()`. Nama lama (`lfa`, `night`, `mono`) tetap diterima.
- Skala RPM, satuan ODO, rentang suhu, ambang bensin: objek `CONFIG` di atas `script.js`.

## Font
Tipografi referensi butuh font bergaya Orbitron (display) dan Rajdhani (label). Tanpa font itu, HUD memakai fallback (Bahnschrift di Windows).
1. Unduh Orbitron dan Rajdhani dari Google Fonts, ubah ke `.woff2`, taruh di `fonts/`.
2. Tambahkan di atas `styles.css`:
```css
@font-face { font-family: 'Orbitron'; font-weight: 600 900; src: url('fonts/Orbitron.woff2') format('woff2'); }
@font-face { font-family: 'Rajdhani'; font-weight: 500 700; src: url('fonts/Rajdhani.woff2') format('woff2'); }
```
Di mode `?demo`, font dimuat dari Google Fonts (perlu internet). Di game tidak ada permintaan ke internet.

## Menghubungkan data (NUI)
Pesan memakai format `action` = nama fungsi. Contoh dari sisi Lua (isi nilainya dari resource Anda):
```lua
SendNUIMessage({ action = 'setSpeed', speed = speedMetersPerSecond })
SendNUIMessage({ action = 'setRPM', rpm = rpm01 })        -- 0.0 - 1.0
SendNUIMessage({ action = 'setGear', gear = gear })
SendNUIMessage({ action = 'setHeadlights', state = 0 })   -- 0 mati, 1 low, 2 high
SendNUIMessage({ action = 'setSeatbelts', state = true })
SendNUIMessage({ action = 'setEngine', state = true })
```
Fungsi JS yang sama juga bisa dipanggil langsung (`setSpeed(12.3)`). Daftar lengkap ada di komentar awal `script.js` dan tabel `ACTIONS`.

| Fungsi | Input | Catatan |
|---|---|---|
| `setSpeed` | m/s | tampil KM/H (x3.6); juga menghitung Trip A |
| `setRPM` | 0-1 | 1 = angka 9 di bar |
| `setFuel` | 0-1 atau 0-100 | bar kuning di bawah 20% |
| `setHealth` | 0-1 atau 0-1000 | check engine kuning <= 50%, merah <= 30% |
| `setOdometer` | jarak | satuan input diatur `CONFIG.odoInputUnit` (`'mi'` / `'km'`), tampil KM 6 digit |
| `setTemp` | derajat C | rentang `CONFIG.tempMinC` - `tempMaxC` |
| `setCheckEngine` / `setOilWarning` / `setBatteryWarning` | bool | fungsi baru; tidak ada event bawaan |
| `setTrip` / `resetTrip` | km | Trip A otomatis, disimpan di `localStorage` |

## Yang berubah dari versi dial bundar
Dihapus karena tidak ada di desain referensi: jam, suhu °C di samping, indikator gembok (status tetap disimpan, `updateLockStatus` dan aliasnya tetap aman dipanggil), teks SPORT/SHIFT, angka persen fuel, dan arc OIL PRESS (sebelumnya sebenarnya nilai `setHealth`). Sein tetap no-op.

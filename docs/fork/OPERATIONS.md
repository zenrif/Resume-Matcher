# Operations and Deployment Guide

> Panduan operasional, deployment, backup/restore, dan pemeliharaan untuk Resume Matcher Fork.

---

## 1. Arsitektur Deployment

Aplikasi ini dibungkus dalam container Docker tunggal yang menjalankan:
- **Frontend**: Next.js pada port `3000`
- **Backend**: FastAPI / Uvicorn pada port `8000` (dihubungkan secara internal oleh Next.js API routes)
- **Headless Chromium**: Digunakan oleh backend untuk merender dokumen resume/cover letter menjadi berkas PDF berkualitas tinggi

```
       Internet (HTTPS)
              │
              ▼
   ┌──────────────────────┐
   │ Reverse Proxy (TLS)  │  Caddy / Nginx
   │ e.g. cv.example.com  │  Terminates SSL, sets X-Forwarded-*
   └──────────┬───────────┘
              │  HTTP (127.0.0.1:3000)
              ▼
   ┌────────────────────────────────────────────────────────┐
   │ Docker Container (resume-matcher)                      │
   │                                                        │
   │   Next.js (Port 3000)                                  │
   │        │ (Internal proxy /api/*)                       │
   │        ▼                                               │
   │   FastAPI Backend (Port 8000)                          │
   │        │                                               │
   │        ├──► SQLite Database (/app/backend/data/)       │
   │        ├──► Local Secret Key & Config                  │
   │        └──► Playwright Chromium (Calls Next.js locally)│
   └────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Port Binding Loopback (`127.0.0.1:${PORT:-3000}:3000`)**
> Pada `docker-compose.yml`, port dipetakan secara eksplisit ke `127.0.0.1`. Ini memastikan port `3000` **tidak dapat diakses langsung dari jaringan publik melalui plain HTTP**, melainkan wajib melewati reverse proxy HTTPS.

---

## 2. Variabel Lingkungan (Environment Variables)

Konfigurasi diatur melalui environment variables di `docker-compose.yml` atau berkas `.env`:

| Variabel | Default | Deskripsi |
|---|---|---|
| `PORT` | `3000` | Port host tempat container mendengarkan pada loopback `127.0.0.1`. |
| `FRONTEND_BASE_URL` | `http://localhost:3000` | URL yang digunakan oleh Chromium di dalam container untuk merender halaman print. Tetap biarkan `http://localhost:3000` (Option A) agar request print PDF tidak keluar ke internet. |
| `PUBLIC_BASE_URL` | *(Kosong / fallback ke `FRONTEND_BASE_URL`)* | Domain publik aplikasi (misal `https://cv.example.com`). Digunakan untuk membuat tautan undangan/reset kata sandi (`/invite/<token>`). |
| `AUTH_COOKIE_SECURE` | `true` | Menandai cookie sesi `rm_session` dengan flag `Secure`. Wajib `true` di lingkungan produksi dengan HTTPS. Atur `false` hanya untuk pengembangan lokal tanpa HTTPS. |
| `AUTH_SESSION_DAYS` | `30` | Durasi masa berlaku sesi login dalam hitungan hari. |
| `ADMIN_EMAIL` | *(Kosong)* | Alamat email admin utama. Pada startup pertama, jika belum ada user di database, akun admin otomatis dibuat dan tautan aktivasi dicetak di log. |
| `DEFAULT_DAILY_AI_LIMIT`| `30` | Batas kuota operasi AI harian untuk pengguna biasa non-admin (admin selalu *unlimited*). Kuota direset otomatis setiap pukul 00:00 WIB. |
| `TRUST_PROXY` | `true` | Mengaktifkan pembacaan IP klien dari header `X-Forwarded-For` paling kiri saat berada di belakang reverse proxy. |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | Daftar domain yang diizinkan untuk validasi `Origin` pada mutasi state (JSON array). Masukkan domain publik Anda, misal: `["https://cv.example.com"]`. |
| `DOCS_ENABLED` | `false` | Mengaktifkan/menonaktifkan endpoint dokumentasi API interaktif (`/docs`, `/redoc`, `/openapi.json`). Nonaktif secara default di produksi untuk keamanan. |
| `MIN_PASSWORD_LENGTH` | `10` | Panjang minimum kata sandi pengguna. |
| `INVITE_TTL_DAYS` | `7` | Masa berlaku tautan undangan atau reset kata sandi dalam hari. |
| `LOG_LEVEL` | `INFO` | Tingkat logging backend (`DEBUG`, `INFO`, `WARNING`, `ERROR`). |

---

## 3. Konfigurasi Reverse Proxy (HTTPS)

### Opsi A: Caddy (Sangat Direkomendasikan)
Caddy mengelola sertifikat TLS Let's Encrypt secara otomatis:

```caddyfile
cv.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto https
    }
}
```

### Opsi B: Nginx
Jika menggunakan Nginx dengan Certbot:

```nginx
server {
    listen 80;
    server_name cv.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name cv.example.com;

    ssl_certificate /etc/letsencrypt/live/cv.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cv.example.com/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 4. Bootstrap Akun Admin Pertama

1. Pastikan variabel berikut diatur di `docker-compose.yml` atau `.env`:
   ```yaml
   ADMIN_EMAIL=pemilik@example.com
   PUBLIC_BASE_URL=https://cv.example.com
   AUTH_COOKIE_SECURE=true
   ```
2. Jalankan container:
   ```bash
   docker compose up -d
   ```
3. Periksa log container untuk mendapatkan tautan aktivasi awal:
   ```bash
   docker compose logs resume-matcher | grep "Admin invite link"
   ```
   *Contoh output:*
   ```text
   Admin invite link: https://cv.example.com/invite/8a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p
   ```
4. Buka tautan tersebut di peramban Anda, masukkan kata sandi baru (minimal 10 karakter), dan klik **Set Password & Continue**. Akun admin utama Anda kini aktif.

---

## 5. Manajemen Admin & Pengguna melalui CLI

Jika Anda lupa kata sandi admin atau perlu memulihkan akses secara mendesak tanpa akses antarmuka:

```bash
docker compose exec resume-matcher python -m app.scripts.create_admin --email pemilik@example.com
```

**Perilaku Script:**
- Jika email belum terdaftar: membuat akun baru dengan peran `admin` dan mencetak tautan aktivasi.
- Jika email sudah terdaftar: memastikan peran pengguna adalah `admin`, mengaktifkan akun jika nonaktif, mencabut semua sesi aktif yang ada demi keamanan, dan mencetak tautan reset kata sandi baru.

---

## 6. Prosedur Pencadangan (Backup) & Pemulihan (Restore)

Semua data persisten disimpan di dalam volume Docker `resume-data` pada path container `/app/backend/data/`.

Ada tiga berkas krusial:
1. `resume_matcher.db` — Basis data SQLite (user, auth, resume, pekerjaan, pelacak lamaran).
2. `.secret_key` — Kunci enkripsi simetris Fernet untuk kunci API LLM yang disimpan. **Tanpa berkas ini, kunci API yang tersimpan di database tidak dapat didekripsi!**
3. `config.json` — Konfigurasi preferensi model dan sistem.

### Prosedur Pencadangan Konsisten (Online Backup)
Karena container berbasis image Linux minimalis tanpa binary CLI `sqlite3`, gunakan modul bawaan Python `sqlite3.backup()` untuk membuat snapshot basis data yang konsisten tanpa menghentikan container:

```bash
#!/usr/bin/env bash
set -e

BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 1. Jalankan snapshot SQLite internal
docker compose exec resume-matcher python -c "import sqlite3; s=sqlite3.connect('/app/backend/data/resume_matcher.db'); d=sqlite3.connect('/app/backend/data/backup.db'); s.backup(d)"

# 2. Salin berkas snapshot dan konfigurasi ke host
docker compose cp resume-matcher:/app/backend/data/backup.db "$BACKUP_DIR/resume_matcher.db"
docker compose cp resume-matcher:/app/backend/data/.secret_key "$BACKUP_DIR/.secret_key"
docker compose cp resume-matcher:/app/backend/data/config.json "$BACKUP_DIR/config.json"

# 3. Bersihkan snapshot sementara di dalam container
docker compose exec resume-matcher rm -f /app/backend/data/backup.db

echo "Backup berhasil disimpan di: $BACKUP_DIR"
```

### Prosedur Pemulihan (Restore)
Untuk memulihkan data dari salinan cadangan:

1. Hentikan container:
   ```bash
   docker compose stop resume-matcher
   ```
2. Salin ketiga berkas cadangan ke dalam volume:
   ```bash
   CONTAINER_ID=$(docker compose ps -q resume-matcher)
   docker cp ./backups/20261004_120000/resume_matcher.db "$CONTAINER_ID:/app/backend/data/resume_matcher.db"
   docker cp ./backups/20261004_120000/.secret_key "$CONTAINER_ID:/app/backend/data/.secret_key"
   docker cp ./backups/20261004_120000/config.json "$CONTAINER_ID:/app/backend/data/config.json"
   ```
3. Mulai kembali container:
   ```bash
   docker compose start resume-matcher
   ```
4. Verifikasi status melalui antarmuka atau log:
   ```bash
   docker compose logs --tail=50 resume-matcher
   ```

---

## 7. Pemeliharaan & Sinkronisasi dari Upstream

Saat upstream (`srbhr/Resume-Matcher`) merilis pembaruan:

1. **Tarik perubahan upstream:**
   ```bash
   git fetch upstream
   git merge upstream/main
   ```
2. **Selesaikan potensi konflik merge:**
   Titik konflik yang umum terjadi:
   - `apps/backend/app/database.py` (Pastikan semua query tetap memiliki scoping `user_id`)
   - `apps/backend/app/routers/resumes.py` & `config.py`
   - `apps/frontend/messages/*.json` (Pastikan semua kunci baru diterjemahkan dan lolos `check_locale_parity.py`)
   - `apps/frontend/app/(default)/settings/page.tsx`
3. **Audit tabel / endpoint baru:**
   Setiap tabel baru yang diperkenalkan oleh upstream **wajib ditambahkan kolom `user_id`** dan foreign key ke tabel `users`.
4. **Jalankan pengujian lokal:**
   ```bash
   # Backend
   cd apps/backend && uv run pytest tests/unit/ tests/evals/
   # Frontend
   cd apps/frontend && npm run typecheck && npm run lint && npx vitest run
   ```
5. **Bangun ulang container produksi:**
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

---

## 8. Daftar Periksa Pra-Rilis (Pre-flight Checklist)

Sebelum membagikan akses kepada pengguna lain:

- [ ] Port `3000` tidak terbuka ke internet (terikat ke `127.0.0.1`).
- [ ] HTTPS aktif dan valid melalui reverse proxy (Caddy / Nginx).
- [ ] Cookie sesi `rm_session` memiliki atribut `HttpOnly`, `SameSite=Lax`, dan `Secure`.
- [ ] Endpoint `/api/v1/config/llm-api-key` mengembalikan status `403 Forbidden` saat diakses akun non-admin.
- [ ] Endpoint dokumentasi Swagger `/docs` dan `/redoc` mengembalikan `404 Not Found`.
- [ ] Pengunduhan PDF resume dan cover letter berhasil di lingkungan produksi.
- [ ] Uji isolasi data dua pengguna: User B mencoba mengakses ID resume User A selalu menghasilkan `404 Not Found`.
- [ ] Batas pengeluaran (*spending cap*) telah diatur di dashboard penyedia LLM (OpenAI/Anthropic).
- [ ] Prosedur pencadangan dan pemulihan telah diuji coba minimal satu kali.

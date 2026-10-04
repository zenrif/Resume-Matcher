# Operations and Deployment Guide (Dokploy & Production)

> Panduan deployment produksi menggunakan **Dokploy** di VPS pribadi, manajemen operasional, pencadangan (backup), pemulihan (restore), dan sinkronisasi upstream untuk Resume Matcher Fork.

---

## 1. Arsitektur Deployment di Dokploy

**Dokploy** adalah platform PaaS open-source (berbasis Docker) yang mengelola siklus hidup container dan menggunakan **Traefik** sebagai reverse proxy bawaan dengan otomatisasi sertifikat SSL/TLS (Let's Encrypt).

```
       Pengguna Internet (HTTPS)
                   │
                   ▼
       ┌────────────────────────┐
       │   Traefik (Dokploy)    │  Port 80/443 (Otomatis SSL Let's Encrypt)
       │ e.g. cv.zen-ai.my.id   │  Menangani terminasi TLS & header X-Forwarded-*
       └───────────┬────────────┘
                   │
                   │ Jaringan Docker Internal (dokploy-network)
                   ▼
       ┌────────────────────────────────────────────────────────┐
       │ Container Aplikasi (resume-matcher)                    │
       │                                                        │
       │   Next.js Frontend (Port internal: 3000)               │
       │        │ (Internal rewrite proxy /api/*)               │
       │        ▼                                               │
       │   FastAPI Backend (Port internal: 8000)                │
       │        │                                               │
       │        ├──► SQLite DB (/app/backend/data/)             │
       │        ├──► Local Secret Key & Config                  │
       │        └──► Playwright Chromium (Calls Next.js locally)│
       └────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Keamanan Port pada Dokploy:**
> Traefik di Dokploy menghubungkan domain secara langsung ke port internal container (`3000`) melalui jaringan internal Docker. Port `3000` **tidak perlu dipublikasikan ke antarmuka publik host**, sehingga container terlindungi dari akses langsung tanpa TLS.

---

## 2. Langkah-Langkah Deployment di Dokploy

Anda dapat mendeploy Resume Matcher di Dokploy melalui salah satu dari dua metode di bawah ini:

### Metode A: Sebagai "Application" (Direkomendasikan via Git)

1. **Buat Aplikasi Baru:**
   - Masuk ke dashboard Dokploy Anda.
   - Pilih Project / Environment Anda, lalu klik **Create Application**.
   - Beri nama, misalnya `resume-matcher`.

2. **Hubungkan Sumber Kode (Git):**
   - **Provider:** GitHub / Git.
   - **Repository:** Repository fork Anda (misal `zenrif/Resume-Matcher`).
   - **Branch:** Branch rilis Anda (misal `main` atau `fork/phase-7-deployment`).
   - **Build Type:** Pilih **Dockerfile**.
   - **Dockerfile Path:** `./Dockerfile`.

3. **Konfigurasi Domain & SSL:**
   - Buka tab **Domains** pada aplikasi `resume-matcher`.
   - Klik **Add Domain**:
     - **Host:** `cv.zen-ai.my.id`
     - **Path:** `/`.
     - **Container Port:** `3000`.
     - **HTTPS:** Centang/aktifkan tombol **Certificate / SSL (Let's Encrypt)**.
   - Simpan. Pastikan DNS Record (A Record) subdomain Anda di DNS manager (misal Cloudflare/Namecheap) sudah mengarah ke IP publik VPS Anda.

4. **Konfigurasi Persistent Storage (Volume) — WAJIB:**
   - Buka tab **Volumes** / **Storage** di dashboard aplikasi Dokploy.
   - Klik **Add Volume**:
     - **Type:** Pilih **Volume** (atau *Bind Mount* jika ingin path spesifik di VPS).
     - **Mount Path:** `/app/backend/data` (Path di dalam container).
     - **Name:** `resume-matcher-data`.
   > [!CAUTION]
   > Jika volume ini tidak dikonfigurasi, semua basis data akun, riwayat resume, dan kunci enkripsi API akan hilang setiap kali aplikasi di-deploy ulang (*rebuild*).

5. **Konfigurasi Environment Variables:**
   - Buka tab **Environment** di Dokploy dan masukkan variabel berikut:
   ```env
   # --- Domain & Jaringan ---
   FRONTEND_BASE_URL=http://localhost:3000
   PUBLIC_BASE_URL=https://cv.zen-ai.my.id
   CORS_ORIGINS=["https://cv.zen-ai.my.id"]
   TRUST_PROXY=true

   # --- Autentikasi & Keamanan ---
   AUTH_COOKIE_SECURE=true
   AUTH_SESSION_DAYS=30
   ADMIN_EMAIL=zaenalarifmagang@gmail.com
   DEFAULT_DAILY_AI_LIMIT=30
   DOCS_ENABLED=false
   MIN_PASSWORD_LENGTH=10
   INVITE_TTL_DAYS=7

   # --- Logging & LLM ---
   LOG_LEVEL=INFO
   LOG_LLM=WARNING
   LLM_PROVIDER=openai
   ```
   *(Catatan: Kunci API LLM dapat Anda isi di variabel `LLM_API_KEY` atau dikonfigurasikan nanti melalui halaman Pengaturan admin di browser).*

6. **Deploy:**
   - Klik tombol **Deploy** di Dokploy.
   - Dokploy akan mengunduh repository, membangun image Docker sesuai `Dockerfile`, mengonfigurasi Traefik, dan menjalankan container.

---

### Metode B: Sebagai "Compose" di Dokploy

Jika Anda lebih menyukai mode Compose di Dokploy:
1. Buat **Compose** baru di Dokploy.
2. Gunakan berkas `docker-compose.yml` dari repository ini:
   ```yaml
   services:
     resume-matcher:
       build: .
       container_name: resume-matcher
       ports:
         - "127.0.0.1:3000:3000"
       volumes:
         - resume-matcher-data:/app/backend/data
       environment:
         - FRONTEND_BASE_URL=http://localhost:3000
         - PUBLIC_BASE_URL=https://cv.zen-ai.my.id
         - AUTH_COOKIE_SECURE=true
         - AUTH_SESSION_DAYS=30
         - ADMIN_EMAIL=zaenalarifmagang@gmail.com
         - DEFAULT_DAILY_AI_LIMIT=30
         - TRUST_PROXY=true
         - DOCS_ENABLED=false
         - CORS_ORIGINS=["https://cv.zen-ai.my.id"]
         - LOG_LEVEL=INFO
         - LOG_LLM=WARNING
         - LLM_PROVIDER=openai
       restart: unless-stopped

   volumes:
     resume-matcher-data:
   ```
3. Arahkan domain Dokploy ke port `3000`.

---

## 3. Bootstrap Akun Admin Pertama di Dokploy

Setelah proses deploy pertama selesai dan container berjalan:

1. **Ambil Tautan Undangan dari Log Dokploy:**
   - Di dashboard aplikasi Dokploy, buka tab **Logs** / **Deployments**.
   - Cari baris yang diawali dengan:
     ```text
     Admin invite link: https://cv.zen-ai.my.id/invite/<token_rahasia>
     ```
2. **Aktivasi Akun:**
   - Buka tautan tersebut di peramban Anda.
   - Masukkan kata sandi admin (minimal 10 karakter).
   - Klik **Set Password & Continue**. Akun admin utama Anda kini aktif.

---

## 4. Manajemen Akun Admin via Web Terminal Dokploy

Jika Anda lupa kata sandi admin atau log sudah terhapus:

1. Buka dashboard Dokploy -> pilih aplikasi `resume-matcher` -> buka tab **Terminal** / **Console**.
2. Jalankan perintah berikut di terminal container:
   ```bash
   python -m app.scripts.create_admin --email zaenalarifmagang@gmail.com
   ```
3. Script akan mencetak tautan reset baru:
   ```text
   Admin invite link: https://cv.zen-ai.my.id/invite/<token_baru>
   ```
4. Buka tautan tersebut di peramban untuk mengatur ulang kata sandi admin Anda.

> [!TIP]
> Anda juga dapat menjalankan perintah ini dari SSH VPS langsung:
> ```bash
> docker exec -it $(docker ps -qf "name=resume-matcher") python -m app.scripts.create_admin --email zaenalarifmagang@gmail.com
> ```

---

## 5. Prosedur Pencadangan (Backup) & Pemulihan (Restore)

Data penting tersimpan di `/app/backend/data/`:
1. `resume_matcher.db` — Basis data SQLite (users, resumes, jobs, tailored documents, tracking).
2. `.secret_key` — Kunci enkripsi Fernet untuk kunci API LLM. **Wajib dicadangkan! Tanpa berkas ini, kunci API di database tidak dapat didekripsi.**
3. `config.json` — Konfigurasi preferensi sistem.

### Skrip Backup Otomatis di VPS Host
Buat script backup di VPS Anda (misalnya `/opt/backups/backup-resume-matcher.sh`):

```bash
#!/usr/bin/env bash
set -e

BACKUP_ROOT="/opt/backups/resume-matcher"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_ROOT/$TIMESTAMP"
mkdir -p "$DEST"

CONTAINER_ID=$(docker ps -qf "name=resume-matcher" | head -n 1)

if [ -z "$CONTAINER_ID" ]; then
    echo "Container resume-matcher tidak ditemukan."
    exit 1
fi

# 1. Jalankan snapshot SQLite konsisten secara online (tanpa downtime)
docker exec "$CONTAINER_ID" python -c "import sqlite3; s=sqlite3.connect('/app/backend/data/resume_matcher.db'); d=sqlite3.connect('/app/backend/data/backup.db'); s.backup(d)"

# 2. Salin data ke host VPS
docker cp "$CONTAINER_ID:/app/backend/data/backup.db" "$DEST/resume_matcher.db"
docker cp "$CONTAINER_ID:/app/backend/data/.secret_key" "$DEST/.secret_key"
docker cp "$CONTAINER_ID:/app/backend/data/config.json" "$DEST/config.json"

# 3. Hapus snapshot sementara di dalam container
docker exec "$CONTAINER_ID" rm -f /app/backend/data/backup.db

echo "Backup berhasil disimpan di: $DEST"

# Opsi: Hapus backup yang lebih lama dari 30 hari
find "$BACKUP_ROOT" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

Jadwalkan di crontab host VPS (`crontab -e`):
```text
0 3 * * * /opt/backups/backup-resume-matcher.sh >> /var/log/resume-matcher-backup.log 2>&1
```

### Prosedur Pemulihan (Restore)
Jika perlu merestore data:

1. Di dashboard Dokploy, hentikan container (**Stop**).
2. Salin ketiga berkas dari folder backup host ke volume container:
   ```bash
   CONTAINER_ID=$(docker ps -aqf "name=resume-matcher" | head -n 1)
   docker cp /opt/backups/resume-matcher/20261004_120000/resume_matcher.db "$CONTAINER_ID:/app/backend/data/resume_matcher.db"
   docker cp /opt/backups/resume-matcher/20261004_120000/.secret_key "$CONTAINER_ID:/app/backend/data/.secret_key"
   docker cp /opt/backups/resume-matcher/20261004_120000/config.json "$CONTAINER_ID:/app/backend/data/config.json"
   ```
3. Di dashboard Dokploy, mulai kembali container (**Start**).

---

## 6. Pemeliharaan & Sinkronisasi dari Upstream

Saat upstream (`srbhr/Resume-Matcher`) merilis fitur baru atau perbaikan:

1. Di komputer lokal / development:
   ```bash
   git fetch upstream
   git merge upstream/main
   ```
2. Periksa dan selesaikan konflik (khususnya pastikan scoping `user_id` tetap ada pada query database baru).
3. Jalankan pengujian:
   ```bash
   # Backend
   cd apps/backend && uv run pytest tests/unit/ tests/evals/
   # Frontend
   cd apps/frontend && npm run typecheck && npm run lint && npx vitest run
   ```
4. Push perubahan ke GitHub repository Anda:
   ```bash
   git push origin main
   ```
5. Di Dokploy: Jika fitur Auto-Deploy aktif, Dokploy akan langsung mendeteksi commit baru dan melakukan rebuild secara otomatis tanpa kehilangan data volume!

---

## 7. Daftar Periksa Pra-Rilis di Dokploy (Pre-flight Checklist)

Sebelum membagikan tautan kepada rekan atau pengguna lain:

- [ ] Domain Dokploy menggunakan **HTTPS** aktif dengan gembok hijau yang valid.
- [ ] Volume `/app/backend/data` sudah terpasang (*mounted*) di tab Volumes Dokploy.
- [ ] Cookie sesi `rm_session` terbukti berflag `HttpOnly`, `SameSite=Lax`, dan `Secure` di browser DevTools.
- [ ] Endpoint `/api/v1/config/llm-api-key` menghasilkan status `403 Forbidden` jika diakses user non-admin.
- [ ] Endpoint `/docs` dan `/redoc` menghasilkan `404 Not Found`.
- [ ] Fitur unduh PDF resume dan cover letter berfungsi lancar di domain produksi Dokploy.
- [ ] Spending limit / batas kuota API telah diatur di dashboard penyedia AI (OpenAI / Anthropic).
- [ ] Skrip backup berkala telah diuji coba minimal satu kali.

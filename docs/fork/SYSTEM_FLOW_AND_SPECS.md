# Arsitektur Alur Sistem (System Flows) & Spesifikasi VPS

> Dokumen komprehensif mengenai seluruh alur kerja sistem (*end-to-end flows*) pada Resume Matcher Fork, serta panduan spesifikasi minimum VPS untuk deployment produksi di Dokploy.

---

## 1. Spesifikasi Minimum & Rekomendasi VPS

Resume Matcher adalah aplikasi fullstack yang menggabungkan Next.js (Node.js runtime), FastAPI (Python 3.13), basis data SQLite embedded, dan **Headless Chromium (Playwright)** untuk rendering PDF berstandar ATS.

Komponen yang paling memakan resource adalah:
1. **Docker Build**: Proses kompilasi Next.js (`npm run build`) saat deploy membutuhkan lonjakan memori (RAM peak).
2. **Headless Chromium**: Setiap eksekusi unduh PDF menjalankan browser headless untuk merender dokumen beresolusi tinggi.

### Tabel Spesifikasi Hardware VPS

| Komponen | Spesifikasi Minimum (Personal / 1–3 User) | Spesifikasi Rekomendasi (5–15 User Aktif) | Catatan Penting |
|---|---|---|---|
| **vCPU** | 2 Core | 2–4 Core | Rendering PDF dan parsing teks memanfaatkan CPU secara intensif. |
| **RAM** | 2 GB | 4 GB | Kurang dari 2 GB sangat rentan terhadap *Out of Memory* (OOM). |
| **SWAP** | **2 GB (Wajib dibuat)** | **2–4 GB** | **Sangat krusial** mencegah kegagalan build `npm run build` dan crash Chromium. |
| **Penyimpanan (Storage)** | 20 GB SSD / NVMe | 40 GB SSD / NVMe | Ruang untuk Docker image layers, cache build, database, dan backups. |
| **Sistem Operasi** | Ubuntu 22.04 / 24.04 LTS atau Debian 12 | Ubuntu 24.04 LTS / Debian 12 | Kompatibel penuh dengan Dokploy dan runtime Docker modern. |
| **Jaringan (Bandwidth)** | 1 Gbps port, kuota 1 TB/bulan | 1 Gbps port, kuota 2+ TB/bulan | Koneksi stabil ke API penyedia LLM (OpenAI, Gemini, dll.). |

> [!IMPORTANT]
> ### Panduan Menambahkan Swap Memory di VPS (Wajib untuk RAM 2 GB)
> Jika VPS Anda memiliki RAM 2 GB, pastikan swap diaktifkan agar proses build Docker tidak terkena *Linux OOM Killer*:
> ```bash
> # Jalankan perintah ini di SSH host VPS Anda:
> sudo fallocate -l 2G /swapfile
> sudo chmod 600 /swapfile
> sudo mkswap /swapfile
> sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```

---

## 2. Peta Alur Sistem (System Flows)

Berikut adalah 8 alur kerja utama di dalam Resume Matcher:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RESUME MATCHER WORKFLOWS                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [1. Auth & Tenancy] ────────► [2. Resume Master Creation]             │
│   - Login / Sesi Cookie         - Upload File (PDF/DOCX)               │
│   - Admin Bootstrap             - AI Resume Wizard (Bahasa Indonesia)  │
│   - Isolasi Multi-User          - Penyimpanan Terstruktur              │
│                                           │                            │
│                                           ▼                            │
│  [5. Tracker & Evaluasi] ◄──── [3. Job Tailoring & Anti-Fabrication]   │
│   - Kanban Lamaran              - Job Keywords Matching                │
│   - Analisis JD Match           - Filter Frasa Klise Indonesia         │
│   - Persiapan Wawancara         - Master Alignment (Anti-Halusinasi)   │
│                                           │                            │
│                                           ▼                            │
│  [7. Dokumen Tambahan]   ◄──── [4. ATS PDF Rendering & Export]         │
│   - Cover Letter                - Headless Chromium Vector PDF         │
│   - Cold Outreach Mail          - Verified Reading Order pdfminer.six  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Alur 1: Bootstrap & Autentikasi Pengguna (Auth & Tenancy)

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    actor User
    participant Browser
    participant API as FastAPI Backend
    participant DB as SQLite Database

    Note over Admin,API: Bootstrap Admin Pertama Kali
    API->>DB: Periksa apakah tabel users kosong saat startup
    DB-->>API: 0 user ditemukan
    API->>DB: Buat user role 'admin' (email dari ADMIN_EMAIL)
    API->>DB: Buat token invite unik (expired dalam 7 hari)
    API-->>Admin: Cetak "Admin invite link" di log container

    Admin->>Browser: Buka tautan /invite/[token]
    Browser->>API: POST /api/v1/auth/accept-invite (password baru)
    API->>DB: Hash password dengan Argon2id & simpan
    API-->>Browser: Set cookie rm_session (HttpOnly, Secure, SameSite=Lax)

    Note over Admin,User: Undangan Pengguna Biasa
    Admin->>Browser: Masuk menu Pengaturan -> User Management -> Invite User
    Browser->>API: POST /api/v1/auth/admin/users (email, quota harian)
    API->>DB: Simpan calon user & buat invite link
    API-->>Admin: Tautan /invite/[token] disalin
    Admin->>User: Berikan tautan undangan
    User->>Browser: Buka tautan & setel password sendiri
```

**Karakteristik Keamanan:**
- Cookie sesi `rm_session` ditandatangani menggunakan HMAC-SHA256 dengan rotasi key aman.
- Rate limiting ketat pada endpoint login (5 percobaan / 15 menit per IP) dan validasi invite token (10 percobaan / jam).
- Seluruh mutasi state memvalidasi header `Origin` untuk mencegah serangan CSRF.

---

### Alur 2: Pembuatan & Parsing Resume Master

Ada dua jalur untuk menyiapkan resume master:

```mermaid
graph TD
    Start([Mulai]) --> Choice{Pilih Titik Awal}

    Choice -->|Jalur A: Berkas yang Ada| Upload[Upload PDF / DOC / DOCX]
    Upload --> Extract[Ekstraksi Teks Lokal]
    Extract --> LLMParse[LLM Parser menyusun ke skema ResumeData]
    LLMParse --> SaveDB[(Simpan ke Database dengan user_id)]

    Choice -->|Jalur B: Dipandu AI| Wizard[Mulai AI Resume Wizard]
    Wizard --> Step1[Intro & Data Kontak]
    Step1 --> Step2[Ringkasan Profesional]
    Step2 --> Step3[Pengalaman Kerja & Pencapaian]
    Step3 --> Step4[Pendidikan & Proyek]
    Step4 --> Step5[Keahlian Teknis]
    Step5 --> LiveDraft[Pratinjau Draf Langsung & Backup Lokal]
    LiveDraft --> Finalize[Klik 'Buat Resume Master']
    Finalize --> SaveDB

    SaveDB --> Ready([Resume Master Siap Digunakan])
```

- **Penyimpanan Lokal:** Draf wizard otomatis disimpan di browser local storage untuk mencegah kehilangan pekerjaan jika koneksi terputus.
- **Dukungan Multi-Master:** Pengguna dapat memiliki lebih dari satu jalur master resume (misal: satu untuk fokus *Backend Developer*, satu untuk *DevOps / SRE*).

---

### Alur 3: Penyesuaian Resume Berbasis Lowongan (Tailoring & Anti-Fabrication)

Alur utama dalam menyelaraskan resume terhadap lowongan kerja dengan penjagaan ketat agar AI tidak mengarang bebas (*hallucination / fabrication*):

```mermaid
flowchart TD
    A[Pilih Resume Master + Tempel Deskripsi Pekerjaan] --> B[Ekstraksi Kata Kunci Lowongan / Job Keywords]
    B --> C{Cek Kuota Harian AI Pengguna}
    C -->|Kuota Habis| C_Fail[Tolak: 429 Daily Limit Exceeded]
    C -->|Kuota Tersedia| D[Pilih Intensitas Penyesuaian: Nudge / Keywords / Full]

    D --> E[Panggilan LLM dengan Aturan Kebenaran Kritis]
    E --> F[Pembersihan Frasa Klise AI Lokal - Refiner Pass 2]
    F -->|Bahasa Indonesia| F1[Filter Kata Klise: 'memelopori', 'merevolusi', 'sinergi', 'mampu bekerja di bawah tekanan', em-dash]
    F -->|Bahasa Inggris| F2[Filter Buzzwords: 'spearheaded', 'synergy', 'leverage', em-dash]

    F1 & F2 --> G[Validasi Penyelarasan Master - Refiner Pass 3]
    G --> H{Apakah ada entitas baru?}
    H -->|Ya: Nama PT, Gelar, Jabatan, Angka Asing| H_Fix[Hapus / Kembalikan ke Klaim Asli Master]
    H -->|Tidak: Bersih & Terverifikasi| I[Tampilkan Pratinjau Perbandingan / Diff Modal]

    I --> J[Pengguna Meninjau & Menyetujui Perubahan]
    J --> K[(Simpan sebagai Tailored Resume)]
```

**Mekanisme Anti-Fabrikasi:**
1. **Prompt Truthfulness Rules**: Instruksi mutlak bagi LLM bahwa resume master adalah *single source of truth*.
2. **Deterministic Phrase Removal**: Menghapus frasa AI yang terdeteksi secara lokal (tanpa memotong kata kunci yang memang ada di dalam deskripsi lowongan).
3. **Master Alignment Verification**: Kode backend secara terprogram membandingkan setiap nama perusahaan, gelar akademik, dan angka metrik baru dengan data master resume.

---

### Alur 4: Pembuatan Cover Letter & Pesan Outreach

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant API as Backend Service
    participant LLM as Provider AI (OpenAI/Anthropic/Gemini)

    User->>Browser: Aktifkan "Cover Letter" & "Outreach Message" di Pengaturan
    User->>Browser: Jalankan penyesuaian resume terhadap lowongan
    API->>API: Periksa kuota AI harian pengguna
    API->>LLM: Kirim prompt Cover Letter + resume master + lowongan (Bahasa Indonesia / Inggris)
    API->>LLM: Kirim prompt Pesan Cold Outreach singkat (100–150 kata)
    LLM-->>API: Kembalikan konten terstruktur
    API-->>Browser: Tampilkan di tab editor samping resume
    User->>Browser: Edit personalisasi, salin ke clipboard, atau unduh PDF
```

---

### Alur 5: Evaluasi Kesesuaian (JD Match) & Persiapan Wawancara

- **JD Match Analysis**:
  - Menganalisis tingkat keselarasan kata kunci (*match score*).
  - Menyorot (*highlight*) kata kunci yang cocok secara langsung pada tampilan resume dengan penanda visual.
  - Memberikan daftar saran kata kunci teknis yang belum tercakup di resume.
- **Interview Preparation**:
  - Menghasilkan daftar pertanyaan wawancara yang spesifik berdasarkan proyek nyata dan riwayat pekerjaan di resume.
  - Memberikan panduan jawaban berbasis bukti (*grounded answer points*) tanpa mengarang pengalaman yang tidak ada.

---

### Alur 6: Rendering PDF & Verifikasi ATS (Ekspor Dokumen)

Proses pembuatan berkas PDF asli yang menjamin struktur teks dapat dibaca oleh sistem ATS perusahaan:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant API as FastAPI Backend
    participant Chromium as Headless Chromium (Playwright)
    participant NextJS as Next.js Print Page

    User->>Browser: Klik "Unduh PDF"
    Browser->>API: GET /api/v1/resumes/[id]/pdf
    API->>API: Buat short-lived print token (berlaku 60 detik)
    API->>Chromium: Buka http://localhost:3000/print/resumes/[id]?pt=<token>
    Chromium->>NextJS: Request halaman render print
    NextJS-->>Chromium: Kembalikan HTML dengan container .resume-print
    Chromium->>Chromium: Tunggu font selesai termuat (document.fonts.ready)
    Chromium->>Chromium: Generate PDF berbasis vektor (Format A4 / Letter)
    Chromium-->>API: Kembalikan raw PDF bytes (magic header %PDF)
    API-->>Browser: Stream berkas .pdf ke peramban pengguna
```

**Jaminan Keterbacaan ATS:**
- Tata letak default menggunakan `swiss-single` satu kolom (standar industri paling aman untuk parser ATS).
- Telah diuji menggunakan library ekstraksi teks `pdfminer.six` untuk menjamin *linear reading order* (nama -> judul -> ringkasan -> riwayat kerja -> pendidikan -> keahlian).

---

### Alur 7: Pelacak Lamaran (Application Tracker)

Papan Kanban interaktif untuk mengelola perjalanan pencarian kerja:

```
┌───────────┐    ┌───────────┐    ┌─────────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│   SAVED   │───►│  APPLIED  │───►│ NO RESPONSE │───►│ RESPONSE  │───►│ INTERVIEW │───►│ ACCEPTED  │
│  Disimpan │    │ Terkirim  │    │  (Followup) │    │ Ada Balas │    │ Wawancara │    │  Diterima │
└───────────┘    └───────────┘    └─────────────┘    └───────────┘    └───────────┘    └───────────┘
                                                                                             │
                                                                                             ▼
                                                                                       ┌───────────┐
                                                                                       │ REJECTED  │
                                                                                       │  Ditolak  │
                                                                                       └───────────┘
```
- Setiap kartu terhubung langsung dengan ID resume yang digunakan dan deskripsi pekerjaan yang dilamar.
- Dilengkapi kolom catatan pribadi untuk mencatat kontak perekrut atau jadwal tes teknis.

---

### Alur 8: Isolasi Multi-User, Kuota Harian, & Penghapusan Mandiri

- **Isolasi Data Multitenant:**
  Setiap baris data pada tabel `resumes`, `jobs`, `applications`, `resume_tailor_sessions`, dan `application_tracker` terikat pada kolom `user_id`. Backend secara otomatis menolak akses antar-pengguna dengan status `404 Not Found` (mencegah enumerasi ID).
- **Reset Kuota Harian:**
  Batas operasi AI (misal 30 operasi/hari) direset setiap pukul 00:00 WIB (Waktu Indonesia Barat / Asia/Jakarta).
- **Penghapusan Data Mandiri (*Self Data Deletion*):**
  Pengguna memiliki kendali privasi penuh melalui tombol "Delete All My Data" di menu Akun. Mengetik `RESET_ALL_DATA` akan menghapus seluruh resume, riwayat penyesuaian, dan lamaran milik pengguna secara permanen dan bersih (*cascading delete*).

---

## 3. Ringkasan Kebutuhan Deployment Produksi (Dokploy)

| Kebutuhan | Nilai Konfigurasi | Lokasi Pengaturan |
|---|---|---|
| **Domain** | `cv.zen-ai.my.id` | Tab **Domains** di Dokploy |
| **Port Container** | `3000` | Tab **Domains** di Dokploy |
| **SSL / HTTPS** | Aktif (Let's Encrypt Traefik) | Centang SSL di tab **Domains** |
| **Persistent Volume** | `resume-matcher-data` -> `/app/backend/data` | Tab **Volumes** di Dokploy |
| **Admin Email** | `zaenalarifmagang@gmail.com` | Tab **Environment** di Dokploy |
| **Public Base URL** | `https://cv.zen-ai.my.id` | Tab **Environment** di Dokploy |
| **CORS Origins** | `["https://cv.zen-ai.my.id"]` | Tab **Environment** di Dokploy |
| **Reverse Proxy Header** | `TRUST_PROXY=true` | Tab **Environment** di Dokploy |

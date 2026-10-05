"""Unit tests for language_detector service."""

from app.services.language_detector import detect_language


def test_detect_english_resume():
    text = (
        "Result-oriented IT Professional with 4+ years of fullstack development experience. "
        "Passionate about driving digital transformation across enterprise and financial sectors. "
        "Proven track record in leading end-to-end product lifecycles and managing cloud infrastructure. "
        "Excellent communicator with a strong commitment to continuous learning."
    )
    assert detect_language(text) == "en"


def test_detect_indonesian_resume():
    text = (
        "Ringkasan Profesional: Pengembang perangkat lunak berpengalaman lebih dari 4 tahun "
        "dalam pengembangan sistem enterprise dan perbankan. Memiliki keahlian dalam memimpin "
        "proyek dari awal hingga akhir, mengelola infrastruktur komputasi awan, dan bekerja sama "
        "dengan tim lintas fungsi untuk mencapai target perusahaan."
    )
    assert detect_language(text) == "id"


def test_detect_indonesian_job_description():
    text = (
        "Deskripsi Pekerjaan: Dibutuhkan Senior Backend Developer untuk penempatan di Jakarta. "
        "Kualifikasi dan Persyaratan: "
        "- Memiliki pengalaman kerja minimal 3 tahun di bidang pengembangan backend "
        "- Mampu mengelola database PostgreSQL dan Redis "
        "- Bertanggung jawab dalam merancang dan mengembangkan API yang aman dan scalable "
        "- Lulusan S1 Teknik Informatika atau jurusan terkait"
    )
    assert detect_language(text) == "id"


def test_detect_english_job_description():
    text = (
        "Job Description: Looking for a Senior Fullstack Engineer to join our core team. "
        "Qualifications and Requirements: "
        "- 4+ years of experience in software development and architecture "
        "- Proficient in React, TypeScript, Python, and cloud services "
        "- Bachelor's degree in Computer Science or related field "
        "- Strong problem-solving skills and experience with microservices"
    )
    assert detect_language(text) == "en"


def test_detect_empty_or_whitespace_fallback():
    assert detect_language(None) == "en"
    assert detect_language("") == "en"
    assert detect_language("   \n\t  ") == "en"
    assert detect_language("", default="id") == "id"


def test_detect_asian_scripts():
    # Japanese
    assert detect_language("ソフトウェアエンジニアの職務経歴書です。よろしくお願いいたします。") == "ja"
    # Korean
    assert detect_language("소프트웨어 엔지니어 이력서입니다. 잘 부탁드립니다.") == "ko"
    # Chinese
    assert detect_language("资深全栈工程师，具备五年以上的大型系统架构与研发经验。") == "zh"


def test_detect_indonesian_with_tech_keywords():
    # Indonesian resumes often have English tech names (Laravel, Docker, REST API)
    text = (
        "Pengalaman Kerja: Fullstack Developer di Surabaya, Indonesia. "
        "Bertanggung jawab mengembangkan REST API menggunakan Laravel, Docker, dan MySQL. "
        "Membuat sistem pembayaran terintegrasi dan mengelola deployment server."
    )
    assert detect_language(text) == "id"

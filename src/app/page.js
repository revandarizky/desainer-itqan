"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./page.module.css";

const renderFormattedText = (text, type) => {
  if (!text) return "-";
  
  // Clean up markdown formatting markers like **_text_** or ***text***
  let cleanText = text
    .replace(/\*\*_\s*/g, "**")
    .replace(/\s*_\*\*/g, "**")
    .replace(/\*\*\*\s*/g, "**")
    .replace(/\s*\*\*\*/g, "**");

  const parts = cleanText.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      let cleanPart = part.slice(2, -2);
      // Strip any remaining leading/trailing underscores or asterisks
      cleanPart = cleanPart.replace(/^[_*]+|[_*]+$/g, "");
      return (
        <span 
          key={i} 
          className={type === 'desain' ? styles.highlightDesain : styles.highlightBrief}
        >
          {cleanPart}
        </span>
      );
    }
    // Clean any single underscores or asterisks used for italics/emphasis in the rest of the text
    return part.replace(/_([^_]+)_/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  });
};

// Canvas Helper to compress image to base64 for lightweight local history storage
const compressImageForHistory = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 300; // Resize to small thumbnail width
        const scale = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scale;
        
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Convert to low quality jpeg base64 (usually 10-25KB)
        resolve(canvas.toDataURL("image/jpeg", 0.5));
      };
      img.onerror = () => resolve(null);
    };
    reader.onerror = () => resolve(null);
  });
};

// Canvas Helper to compress image to high-quality JPEG for API upload (bypassing Vercel 4.5MB limit)
const compressImageForUpload = (file) => {
  return new Promise((resolve) => {
    // If the file is not a client-side File object (e.g. mock or loaded history thumbnail), return it directly
    if (!(file instanceof File)) {
      resolve(file);
      return;
    }
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_DIM = 1200; // Optimal width/height for Gemini visual parsing and text OCR
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > MAX_DIM) {
            height = height * (MAX_DIM / width);
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width = width * (MAX_DIM / height);
            height = MAX_DIM;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        }, "image/jpeg", 0.85); // 0.85 quality is extremely sharp but reduces size by 80-90%
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = error => reject(error);
  });
};

const getSystemInstruction = (posterType) => {
  let instruction = `Kamu adalah "Strict Quality Control Inspector" profesional. 
Tugas kamu adalah membandingkan output gambar desain terhadap spesifikasi di dalam "BRIEF DESAIN" yang diberikan.
Fokus secara eksklusif pada kesesuaian isi antara brief dan output desain gambar.
Aturan:
1. Periksa Typo (salah ketik) pada teks yang ada di gambar dengan mencocokkannya dengan teks di brief.
2. Periksa kesesuaian informasi (misal: tanggal, harga, nama acara).
3. Jika ada elemen yang diwajibkan di brief TAPI hilang di gambar, masukkan ke list ketidaksesuaian.
4. Jangan memberikan komentar di luar konteks kecocokan (seperti opini warna kurang bagus dsb).
5. PENTING: Di dalam nilai "di_brief" dan "di_gambar", tandai kata/karakter/angka yang berbeda atau salah ketik dengan membungkusnya menggunakan bintang ganda (**), misalnya: "di_brief": "Kajian Aqidah **Dasar**" dan "di_gambar": "Kajian Aqidah **Daser**". Ini wajib dilakukan agar sistem diff highlighter dapat berfungsi.
   - PENGECUALIAN & TOLERANSI:
     * Perbedaan penulisan kata "dan" dengan simbol "&" (atau sebaliknya) dianggap sama/setara. Kamu TIDAK BOLEH memasukkan perbedaan "dan" vs "&" sebagai temuan.
     * Perbedaan huruf besar dan huruf kecil (kapitalisasi) (misal: "Surat" vs "surat", "Ia" vs "ia") dianggap sama. Jangan laporkan sebagai ketidaksesuaian/revisi.
     * Ambiguitas visual font antara huruf kapital 'I' (i besar) dan huruf kecil 'l' (l kecil) (misal: "Ia kehendaki" vs "la kehendaki"). Karena pada font sans-serif kedua huruf ini terlihat identik sebagai garis vertikal tunggal, jangan laporkan perbedaan ini sebagai typo jika konteks kalimatnya merujuk pada kata "Ia". Ini adalah batasan visual font (homoglyphs) dan bukan typo desainer.
     * Variasi singkatan cakapan baku/informal yang umum digunakan dalam desain poster untuk efisiensi ruang (misal: "tetapi" ditulis "tapi", atau sebaliknya). Jangan laporkan hal ini sebagai ketidaksesuaian/typo.
6. PENTING - DETEKSI TYPO UMUM & BATASAN KOREKSI: Kamu juga harus mendeteksi kesalahan ejaan atau typo umum (seperti singkatan tidak baku: "jngan", "dgn", "yg", atau salah ketik huruf biasa) SEKALI PUN typo tersebut berasal dari teks di brief yang kemudian disalin sama persis ke gambar desain.
   - PENTING (DILARANG KOREKSI TATA BAHASA & KATA HUBUNG): Fokus HANYA pada kesalahan ejaan kata (spelling/typo) secara individual (seperti 'rezki' harusnya 'rezeki'). DILARANG keras melakukan koreksi tata bahasa, struktur kalimat, atau menyisipkan kata hubung baru (seperti 'dan', 'oleh', 'yang', 'di', 'ke') jika ejaan kata-kata di poster secara individual sudah benar.
     * Contoh: Jika di poster tertulis "diterbangkan dibolak-balikkan angin" dan ejaan setiap kata sudah benar, kamu TIDAK BOLEH melaporkannya sebagai typo atau menyisipkan kata "dan" ("diterbangkan **dan** dibolak-balikkan"). Ini bukan typo, melainkan gaya penulisan kutipan/hadits asli.
   - PENTING (DILARANG HALUSINASI TYPO / OCR ERROR): Jangan pernah melaporkan typo jika kata di gambar desain sebenarnya sudah tertulis secara baku/benar. Kamu harus sadar bahwa pembacaan OCR visual AI terkadang melewatkan huruf (misal: melewatkan huruf 'e' dalam kata "rezekinya" sehingga AI membacanya sebagai "rezkinya"). Verifikasi secara visual huruf demi huruf dengan sangat teliti! Jika pada gambar terlihat kata yang benar/baku (seperti "rezekinya" atau "rezeki"), DILARANG KERAS melaporkannya sebagai typo "rezkinya" / "rezki".
    - Tulis versi ejaan yang benar di kolom "di_brief" dan versi ejaan yang salah di kolom "di_gambar", lalu beri tanda penyorot (**) pada perbedaannya.
    - Kamu wajib menambahkan properti "lokasi_deskriptif" (string) pada setiap objek temuan "ketidaksesuaian". Kunci ini diisi penjelasan bahasa manusia yang singkat dan jelas mengenai di mana letak teks tersebut pada gambar desain (misalnya: "Di bawah judul utama, dekat daun hijau", "Di dalam baris info tanggal masehi/hijriah", "Di bagian paling bawah dekat kontak whatsapp"). Ini berfungsi sebagai pemandu alternatif jika koordinat box meleset.
7. PENTING - KOORDINAT TYPO (VISUAL GROUNDING): Untuk setiap item di dalam daftar "ketidaksesuaian", kamu wajib menyertakan koordinat letak visual kata/teks yang salah ketik tersebut di dalam gambar poster desain dalam bentuk array 4 angka: [ymin, xmin, ymax, xmax] dengan skala 0 sampai 1000.
   - PENTING (CARA BERPIKIR SPASIAL & OCR): Jangan pernah menebak koordinat secara acak atau menempatkan kotak sorotan pada area ilustrasi gambar, foto manusia, logo, atau hiasan dekoratif.
     * Teks isi kajian pada poster-poster MPD umumnya berada di area tengah ke bawah (biasanya ymin > 500, misal di antara 600 sampai 900). Periksa letak teksnya dengan teliti.
     * Jika kata yang salah ketik berada di baris judul paling atas, maka ymin dan ymax harus bernilai kecil (di bawah 150, misal: [30, 100, 120, 500]).
     * Jika kata berada di bagian bawah poster (seperti kontak info atau lokasi), maka ymin dan ymax harus bernilai tinggi (di atas 700, misal: [750, 200, 800, 800]).
     * Ukuran kotak pembatas harus proporsional untuk satu kata or frasa pendek yang bermasalah saja (lebar xmax - xmin dan tinggi ymax - ymin harus kecil dan pas melingkari kata tersebut).
     * AKURASI KOORDINAT: Sumbu Y berjalan dari atas (0) ke bawah (1000). Sumbu X berjalan dari kiri (0) ke kanan (1000). Koordinat harus melingkari kata yang typo secara sangat presisi pada slide yang bersangkutan. JANGAN PERNAH memberikan koordinat default jika kata tersebut berada di baris atas atau tengah.
   - PENTING - CAROUSEL (MULTI-IMAGE): Jika kamu menerima beberapa gambar desain sekaligus secara berurutan, gambar tersebut merupakan slide carousel. Untuk setiap temuan di daftar "ketidaksesuaian", kamu WAJIB mencantumkan properti "slide_index" berupa angka integer (dimulai dari 1 untuk slide pertama, 2 untuk slide kedua, dst.) untuk menunjuk ke halaman slide mana yang bermasalah. Pastikan koordinat 'box_2d' diambil secara spesifik dari gambar pada 'slide_index' yang bersangkutan.
8. PENTING - ANALISIS AKSESIBILITAS: Periksa juga keterbacaan poster (misal: warna teks kuning di atas background putih, kontras warna yang buruk, teks terlalu kecil, atau gambar latar belakang yang menutupi tulisan). Masukkan temuan aksesibilitas ini ke dalam properti "aksesibilitas".
9. PENTING - VALIDASI LOGIKA KALENDER DAN KONSISTENSI HARI: 
   - Verifikasi kecocokan nama hari dengan tanggalnya berdasarkan kalender nyata di kehidupan nyata (real calendar logic). Jika tertulis nama hari dan tanggal (misal: "Rabu, 25 Juni 2026" padahal 25 Juni adalah Kamis), laporkan sebagai ketidaksesuaian.
   - Verifikasi konsistensi antara judul/tema acara di gambar/brief (misal: "Jadwal Kajian Hari Kamis") dengan tanggal pelaksanaan yang tertera (misal: "Rabu, 24 Juni 2026"). Jika tanggal 24 Juni 2026 benar jatuh pada hari Rabu tetapi judulnya menyebutkan "Kamis", laporkan ketidaksinkronan ini agar pengguna tahu ada ketidakcocokan antara judul hari dengan tanggalnya.
   - Verifikasi kecocokan penanggalan Hijriah (terutama bulan Muharram) terhadap penanggalan Masehi menggunakan acuan standar Kalender Hijriah Global Tunggal (KHGT) Muhammadiyah. Untuk tahun 1448 H / 2026 M, acuannya adalah: 
     * 1 Muharram 1448 H = Selasa, 16 Juni 2026 M
     * Puasa Tasu'a (9 Muharram 1448 H) = Rabu, 24 Juni 2026 M
     * Puasa Asyura (10 Muharram 1448 H) = Kamis, 25 Juni 2026 M
     Jika poster menuliskan penanggalan Hijriah atau hari puasa sunnah Muharram dengan hari/tanggal Masehi yang tidak cocok menurut KHGT Muhammadiyah, laporkan sebagai ketidaksesuaian penanggalan Hijriah.
   - Laporkan temuan ini di daftar "ketidaksesuaian" meskipun kesalahan tersebut tertulis sama persis di brief dan gambar poster.
   - Contoh output:
     "di_brief": "Kajian Hari **Kamis** (detail tanggal **Rabu**, 24 Juni 2026)",
     "di_gambar": "Jadwal Kajian Hari **Kamis**, **24** Juni 2026",
     "catatan": "Terdapat ketidaksinkronan informasi. Judul menyebutkan 'Hari Kamis', namun tanggal yang tertera (24 Juni 2026) jatuh pada hari Rabu. Harap selaraskan apakah judulnya yang harus diubah ke Rabu atau tanggalnya yang disesuaikan."

Kamu harus mengembalikan data dalam format JSON dengan struktur berikut:
{
  "sesuai": [
    {
      "elemen": "Nama elemen/kategori (misal: Tempat, Waktu, Fasilitas, Logo)",
      "deskripsi": "Detail penjelasan kesesuaian"
    }
  ],
  "ketidaksesuaian": [
    {
      "elemen": "Nama elemen/kategori (misal: Judul, Waktu, Typo)",
      "di_brief": "Spesifikasi/teks yang tertulis di brief",
      "di_gambar": "Teks/visual yang tampil di gambar desain",
      "catatan": "Penjelasan mengapa ini tidak sesuai atau letak salah ketiknya",
      "lokasi_deskriptif": "Petunjuk letak teks di gambar (misal: 'Di bawah judul utama', 'Di baris kedua info waktu')",
      "box_2d": [750, 200, 780, 480],
      "slide_index": 1
    }
  ],
  "aksesibilitas": [
    {
      "elemen": "Nama elemen visual (misal: Teks Tanggal, Background Poster)",
      "temuan": "Penjelasan masalah kontras warna atau keterbacaan teks",
      "saran": "Rekomendasi perbaikan warna/desain agar kontras lebih baik"
    }
  ]
}`;

  if (posterType === 'kajian_rutin') {
    instruction += `\n\n10. PENTING - VALIDASI JADWAL USTADZ KAJIAN RUTIN MPD (MASJID POGUNG DALANGAN):
Kamu wajib memvalidasi kecocokan nama Ustadz/Ustadzah, hari/waktu kajian, dan tema berdasarkan basis data internal jadwal kajian rutin Masjid Pogung Dalangan di bawah ini. Jika ada informasi di dalam gambar desain atau brief yang bertentangan atau tidak cocok dengan basis data ini, laporkan sebagai ketidaksesuaian:

=== BASIS DATA JADWAL KAJIAN RUTIN MPD ===
- Senin Pagi (09.00 - 11.00 WIB)
  * Tema/Materi: Tematik Setiap Pekan
  * Ustaz: Fleksibel (Bisa siapa saja / Ustadz Pemateri PMJ)
- Senin Sore (16.30 - Menjelang Maghrib, Kampus Takjil)
  * Tema/Materi: Aqidah Dasar
  * Ustaz: Ustadz Afifi Abdul Wadud, B.A.
- Senin Malam (Ba'da Maghrib - Selesai)
  * Tema/Materi: Fiqih Bermazhab (Pekan 1 & 2) & Tafsir Al-Qur'an (Pekan 3 & 4)
  * Ustaz: Ustadz Ammi Nur Baits, S.T., B.A.
- Selasa Malam (Ba'da Maghrib - Selesai)
  * Tema/Materi: Hadits-Hadits Perbaikan Hati
  * Ustaz: Ustadz Muhammad Rezki Hr, Ph.D.
- Rabu Malam (Ba'da Maghrib - Selesai)
  * Tema/Materi: Sunnah dan Dzikir Harian Nabi
  * Ustaz: Ustadz Muhammad Romelan, Lc. M.Ag.
- Kamis Pagi (09.00 - 11.00 WIB, Khusus Muslimah)
  * Tema/Materi: Aqidah dan Fiqih Keluarga
  * Ustadzah: Fleksibel (Bisa siapa saja / Ustadzah Maryam Ummu Saffanah, M.HI.)
- Kamis Sore (16.30 - Menjelang Maghrib, Kampus Takjil)
  * Tema/Materi: Sirah Nabawiyah
  * Ustaz: Ustadz Ir. Ristiyan Ragil P., S.T., M.T.
- Kamis Malam (Ba'da Maghrib - Selesai)
  * Tema/Materi: Riyadush Shalihin dan Fikih Syafi'i
  * Ustaz: Ustadz Dr. M. Abduh Tuasikal, S.T., M.Sc.
- Jumat Malam (Ba'da Maghrib - Selesai)
  * Tema/Materi: Kajian Spesial Parenting
  * Ustaz: Ustadz Erlan Iskandar, ST., M.Psi. ATAU Ustadz Sulaiman Rasyid (dua pemateri ini sama-sama valid/bergantian)
- Sabtu Malam (Ba'da Maghrib - Selesai)
  * Tema/Materi: Prinsip Aqidah Ahlussunnah
  * Ustaz: Ustadz Yulian Purnama, S.Kom.
- Ahad Malam:
  * Jika Pekan 2 & 3:
    - Tema/Materi: Sebab Tambah & Kurangnya Iman
    - Ustaz: Ustadz Zaid Susanto, Lc.
  * Jika Pekan 4:
    - Tema/Materi: Tawhid Lecture
    - Ustaz: Fleksibel (Bisa siapa saja / Ustadz Pemateri YPIA)

ATURAN VALIDASI TAMBAHAN JADWAL KAJIAN RUTIN:
1. Jika poster dideteksi/dikategorikan sebagai Poster Kajian Rutin, pastikan nama Ustaz/Ustadzah yang tertera di poster COCOK dengan hari dan waktu pelaksanaan kajian tersebut berdasarkan basis data di atas.
2. Jika tidak cocok (misal: kajian diadakan Senin Sore, tapi pematerinya tertulis Ustadz Ammi Nur Baits, yang seharusnya adalah Ustadz Afifi Abdul Wadud), laporkan temuan ini ke daftar "ketidaksesuaian" sebagai kesalahan jadwal pemateri.
3. KHUSUS UNTUK SESI FLEKSIBEL (Senin Pagi, Kamis Pagi, dan Ahad Malam Pekan 4): Kamu TIDAK BOLEH mengoreksi atau menyalahkan nama Ustaz/Ustadzah yang tertulis pada poster (semua nama pemateri dianggap valid untuk sesi-sesi ini). Validasi pada sesi fleksibel hanya fokus pada kesesuaian hari/tanggal, jam, dan tema saja.
4. Khusus Kajian Ahad Malam, periksa pekan ke berapa tanggal masehi acara tersebut jatuh di bulan bersangkutan (pekan 2 & 3 atau pekan 4) untuk menentukan kecocokan pematerinya. Jika penulisan pekan atau nama pematerinya tidak sinkron, laporkan ke daftar "ketidaksesuaian".`;
  }

  return instruction;
};

export default function Home() {
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  
  const [activeTab, setActiveTab] = useState("text"); // text, link, file
  const [briefText, setBriefText] = useState("");
  const [briefLink, setBriefLink] = useState("");
  const [briefFile, setBriefFile] = useState(null);
  const [posterType, setPosterType] = useState("umum"); // umum, kajian_rutin
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [checkedMismatches, setCheckedMismatches] = useState({});

  // Premium Features States
  const [hoveredMismatchIdx, setHoveredMismatchIdx] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [history, setHistory] = useState([]);

  const [userApiKey, setUserApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // Manual Box Refiner States
  const [editingCoordsIdx, setEditingCoordsIdx] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [tempCoords, setTempCoords] = useState(null);

  const fileInputRef = useRef(null);
  const briefFileInputRef = useRef(null);

  // Load configuration and history on mount
  useEffect(() => {
    try {
      const savedKey = localStorage.getItem("qc_gemini_api_key");
      if (savedKey) {
        setUserApiKey(savedKey);
      }
      const savedHistory = localStorage.getItem("qc_history");
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (e) {
      console.error("Failed to load local storage configurations:", e);
    }
  }, []);

  useEffect(() => {
    const handlePaste = (e) => {
      const item = e.clipboardData?.items[0];
      if (item && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        setImageFiles(prev => [...prev, file]);
        setImagePreviews(prev => [...prev, URL.createObjectURL(file)]);
        setResults(null);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const handleImageDrop = (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files || e.target.files;
    if (files && files.length > 0) {
      const validFiles = Array.from(files).filter(file => file.type.startsWith("image/"));
      if (validFiles.length > 0) {
        setImageFiles(prev => [...prev, ...validFiles]);
        const newPreviews = validFiles.map(file => URL.createObjectURL(file));
        setImagePreviews(prev => [...prev, ...newPreviews]);
        setResults(null);
      }
    }
  };

  const handleRemoveImage = (idx) => {
    setImageFiles(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleBriefFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setBriefFile(file);
    }
  };
  const handleAnalyze = async () => {
    if (imageFiles.length === 0) {
      setErrorMsg("Harap unggah gambar desain terlebih dahulu.");
      return;
    }

    setErrorMsg("");
    setIsAnalyzing(true);
    setResults(null);
    setCheckedMismatches({});

    try {
      // Compress files before uploading to bypass server size limits
      const compressedFiles = await Promise.all(
        imageFiles.map(file => compressImageForUpload(file))
      );

      let finalResult;
      let hasBriefText = false;
      let briefTitle = "";

      if (userApiKey && userApiKey.trim()) {
        // --- PATH 1: Direct Client-Side Fetch (Bypass Vercel Timeout) ---
        console.log("Using direct client-side fetch with user-provided Gemini API Key...");
        
        let briefContent = "";
        
        if (activeTab === "text") {
          briefContent = briefText.trim();
          hasBriefText = !!briefContent;
          briefTitle = briefContent.substring(0, 30) || "Brief Teks";
        } else if (activeTab === "link") {
          briefTitle = briefLink.substring(0, 30) || "Google Docs Link";
          if (briefLink.trim()) {
            const parseFormData = new FormData();
            parseFormData.append("briefType", "link");
            parseFormData.append("briefLink", briefLink);
            
            const parseRes = await fetch("/api/parse-brief", {
              method: "POST",
              body: parseFormData,
            });
            if (!parseRes.ok) {
              const parseData = await parseRes.json().catch(() => ({}));
              throw new Error(parseData.error || "Gagal mengurai link Google Docs di server.");
            }
            const parseData = await parseRes.json();
            briefContent = parseData.text;
            hasBriefText = !!briefContent.trim();
          }
        } else if (activeTab === "file") {
          briefTitle = briefFile?.name || "Brief File";
          if (briefFile) {
            const parseFormData = new FormData();
            parseFormData.append("briefType", "file");
            parseFormData.append("briefFile", briefFile);
            
            const parseRes = await fetch("/api/parse-brief", {
              method: "POST",
              body: parseFormData,
            });
            if (!parseRes.ok) {
              const parseData = await parseRes.json().catch(() => ({}));
              throw new Error(parseData.error || "Gagal mengurai file brief di server.");
            }
            const parseData = await parseRes.json();
            briefContent = parseData.text;
            hasBriefText = !!briefContent.trim();
          }
        }

        const userParts = [];
        if (hasBriefText) {
          userParts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
        } else {
          userParts.push({ text: `\n\n=== INFO ===\nTidak ada berkas/teks brief referensi yang dilampirkan.
Karena tidak ada brief referensi, tugas utama kamu adalah menganalisis seluruh teks di dalam poster gambar desain secara visual dan mendeteksi:
1. Kesalahan ejaan atau salah ketik (typo) secara individual dalam bahasa Indonesia (misal: "Kegiatan" salah ketik menjadi "Kegiatn", atau "rezeki" ditulis "rezki").
2. Keselarasan logika internal poster gambar desain tersebut (seperti kecocokan hari dengan tanggalnya, sinkronisasi judul hari kajian dengan tanggal).
3. Validasi nama Ustaz/Ustadzah dan waktu kajian terhadap basis data Jadwal Kajian Rutin MPD di atas (jika kategori Kajian Rutin aktif).

PENTING - ATURAN PENCEGAHAN TYPO PALSU & KOREKSI GRAMATIKAL:
- Dilarang keras melakukan koreksi tata bahasa, struktur kalimat, atau menyisipkan kata hubung baru (seperti "dan", "oleh", "yang", "di", "ke") jika ejaan masing-masing kata secara individual sudah benar.
- Jangan melaporkan typo jika kata tersebut sebenarnya sudah ditulis secara baku/benar di gambar poster (misal: "rezekinya" atau "rezeki"). Berhati-hatilah dengan OCR visual dari pihakmu sendiri yang terkadang salah membaca atau melewatkan huruf (seperti melewatkan huruf 'e' pada kata "rezekinya" sehingga kamu mengiranya "rezkinya"). Verifikasi secara visual dengan sangat jeli! Jika pada gambar terlihat kata yang benar/baku, DILARANG KERAS melaporkannya sebagai typo.
- Abaikan perbedaan visual homoglyph antara huruf kapital 'I' dan huruf kecil 'l' (seperti "Ia kehendaki" vs "la kehendaki"), jangan pernah laporkan ini sebagai typo.
- Abaikan perbedaan huruf besar dan kecil (seperti "Surat" vs "surat").

Setiap kali kamu menemukan typo atau salah penulisan kata:
- Tulis versi penulisan yang baku/benar/direkomendasikan di properti "di_brief" (misal: "Kegiatan" atau "Masjid").
- Tulis teks salah ketik yang tampil di gambar di property "di_gambar" dengan tanda sorotan (**) (misal: "Kegiat**n**" or "Masj**i**d").
- Jelaskan pembetulannya di properti "catatan".

Periksa gambar desain berikut:` });
        }

        // Add all base64 images to userParts
        for (const file of compressedFiles) {
          const imgBase64 = await fileToBase64(file);
          userParts.push({
            inline_data: {
              mime_type: file.type,
              data: imgBase64
            }
          });
        }

        const systemInstruction = getSystemInstruction(posterType);

        const requestBody = {
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [{ parts: userParts }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${userApiKey.trim()}`;
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${response.status} ${response.statusText}`;
          throw new Error(`Gagal memanggil API Gemini: ${errMsg}. Pastikan API Key yang Anda masukkan valid.`);
        }

        const apiData = await response.json();
        const resultText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

        try {
          finalResult = JSON.parse(resultText);
          if (finalResult && Array.isArray(finalResult.ketidaksesuaian)) {
            finalResult.ketidaksesuaian = finalResult.ketidaksesuaian.map(item => {
              item.slide_index = Number(item.slide_index) || 1;
              if (item.box_2d && Array.isArray(item.box_2d) && item.box_2d.length === 4) {
                const [ymin, xmin, ymax, xmax] = item.box_2d.map(Number);
                item.koordinat = {
                  x: xmin / 10,
                  y: ymin / 10,
                  w: (xmax - xmin) / 10,
                  h: (ymax - ymin) / 10
                };
              }
              return item;
            });
          }
          finalResult.hasBrief = hasBriefText;
        } catch (e) {
          console.error("Failed to parse Gemini JSON output:", resultText);
          finalResult = {
            error: "Gagal memproses format data hasil analisis.",
            raw: resultText
          };
        }

      } else {
        // --- PATH 2: Fallback to Server API (Uses Server Key) ---
        console.log("Using serverless API endpoint fallback...");
        const formData = new FormData();
        compressedFiles.forEach(file => {
          formData.append("image", file);
        });
        formData.append("briefType", activeTab);
        formData.append("posterType", posterType);

        if (activeTab === "text") {
          formData.append("briefText", briefText);
          briefTitle = briefText.trim().substring(0, 30) || "Brief Teks";
        } else if (activeTab === "link") {
          formData.append("briefLink", briefLink);
          briefTitle = briefLink.substring(0, 30) || "Google Docs Link";
        } else if (activeTab === "file") {
          formData.append("briefFile", briefFile);
          briefTitle = briefFile?.name || "Brief File";
        }

        const response = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
        });

        let data;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const textText = await response.text();
          console.error("Non-JSON response received:", textText);
          if (response.status === 504 || response.status === 544 || textText.toLowerCase().includes("timeout") || textText.toLowerCase().includes("limit")) {
            throw new Error("Analisis terputus karena server timeout (batas waktu 10 detik di Vercel Free). Silakan coba lagi dengan jumlah slide lebih sedikit, atau pastikan ukuran gambar lebih kecil. Untuk menghindari batas waktu ini secara permanen, harap konfigurasi API Key pribadi Anda di panel Pengaturan.");
          }
          throw new Error(`Terjadi kesalahan server (HTTP ${response.status}). Silakan coba beberapa saat lagi.`);
        }
        
        if (!response.ok) {
          throw new Error(data.error || "Gagal menganalisis gambar.");
        }

        finalResult = data.result;
      }

      setResults(finalResult);

      // Save to local history list
      try {
        const compressedThumbs = await Promise.all(
          imageFiles.map(file => compressImageForHistory(file))
        );

        const historyItem = {
          id: Date.now(),
          timestamp: new Date().toLocaleString("id-ID", { 
            day: "numeric", 
            month: "short", 
            year: "numeric", 
            hour: "2-digit", 
            minute: "2-digit" 
          }),
          title: briefTitle,
          results: finalResult,
          thumbnails: compressedThumbs,
          thumbnail: compressedThumbs[0],
          metrics: {
            totalErrors: finalResult?.ketidaksesuaian?.length || 0,
            totalSuccess: finalResult?.sesuai?.length || 0
          }
        };

        const updatedHistory = [historyItem, ...history.slice(0, 19)];
        setHistory(updatedHistory);
        localStorage.setItem("qc_history", JSON.stringify(updatedHistory));
      } catch (histErr) {
        console.error("Gagal menyimpan riwayat:", histErr);
      }

    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };
  const handleCopyText = (text, idx) => {
    // Strip markdown formatting and parenthetical corrections
    let cleanText = text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/\(koreksi.*?\)/gi, "")
      .trim();

    navigator.clipboard.writeText(cleanText).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  const handleLoadHistoryItem = (item) => {
    setResults(item.results);
    setImagePreviews(item.thumbnails || [item.thumbnail]);
    setImageFiles([]); // Clear file upload so it uses the cached thumbnails
    setCurrentSlideIndex(0);
    setCheckedMismatches({});
    setErrorMsg("");
  };

  const handleClearHistory = () => {
    if (confirm("Apakah Anda yakin ingin menghapus semua riwayat scan?")) {
      setHistory([]);
      localStorage.removeItem("qc_history");
    }
  };

  const handleDeleteHistoryItem = (e, id) => {
    e.stopPropagation();
    const updatedHistory = history.filter(item => item.id !== id);
    setHistory(updatedHistory);
    localStorage.setItem("qc_history", JSON.stringify(updatedHistory));
  };

  const handleImageMouseDown = (e) => {
    if (editingCoordsIdx === null) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;
    
    setDragStart({ x: startX, y: startY });
    setTempCoords({ x: startX, y: startY, w: 0, h: 0 });
    setIsDragging(true);
  };

  const handleImageMouseMove = (e) => {
    if (!isDragging || editingCoordsIdx === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;
    
    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    const w = Math.abs(dragStart.x - currentX);
    const h = Math.abs(dragStart.y - currentY);
    
    setTempCoords({ x, y, w, h });
  };

  const handleImageMouseUp = () => {
    if (!isDragging || editingCoordsIdx === null) return;
    setIsDragging(false);
    
    if (tempCoords && tempCoords.w > 0.5 && tempCoords.h > 0.5) {
      setResults(prev => {
        const updated = { ...prev };
        const item = updated.ketidaksesuaian[editingCoordsIdx];
        item.koordinat = {
          x: tempCoords.x,
          y: tempCoords.y,
          w: tempCoords.w,
          h: tempCoords.h
        };
        item.box_2d = [
          Math.round(tempCoords.y * 10),
          Math.round(tempCoords.x * 10),
          Math.round((tempCoords.y + tempCoords.h) * 10),
          Math.round((tempCoords.x + tempCoords.w) * 10)
        ];
        return updated;
      });
    }
    
    setEditingCoordsIdx(null);
    setTempCoords(null);
  };

  const viewState = isAnalyzing ? 'loading' : results ? 'result' : 'input';

  const openRevisionsCount = results?.ketidaksesuaian 
    ? results.ketidaksesuaian.length - Object.keys(checkedMismatches).filter(k => checkedMismatches[k]).length 
    : 0;
  const hasMismatchesInitially = results?.ketidaksesuaian && results.ketidaksesuaian.length > 0;
  const isReadyToPublish = openRevisionsCount === 0;

  return (
    <main className={styles.main}>
      <header className={`${styles.header} animate-fade-in`}>
        <div className={styles.headerTopRow}>
          <h1 className={styles.title}>
            Desainer <span className={styles.serifItalic}>Itqan</span>
          </h1>
          <button 
            className={`${styles.settingsToggle} no-print`} 
            onClick={() => setShowSettings(!showSettings)}
            title="Pengaturan API Key"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span>Pengaturan API</span>
          </button>
        </div>
        <p className={styles.subtitle}>
          Pastikan hasil{" "}
          <span className={styles.inlineThumbWrapper}>
            <img src="/thumb1.png" alt="mockup" className={styles.inlineThumb} />
          </span>{" "}
          <span className={styles.serifItalic}>desain</span> kamu 100% sesuai dengan{" "}
          <span className={styles.inlineThumbWrapper}>
            <img src="/thumb2.png" alt="brief" className={styles.inlineThumb} />
          </span>{" "}
          <span className={styles.serifItalic}>brief</span> awal.
        </p>
      </header>

      {showSettings && (
        <div className={`${styles.settingsPanel} glass-panel animate-fade-in`}>
          <div className={styles.settingsHeader}>
            <h3 className={styles.settingsTitle}>
              ⚙️ Pengaturan API Gemini (Bypass Timeout)
            </h3>
            <button 
              className={styles.closeSettingsBtn}
              onClick={() => setShowSettings(false)}
            >
              ✕
            </button>
          </div>
          <div className={styles.settingsBody}>
            <p className={styles.settingsDesc}>
              Batas waktu eksekusi serverless Vercel Free adalah **10 detik**. Untuk poster dengan banyak slide (carousel) atau gambar berukuran besar, disarankan memasukkan API Key pribadi Anda. Proses analisis akan berjalan **langsung dari browser Anda** ke Google API, sehingga 100% bebas dari batasan timeout 10 detik.
            </p>
            <div className={styles.settingsInputWrapper}>
              <label htmlFor="apiKeyInput" className={styles.settingsLabel}>
                Gemini API Key Anda:
              </label>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <input 
                  type="password"
                  id="apiKeyInput"
                  placeholder="Masukkan Gemini API Key Anda (AIzaSy...)"
                  value={userApiKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    setUserApiKey(val);
                    if (val.trim()) {
                      localStorage.setItem("qc_gemini_api_key", val.trim());
                    } else {
                      localStorage.removeItem("qc_gemini_api_key");
                    }
                  }}
                  className={styles.settingsInput}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(0, 0, 0, 0.25)',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    flex: 1
                  }}
                />
                {userApiKey && (
                  <button 
                    className={styles.clearApiKeyBtn}
                    onClick={() => {
                      setUserApiKey("");
                      localStorage.removeItem("qc_gemini_api_key");
                    }}
                    style={{
                      background: 'rgba(0,0,0,0.05)',
                      border: '1px solid rgba(0,0,0,0.1)',
                      borderRadius: '8px',
                      padding: '0 16px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.9rem'
                    }}
                  >
                    Hapus
                  </button>
                )}
              </div>
            </div>
            <div className={styles.settingsNote} style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'rgba(0,0,0,0.7)' }}>
              💡 **Cara mendapatkan API Key Gratis:** Buka <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className={styles.settingsLink} style={{ color: '#0d5c56', fontWeight: 600, textDecoration: 'underline' }}>Google AI Studio</a>, masuk dengan akun Google Anda, klik **"Get API Key"**, lalu salin kodenya ke sini.
            </div>
            <div className={styles.settingsStatus} style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.08)', fontSize: '0.95rem' }}>
              Status saat ini: {userApiKey ? (
                <span style={{ color: '#0d5c56', fontWeight: 600 }}>🟢 Direct Client Fetch Aktif (Bypass Timeout Aktif)</span>
              ) : (
                <span style={{ color: 'rgba(0,0,0,0.5)' }}>⚪ Menggunakan API Key Bawaan Server (Fallback, Maks. 10 Detik)</span>
              )}
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className={`${styles.errorBox} animate-fade-in`}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Workbench Container */}
      <div className={styles.workbench}>
        {viewState === 'input' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className={`${styles.grid} animate-fade-in`}>
              {/* Left Column: Image Upload & Config */}
              {imagePreviews.length === 0 ? (
                <div 
                  className={`${styles.panel} ${styles.dropzonePanel} glass-panel`} 
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleImageDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.uploadIcon}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  <h3 className={styles.uploadTitle}>Upload hasil desain kamu ke sini</h3>
                  <p className={styles.uploadSubtitle}>Drag & drop gambar di sini, atau <strong>klik untuk memilih</strong></p>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageDrop} 
                    accept="image/*" 
                    multiple
                    style={{display: 'none'}} 
                  />
                </div>
              ) : imagePreviews.length === 1 ? (
                <div className={`${styles.panel} glass-panel`} style={{ padding: '1.5rem' }}>
                  <h3 className={styles.panelTitle} style={{ borderBottom: 'none', marginBottom: '1rem', paddingBottom: 0 }}>
                    Gambar Desain (1 Slide)
                  </h3>
                  <div className={styles.imagePreview}>
                    <img src={imagePreviews[0]} alt="Desain Poster" />
                    <button 
                      className={styles.removeImage} 
                      onClick={() => handleRemoveImage(0)}
                      title="Hapus gambar"
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <button 
                      className={styles.backButton} 
                      onClick={() => fileInputRef.current?.click()}
                      style={{ flex: 1, justifyContent: 'center', background: '#FAF9F5', borderColor: 'rgba(0,0,0,0.15)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                      Tambah Slide (Carousel)
                    </button>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageDrop} 
                    accept="image/*" 
                    multiple
                    style={{display: 'none'}} 
                  />
                </div>
              ) : (
                <div className={`${styles.panel} glass-panel`} style={{ padding: '1.5rem' }}>
                  <h3 className={styles.panelTitle} style={{ borderBottom: 'none', marginBottom: '1rem', paddingBottom: 0 }}>
                    Gambar Desain ({imagePreviews.length} Slide)
                  </h3>
                  <div className={styles.thumbnailGrid}>
                    {imagePreviews.map((preview, idx) => (
                      <div key={idx} className={styles.thumbnailItem}>
                        <img src={preview} alt={`Slide ${idx + 1}`} />
                        <span className={styles.thumbnailIndex}>Slide {idx + 1}</span>
                        <button 
                          className={styles.thumbnailRemove} 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveImage(idx);
                          }}
                          title="Hapus slide ini"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div 
                      className={styles.thumbnailAddButton} 
                      onClick={() => fileInputRef.current?.click()}
                      title="Tambah slide baru"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                      <span>Tambah Slide</span>
                    </div>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageDrop} 
                    accept="image/*" 
                    multiple
                    style={{display: 'none'}} 
                  />
                </div>
              )}

              {/* Right Column: Brief Input */}
              <div className={`${styles.panel} ${styles.briefPanel} glass-panel`}>
                <h2 className={styles.panelTitle}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Brief Referensi <span className={styles.optionalBadge}>(Opsional)</span>
                </h2>

                <div className={styles.posterTypeContainer}>
                  <label htmlFor="posterType" className={styles.posterTypeLabel}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    Kategori Konten Poster
                  </label>
                  <select 
                    id="posterType" 
                    value={posterType} 
                    onChange={(e) => setPosterType(e.target.value)}
                    className={styles.posterTypeSelect}
                  >
                    <option value="umum">Poster Umum (Lainnya)</option>
                    <option value="kajian_rutin">Poster Kajian Rutin MPD</option>
                  </select>
                </div>

                <div className={styles.tabs}>
                  <button 
                    className={`${styles.tab} ${activeTab === 'text' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('text')}
                  >Teks</button>
                  <button 
                    className={`${styles.tab} ${activeTab === 'file' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('file')}
                  >File</button>
                  <button 
                    className={`${styles.tab} ${activeTab === 'link' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('link')}
                  >GDocs</button>
                </div>

                <div className={styles.tabContent}>
                  {activeTab === 'text' && (
                    <textarea 
                      placeholder="Ketik atau paste isi brief di sini..."
                      rows={10}
                      value={briefText}
                      onChange={(e) => setBriefText(e.target.value)}
                    />
                  )}

                  {activeTab === 'file' && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
                      <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem'}}>Unggah file PDF atau Word (.docx) yang berisi instruksi desain.</p>
                      <div 
                        className={styles.briefFileDropzone}
                        onClick={() => briefFileInputRef.current?.click()}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.briefUploadIcon}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        <span className={styles.briefUploadText}>
                          {briefFile ? briefFile.name : "Pilih file brief..."}
                        </span>
                      </div>
                      <input 
                        type="file" 
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={handleBriefFileChange}
                        ref={briefFileInputRef}
                        style={{display: 'none'}}
                      />
                    </div>
                  )}

                  {activeTab === 'link' && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                      <p style={{color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem'}}>Masukkan link Google Docs publik (Anyone with the link can view).</p>
                      <input 
                        type="text" 
                        placeholder="https://docs.google.com/document/d/..."
                        value={briefLink}
                        onChange={(e) => setBriefLink(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <button 
                  className="btn-primary" 
                  style={{marginTop: 'auto'}}
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? "Sedang Menganalisis..." : "Mulai Quality Control"}
                  {!isAnalyzing && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>}
                </button>
              </div>
            </div>

            {/* Local History Section */}
            {history.length > 0 && (
              <div className={`${styles.historyPanel} glass-panel animate-fade-in`} style={{ padding: '1.75rem' }}>
                <div className={styles.historyHeader}>
                  <h3 className={styles.historyTitle}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"></path><circle cx="12" cy="12" r="9"></circle></svg>
                    Riwayat Quality Control ({history.length})
                  </h3>
                  <button className={styles.clearHistoryBtn} onClick={handleClearHistory}>
                    Hapus Semua
                  </button>
                </div>
                <div className={styles.historyList}>
                  {history.map((item) => (
                    <div 
                      key={item.id} 
                      className={styles.historyItem}
                      onClick={() => handleLoadHistoryItem(item)}
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="Thumbnail" className={styles.historyItemThumb} />
                      ) : (
                        <div className={styles.historyItemThumb} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', color: 'rgba(0,0,0,0.2)' }}>🖼️</div>
                      )}
                      <div className={styles.historyItemContent}>
                        <h4 className={styles.historyItemTitle} style={{ margin: 0 }}>
                          {item.title}
                        </h4>
                        <div className={styles.historyItemMeta}>
                          <span className={styles.historyItemTime}>{item.timestamp}</span>
                          <span className={item.metrics.totalErrors > 0 ? styles.historyItemBadgeError : styles.historyItemBadgeSuccess}>
                            {item.metrics.totalErrors > 0 ? `⚠️ ${item.metrics.totalErrors} Revisi` : "✅ Siap"}
                          </span>
                        </div>
                      </div>
                      <button 
                        className={styles.historyItemDelete} 
                        onClick={(e) => handleDeleteHistoryItem(e, item.id)}
                        title="Hapus riwayat ini"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {viewState === 'loading' && (
          <div className={`${styles.loadingPanel} animate-fade-in`}>
            <div className={styles.loadingState}>
              <div className={styles.spinner}></div>
              <p className={styles.loadingQuote}>
                "Sesungguhnya Allah sangat mencintai orang yang jika <br />
                melakukan suatu <span className={styles.serifItalic}>pekerjaan</span>, ia melakukannya secara <br />
                <span className={styles.serifItalic}>itqan</span> (profesional, terarah, dan tuntas)." <br />
                <span className={styles.loadingQuoteSource}>(HR. Ath-Thabrani)</span>
              </p>
            </div>
          </div>
        )}

        {viewState === 'result' && results && (
          <div className={`${styles.resultsGrid} animate-fade-in`}>
            {/* Left Column: Image Preview with Absolute Bounding Box Overlays */}
            <div className={`${styles.panel} glass-panel ${styles.stickyImagePanel}`}>
              <h3 className={styles.panelTitle} style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '0.5rem' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                Visual Desain & Temuan
              </h3>
              {imagePreviews && imagePreviews.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div 
                    className={`${styles.imageOverlayContainer} ${editingCoordsIdx !== null ? styles.drawingModeActive : ''}`}
                    onMouseDown={handleImageMouseDown}
                    onMouseMove={handleImageMouseMove}
                    onMouseUp={handleImageMouseUp}
                  >
                    <img 
                      src={imagePreviews[currentSlideIndex]} 
                      alt={`Analisis Gambar Slide ${currentSlideIndex + 1}`} 
                      className={styles.analyzedImage} 
                      draggable={false}
                    />
                    
                    {/* Drawing mode banner indicator */}
                    {editingCoordsIdx !== null && (
                      <div className={styles.drawingBanner}>
                        ✍️ Mode Menggambar: Klik & seret kursor pada gambar untuk menggambar area sorotan #{editingCoordsIdx + 1}
                      </div>
                    )}
                    
                    {/* Bounding box overlays */}
                    {results.ketidaksesuaian?.map((item, idx) => {
                      if (item.slide_index !== currentSlideIndex + 1) return null;
                      if (checkedMismatches[idx] || !item.koordinat) return null;
                      const { x, y, w, h } = item.koordinat;
                      const isHovered = hoveredMismatchIdx === idx;
                      return (
                        <div 
                          key={idx}
                          className={`${styles.boundingBoxOverlay} ${isHovered ? styles.boundingBoxOverlayHovered : ''}`}
                          style={{
                            left: `${x}%`,
                            top: `${y}%`,
                            width: `${w}%`,
                            height: `${h}%`
                          }}
                        >
                          <span className={styles.boundingBoxBadge}>{idx + 1}</span>
                        </div>
                      );
                    })}

                    {/* Temporary Drag Selection Box */}
                    {tempCoords && (
                      <div 
                        className={styles.boundingBoxOverlay}
                        style={{
                          left: `${tempCoords.x}%`,
                          top: `${tempCoords.y}%`,
                          width: `${tempCoords.w}%`,
                          height: `${tempCoords.h}%`,
                          borderStyle: 'dashed',
                          borderColor: '#EF4444',
                          background: 'rgba(239, 68, 68, 0.15)'
                        }}
                      />
                    )}
                  </div>
                  
                  {/* Carousel Controls */}
                  {imagePreviews.length > 1 && (
                    <div className={styles.carouselControls}>
                      <button 
                        className={styles.carouselButton} 
                        onClick={() => setCurrentSlideIndex(prev => Math.max(0, prev - 1))}
                        disabled={currentSlideIndex === 0}
                      >
                        ◀ Prev
                      </button>
                      <span className={styles.carouselIndicatorText}>
                        Slide {currentSlideIndex + 1} dari {imagePreviews.length}
                      </span>
                      <button 
                        className={styles.carouselButton} 
                        onClick={() => setCurrentSlideIndex(prev => Math.min(imagePreviews.length - 1, prev + 1))}
                        disabled={currentSlideIndex === imagePreviews.length - 1}
                      >
                        Next ▶
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
                  🖼️ Pratinjau gambar tidak tersedia (scan dimuat dari riwayat)
                </div>
              )}
            </div>

            {/* Right Column: Checklists & Findings */}
            <div className={`${styles.resultsPanel}`}>
              <div className={styles.resultsHeader}>
                <h2 className={styles.panelTitle} style={{ borderBottom: 'none', paddingBottom: 0 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  Hasil Quality Control
                </h2>
                <div className={styles.actionRow}>
                  <button 
                    className={`${styles.backButton} no-print`} 
                    onClick={() => window.print()}
                    style={{ background: '#FAF9F5', borderColor: 'rgba(0,0,0,0.15)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                    Ekspor PDF / Cetak
                  </button>
                  <button 
                    className={`${styles.backButton} no-print`} 
                    onClick={() => {
                      setResults(null);
                      setImagePreviews([]);
                      setImageFiles([]);
                      setCurrentSlideIndex(0);
                      setErrorMsg("");
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    Revisi Baru
                  </button>
                </div>
              </div>

              {typeof results === 'object' && !results.error && (
                <div className={styles.summaryBar}>
                  <div className={isReadyToPublish ? styles.summaryStatusBadgeSuccess : styles.summaryStatusBadgeError}>
                    {isReadyToPublish ? '✅ Siap Publikasi' : '⚠️ Butuh Revisi'}
                  </div>
                  <div className={styles.summaryMetrics}>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Total Temuan:</span>
                      <span className={styles.metricValue}>{(results.ketidaksesuaian?.length || 0) + (results.sesuai?.length || 0)}</span>
                    </div>
                    <div className={styles.metricDivider}></div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Revisi Terbuka:</span>
                      <span className={styles.metricValue} style={{ color: openRevisionsCount > 0 ? '#b91c1c' : 'inherit' }}>
                        {openRevisionsCount}
                      </span>
                    </div>
                    <div className={styles.metricDivider}></div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Sesuai Brief:</span>
                      <span className={styles.metricValue} style={{ color: '#0d5c56' }}>{results.sesuai?.length || 0}</span>
                    </div>
                  </div>
                </div>
              )}

              {hasMismatchesInitially && isReadyToPublish && (
                <div className={`${styles.celebrationCard} animate-fade-in`}>
                  <div className={styles.celebrationIcon}>🎉</div>
                  <div className={styles.celebrationContent}>
                    <h4 className={styles.celebrationTitle}>Luar Biasa! Semua Revisi Selesai Diperiksa</h4>
                    <p className={styles.celebrationText}>
                      Seluruh catatan perbaikan telah Anda beri tanda selesai. Poster desain kini <strong>sudah siap publish!</strong>
                    </p>
                  </div>
                </div>
              )}

              {typeof results === 'object' && !results.error ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  {/* 1. KETIDAKSESUAIAN / TYPO */}
                  <div className={styles.qcSection}>
                    <h3 className={styles.qcSectionTitleError}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                      Ketidaksesuaian & Typo ({results.ketidaksesuaian?.length || 0})
                    </h3>
                    
                    {results.ketidaksesuaian && results.ketidaksesuaian.length > 0 ? (
                      <div className={styles.mismatchList}>
                        {results.ketidaksesuaian.map((item, idx) => {
                          const isChecked = !!checkedMismatches[idx];
                          const isCopied = copiedIdx === idx;
                          return (
                            <div 
                              key={idx} 
                              className={`${styles.mismatchItem} ${isChecked ? styles.mismatchItemChecked : ''}`}
                              onMouseEnter={() => {
                                setHoveredMismatchIdx(idx);
                                if (item.slide_index) {
                                  setCurrentSlideIndex(item.slide_index - 1);
                                }
                              }}
                              onMouseLeave={() => setHoveredMismatchIdx(null)}
                            >
                              {/* 1. Unified Card Header */}
                              <div className={styles.mismatchHeader}>
                                <div className={styles.mismatchHeaderLeft}>
                                  <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    className={styles.mismatchCheckbox}
                                    onChange={() => setCheckedMismatches(prev => ({
                                      ...prev,
                                      [idx]: !prev[idx]
                                    }))}
                                  />
                                  <span className={styles.mismatchIndexBadge}>{idx + 1}</span>
                                  {item.slide_index && (
                                    <span className={styles.slideBadge}>
                                      Slide {item.slide_index}
                                    </span>
                                  )}
                                  <span className={styles.elementBadge}>
                                    {item.elemen || "Temuan"}
                                  </span>
                                </div>
                                
                                <div className={styles.mismatchHeaderActions}>
                                  {/* Manual Refine Area Box Button */}
                                  <button 
                                    className={`${styles.adjustAreaBtn} ${editingCoordsIdx === idx ? styles.adjustAreaBtnActive : ''} no-print`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingCoordsIdx(editingCoordsIdx === idx ? null : idx);
                                      if (item.slide_index) {
                                        setCurrentSlideIndex(item.slide_index - 1);
                                      }
                                    }}
                                    title="Gambarkan kotak sorotan manual pada poster"
                                  >
                                    {editingCoordsIdx === idx ? "✕ Batal" : "📍 Sorot Manual"}
                                  </button>

                                  {/* Copy text button */}
                                  <button 
                                    className={`${styles.copyBriefBtn} ${isCopied ? styles.copyBriefBtnCopied : ''} no-print`} 
                                    onClick={() => handleCopyText(item.di_brief, idx)}
                                    title="Salin teks perbaikan"
                                  >
                                    {isCopied ? (
                                      <>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginRight: '2px' }}><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        Tersalin
                                      </>
                                    ) : (
                                      <>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '2px' }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                        Salin
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* 2. Inner Comparison Row (equal heights) */}
                              <div className={styles.mismatchCompareRow}>
                                <div className={styles.mismatchBriefBox}>
                                  <div className={styles.compareBoxHeader}>
                                    <span className={styles.compareLabelMini}>
                                      {results?.hasBrief !== false ? "Brief" : "Baku"}
                                    </span>
                                  </div>
                                  <div className={styles.compareText}>
                                    {renderFormattedText(item.di_brief, 'brief')}
                                  </div>
                                </div>
                                <div className={styles.mismatchArrow}>➔</div>
                                <div className={styles.mismatchDesainBox}>
                                  <div className={styles.compareBoxHeader}>
                                    <span className={styles.compareLabelMini}>Desain</span>
                                  </div>
                                  <div className={styles.compareText}>
                                    {renderFormattedText(item.di_gambar, 'desain')}
                                  </div>
                                </div>
                              </div>

                              {/* 3. Card Footer for Location & Notes */}
                              <div className={styles.mismatchFooter}>
                                {item.lokasi_deskriptif && (
                                  <div className={styles.locationHelper}>
                                    📍 <strong>Letak:</strong> {item.lokasi_deskriptif}
                                  </div>
                                )}
                                {item.catatan && (
                                  <div className={styles.notesHelper}>
                                    📝 <strong>Catatan:</strong> {item.catatan}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={styles.emptyMismatch}>
                        🎉 Tidak ditemukan ketidaksesuaian atau typo. Semua sudah sesuai brief!
                      </div>
                    )}
                  </div>

                  {/* 2. ANALISIS AKSESIBILITAS KONTRASE / KETERBACAAN */}
                  <div className={styles.accessibilitySection}>
                    <h3 className={styles.qcSectionTitleWarning}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                      Analisis Keterbacaan & Aksesibilitas
                    </h3>

                    {results.aksesibilitas && results.aksesibilitas.length > 0 ? (
                      <div className={styles.accessibilityList}>
                        {results.aksesibilitas.map((item, idx) => (
                          <div key={idx} className={styles.accessibilityCard}>
                            <div className={styles.accessibilityHeaderRow}>
                              <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                              <span>{item.elemen}</span>
                            </div>
                            <p className={styles.accessibilityDesc}>
                              {item.temuan}
                            </p>
                            {item.saran && (
                              <div className={styles.accessibilitySaran}>
                                💡 Saran: {item.saran}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyAccessibility} style={{ marginTop: '1rem' }}>
                        <span>🛡️</span> Aksesibilitas Kontras & Keterbacaan: Baik. Semua teks poster memiliki keterbacaan yang tinggi!
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                // Fallback raw view
                <div className={styles.resultSection}>
                  <div className={styles.errorBox}>
                    <strong>Perhatian:</strong> Gagal menampilkan format visual terstruktur. Menampilkan data mentah:
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.03)', padding: '1rem', borderRadius: '8px', fontFamily: 'monospace' }}>
                    {results.raw || JSON.stringify(results, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

import mammoth from 'mammoth';

export const maxDuration = 60; // Meningkatkan timeout Vercel Serverless menjadi 60 detik (bawaan Hobby tier adalah 10 detik)

export async function POST(request) {
  try {
    const formData = await request.formData();
    let apiKey = formData.get('apiKey')?.trim();
    if (!apiKey) {
      apiKey = process.env.GEMINI_API_KEY;
    }
    console.log("DEBUG BACKEND - process.env.GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
    if (process.env.GEMINI_API_KEY) {
      console.log("DEBUG BACKEND - process.env.GEMINI_API_KEY length:", process.env.GEMINI_API_KEY.length);
      console.log("DEBUG BACKEND - process.env.GEMINI_API_KEY prefix:", process.env.GEMINI_API_KEY.substring(0, 8));
    }
    const imageFile = formData.get('image');
    const briefType = formData.get('briefType');
    const posterType = formData.get('posterType') || 'umum';

    if (!apiKey) {
      return Response.json({ error: 'API Key wajib diisi (masukkan di UI atau konfigurasikan di server).' }, { status: 400 });
    }
    if (!imageFile) {
      return Response.json({ error: 'Gambar desain wajib diunggah.' }, { status: 400 });
    }

    const imageBuffer = await imageFile.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');
    const imageMimeType = imageFile.type;

    let briefContent = '';
    const parts = [];

    let systemInstruction = `Kamu adalah "Strict Quality Control Inspector" profesional. 
Tugas kamu adalah membandingkan output gambar desain terhadap spesifikasi di dalam "BRIEF DESAIN" yang diberikan.
Fokus secara eksklusif pada kesesuaian isi antara brief dan output desain gambar.
Aturan:
1. Periksa Typo (salah ketik) pada teks yang ada di gambar dengan mencocokkannya dengan teks di brief.
2. Periksa kesesuaian informasi (misal: tanggal, harga, nama acara).
3. Jika ada elemen yang diwajibkan di brief TAPI hilang di gambar, masukkan ke list ketidaksesuaian.
4. Jangan memberikan komentar di luar konteks kecocokan (seperti opini warna kurang bagus dsb).
5. PENTING: Di dalam nilai "di_brief" dan "di_gambar", tandai kata/karakter/angka yang berbeda atau salah ketik dengan membungkusnya menggunakan bintang ganda (**), misalnya: "di_brief": "Buka Puasa Tasu'a **dan** Asyura" dan "di_gambar": "Buka Puasa Tasu'a **&** Asyura". Ini wajib dilakukan agar sistem diff highlighter dapat berfungsi.
6. PENTING - DETEKSI TYPO UMUM: Kamu juga harus mendeteksi kesalahan ejaan atau typo umum (seperti singkatan tidak baku: "jngan", "dgn", "yg", "saja" tertulis "sja", atau salah ketik huruf biasa) SEKALI PUN typo tersebut berasal dari teks di brief yang kemudian disalin sama persis ke gambar desain. 
   - Jika terdapat typo umum yang tertulis di brief dan diikuti oleh desain, kamu WAJIB memasukkannya ke dalam daftar "ketidaksesuaian".
   - Tulis versi ejaan yang benar di kolom "di_brief" (serta sebutkan ejaan aslinya dari brief) dan versi ejaan yang salah di kolom "di_gambar", lalu beri tanda penyorot (**) pada perbedaannya.
7. PENTING - KOORDINAT TYPO: Untuk setiap item di dalam daftar "ketidaksesuaian", kamu wajib menyertakan koordinat letak visual teks yang bermasalah di dalam gambar poster desain dalam bentuk objek "koordinat" dengan format percentage (0-100) relatif terhadap dimensi gambar:
   - "koordinat": { "x": <persentase_jarak_dari_kiri>, "y": <persentase_jarak_dari_atas>, "w": <persentase_lebar_kotak>, "h": <persentase_tinggi_kotak> }
   - Angka berupa float/decimal antara 0.0 sampai 100.0. Buat seakurat mungkin agar kita bisa menggambar kotak penyorot tepat di atas tulisan typo tersebut.
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
      "koordinat": {
        "x": 10.5,
        "y": 25.0,
        "w": 35.5,
        "h": 5.0
      }
    }
  ],
  "aksesibilitas": [
    {
      "elemen": "Nama elemen visual (misal: Teks Tanggal, Background Poster)",
      "temuan": "Penjelasan masalah kontras warna atau keterbacaan teks",
      "saran": "Rekomendasi perbaikan warna/desain agar kontras lebih baik"
    }
  ]
} `;

    if (posterType === 'kajian_rutin') {
      systemInstruction += `\n\n10. PENTING - VALIDASI JADWAL USTADZ KAJIAN RUTIN MPD (MASJID POGUNG DALANGAN):
Kamu wajib memvalidasi kecocokan nama Ustadz/Ustadzah, hari/waktu kajian, dan tema berdasarkan basis data internal jadwal kajian rutin Masjid Pogung Dalangan di bawah ini. Jika ada informasi di dalam gambar desain atau brief yang bertentangan atau tidak cocok dengan basis data ini, laporkan sebagai ketidaksesuaian:

=== BASIS DATA JADWAL KAJIAN RUTIN MPD ===
- Senin Pagi (09.00 - 11.00 WIB)
  * Tema/Materi: Tematik Setiap Pekan
  * Ustaz: Ustadz Pemateri PMJ
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
  * Ustadzah: Ustadzah Maryam Ummu Saffanah, M.HI.
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
    - Ustaz: Ustadz Pemateri YPIA

ATURAN VALIDASI TAMBAHAN JADWAL KAJIAN RUTIN:
1. Jika poster dideteksi/dikategorikan sebagai Poster Kajian Rutin, pastikan nama Ustaz/Ustadzah yang tertera di poster COCOK dengan hari dan waktu pelaksanaan kajian tersebut berdasarkan basis data di atas.
2. Jika tidak cocok (misal: kajian diadakan Senin Sore, tapi pematerinya tertulis Ustadz Ammi Nur Baits, yang seharusnya adalah Ustadz Afifi Abdul Wadud), laporkan temuan ini ke daftar "ketidaksesuaian" sebagai kesalahan jadwal pemateri.
3. Khusus Kajian Ahad Malam, periksa pekan ke berapa tanggal masehi acara tersebut jatuh di bulan bersangkutan (pekan 2 & 3 atau pekan 4) untuk menentukan kecocokan pematerinya. Jika penulisan pekan atau nama pematerinya tidak sinkron, laporkan ke daftar "ketidaksesuaian".`;
    }

    parts.push({ text: systemInstruction });

    let hasBrief = false;
    if (briefType === 'text') {
      const textVal = formData.get('briefText')?.trim();
      if (textVal) {
        briefContent = textVal;
        hasBrief = true;
        parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
      }
    } 
    else if (briefType === 'link') {
      const link = formData.get('briefLink')?.trim();
      if (link) {
        const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
          const docId = match[1];
          const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
          const res = await fetch(exportUrl);
          if (!res.ok) {
            throw new Error('Gagal mengakses link Google Docs. Pastikan link diset "Anyone with the link can view".');
          }
          briefContent = await res.text();
          hasBrief = true;
          parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
        } else {
          throw new Error('Link Google Docs tidak valid. Harap sertakan URL dokumen yang benar.');
        }
      }
    } 
    else if (briefType === 'file') {
      const file = formData.get('briefFile');
      if (file && file.size > 0) {
        const fileBuffer = await file.arrayBuffer();
        
        if (file.name.toLowerCase().endsWith('.pdf')) {
          if (typeof global.DOMMatrix === 'undefined') {
            global.DOMMatrix = class DOMMatrix {};
          }
          const { PDFParse } = await import('pdf-parse');
          const parser = new PDFParse({ data: Buffer.from(fileBuffer) });
          const pdfData = await parser.getText();
          briefContent = pdfData.text;
          hasBrief = true;
          parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
        } else if (file.name.toLowerCase().endsWith('.docx')) {
          const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBuffer) });
          briefContent = result.value;
          hasBrief = true;
          parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
        } else {
          throw new Error('Format file tidak didukung. Harap unggah .pdf atau .docx');
        }
      }
    }

    if (!hasBrief) {
      parts.push({ text: `\n\n=== INFO ===\nTidak ada berkas/teks brief referensi yang dilampirkan. Kamu wajib memverifikasi keselarasan logika internal poster gambar desain tersebut (seperti kecocokan hari dengan tanggalnya, sinkronisasi judul hari kajian dengan tanggal) serta memvalidasi nama Ustaz/Ustadzah dan waktu kajian terhadap basis data Jadwal Kajian Rutin MPD di atas (jika kategori Kajian Rutin aktif).\n\nPeriksa gambar desain berikut:` });
    }

    // Add Image to parts (for REST API it uses inline_data)
    parts.push({
      inline_data: {
        mime_type: imageMimeType,
        data: imageBase64
      }
    });

    const requestBody = {
      contents: [{ parts: parts }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    let apiRes;
    let apiData;
    let attempts = 0;
    const maxAttempts = 3;
    const models = ["gemini-2.5-flash", "gemini-1.5-flash"];

    while (attempts < maxAttempts) {
      const currentModel = models[attempts % models.length];
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      
      console.log(`Calling Gemini API (Attempt ${attempts + 1}/${maxAttempts}) using model: ${currentModel}...`);
      
      try {
        apiRes = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        apiData = await apiRes.json();

        if (apiRes.ok) {
          break; // Success!
        }

        console.warn(`Attempt ${attempts + 1} failed:`, apiData?.error?.message || apiRes.statusText);

        const errorMessage = apiData?.error?.message || "";
        const isTemporaryError = 
          apiRes.status === 429 || 
          apiRes.status === 503 || 
          apiRes.status === 500 || 
          errorMessage.toLowerCase().includes("high demand") || 
          errorMessage.toLowerCase().includes("quota") ||
          errorMessage.toLowerCase().includes("limit");

        if (!isTemporaryError) {
          // If it's a structural error (invalid api key, bad request structure), throw immediately
          throw new Error(errorMessage || 'Gagal memanggil API Gemini.');
        }

      } catch (err) {
        console.error(`Error on attempt ${attempts + 1}:`, err.message);
        if (attempts === maxAttempts - 1) {
          throw err;
        }
      }

      attempts++;
      if (attempts < maxAttempts) {
        const delay = 1500 * attempts; // 1.5s, 3s backoff
        console.log(`Waiting ${delay}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (!apiRes || !apiRes.ok) {
      console.error("Gemini API Final Error:", apiData);
      throw new Error(apiData?.error?.message || 'Gagal memanggil API Gemini setelah beberapa percobaan.');
    }

    const resultText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    let parsedResult;
    try {
      parsedResult = JSON.parse(resultText);
    } catch (e) {
      console.error("Failed to parse Gemini JSON output:", resultText);
      parsedResult = {
        error: "Gagal memproses format data hasil analisis.",
        raw: resultText
      };
    }

    return Response.json({ result: parsedResult });

  } catch (error) {
    console.error("Analysis Error:", error);
    return Response.json({ error: error.message || 'Terjadi kesalahan internal server.' }, { status: 500 });
  }
}

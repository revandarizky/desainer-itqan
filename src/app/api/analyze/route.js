import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const apiKey = formData.get('apiKey')?.trim();
    const imageFile = formData.get('image');
    const briefType = formData.get('briefType');

    if (!apiKey || !imageFile) {
      return Response.json({ error: 'API Key dan Gambar wajib diisi.' }, { status: 400 });
    }

    const imageBuffer = await imageFile.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');
    const imageMimeType = imageFile.type;

    let briefContent = '';
    const parts = [];

    const systemInstruction = `Kamu adalah "Strict Quality Control Inspector" profesional. 
Tugas kamu adalah membandingkan output gambar desain terhadap spesifikasi di dalam "BRIEF DESAIN" yang diberikan.
Fokus secara eksklusif pada kesesuaian isi antara brief dan output desain gambar.
Aturan:
1. Periksa Typo (salah ketik) pada teks yang ada di gambar dengan mencocokkannya dengan teks di brief.
2. Periksa kesesuaian informasi (misal: tanggal, harga, nama acara).
3. Jika ada elemen yang diwajibkan di brief TAPI hilang di gambar, masukkan ke list ketidaksesuaian.
4. Jangan memberikan komentar di luar konteks kecocokan (seperti opini warna kurang bagus dsb).
5. PENTING: Di dalam nilai "di_brief" dan "di_gambar", tandai kata/karakter/angka yang berbeda atau salah ketik dengan membungkusnya menggunakan bintang ganda (**), misalnya: "di_brief": "Buka Puasa Tasu'a **dan** Asyura" dan "di_gambar": "Buka Puasa Tasu'a **&** Asyura". Ini wajib dilakukan agar sistem diff highlighter dapat berfungsi.

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
      "catatan": "Penjelasan mengapa ini tidak sesuai atau letak salah ketiknya"
    }
  ]
}`;

    parts.push({ text: systemInstruction });

    if (briefType === 'text') {
      briefContent = formData.get('briefText');
      parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
    } 
    else if (briefType === 'link') {
      const link = formData.get('briefLink');
      const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const docId = match[1];
        const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
        const res = await fetch(exportUrl);
        if (!res.ok) {
          throw new Error('Gagal mengakses link Google Docs. Pastikan link diset "Anyone with the link can view".');
        }
        briefContent = await res.text();
        parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
      } else {
        throw new Error('Link Google Docs tidak valid. Harap sertakan URL dokumen yang benar.');
      }
    } 
    else if (briefType === 'file') {
      const file = formData.get('briefFile');
      if (!file) throw new Error('File brief tidak ditemukan.');
      const fileBuffer = await file.arrayBuffer();
      
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const parser = new PDFParse({ data: Buffer.from(fileBuffer) });
        const pdfData = await parser.getText();
        briefContent = pdfData.text;
        parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
      } else if (file.name.toLowerCase().endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBuffer) });
        briefContent = result.value;
        parts.push({ text: `\n\n=== BRIEF DESAIN ===\n${briefContent}\n\nPeriksa gambar desain berikut:` });
      } else {
        throw new Error('Format file tidak didukung. Harap unggah .pdf atau .docx');
      }
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const apiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      console.error("Gemini API Error:", apiData);
      throw new Error(apiData.error?.message || 'Gagal memanggil API Gemini.');
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

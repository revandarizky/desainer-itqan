import mammoth from 'mammoth';

export const maxDuration = 10;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const briefType = formData.get('briefType');
    let briefContent = '';

    if (briefType === 'text') {
      briefContent = formData.get('briefText')?.trim() || '';
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
        } else if (file.name.toLowerCase().endsWith('.docx')) {
          const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBuffer) });
          briefContent = result.value;
        } else {
          throw new Error('Format file tidak didukung. Harap unggah .pdf atau .docx');
        }
      }
    }

    return Response.json({ text: briefContent });
  } catch (error) {
    console.error("Brief Parsing Error:", error);
    return Response.json({ error: error.message || 'Gagal memproses file brief.' }, { status: 500 });
  }
}

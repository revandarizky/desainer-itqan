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

export default function Home() {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  
  const [activeTab, setActiveTab] = useState("text"); // text, link, file
  const [briefText, setBriefText] = useState("");
  const [briefLink, setBriefLink] = useState("");
  const [briefFile, setBriefFile] = useState(null);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [checkedMismatches, setCheckedMismatches] = useState({});

  // Premium Features States
  const [hoveredMismatchIdx, setHoveredMismatchIdx] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [history, setHistory] = useState([]);

  const fileInputRef = useRef(null);
  const briefFileInputRef = useRef(null);

  // Load history on mount
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem("qc_history");
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (e) {
      console.error("Failed to load local storage history:", e);
    }
  }, []);

  useEffect(() => {
    const handlePaste = (e) => {
      const item = e.clipboardData?.items[0];
      if (item && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
        setResults(null);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const handleImageDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0] || e.target.files[0];
    if (file && file.type.startsWith("image/")) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setResults(null);
    }
  };

  const handleBriefFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setBriefFile(file);
    }
  };

  const handleAnalyze = async () => {
    if (!imageFile) {
      setErrorMsg("Harap unggah gambar desain terlebih dahulu.");
      return;
    }

    // Validation based on active tab
    if (activeTab === "text" && !briefText.trim()) {
      setErrorMsg("Harap masukkan teks brief.");
      return;
    }
    if (activeTab === "link" && !briefLink.trim()) {
      setErrorMsg("Harap masukkan link Google Docs.");
      return;
    }
    if (activeTab === "file" && !briefFile) {
      setErrorMsg("Harap unggah file brief (PDF/Word).");
      return;
    }

    setErrorMsg("");
    setIsAnalyzing(true);
    setResults(null);
    setCheckedMismatches({});

    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("briefType", activeTab);

      if (activeTab === "text") {
        formData.append("briefText", briefText);
      } else if (activeTab === "link") {
        formData.append("briefLink", briefLink);
      } else if (activeTab === "file") {
        formData.append("briefFile", briefFile);
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Gagal menganalisis gambar.");
      }

      setResults(data.result);

      // Save to local history list
      try {
        const compressedThumb = await compressImageForHistory(imageFile);
        
        const briefTitle = activeTab === "text" 
          ? (briefText.trim().substring(0, 30) || "Brief Teks") 
          : activeTab === "file" 
            ? (briefFile?.name || "Brief File") 
            : (briefLink.substring(0, 30) || "Google Docs Link");

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
          results: data.result,
          thumbnail: compressedThumb,
          metrics: {
            totalErrors: data.result?.ketidaksesuaian?.length || 0,
            totalSuccess: data.result?.sesuai?.length || 0
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
    setImagePreview(item.thumbnail); // Load compressed thumbnail image
    setImageFile(null); // Clear file upload so it uses the cached thumbnail
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

  const viewState = isAnalyzing ? 'loading' : results ? 'result' : 'input';

  return (
    <main className={styles.main}>
      <header className={`${styles.header} animate-fade-in`}>
        <h1 className={styles.title}>
          Desainer <span className={styles.serifItalic}>Itqan</span>
        </h1>
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
              {!imagePreview ? (
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
                    style={{display: 'none'}} 
                  />
                </div>
              ) : (
                <div className={`${styles.panel} glass-panel`} style={{ padding: '1.5rem' }}>
                  <div className={styles.imagePreview}>
                    <button className={styles.removeImage} onClick={() => {setImagePreview(null); setImageFile(null);}}>✕</button>
                    <img src={imagePreview} alt="Preview" />
                  </div>
                </div>
              )}

              {/* Right Column: Brief Input */}
              <div className={`${styles.panel} ${styles.briefPanel} glass-panel`}>
                <h2 className={styles.panelTitle}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Brief Referensi
                </h2>

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
              {imagePreview ? (
                <div className={styles.imageOverlayContainer}>
                  <img src={imagePreview} alt="Analisis Gambar" className={styles.analyzedImage} />
                  
                  {/* Bounding box overlays */}
                  {results.ketidaksesuaian?.map((item, idx) => {
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
                      setImagePreview(null);
                      setImageFile(null);
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
                  <div className={results.ketidaksesuaian?.length > 0 ? styles.summaryStatusBadgeError : styles.summaryStatusBadgeSuccess}>
                    {results.ketidaksesuaian?.length > 0 ? '⚠️ Butuh Revisi' : '✅ Siap Publikasi'}
                  </div>
                  <div className={styles.summaryMetrics}>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Total Temuan:</span>
                      <span className={styles.metricValue}>{(results.ketidaksesuaian?.length || 0) + (results.sesuai?.length || 0)}</span>
                    </div>
                    <div className={styles.metricDivider}></div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Revisi Terbuka:</span>
                      <span className={styles.metricValue} style={{ color: results.ketidaksesuaian?.length > 0 ? '#b91c1c' : 'inherit' }}>
                        {results.ketidaksesuaian?.length ? results.ketidaksesuaian.length - Object.keys(checkedMismatches).filter(k => checkedMismatches[k]).length : 0}
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
                              onMouseEnter={() => setHoveredMismatchIdx(idx)}
                              onMouseLeave={() => setHoveredMismatchIdx(null)}
                            >
                              <input 
                                type="checkbox" 
                                checked={isChecked}
                                className={styles.mismatchCheckbox}
                                onChange={() => setCheckedMismatches(prev => ({
                                  ...prev,
                                  [idx]: !prev[idx]
                                }))}
                              />
                              <div className={styles.mismatchCompareRow}>
                                <div className={styles.mismatchBriefBox}>
                                  <span className={styles.mismatchIndexBadge}>{idx + 1}</span>
                                  <span className={styles.compareLabelMini}>Brief</span>
                                  <span className={styles.compareText}>
                                    {renderFormattedText(item.di_brief, 'brief')}
                                  </span>
                                  
                                  {/* Copy text button */}
                                  <button 
                                    className={`${styles.copyBriefBtn} ${isCopied ? styles.copyBriefBtnCopied : ''} no-print`} 
                                    onClick={() => handleCopyText(item.di_brief, idx)}
                                    title="Salin teks perbaikan"
                                  >
                                    {isCopied ? (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    ) : (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    )}
                                  </button>
                                </div>
                                <div className={styles.mismatchArrow}>➔</div>
                                <div className={styles.mismatchDesainBox}>
                                  <span className={styles.compareLabelMini}>Desain</span>
                                  <span className={styles.compareText}>
                                    {renderFormattedText(item.di_gambar, 'desain')}
                                  </span>
                                </div>
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

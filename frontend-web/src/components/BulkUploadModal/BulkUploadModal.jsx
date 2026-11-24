import React, { useState, useRef, useCallback } from 'react';
import {
  downloadTaskTemplate,
  previewBulkUpload,
  importBulkUpload,
} from '../../services/api';
import Can from '../Can';
import './BulkUploadModal.css';

const STEP_UPLOAD = 1;
const STEP_PREVIEW = 2;
const STEP_RESULT = 3;

function BulkUploadModal({ onClose, onImportComplete }) {
  const [currentStep, setCurrentStep] = useState(STEP_UPLOAD);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  // ── Step 1: File Handling ──────────────────────────────────

  const validateFile = (file) => {
    if (!file) return 'File tidak ditemukan.';
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      return 'Hanya file Excel (.xlsx, .xls) yang diizinkan.';
    }
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return 'Ukuran file maksimal 5MB.';
    }
    return null;
  };

  const handleFileSelect = (file) => {
    const error = validateFile(file);
    if (error) {
      showToast(error, 'error');
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadTaskTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'task_template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast('Template berhasil diunduh!', 'success');
    } catch (error) {
      console.error('Error downloading template:', error);
      showToast('Gagal mengunduh template.', 'error');
    }
  };

  const handleUploadAndContinue = async () => {
    if (!selectedFile) {
      showToast('Silakan pilih file terlebih dahulu.', 'warning');
      return;
    }

    setUploading(true);
    try {
      const result = await previewBulkUpload(selectedFile);
      setPreviewData(result);
      setCurrentStep(STEP_PREVIEW);
    } catch (error) {
      console.error('Preview error:', error);
      const msg = error.response?.data?.message || 'Gagal memproses file.';
      showToast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── Step 2: Preview ────────────────────────────────────────

  const handleImport = async () => {
    if (!selectedFile) return;

    setImporting(true);
    try {
      const result = await importBulkUpload(selectedFile);
      setImportResult(result);
      setCurrentStep(STEP_RESULT);
    } catch (error) {
      console.error('Import error:', error);
      const msg = error.response?.data?.message || 'Gagal mengimport data.';
      showToast(msg, 'error');
    } finally {
      setImporting(false);
    }
  };

  // ── Step 3: Result ─────────────────────────────────────────

  const handleDownloadErrorLog = () => {
    if (!importResult?.errors?.length) return;

    const header = 'Row,Title,Error\n';
    const rows = importResult.errors
      .map((e) => `${e.row},"${e.title}","${e.error}"`)
      .join('\n');
    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'error_log_bulk_upload.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleFinish = () => {
    if (onImportComplete) onImportComplete();
    onClose();
  };

  // ── Toast ──────────────────────────────────────────────────

  const [toast, setToast] = useState({ show: false, message: '', type: '' });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: '' });
    }, 3000);
  };

  // ── Render Helpers ─────────────────────────────────────────

  const renderStepIndicator = () => (
    <div className="bulk-step-indicator">
      <div className={`bulk-step ${currentStep >= STEP_UPLOAD ? 'active' : ''} ${currentStep > STEP_UPLOAD ? 'completed' : ''}`}>
        <div className="bulk-step-circle">
          {currentStep > STEP_UPLOAD ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <span>1</span>
          )}
        </div>
        <span className="bulk-step-label">Upload File</span>
      </div>
      <div className={`bulk-step-connector ${currentStep > STEP_UPLOAD ? 'completed' : ''}`} />
      <div className={`bulk-step ${currentStep >= STEP_PREVIEW ? 'active' : ''} ${currentStep > STEP_PREVIEW ? 'completed' : ''}`}>
        <div className="bulk-step-circle">
          {currentStep > STEP_PREVIEW ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <span>2</span>
          )}
        </div>
        <span className="bulk-step-label">Validation & Preview</span>
      </div>
      <div className={`bulk-step-connector ${currentStep > STEP_PREVIEW ? 'completed' : ''}`} />
      <div className={`bulk-step ${currentStep >= STEP_RESULT ? 'active' : ''}`}>
        <div className="bulk-step-circle">
          <span>3</span>
        </div>
        <span className="bulk-step-label">Import Result</span>
      </div>
    </div>
  );

  const renderUploadStep = () => (
    <div className="bulk-upload-step">
      <div
        className={`bulk-dropzone ${dragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleBrowseClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />
        <div className="bulk-dropzone-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <p className="bulk-dropzone-text">
          {selectedFile ? (
            <>
              <strong>{selectedFile.name}</strong>
              <span className="bulk-file-size"> ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
            </>
          ) : (
            <>
              Seret file ke sini atau <span className="bulk-browse-link">klik untuk browse</span>
            </>
          )}
        </p>
        <p className="bulk-dropzone-hint">Format: .xlsx, .xls (Maks. 5MB)</p>
      </div>

      {selectedFile && (
        <div className="bulk-selected-file">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="bulk-file-name">{selectedFile.name}</span>
          <button
            className="bulk-file-remove"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedFile(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            title="Hapus file"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Download template needs tasks.export (upload itself needs tasks.import) */}
      <Can perm="tasks.export">
        <div className="bulk-template-section">
          <p className="bulk-template-text">Belum punya template? Download template Excel terlebih dahulu.</p>
          <button className="bulk-btn-template" onClick={handleDownloadTemplate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download Template
          </button>
        </div>
      </Can>

      <div className="bulk-modal-actions">
        <button className="bulk-btn-cancel" onClick={onClose}>Batal</button>
        <button
          className="bulk-btn-primary"
          onClick={handleUploadAndContinue}
          disabled={!selectedFile || uploading}
        >
          {uploading ? (
            <>
              <span className="bulk-spinner" />
              Memproses...
            </>
          ) : (
            'Upload & Lanjutkan'
          )}
        </button>
      </div>
    </div>
  );

  const renderPreviewStep = () => {
    if (!previewData) return null;

    const { total, valid, errors, validRows } = previewData;
    const errorCount = errors.length;
    const hasErrors = errorCount > 0;

    return (
      <div className="bulk-preview-step">
        {/* Summary Cards */}
        <div className="bulk-preview-summary">
          <div className="bulk-summary-card">
            <span className="bulk-summary-value">{total}</span>
            <span className="bulk-summary-label">Total Data</span>
          </div>
          <div className="bulk-summary-card valid">
            <span className="bulk-summary-value">{valid}</span>
            <span className="bulk-summary-label">Valid</span>
          </div>
          <div className="bulk-summary-card error">
            <span className="bulk-summary-value">{errorCount}</span>
            <span className="bulk-summary-label">Error</span>
          </div>
        </div>

        {/* Error Table */}
        {hasErrors && (
          <div className="bulk-error-section">
            <h4 className="bulk-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              Daftar Error ({errorCount})
            </h4>
            <div className="bulk-error-table-wrap">
              <table className="bulk-error-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Column</th>
                    <th>Value</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((err, idx) => (
                    <tr key={idx}>
                      <td>{err.row}</td>
                      <td>{err.column}</td>
                      <td className="bulk-error-value" title={err.value}>{err.value}</td>
                      <td className="bulk-error-msg">{err.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Preview Table */}
        {validRows.length > 0 && (
          <div className="bulk-preview-section">
            <h4 className="bulk-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Preview Data ({validRows.length} baris)
            </h4>
            <div className="bulk-preview-table-wrap">
              <table className="bulk-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Description</th>
                    <th>Location</th>
                    <th>Latitude</th>
                    <th>Longitude</th>
                    <th>Start Time</th>
                    <th>End Time</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.rowNumber}</td>
                      <td>{row.data.title}</td>
                      <td className="bulk-cell-ellipsis" title={row.data.description}>{row.data.description || '-'}</td>
                      <td className="bulk-cell-ellipsis" title={row.data.location}>{row.data.location}</td>
                      <td>{row.data.latitude ?? '-'}</td>
                      <td>{row.data.longitude ?? '-'}</td>
                      <td>{row.data.startTime}</td>
                      <td>{row.data.endTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bulk-modal-actions">
          <button className="bulk-btn-cancel" onClick={() => setCurrentStep(STEP_UPLOAD)}>Kembali</button>
          <button
            className="bulk-btn-primary"
            onClick={handleImport}
            disabled={hasErrors || importing}
          >
            {importing ? (
              <>
                <span className="bulk-spinner" />
                Mengimport...
              </>
            ) : (
              'Lanjutkan ke Import'
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderResultStep = () => {
    if (!importResult) return null;

    const { total, success, failed, skipped, errors } = importResult;

    return (
      <div className="bulk-result-step">
        <div className="bulk-result-icon">
          {failed > 0 ? (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          )}
        </div>

        <h3 className="bulk-result-title">Import Selesai</h3>

        <div className="bulk-result-summary">
          <div className="bulk-result-card">
            <span className="bulk-result-value">{total}</span>
            <span className="bulk-result-label">Total Data</span>
          </div>
          <div className="bulk-result-card success">
            <span className="bulk-result-value">{success}</span>
            <span className="bulk-result-label">Berhasil</span>
          </div>
          <div className="bulk-result-card failed">
            <span className="bulk-result-value">{failed}</span>
            <span className="bulk-result-label">Gagal</span>
          </div>
          <div className="bulk-result-card skipped">
            <span className="bulk-result-value">{skipped}</span>
            <span className="bulk-result-label">Dilewati</span>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="bulk-result-errors">
            <h4 className="bulk-section-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              Detail Error ({errors.length})
            </h4>
            <div className="bulk-error-table-wrap">
              <table className="bulk-error-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Title</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((err, idx) => (
                    <tr key={idx}>
                      <td>{err.row}</td>
                      <td>{err.title}</td>
                      <td className="bulk-error-msg">{err.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bulk-modal-actions">
          {errors.length > 0 && (
            <button className="bulk-btn-secondary" onClick={handleDownloadErrorLog}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Error Log
            </button>
          )}
          <button className="bulk-btn-primary" onClick={handleFinish}>
            Selesai
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="bulk-modal-overlay" onClick={onClose}>
      <div className="bulk-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="bulk-modal-header">
          <h2>Bulk Upload Task</h2>
          <button className="bulk-modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {renderStepIndicator()}

        <div className="bulk-modal-body">
          {currentStep === STEP_UPLOAD && renderUploadStep()}
          {currentStep === STEP_PREVIEW && renderPreviewStep()}
          {currentStep === STEP_RESULT && renderResultStep()}
        </div>
      </div>

      {/* Toast */}
      {toast.show && (
        <div className={`bulk-toast bulk-toast-${toast.type}`}>
          {toast.type === 'success' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          )}
          {toast.type === 'error' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          )}
          {toast.type === 'warning' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default BulkUploadModal;
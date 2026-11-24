import React, { useState } from 'react';
import {
  MATRIX_COLUMNS,
  flattenCatalog,
  getBasePermission,
  splitModulePermissions,
  toggleModule,
  togglePermission,
  selectAll,
} from './permissionUtils';

/**
 * Permission matrix (Role dashboard, tab "Hak Akses").
 * One row per module, columns Lihat / Buat / Ubah / Hapus / Lainnya.
 *
 * @param {Object} props
 * @param {Array} props.modules - Catalog from GET /admin/permissions (`modules`)
 * @param {string[]} props.value - Selected permission keys
 * @param {(keys: string[]) => void} props.onChange - Called with the new selection
 * @param {boolean} [props.readOnly] - Disable every checkbox (superadmin / employee)
 * @param {string} [props.roleName] - Display name used in the caption
 */
function PermissionMatrix({ modules = [], value = [], onChange, readOnly = false, roleName = '' }) {
  // Module whose "Lihat" was just unticked → inline note
  const [viewNoteModule, setViewNoteModule] = useState(null);

  const selected = new Set(value);
  const total = flattenCatalog(modules).length;

  const emit = (next) => {
    if (!readOnly && onChange) onChange(next);
  };

  const handleToggle = (module, perm, checked) => {
    const base = getBasePermission(module);
    const next = togglePermission(value, perm.key, checked, modules);
    const removedOthers = value.some((k) => k !== perm.key && !next.includes(k));
    setViewNoteModule(!checked && base && base.key === perm.key && removedOthers ? module.module : null);
    emit(next);
  };

  const handleRowToggle = (module) => {
    setViewNoteModule(null);
    emit(toggleModule(value, module, modules));
  };

  const renderCheckbox = (module, perm, label, showText = false) => {
    if (perm.locked) {
      return (
        <span className="pm-locked" title={perm.description || 'Khusus Superadmin'}>
          {selected.has(perm.key) ? '✔' : '—'}
        </span>
      );
    }
    return (
      <label className="pm-check" title={perm.description || perm.label}>
        <input
          type="checkbox"
          checked={selected.has(perm.key)}
          disabled={readOnly}
          onChange={(e) => handleToggle(module, perm, e.target.checked)}
          aria-label={`${module.label} — ${label}`}
        />
        {showText && <span className="pm-check-text">{label}</span>}
      </label>
    );
  };

  return (
    <div className="pm-container">
      <div className="pm-toolbar">
        <span className="pm-title">Hak Akses{roleName ? ` — ${roleName}` : ''}</span>
        {!readOnly && (
          <div className="pm-toolbar-actions">
            <button type="button" className="rm-btn rm-btn-light" onClick={() => { setViewNoteModule(null); emit(selectAll(modules)); }}>
              Pilih semua
            </button>
            <button type="button" className="rm-btn rm-btn-light" onClick={() => { setViewNoteModule(null); emit([]); }}>
              Kosongkan
            </button>
          </div>
        )}
      </div>

      <div className="pm-scroll">
        <table className="pm-table">
          <caption className="pm-caption">
            Hak akses {roleName || 'role'}: {value.length} dari {total} aktif
          </caption>
          <thead>
            <tr>
              <th scope="col" className="pm-col-module">Modul</th>
              {MATRIX_COLUMNS.map((col) => (
                <th scope="col" key={col.action} className="pm-col-action">{col.label}</th>
              ))}
              <th scope="col" className="pm-col-others">Lainnya</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => {
              const { byAction, others } = splitModulePermissions(module);
              const isLockedModule = (module.permissions || []).length > 0 && module.permissions.every((p) => p.locked);
              return (
                <tr key={module.module} className={isLockedModule ? 'pm-row-locked' : ''}>
                  <th scope="row" className="pm-col-module">
                    {readOnly || isLockedModule ? (
                      <span className="pm-module-label">
                        {module.label}
                        {isLockedModule && <span className="pm-lock-chip">🔒 Terkunci</span>}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="pm-module-btn"
                        onClick={() => handleRowToggle(module)}
                        title="Klik untuk memilih / mengosongkan seluruh baris"
                      >
                        {module.label}
                      </button>
                    )}
                    {viewNoteModule === module.module && (
                      <span className="pm-note" role="status">Aksi lain memerlukan akses Lihat</span>
                    )}
                  </th>
                  {MATRIX_COLUMNS.map((col) => (
                    <td key={col.action} className="pm-col-action" data-label={col.label}>
                      {byAction[col.action] ? renderCheckbox(module, byAction[col.action], col.label) : null}
                    </td>
                  ))}
                  <td className="pm-col-others">
                    {isLockedModule ? (
                      <span className="pm-muted">Khusus Superadmin</span>
                    ) : (
                      <div className="pm-others">
                        {others.map((perm) => (
                          <React.Fragment key={perm.key}>
                            {renderCheckbox(module, perm, perm.label, true)}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pm-count" aria-live="polite">
        <strong>{value.length}</strong> dari {total} hak akses aktif
      </div>
    </div>
  );
}

export default PermissionMatrix;

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  createRole,
  updateRole,
  updateRolePermissions,
  getRole,
  getRoleAudit,
} from '../../services/api';
import TaskCreatorBadge from '../../components/TaskCreatorBadge';
import PermissionMatrix from './PermissionMatrix';
import {
  ROLE_NAME_PATTERN,
  diffPermissions,
  getPermissionLabel,
  isViewOnlyRole,
  slugifyRoleName,
  sortByCatalog,
} from './permissionUtils';

const COLOR_PRESETS = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#db2777', '#475569'];
const DEFAULT_CUSTOM_LEVEL = 40;

const TABS = [
  { id: 'detail', label: 'Detail' },
  { id: 'permissions', label: 'Hak Akses' },
  { id: 'members', label: 'Anggota', editOnly: true },
  { id: 'history', label: 'Riwayat', editOnly: true },
];

const AUDIT_ACTION_TEXT = {
  'role.created': 'membuat role',
  'role.updated': 'mengubah detail role',
  'role.permissions_updated': 'mengubah hak akses',
  'role.deleted': 'menghapus role',
  'user.role_changed': 'mengubah role user',
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const permissionsOf = (snapshot) => {
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(snapshot?.permissions)) return snapshot.permissions;
  return null;
};

const errorMessage = (error, fallback) => error?.response?.data?.message || fallback;

/**
 * Create / edit role drawer with tabs Detail, Hak Akses, Anggota, Riwayat.
 *
 * @param {Object} props
 * @param {'create'|'edit'} props.mode
 * @param {Object|null} props.role - Role item (edit mode)
 * @param {Object|null} props.copyFrom - Role to duplicate (create mode)
 * @param {Array} props.roles - All roles (for "Salin hak akses dari")
 * @param {Array} props.modules - Permission catalog modules
 * @param {() => void} props.onClose
 * @param {(role: Object) => void} props.onSaved - Called with the saved role item
 * @param {() => void} props.onCatalogStale - Called after a 422 so the page refetches the catalog
 */
function RoleEditor({ mode, role = null, copyFrom = null, roles = [], modules = [], onClose, onSaved, onCatalogStale }) {
  const isCreate = mode === 'create';
  const viewOnly = !isCreate && isViewOnlyRole(role);
  const editable = isCreate
    ? { permissions: true, name: true, level: true, delete: false, showTaskBadge: true }
    : {
      permissions: !!role?.editable?.permissions,
      name: !!role?.editable?.name,
      level: !!role?.editable?.level,
      delete: !!role?.editable?.delete,
      showTaskBadge: role?.editable?.showTaskBadge !== false && !viewOnly,
    };

  const initialDetail = () => {
    if (isCreate && copyFrom) {
      const displayName = `${copyFrom.displayName || copyFrom.name} (Salinan)`;
      return {
        displayName,
        name: slugifyRoleName(displayName),
        description: copyFrom.description || '',
        level: copyFrom.level > 0 && copyFrom.level < 100 ? copyFrom.level : DEFAULT_CUSTOM_LEVEL,
        color: copyFrom.color || COLOR_PRESETS[0],
        showTaskBadge: !!copyFrom.showTaskBadge,
      };
    }
    if (isCreate) {
      return { displayName: '', name: '', description: '', level: DEFAULT_CUSTOM_LEVEL, color: COLOR_PRESETS[3], showTaskBadge: false };
    }
    return {
      displayName: role?.displayName || '',
      name: role?.name || '',
      description: role?.description || '',
      level: role?.level ?? DEFAULT_CUSTOM_LEVEL,
      color: role?.color || COLOR_PRESETS[0],
      showTaskBadge: !!role?.showTaskBadge,
    };
  };

  const [activeTab, setActiveTab] = useState(viewOnly ? 'permissions' : 'detail');
  const [detail, setDetail] = useState(initialDetail);
  const [nameTouched, setNameTouched] = useState(false);
  const [copyFromRoleId, setCopyFromRoleId] = useState(copyFrom?.id ? String(copyFrom.id) : '');
  const savedPermissions = useMemo(
    () => sortByCatalog(isCreate ? (copyFrom?.permissions || []) : (role?.permissions || []), modules),
    [isCreate, copyFrom, role, modules]
  );
  const [permissions, setPermissions] = useState(savedPermissions);
  const [confirmDiff, setConfirmDiff] = useState(null); // { added, removed } while confirming
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // Members / history (edit mode, loaded lazily per tab)
  const [members, setMembers] = useState(null);
  const [membersError, setMembersError] = useState('');
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    if (isCreate || !role?.id) return undefined;
    let cancelled = false;
    if (activeTab === 'members' && members === null) {
      getRole(role.id)
        .then((res) => { if (!cancelled) setMembers(res.data?.users || []); })
        .catch((err) => { if (!cancelled) { setMembers([]); setMembersError(errorMessage(err, 'Gagal memuat anggota role.')); } });
    }
    if (activeTab === 'history' && history === null) {
      getRoleAudit(role.id)
        .then((res) => { if (!cancelled) setHistory(res.data || []); })
        .catch((err) => { if (!cancelled) { setHistory([]); setHistoryError(errorMessage(err, 'Riwayat belum tersedia.')); } });
    }
    return () => { cancelled = true; };
  }, [activeTab, isCreate, role?.id, members, history]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = isCreate
    ? 'Buat Role Baru'
    : viewOnly
      ? `Lihat Role — ${role?.displayName || role?.name}`
      : `Edit Role — ${role?.displayName || role?.name}`;

  const permissionDiff = diffPermissions(savedPermissions, permissions);
  const permissionsDirty = permissionDiff.added.length > 0 || permissionDiff.removed.length > 0;

  // ── Detail form ──────────────────────────────────────────
  const setField = (field, value) => {
    setDetail((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'displayName' && isCreate && !nameTouched) {
        next.name = slugifyRoleName(value);
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateDetail = () => {
    const next = {};
    const displayName = detail.displayName.trim();
    if (displayName.length < 2 || displayName.length > 100) next.displayName = 'Nama tampilan wajib diisi (2–100 karakter).';
    if (isCreate && !ROLE_NAME_PATTERN.test(detail.name)) {
      next.name = 'Kode role 3–50 karakter: huruf kecil, angka, atau _ dan diawali huruf.';
    }
    const level = Number(detail.level);
    if (editable.level && (!Number.isInteger(level) || level < 1 || level > 99)) next.level = 'Level harus antara 1 dan 99.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleCopyFromChange = (roleId) => {
    setCopyFromRoleId(roleId);
    const source = roles.find((r) => String(r.id) === String(roleId));
    setPermissions(sortByCatalog(source?.permissions || [], modules));
  };

  const handleApiError = (error, fallback) => {
    const status = error?.response?.status;
    toast.error(errorMessage(error, fallback));
    if (status === 422 && onCatalogStale) onCatalogStale();
  };

  const handleCreate = async () => {
    if (!validateDetail()) {
      setActiveTab('detail');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: detail.name,
        displayName: detail.displayName.trim(),
        description: detail.description.trim() || undefined,
        level: Number(detail.level),
        color: detail.color,
        showTaskBadge: !!detail.showTaskBadge,
        permissions,
      };
      if (copyFromRoleId) payload.copyFromRoleId = copyFromRoleId;
      const res = await createRole(payload);
      const autoAdded = res.meta?.autoAdded || [];
      toast.success(`Role ${payload.displayName} dibuat`);
      if (autoAdded.length > 0) {
        toast.info(`Ditambahkan otomatis: ${autoAdded.map((k) => getPermissionLabel(k, modules)).join(', ')}`);
      }
      onSaved(res.data);
    } catch (error) {
      handleApiError(error, 'Gagal membuat role.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetail = async () => {
    if (!validateDetail()) return;
    const changes = {};
    if (detail.displayName.trim() !== (role.displayName || '')) changes.displayName = detail.displayName.trim();
    if (detail.description.trim() !== (role.description || '')) changes.description = detail.description.trim();
    if (detail.color !== (role.color || '')) changes.color = detail.color;
    if (editable.level && Number(detail.level) !== role.level) changes.level = Number(detail.level);
    if (editable.showTaskBadge && !!detail.showTaskBadge !== !!role.showTaskBadge) changes.showTaskBadge = !!detail.showTaskBadge;
    if (Object.keys(changes).length === 0) {
      toast.info('Tidak ada perubahan.');
      return;
    }
    setSaving(true);
    try {
      const res = await updateRole(role.id, changes);
      toast.success(`Role ${res.data?.displayName || detail.displayName} diperbarui`);
      onSaved(res.data, { keepOpen: true });
    } catch (error) {
      handleApiError(error, 'Gagal memperbarui role.');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestSavePermissions = () => {
    if (!permissionsDirty) {
      toast.info('Tidak ada perubahan hak akses.');
      return;
    }
    setConfirmDiff(permissionDiff);
  };

  const handleConfirmSavePermissions = async () => {
    setSaving(true);
    try {
      const res = await updateRolePermissions(role.id, permissions);
      const autoAdded = res.meta?.autoAdded || [];
      toast.success(`Hak akses ${role.displayName || role.name} diperbarui`);
      if (autoAdded.length > 0) {
        toast.info(`Ditambahkan otomatis: ${autoAdded.map((k) => getPermissionLabel(k, modules)).join(', ')}`);
      }
      setConfirmDiff(null);
      onSaved(res.data, { keepOpen: true });
    } catch (error) {
      setConfirmDiff(null);
      handleApiError(error, 'Gagal menyimpan hak akses.');
    } finally {
      setSaving(false);
    }
  };

  const previewRole = {
    name: detail.name,
    displayName: detail.displayName.trim() || 'Role',
    color: detail.color,
    showBadge: true,
  };

  const visibleTabs = TABS.filter((tab) => !(tab.editOnly && isCreate));

  // ── Render helpers ───────────────────────────────────────
  const renderBanner = () => {
    if (!viewOnly) return null;
    const text = role?.platform === 'mobile'
      ? `${role?.displayName || 'Role ini'} hanya dapat login di aplikasi mobile`
      : `${role?.displayName || 'Role ini'} selalu memiliki semua akses`;
    return <div className="rm-banner" role="note">🔒 {text}</div>;
  };

  const renderDetailTab = () => (
    <div className="rm-form">
      <div className="rm-field">
        <label htmlFor="rm-displayName">Nama tampilan <span className="rm-required">*</span></label>
        <input
          id="rm-displayName"
          type="text"
          value={detail.displayName}
          onChange={(e) => setField('displayName', e.target.value)}
          maxLength={100}
          disabled={viewOnly}
          placeholder="mis. Supervisor Lapangan"
        />
        {errors.displayName && <span className="rm-error">{errors.displayName}</span>}
      </div>

      <div className="rm-field">
        <label htmlFor="rm-name">Kode role</label>
        <input
          id="rm-name"
          type="text"
          value={detail.name}
          onChange={(e) => { setNameTouched(true); setField('name', e.target.value.toLowerCase()); }}
          maxLength={50}
          readOnly={!isCreate}
          className={!isCreate ? 'rm-readonly' : ''}
          placeholder="supervisor_lapangan"
        />
        {errors.name && <span className="rm-error">{errors.name}</span>}
        {isCreate && <span className="rm-hint">Huruf kecil, angka dan _. Tidak dapat diubah setelah role dibuat.</span>}
      </div>

      <div className="rm-field">
        <label htmlFor="rm-description">Deskripsi</label>
        <textarea
          id="rm-description"
          rows={3}
          value={detail.description}
          onChange={(e) => setField('description', e.target.value)}
          disabled={viewOnly}
          placeholder="Opsional"
        />
      </div>

      <div className="rm-field">
        <label htmlFor="rm-level">Level</label>
        <div className="rm-level-row">
          <input
            id="rm-level"
            type="range"
            min={1}
            max={99}
            value={Math.min(99, Math.max(1, Number(detail.level) || 1))}
            onChange={(e) => setField('level', Number(e.target.value))}
            disabled={!editable.level}
            aria-label="Level role"
          />
          <input
            type="number"
            min={1}
            max={99}
            value={detail.level}
            onChange={(e) => setField('level', e.target.value === '' ? '' : Number(e.target.value))}
            disabled={!editable.level}
            className="rm-level-number"
            aria-label="Level role (angka)"
          />
        </div>
        {errors.level && <span className="rm-error">{errors.level}</span>}
        <span className="rm-hint">
          Role dengan level lebih tinggi dapat mengelola user dengan role level lebih rendah. Admin &amp; Manager = 50.
        </span>
      </div>

      <div className="rm-field">
        <span className="rm-label">Warna badge</span>
        <div className="rm-swatches" role="radiogroup" aria-label="Warna badge">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={detail.color === color}
              aria-label={`Warna ${color}`}
              className={`rm-swatch ${detail.color === color ? 'selected' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => setField('color', color)}
              disabled={viewOnly}
            />
          ))}
        </div>
      </div>

      {editable.showTaskBadge && (
        <div className="rm-field">
          <div className="rm-badge-row">
            <label className="rm-checkbox">
              <input
                type="checkbox"
                checked={!!detail.showTaskBadge}
                onChange={(e) => setField('showTaskBadge', e.target.checked)}
              />
              Tampilkan badge pada task
            </label>
            {detail.showTaskBadge && <TaskCreatorBadge createdByRole={previewRole} />}
          </div>
          <span className="rm-hint">
            Task yang dibuat oleh user dengan role ini akan menampilkan badge &quot;Dibuat oleh {previewRole.displayName}&quot;.
            Perubahan berlaku juga untuk task yang sudah dibuat oleh role ini.
          </span>
        </div>
      )}

      {isCreate && (
        <div className="rm-field">
          <label htmlFor="rm-copyFrom">Salin hak akses dari</label>
          <select id="rm-copyFrom" value={copyFromRoleId} onChange={(e) => handleCopyFromChange(e.target.value)}>
            <option value="">— Tidak menyalin —</option>
            {roles.filter((r) => r.platform === 'web').map((r) => (
              <option key={r.id} value={String(r.id)}>{r.displayName || r.name}</option>
            ))}
          </select>
        </div>
      )}

      {!isCreate && !viewOnly && (
        <div className="rm-actions">
          <button type="button" className="rm-btn rm-btn-light" onClick={() => { setDetail(initialDetail()); setErrors({}); }} disabled={saving}>
            Batal
          </button>
          <button type="button" className="rm-btn rm-btn-primary" onClick={handleSaveDetail} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan detail'}
          </button>
        </div>
      )}
    </div>
  );

  const renderConfirm = () => {
    if (!confirmDiff) return null;
    const userCount = role?.userCount || 0;
    return (
      <div className="rm-confirm" role="alertdialog" aria-labelledby="rm-confirm-title">
        <p id="rm-confirm-title" className="rm-confirm-title">
          +{confirmDiff.added.length} ditambahkan, −{confirmDiff.removed.length} dihapus.{' '}
          {userCount} user dengan role {role?.displayName || role?.name} akan langsung terpengaruh.
        </p>
        {(confirmDiff.added.length > 0 || confirmDiff.removed.length > 0) && (
          <ul className="rm-diff-list">
            {confirmDiff.added.map((k) => <li key={`a-${k}`} className="rm-diff-added">+ {getPermissionLabel(k, modules)}</li>)}
            {confirmDiff.removed.map((k) => <li key={`r-${k}`} className="rm-diff-removed">− {getPermissionLabel(k, modules)}</li>)}
          </ul>
        )}
        <div className="rm-actions">
          <button type="button" className="rm-btn rm-btn-light" onClick={() => setConfirmDiff(null)} disabled={saving}>Batal</button>
          <button type="button" className="rm-btn rm-btn-primary" onClick={handleConfirmSavePermissions} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Ya, simpan'}
          </button>
        </div>
      </div>
    );
  };

  const renderPermissionsTab = () => {
    if (!isCreate && role?.platform === 'mobile') {
      return <p className="rm-muted">Role mobile tidak menggunakan matriks hak akses web.</p>;
    }
    const matrixReadOnly = viewOnly || !editable.permissions;
    return (
      <>
        <PermissionMatrix
          modules={modules}
          value={permissions}
          onChange={setPermissions}
          readOnly={matrixReadOnly}
          roleName={detail.displayName || role?.displayName || ''}
        />
        {!isCreate && !matrixReadOnly && (
          confirmDiff ? renderConfirm() : (
            <div className="rm-actions">
              <button type="button" className="rm-btn rm-btn-light" onClick={() => setPermissions(savedPermissions)} disabled={!permissionsDirty || saving}>
                Batal
              </button>
              <button type="button" className="rm-btn rm-btn-primary" onClick={handleRequestSavePermissions} disabled={!permissionsDirty || saving}>
                Simpan
              </button>
            </div>
          )
        )}
      </>
    );
  };

  const renderMembersTab = () => {
    if (members === null) return <p className="rm-muted">Memuat anggota...</p>;
    return (
      <div className="rm-members">
        {membersError && <p className="rm-error">{membersError}</p>}
        {members.length === 0 && !membersError ? (
          <p className="rm-muted">Belum ada user dengan role ini.</p>
        ) : (
          <ul className="rm-member-list">
            {members.map((m) => (
              <li key={m.id} className="rm-member">
                <div className="rm-member-main">
                  <span className="rm-member-name">{m.name}</span>
                  <span className="rm-member-email">{m.email}</span>
                </div>
                <div className="rm-member-meta">
                  <span className={`rm-status rm-status-${m.status}`}>{m.status === 'active' ? 'Aktif' : 'Nonaktif'}</span>
                  <span className="rm-member-login">Login terakhir: {formatDateTime(m.lastLoginAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {role?.userCount > (members?.length || 0) && (
          <p className="rm-hint">Menampilkan {members.length} dari {role.userCount} user.</p>
        )}
        <Link to={`/users?role=${encodeURIComponent(role?.name || '')}`} className="rm-link">
          Kelola di User Management →
        </Link>
      </div>
    );
  };

  const describeAudit = (entry) => {
    const actor = entry.actorName || 'Sistem';
    if (entry.action === 'role.permissions_updated') {
      const before = permissionsOf(entry.before);
      const after = permissionsOf(entry.after);
      if (before && after) {
        const { added, removed } = diffPermissions(before, after);
        const parts = [];
        if (added.length) parts.push(<>menambahkan <em>{added.join(', ')}</em></>);
        if (removed.length) parts.push(<>menghapus <em>{removed.join(', ')}</em></>);
        if (parts.length) {
          return (
            <>
              {actor}{' '}
              {parts.map((part, i) => (
                <React.Fragment key={i}>{i > 0 ? ' dan ' : ''}{part}</React.Fragment>
              ))}
            </>
          );
        }
      }
    }
    return <>{actor} {AUDIT_ACTION_TEXT[entry.action] || entry.action}</>;
  };

  const renderHistoryTab = () => {
    if (history === null) return <p className="rm-muted">Memuat riwayat...</p>;
    if (historyError) return <p className="rm-muted">{historyError}</p>;
    if (history.length === 0) return <p className="rm-muted">Belum ada riwayat perubahan.</p>;
    return (
      <ol className="rm-timeline">
        {history.map((entry) => (
          <li key={entry.id} className="rm-timeline-item">
            <span className="rm-timeline-dot" aria-hidden="true" />
            <div>
              <div className="rm-timeline-text">{describeAudit(entry)}</div>
              <div className="rm-timeline-date">{formatDateTime(entry.createdAt)}</div>
            </div>
          </li>
        ))}
      </ol>
    );
  };

  return (
    <div className="rm-drawer-overlay" onClick={onClose}>
      <aside
        className="rm-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rm-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rm-drawer-header">
          <div className="rm-drawer-title-wrap">
            <span className="rm-dot" style={{ backgroundColor: detail.color }} aria-hidden="true" />
            <h2 id="rm-drawer-title">{title}</h2>
            {!isCreate && role?.isSystem && <span className="rm-chip-system">SISTEM</span>}
          </div>
          <button type="button" className="rm-icon-btn" onClick={onClose} aria-label="Tutup">✕</button>
        </header>

        <nav className="rm-tabs" role="tablist">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`rm-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'permissions' && permissionsDirty && !isCreate && <span className="rm-tab-dot" aria-label="ada perubahan" />}
            </button>
          ))}
        </nav>

        <div className="rm-drawer-body">
          {renderBanner()}
          {activeTab === 'detail' && renderDetailTab()}
          {activeTab === 'permissions' && renderPermissionsTab()}
          {activeTab === 'members' && renderMembersTab()}
          {activeTab === 'history' && renderHistoryTab()}
        </div>

        {isCreate && (
          <footer className="rm-drawer-footer">
            <span className="rm-muted">{permissions.length} hak akses dipilih</span>
            <div className="rm-actions">
              <button type="button" className="rm-btn rm-btn-light" onClick={onClose} disabled={saving}>Batal</button>
              <button type="button" className="rm-btn rm-btn-primary" onClick={handleCreate} disabled={saving}>
                {saving ? 'Menyimpan...' : 'Buat Role'}
              </button>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}

export default RoleEditor;

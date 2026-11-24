import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  getRoles,
  getPermissionCatalog,
  deleteRole,
  reassignRole,
  getAssignableRoles,
} from '../../services/api';
import ResponsiveTable from '../../components/ResponsiveTable/ResponsiveTable';
import RoleEditor from './RoleEditor';
import { flattenCatalog, isViewOnlyRole } from './permissionUtils';
import './RoleManagement.css';

const errorMessage = (error, fallback) => error?.response?.data?.message || fallback;

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M11.333 2.00004C11.5081 1.82494 11.716 1.68605 11.9447 1.59129C12.1735 1.49653 12.4187 1.44775 12.6663 1.44775C12.914 1.44775 13.1592 1.49653 13.3879 1.59129C13.6167 1.68605 13.8246 1.82494 13.9997 2.00004C14.1748 2.17513 14.3137 2.383 14.4084 2.61178C14.5032 2.84055 14.552 3.08575 14.552 3.33337C14.552 3.58099 14.5032 3.82619 14.4084 4.05497C14.3137 4.28374 14.1748 4.49161 13.9997 4.66671L5.33301 13.3334L1.99967 14.3334L2.99967 11L11.333 2.00004Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 4H3.33333H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.33301 4.00004V2.66671C5.33301 2.31309 5.47348 1.97395 5.72353 1.7239C5.97358 1.47385 6.31272 1.33337 6.66634 1.33337H9.33301C9.68663 1.33337 10.0258 1.47385 10.2758 1.7239C10.5259 1.97395 10.6663 2.31309 10.6663 2.66671V4.00004M12.6663 4.00004V13.3334C12.6663 13.687 12.5259 14.0261 12.2758 14.2762C12.0258 14.5262 11.6866 14.6667 11.333 14.6667H4.66634C4.31272 14.6667 3.97358 14.5262 3.72353 14.2762C3.47348 14.0261 3.33301 13.687 3.33301 13.3334V4.00004H12.6663Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Roles & Hak Akses (route /roles, permission roles.manage — superadmin only).
 * Spec: docs/rbac/06-role-dashboard-ui.md
 */
function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  // { mode: 'create'|'edit', roleId?, copyFrom? }
  const [editor, setEditor] = useState(null);
  // { role, step: 'confirm'|'reassign', userCount, message, targets, toRoleId, busy }
  const [deleteState, setDeleteState] = useState(null);

  const totalPermissions = flattenCatalog(modules).length;

  const loadRoles = useCallback(async () => {
    const res = await getRoles({ includeMobile: true });
    setRoles(res.data || []);
  }, []);

  const loadCatalog = useCallback(async () => {
    const res = await getPermissionCatalog();
    setModules(res.modules || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadRoles(), loadCatalog()]);
        if (!cancelled) setLoadError('');
      } catch (error) {
        console.error('Error loading roles:', error);
        if (!cancelled) setLoadError(errorMessage(error, 'Gagal memuat data role.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadRoles, loadCatalog]);

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || (a.displayName || a.name).localeCompare(b.displayName || b.name)),
    [roles]
  );

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRoles;
    return sortedRoles.filter((r) =>
      [r.displayName, r.name, r.description].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [sortedRoles, search]);

  const summary = useMemo(() => ({
    total: roles.length,
    system: roles.filter((r) => r.isSystem).length,
    custom: roles.filter((r) => !r.isSystem).length,
    users: roles.reduce((sum, r) => sum + (r.userCount || 0), 0),
  }), [roles]);

  const editingRole = editor?.mode === 'edit' ? roles.find((r) => String(r.id) === String(editor.roleId)) : null;

  // ── Editor ───────────────────────────────────────────────
  // Fresh editor state every time the drawer opens
  const editorSeq = useRef(0);
  const nextEditorKey = () => {
    editorSeq.current += 1;
    return editorSeq.current;
  };
  const openCreate = () => setEditor({ mode: 'create', copyFrom: null, key: nextEditorKey() });
  const openDuplicate = (role) => setEditor({ mode: 'create', copyFrom: role, key: nextEditorKey() });
  const openEdit = (role) => setEditor({ mode: 'edit', roleId: role.id, key: nextEditorKey() });
  const closeEditor = useCallback(() => setEditor(null), []);

  const handleSaved = async (savedRole, options = {}) => {
    if (savedRole?.id) {
      setRoles((prev) => {
        const exists = prev.some((r) => String(r.id) === String(savedRole.id));
        return exists
          ? prev.map((r) => (String(r.id) === String(savedRole.id) ? { ...r, ...savedRole } : r))
          : [...prev, savedRole];
      });
    }
    if (!options.keepOpen) setEditor(null);
    try {
      await loadRoles();
    } catch (error) {
      console.error('Error reloading roles:', error);
    }
  };

  const handleCatalogStale = async () => {
    try {
      await loadCatalog();
    } catch (error) {
      console.error('Error reloading catalog:', error);
    }
  };

  // ── Delete / reassign flow ───────────────────────────────
  const loadReassignTargets = async (role) => {
    try {
      const res = await getAssignableRoles();
      return (res.data || []).filter((r) => String(r.id) !== String(role.id));
    } catch (error) {
      console.error('Error loading assignable roles:', error);
      return [];
    }
  };

  const openDelete = async (role) => {
    if ((role.userCount || 0) > 0) {
      setDeleteState({ role, step: 'reassign', userCount: role.userCount, message: '', targets: null, toRoleId: '', busy: false });
      const targets = await loadReassignTargets(role);
      setDeleteState((prev) => (prev && prev.role.id === role.id ? { ...prev, targets } : prev));
      return;
    }
    setDeleteState({ role, step: 'confirm', userCount: 0, message: '', targets: null, toRoleId: '', busy: false });
  };

  const closeDelete = () => setDeleteState(null);

  const performDelete = async (role) => {
    await deleteRole(role.id);
    toast.success(`Role ${role.displayName || role.name} dihapus`);
    setDeleteState(null);
    await loadRoles();
  };

  const handleConfirmDelete = async () => {
    const { role } = deleteState;
    setDeleteState((prev) => ({ ...prev, busy: true }));
    try {
      await performDelete(role);
    } catch (error) {
      if (error?.response?.status === 409) {
        const userCount = error.response.data?.userCount ?? role.userCount ?? 0;
        const message = errorMessage(error, `Role masih dipakai oleh ${userCount} user`);
        toast.warning(message);
        setDeleteState((prev) => ({ ...prev, step: 'reassign', userCount, message, busy: false, targets: null }));
        const targets = await loadReassignTargets(role);
        setDeleteState((prev) => (prev ? { ...prev, targets } : prev));
      } else {
        toast.error(errorMessage(error, 'Gagal menghapus role.'));
        setDeleteState((prev) => (prev ? { ...prev, busy: false } : prev));
      }
    }
  };

  const handleReassignAndDelete = async () => {
    const { role, toRoleId } = deleteState;
    if (!toRoleId) {
      toast.warning('Pilih role tujuan terlebih dahulu');
      return;
    }
    setDeleteState((prev) => ({ ...prev, busy: true }));
    try {
      const res = await reassignRole(role.id, toRoleId);
      toast.success(`${res?.moved ?? deleteState.userCount} user dipindahkan`);
      await performDelete(role);
    } catch (error) {
      toast.error(errorMessage(error, 'Gagal memindahkan user.'));
      setDeleteState((prev) => (prev ? { ...prev, busy: false } : prev));
      try { await loadRoles(); } catch { /* ignore */ }
    }
  };

  // ── Cells ────────────────────────────────────────────────
  const renderPermissionCount = (role) => {
    if (role.platform === 'mobile') return <span className="rm-muted">App mobile</span>;
    const count = (role.permissions || []).length;
    if (!role.editable?.permissions && totalPermissions > 0 && count >= totalPermissions) {
      return <span>Semua ({totalPermissions})</span>;
    }
    return <span>{count} / {totalPermissions || '–'}</span>;
  };

  const renderBadgeCell = (role) => {
    if (isViewOnlyRole(role) || role.editable?.showTaskBadge === false) {
      return <span className="rm-muted" aria-label="Tidak berlaku">—</span>;
    }
    return role.showTaskBadge
      ? <span className="rm-badge-yes" title="Badge ditampilkan pada task">✔ <span className="rm-sr">Ya</span></span>
      : <span className="rm-badge-no" title="Badge tidak ditampilkan">✘ <span className="rm-sr">Tidak</span></span>;
  };

  const renderActions = (role) => {
    const viewOnly = isViewOnlyRole(role);
    const userCount = role.userCount || 0;
    const showDelete = !role.isSystem && (role.editable?.delete || userCount > 0);
    return (
      <div className="rm-row-actions">
        {viewOnly ? (
          <button type="button" className="rm-action-btn" onClick={() => openEdit(role)} title="Lihat" aria-label={`Lihat role ${role.displayName}`}>
            <EyeIcon />
          </button>
        ) : (
          <>
            <button type="button" className="rm-action-btn" onClick={() => openEdit(role)} title="Edit" aria-label={`Edit role ${role.displayName}`}>
              <EditIcon />
            </button>
            {role.platform === 'web' && (
              <button type="button" className="rm-action-btn" onClick={() => openDuplicate(role)} title="Duplikat" aria-label={`Duplikat role ${role.displayName}`}>
                <CopyIcon />
              </button>
            )}
          </>
        )}
        {showDelete && (
          <button
            type="button"
            className={`rm-action-btn rm-action-delete ${userCount > 0 ? 'rm-action-needs-reassign' : ''}`}
            onClick={() => openDelete(role)}
            title={userCount > 0 ? `Pindahkan ${userCount} user terlebih dahulu` : 'Hapus'}
            aria-label={userCount > 0 ? `Pindahkan ${userCount} user dari role ${role.displayName} terlebih dahulu` : `Hapus role ${role.displayName}`}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    );
  };

  // ── Delete panel ─────────────────────────────────────────
  const renderDeletePanel = () => {
    if (!deleteState) return null;
    const { role, step, userCount, message, targets, toRoleId, busy } = deleteState;
    const roleLabel = role.displayName || role.name;
    return (
      <div className="rm-modal-overlay" onClick={busy ? undefined : closeDelete}>
        <div className="rm-modal" role="alertdialog" aria-modal="true" aria-labelledby="rm-delete-title" onClick={(e) => e.stopPropagation()}>
          {step === 'confirm' ? (
            <>
              <h3 id="rm-delete-title">Hapus role {roleLabel}?</h3>
              <p>Tindakan ini tidak dapat dibatalkan.</p>
              <div className="rm-actions">
                <button type="button" className="rm-btn rm-btn-light" onClick={closeDelete} disabled={busy}>Batal</button>
                <button type="button" className="rm-btn rm-btn-danger" onClick={handleConfirmDelete} disabled={busy}>
                  {busy ? 'Menghapus...' : 'Hapus'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 id="rm-delete-title">Pindahkan user</h3>
              <p>
                {message || `Role ${roleLabel} masih dipakai oleh ${userCount} user.`} Pilih role tujuan untuk
                memindahkan semua user, lalu role {roleLabel} akan dihapus.
              </p>
              <label className="rm-field">
                <span className="rm-label">Role tujuan</span>
                <select
                  value={toRoleId}
                  onChange={(e) => setDeleteState((prev) => ({ ...prev, toRoleId: e.target.value }))}
                  disabled={busy || targets === null}
                >
                  <option value="">{targets === null ? 'Memuat...' : '— Pilih role —'}</option>
                  {(targets || []).map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.displayName || r.name}{r.platform === 'mobile' ? ' (Mobile)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {targets && targets.length === 0 && (
                <p className="rm-error">Tidak ada role tujuan yang dapat dipilih.</p>
              )}
              <div className="rm-actions">
                <button type="button" className="rm-btn rm-btn-light" onClick={closeDelete} disabled={busy}>Batal</button>
                <button type="button" className="rm-btn rm-btn-danger" onClick={handleReassignAndDelete} disabled={busy || !toRoleId}>
                  {busy ? 'Memproses...' : `Pindahkan ${userCount} user & hapus`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rm-page">
      <div className="rm-header">
        <div>
          <h1>Roles &amp; Hak Akses</h1>
          <p className="rm-subtitle">Atur role dan fitur apa saja yang boleh diakses setiap role.</p>
        </div>
        <button type="button" className="btn-tambah rm-add-btn" onClick={openCreate} disabled={loading || !!loadError}>
          <span className="btn-icon">+</span> Buat Role Baru
        </button>
      </div>

      <div className="rm-toolbar">
        <div className="rm-summary">
          <div className="rm-summary-card"><span className="rm-summary-value">{summary.total}</span><span className="rm-summary-label">Role</span></div>
          <div className="rm-summary-card"><span className="rm-summary-value">{summary.system}</span><span className="rm-summary-label">Sistem</span></div>
          <div className="rm-summary-card"><span className="rm-summary-value">{summary.custom}</span><span className="rm-summary-label">Custom</span></div>
          <div className="rm-summary-card"><span className="rm-summary-value">{summary.users}</span><span className="rm-summary-label">User</span></div>
        </div>
        <div className="rm-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21.0004 21.0004L16.6504 16.6504" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            type="search"
            placeholder="Cari role"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Cari role"
          />
        </div>
      </div>

      {loadError && <div className="rm-load-error" role="alert">{loadError}</div>}

      <div className="rm-content">
        <ResponsiveTable className="rm-table-wrap" tableClassName="rm-table" loading={loading} minWidth="0" maxHeight="100%">
          <thead>
            <tr>
              <th>Role</th>
              <th>Level</th>
              <th>Platform</th>
              <th>User</th>
              <th>Hak akses</th>
              <th>Badge</th>
              <th className="rm-col-actions">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoles.length === 0 ? (
              <tr>
                <td colSpan="7" className="rm-empty">
                  {search ? 'Tidak ada role yang cocok dengan pencarian.' : 'Belum ada role.'}
                </td>
              </tr>
            ) : (
              filteredRoles.map((role) => (
                <tr key={role.id}>
                  <td data-label="Role" className="rm-col-role">
                    <div className="rm-role-cell">
                      <span className="rm-dot" style={{ backgroundColor: role.color || '#6b7280' }} aria-hidden="true" />
                      <div className="rm-role-text">
                        <span className="rm-role-name">
                          {role.displayName || role.name}
                          {role.isSystem && <span className="rm-chip-system">SISTEM</span>}
                        </span>
                        <span className="rm-role-code">{role.name}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Level">{role.level}</td>
                  <td data-label="Platform">{role.platform === 'mobile' ? 'Mobile' : 'Web'}</td>
                  <td data-label="User">{role.userCount ?? 0}</td>
                  <td data-label="Hak akses">{renderPermissionCount(role)}</td>
                  <td data-label="Badge">{renderBadgeCell(role)}</td>
                  <td data-label="Aksi" className="rm-col-actions">{renderActions(role)}</td>
                </tr>
              ))
            )}
          </tbody>
        </ResponsiveTable>
      </div>

      {editor && (editor.mode === 'create' || editingRole) && (
        <RoleEditor
          key={editor.key}
          mode={editor.mode}
          role={editingRole}
          copyFrom={editor.copyFrom}
          roles={roles}
          modules={modules}
          onClose={closeEditor}
          onSaved={handleSaved}
          onCatalogStale={handleCatalogStale}
        />
      )}

      {renderDeletePanel()}
    </div>
  );
}

export default RoleManagement;

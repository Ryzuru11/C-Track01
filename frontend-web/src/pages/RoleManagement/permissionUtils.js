/**
 * Pure helpers for the Role dashboard permission matrix (RBAC v2).
 *
 * The catalog comes from GET /admin/permissions:
 *   { modules: [{ module, label, permissions: [{ key, label, description, isBase?, requires?, locked? }] }] }
 *
 * "Include Read" rule: every action in a module needs that module's base (`.view`)
 * permission. Ticking an action ticks what it requires; unticking a permission
 * unticks everything that requires it.
 */

/** Matrix columns, in display order. Anything else goes to "Lainnya". */
export const MATRIX_COLUMNS = [
  { action: 'view', label: 'Lihat' },
  { action: 'create', label: 'Buat' },
  { action: 'update', label: 'Ubah' },
  { action: 'delete', label: 'Hapus' },
];

const COLUMN_ACTIONS = MATRIX_COLUMNS.map((c) => c.action);

/** "tasks.toggle_status" → "toggle_status" */
export const getAction = (key) => key.slice(key.indexOf('.') + 1);

/** Flat list of every catalog permission. */
export const flattenCatalog = (modules = []) => modules.flatMap((m) => m.permissions || []);

/** Base (Lihat) permission of a module, if it has one. */
export const getBasePermission = (module) =>
  (module?.permissions || []).find((p) => p.isBase || getAction(p.key) === 'view') || null;

/**
 * Map key → keys it requires. Uses `requires` from the catalog, and falls back
 * to "every non-base key of a module requires the module's base key".
 */
export const buildRequiresMap = (modules = []) => {
  const map = new Map();
  modules.forEach((module) => {
    const base = getBasePermission(module);
    (module.permissions || []).forEach((perm) => {
      let requires = Array.isArray(perm.requires) ? perm.requires : null;
      if (!requires) {
        requires = base && base.key !== perm.key ? [base.key] : [];
      }
      map.set(perm.key, requires);
    });
  });
  return map;
};

/** Keys of permissions that can never be granted from the dashboard. */
export const getLockedKeys = (modules = []) =>
  new Set(flattenCatalog(modules).filter((p) => p.locked).map((p) => p.key));

/** Split a module's permissions into the fixed columns and "Lainnya". */
export const splitModulePermissions = (module) => {
  const byAction = {};
  const others = [];
  (module?.permissions || []).forEach((perm) => {
    const action = getAction(perm.key);
    if (COLUMN_ACTIONS.includes(action) && !byAction[action]) {
      byAction[action] = perm;
    } else {
      others.push(perm);
    }
  });
  return { byAction, others };
};

/** Keep the catalog order and drop unknown keys. */
export const sortByCatalog = (keys, modules = []) => {
  const set = new Set(keys);
  return flattenCatalog(modules).map((p) => p.key).filter((k) => set.has(k));
};

/**
 * Tick or untick one permission, applying the "include Read" rule.
 * @returns {string[]} New selection (catalog order)
 */
export const togglePermission = (selected, key, checked, modules = []) => {
  const requiresMap = buildRequiresMap(modules);
  const locked = getLockedKeys(modules);
  if (locked.has(key)) return sortByCatalog(selected, modules);

  const next = new Set(selected);
  if (checked) {
    // Add the key and everything it (transitively) requires
    const stack = [key];
    while (stack.length) {
      const current = stack.pop();
      if (next.has(current) && current !== key) continue;
      next.add(current);
      (requiresMap.get(current) || []).forEach((req) => {
        if (!next.has(req) && !locked.has(req)) stack.push(req);
      });
    }
  } else {
    // Remove the key and everything that (transitively) requires it
    const stack = [key];
    while (stack.length) {
      const current = stack.pop();
      next.delete(current);
      requiresMap.forEach((requires, dependent) => {
        if (requires.includes(current) && next.has(dependent)) stack.push(dependent);
      });
    }
  }
  return sortByCatalog(Array.from(next), modules);
};

/**
 * Row header click: select the whole module, or clear it when it is fully selected.
 * @returns {string[]} New selection (catalog order)
 */
export const toggleModule = (selected, module, modules = []) => {
  const locked = getLockedKeys(modules);
  const keys = (module?.permissions || []).map((p) => p.key).filter((k) => !locked.has(k));
  if (keys.length === 0) return sortByCatalog(selected, modules);

  const allOn = keys.every((k) => selected.includes(k));
  const next = new Set(selected);
  keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
  return sortByCatalog(Array.from(next), modules);
};

/** Select every grantable permission. */
export const selectAll = (modules = []) => {
  const locked = getLockedKeys(modules);
  return flattenCatalog(modules).map((p) => p.key).filter((k) => !locked.has(k));
};

/**
 * Difference between the saved and the edited permission sets.
 * @returns {{ added: string[], removed: string[] }}
 */
export const diffPermissions = (before = [], after = []) => {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((k) => !beforeSet.has(k)),
    removed: before.filter((k) => !afterSet.has(k)),
  };
};

/** "Supervisor Lapangan" → "supervisor_lapangan" (matches ^[a-z][a-z0-9_]{2,49}$ when possible) */
export const slugifyRoleName = (value = '') =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 50);

export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{2,49}$/;

/** Label of a permission key from the catalog (falls back to the key). */
export const getPermissionLabel = (key, modules = []) => {
  for (const module of modules) {
    const perm = (module.permissions || []).find((p) => p.key === key);
    if (perm) return `${module.label}: ${perm.label}`;
  }
  return key;
};

/** Can anything about this role be changed from the dashboard? (superadmin / employee: no) */
export const isViewOnlyRole = (role) =>
  !!role && !role.editable?.permissions && !role.editable?.showTaskBadge && !role.editable?.name && !role.editable?.level;

import useAccess from '../hooks/useAccess';

/**
 * Render children only when the current user has the permission(s).
 *
 *   <Can perm="tasks.delete"><button>Hapus</button></Can>
 *   <Can anyOf={['monitoring.view_reports', 'monitoring.view_locations']}>…</Can>
 *   <Can allOf={['tasks.update', 'tasks.toggle_status']}>…</Can>
 *
 * @param {Object} props
 * @param {string} [props.perm] - Single permission key
 * @param {string[]} [props.anyOf] - Allowed if the user has at least one key
 * @param {string[]} [props.allOf] - Allowed if the user has every key
 * @param {React.ReactNode} [props.fallback] - Rendered when denied (default: nothing)
 * @param {React.ReactNode} props.children
 */
function Can({ perm, anyOf, allOf, fallback = null, children }) {
  const { can, canAny, canAll } = useAccess();

  let allowed = true;
  if (perm) allowed = allowed && can(perm);
  if (anyOf) allowed = allowed && canAny(anyOf);
  if (allOf) allowed = allowed && canAll(allOf);
  if (!perm && !anyOf && !allOf) allowed = false;

  return allowed ? children : fallback;
}

export default Can;

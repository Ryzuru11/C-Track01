import React from 'react';
import './TaskCreatorBadge.css';

const DEFAULT_COLOR = '#0891b2';

/**
 * "Dibuat oleh {Role}" badge. Rendered only when the creator role's
 * "Tampilkan badge pada task" setting is on (createdByRole.showBadge).
 *
 * @param {Object} props
 * @param {{name: string, displayName: string, color: string|null, showBadge: boolean}|null} props.createdByRole
 * @param {{id: string, name: string}|null} [props.createdBy] - Used for the tooltip
 * @param {boolean} [props.compact] - Smaller variant for dense rows
 */
function TaskCreatorBadge({ createdByRole, createdBy = null, compact = false }) {
  if (!createdByRole?.showBadge) return null;

  const color = createdByRole.color || DEFAULT_COLOR;
  const label = createdByRole.displayName || createdByRole.name;
  const title = createdBy?.name ? `Dibuat oleh ${createdBy.name} (${label})` : `Dibuat oleh ${label}`;

  return (
    <span
      className={`task-creator-badge${compact ? ' compact' : ''}`}
      style={{ color, borderColor: color, backgroundColor: `${color}14` }}
      title={title}
    >
      <span className="task-creator-badge-dot" style={{ backgroundColor: color }} aria-hidden="true" />
      Dibuat oleh {label}
    </span>
  );
}

export default TaskCreatorBadge;

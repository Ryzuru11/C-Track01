import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TaskCreatorBadge from './TaskCreatorBadge';

const manager = { name: 'manager', displayName: 'Manager', color: '#0891b2', showBadge: true };

describe('TaskCreatorBadge', () => {
  it('shows "Dibuat oleh {role}" when the creator role has the badge on', () => {
    render(<TaskCreatorBadge createdByRole={manager} createdBy={{ id: 'u1', name: 'Budi' }} />);

    const badge = screen.getByText('Dibuat oleh Manager');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'Dibuat oleh Budi (Manager)');
    expect(badge).toHaveStyle({ color: '#0891b2' });
  });

  it.each([
    ['the badge setting is off', { ...manager, showBadge: false }],
    ['the task has no creator role (created before RBAC)', null],
  ])('renders nothing when %s', (_label, createdByRole) => {
    const { container } = render(<TaskCreatorBadge createdByRole={createdByRole} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to the role code and a default color', () => {
    render(<TaskCreatorBadge createdByRole={{ name: 'supervisor', displayName: '', color: null, showBadge: true }} />);
    const badge = screen.getByText('Dibuat oleh supervisor');
    expect(badge).toHaveAttribute('title', 'Dibuat oleh supervisor');
    expect(badge.getAttribute('style')).toContain('color');
  });

  it('adds the compact class for dense table rows', () => {
    render(<TaskCreatorBadge createdByRole={manager} compact />);
    expect(screen.getByText('Dibuat oleh Manager')).toHaveClass('task-creator-badge', 'compact');
  });
});

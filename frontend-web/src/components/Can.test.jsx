import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import Can from './Can';
import { RBAC_CHANGED_EVENT } from '../utils/auth';

const setPermissions = (permissions) => {
  localStorage.setItem('token', 't');
  localStorage.setItem('user', JSON.stringify({ id: 'u1', platform: 'web', permissions }));
};

describe('<Can>', () => {
  beforeEach(() => localStorage.clear());

  it('renders children only with the permission', () => {
    setPermissions(['tasks.view']);
    render(
      <>
        <Can perm="tasks.view"><span>visible</span></Can>
        <Can perm="tasks.delete" fallback={<span>fallback</span>}><span>hidden</span></Can>
      </>
    );

    expect(screen.getByText('visible')).toBeInTheDocument();
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('supports anyOf and allOf', () => {
    setPermissions(['monitoring.view_locations']);
    render(
      <>
        <Can anyOf={['monitoring.view_reports', 'monitoring.view_locations']}><span>any</span></Can>
        <Can allOf={['monitoring.view_reports', 'monitoring.view_locations']}><span>all</span></Can>
      </>
    );

    expect(screen.getByText('any')).toBeInTheDocument();
    expect(screen.queryByText('all')).not.toBeInTheDocument();
  });

  it('re-renders when permissions change (rbac:changed)', () => {
    setPermissions([]);
    render(<Can perm="tasks.create"><span>create</span></Can>);
    expect(screen.queryByText('create')).not.toBeInTheDocument();

    act(() => {
      setPermissions(['tasks.view', 'tasks.create']);
      window.dispatchEvent(new CustomEvent(RBAC_CHANGED_EVENT));
    });

    expect(screen.getByText('create')).toBeInTheDocument();
  });
});

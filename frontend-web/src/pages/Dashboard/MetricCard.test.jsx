import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MetricCard from './MetricCard';

describe('MetricCard Component', () => {
  it('renders title, value, and subtitle correctly', () => {
    render(
      <MetricCard
        title="Total Pegawai"
        value="128"
        subtitle="+12% dari bulan lalu"
        icon="team"
      />
    );

    expect(screen.getByText('Total Pegawai')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('+12% dari bulan lalu')).toBeInTheDocument();
  });

  it('applies dark variant class when variant is dark', () => {
    const { container } = render(
      <MetricCard
        title="Peringatan"
        value="5"
        subtitle="Memerlukan tindakan"
        icon="warning"
        variant="dark"
      />
    );

    const card = container.querySelector('.metric-card');
    expect(card).toHaveClass('metric-card--dark');
    expect(card).toHaveClass('metric-card--warning');
  });
});

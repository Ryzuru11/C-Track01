import React from 'react';
import './ResponsiveTable.css';

/**
 * ResponsiveTable – shared wrapper used by Task, Taken, and UserManagement pages.
 *
 * Props:
 *   loading        {boolean}  – shows spinner instead of table while true
 *   tableClassName {string}   – class applied to <table> (e.g. "task-table")
 *   className      {string}   – extra class on the outer wrapper
 *   maxHeight      {string}   – CSS max-height for the scroll container
 *                               defaults to calc(100vh - 260px) so it fills
 *                               the viewport and shrinks when the window is small
 *   minWidth       {string}   – minimum width of <table> before horizontal scroll kicks in
 *   children       {ReactNode} – <thead> and <tbody> elements
 */
export default function ResponsiveTable({
  loading = false,
  tableClassName = '',
  className = '',
  maxHeight = 'calc(100vh - 260px)',
  minWidth = '640px',
  children,
}) {
  return (
    <div
      className={`rt-wrapper${className ? ` ${className}` : ''}`}
      style={{ maxHeight }}
    >
      {loading ? (
        <div className="rt-loading">
          <div className="rt-spinner" />
          <p>Memuat data...</p>
        </div>
      ) : (
        <table
          className={`rt-table${tableClassName ? ` ${tableClassName}` : ''}`}
          style={{ minWidth }}
        >
          {children}
        </table>
      )}
    </div>
  );
}

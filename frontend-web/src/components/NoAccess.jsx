import React from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../services/api';
import { getCurrentUser, getRoleMeta } from '../utils/auth';
import './NoAccess.css';

/**
 * Shown when the signed-in web user has no page they are allowed to open.
 */
function NoAccess() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const role = getRoleMeta();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="no-access-page" role="alert">
      <div className="no-access-card">
        <div className="no-access-icon" aria-hidden="true">🔒</div>
        <h1>Tidak ada akses</h1>
        <p>
          {user?.name ? <strong>{user.name}</strong> : 'Akun ini'}
          {role?.displayName ? <> ({role.displayName})</> : null} belum memiliki hak akses ke halaman
          mana pun di aplikasi web. Hubungi Superadmin untuk mengatur hak akses role Anda.
        </p>
        <button type="button" className="no-access-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}

export default NoAccess;

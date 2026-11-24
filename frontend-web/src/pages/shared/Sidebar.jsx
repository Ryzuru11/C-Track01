import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { logout, getUserAvatar } from '../../services/api';
import { getSessionTimeRemaining } from '../../utils/auth';
import useAccess from '../../hooks/useAccess';
import './Sidebar.css';

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  // Re-render menus live when permissions change (rbac:updated → /auth/me)
  const { canAccessPage, role } = useAccess();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [userAvatar, setUserAvatar] = useState(null);
  const [sessionTime, setSessionTime] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(() => {
    let store = window.__ctrackUnreadStore;
    if (!store) {
      try {
        const val = localStorage.getItem('ctrack:unread_store');
        store = val ? JSON.parse(val) : {};
      } catch (e) {
        store = {};
      }
    }
    return Object.values(store).reduce((sum, val) => {
      if (!val) return sum;
      if (typeof val === 'number') return sum + val;
      if (Array.isArray(val)) return sum + val.length;
      if (typeof val === 'object') return sum + Object.values(val).reduce((s, c) => s + c, 0);
      return sum;
    }, 0);
  });

  // Track unread notifications total for the "Taken" menu
  useEffect(() => {
    const handleUpdate = (e) => {
      const store = e.detail?.counts || {};
      const total = Object.values(store).reduce((sum, val) => {
        if (!val) return sum;
        if (typeof val === 'number') return sum + val;
        if (Array.isArray(val)) return sum + val.length;
        if (typeof val === 'object') return sum + Object.values(val).reduce((s, c) => s + c, 0);
        return sum;
      }, 0);
      setUnreadTotal(total);
    };

    window.addEventListener('ctrack:unread_total_updated', handleUpdate);
    return () => {
      window.removeEventListener('ctrack:unread_total_updated', handleUpdate);
    };
  }, []);

  // Get user data from localStorage and fetch avatar
  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const user = JSON.parse(userData);
        setCurrentUser(user);

        // Fetch avatar for the user
        if (user.id) {
          console.log(`👤 Fetching avatar for user: ${user.name}`);
          getUserAvatar(user.id)
            .then(avatar => {
              console.log(`✅ Avatar loaded for sidebar`);
              setUserAvatar(avatar);
            })
            .catch(error => {
              console.warn(`Avatar load failed for sidebar:`, error);
              setUserAvatar(null);
            });
        }
      } catch (error) {
        console.error('Error parsing user data:', error);
      }
    }

    // Update session time every minute
    const updateSessionTime = () => {
      setSessionTime(getSessionTimeRemaining());
    };

    updateSessionTime(); // Initial call
    const interval = setInterval(updateSessionTime, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      localStorage.removeItem('isAuthenticated');
      localStorage.removeItem('rememberMe');
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Still redirect to login even if API call fails
      localStorage.removeItem('isAuthenticated');
      localStorage.removeItem('rememberMe');
      navigate('/login');
    }
  };

  const toggleUserMenu = () => {
    setShowUserMenu(!showUserMenu);
  };

  // Define all menu items with their required permissions
  const allMenuItems = [
    {
      icon: '/icon/Control-Panel.png',
      label: 'Dashboard',
      path: '/dashboard',
      permission: 'DASHBOARD'
    },
    {
      icon: '/icon/System-Report.png',
      label: 'Analytics',
      path: '/analytics',
      permission: 'ANALYTICS'
    },
    {
      icon: '/icon/Clipboard.png',
      label: 'Task',
      path: '/task',
      permission: 'TASK'
    },
    {
      icon: '/icon/Audit.png',
      label: 'Taken',
      path: '/taken',
      permission: 'TAKEN'
    },
    {
      icon: '/icon/Add-User-Male.png',
      label: 'Users',
      path: '/users',
      permission: 'USER_MANAGEMENT'
    },
    {
      icon: '/icon/Add-User-Male.png',
      label: 'Teams',
      path: '/teams',
      permission: 'TEAM_MANAGEMENT'
    },
    {
      icon: '/icon/Control-Panel.png',
      label: 'Roles & Akses',
      path: '/roles',
      permission: 'ROLES'
    }
  ];

  // Filter menu items based on user permissions
  const menuItems = allMenuItems.filter(item => canAccessPage(item.permission));

  // AI Assistant item shown in footer
  const aiAssistantItem = {
    icon: '🤖',
    label: 'AI Assistant',
    path: '/chatbot',
    permission: 'CHATBOT'
  };
  const showAIAssistant = canAccessPage(aiAssistantItem.permission);

  // Role display name comes from the server (roleDisplayName), with a slug fallback
  const getUserRoleDisplay = () => {
    if (!currentUser) return 'User';
    return role.displayName;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src="/Ctrack.png" alt="Life media" className="company-logo" />
      </div>

      <nav className="sidebar-nav">
        <ul className="nav-list">
          {menuItems.map((item, index) => (
            <Link
              key={index}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            >
              {item.icon.startsWith('/') ? (
                <img src={item.icon} alt={item.label} className="nav-icon" />
              ) : (
                <span className="nav-icon">{item.icon}</span>
              )}
              <span className="nav-label">{item.label}</span>
              {item.label === 'Taken' && unreadTotal > 0 && (
                <span className="sidebar-unread-badge">{unreadTotal}</span>
              )}
            </Link>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        {showAIAssistant && (
          <Link
            to={aiAssistantItem.path}
            className={`nav-item ${location.pathname === aiAssistantItem.path ? 'active' : ''}`}
            style={{ marginBottom: '1rem' }}
          >
            <span className="nav-icon">{aiAssistantItem.icon}</span>
            <span className="nav-label">{aiAssistantItem.label}</span>
          </Link>
        )}
        <div className="user-profile">
          <div className="user-avatar">
            {userAvatar ? (
              <img
                src={userAvatar}
                alt={currentUser?.name || 'User Avatar'}
                className="user-avatar-image"
                onError={() => {
                  console.warn('Avatar image failed to load, showing fallback');
                  setUserAvatar(null);
                }}
              />
            ) : (
              <span className="user-avatar-fallback">{currentUser?.name?.charAt(0).toUpperCase() || 'U'}</span>
            )}
          </div>
          <div className="user-info">
            <span className="user-name">{currentUser?.name || 'User'}</span>
            <span className="user-role">{getUserRoleDisplay()}</span>
          </div>
          <button className="user-menu" onClick={toggleUserMenu}>⋮</button>
          {showUserMenu && (
            <div className="user-menu-dropdown">
              {sessionTime > 0 && (
                <div className="menu-item session-info">
                  <span className="session-icon">⏱</span>
                  Session: {sessionTime}m
                </div>
              )}
              <button className="menu-item" onClick={handleLogout}>
                <img src="/icon/Logout.png" alt="Logout" className="menu-icon" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;

import React, { useState, useEffect } from 'react';
import { getUserAvatar } from '../../services/api';
import './UserAvatar.css';

/**
 * UserAvatar component with lazy loading and caching
 * Fetches avatar only when component is rendered
 */
function UserAvatar({ userId, userName, size = 'medium', className = '' }) {
  const [avatar, setAvatar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadAvatar = async () => {
      try {
        setLoading(true);
        setError(false);
        
        const avatarData = await getUserAvatar(userId);
        
        if (isMounted) {
          setAvatar(avatarData);
        }
      } catch (err) {
        if (isMounted) {
          setError(true);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (userId) {
      loadAvatar();
    }

    return () => {
      isMounted = false;
    };
  }, [userId]);

  // Helper to ensure avatar has proper data URI prefix
  const formatAvatarSrc = (avatarData) => {
    if (!avatarData) return null;
    
    // If already has data URI prefix, return as-is
    if (avatarData.startsWith('data:image')) {
      return avatarData;
    }
    
    // Otherwise, add JPEG prefix (most common)
    return `data:image/jpeg;base64,${avatarData}`;
  };

  // Get initials from user name
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const sizeClasses = {
    small: 'avatar-small',
    medium: 'avatar-medium',
    large: 'avatar-large',
  };

  return (
    <div className={`user-avatar ${sizeClasses[size]} ${className}`}>
      {loading ? (
        <div className="avatar-skeleton">
          <div className="skeleton-pulse"></div>
        </div>
      ) : avatar && !error ? (
        <img 
          src={formatAvatarSrc(avatar)} 
          alt={userName} 
          className="avatar-image"
          onError={() => setError(true)}
        />
      ) : (
        <div className="avatar-fallback">
          <span>{getInitials(userName)}</span>
        </div>
      )}
    </div>
  );
}

export default UserAvatar;

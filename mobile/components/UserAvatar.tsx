import React, { useState, useEffect } from 'react';
import { View, Text, Image } from 'react-native';
import { getUserAvatar } from '@/services/api';

interface UserAvatarProps {
  userId: string;
  name: string;
  size?: number;
  fallbackBg?: string;
  borderColor?: string;
}

export default function UserAvatar({
  userId,
  name,
  size = 36,
  fallbackBg = '#1d1d1f',
  borderColor,
}: UserAvatarProps) {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (userId) {
      getUserAvatar(userId).then((uri) => {
        if (isMounted && uri) setAvatarUri(uri);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const initials = (name || '?').charAt(0).toUpperCase();
  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: avatarUri ? 'transparent' : fallbackBg,
    ...(borderColor ? { borderWidth: 2, borderColor } : {}),
    overflow: 'hidden' as const,
  };

  return (
    <View style={containerStyle}>
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text style={{ color: '#FFFFFF', fontSize: size * 0.36, fontWeight: '700' }}>
          {initials}
        </Text>
      )}
    </View>
  );
}

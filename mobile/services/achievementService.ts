import api from '@/services/api';

export const getMyAchievement = async () => {
  const response = await api.get('/achievement/me');

  return response.data.data;
};
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { getComments, sendComment } from '../../services/commentService';
import API_URL from '../../config/api.config';

vi.mock('axios');

describe('Mobile Comment Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getComments should fetch comments by reportId', async () => {
    const mockComments = [
      { id: 'c1', content: 'Komentar pertama', reportId: 'rep-123' },
    ];
    (axios.get as any).mockResolvedValueOnce({ data: mockComments });

    const result = await getComments('rep-123');

    expect(axios.get).toHaveBeenCalledWith(`${API_URL}/comments/rep-123`);
    expect(result).toEqual(mockComments);
  });

  it('sendComment should send POST request with Authorization header', async () => {
    const mockResponse = { success: true, id: 'c2' };
    (axios.post as any).mockResolvedValueOnce({ data: mockResponse });

    const result = await sendComment('rep-123', 'Sudah dikerjakan', null, 'mock-jwt-token');

    expect(axios.post).toHaveBeenCalledWith(
      `${API_URL}/comments`,
      {
        reportId: 'rep-123',
        content: 'Sudah dikerjakan',
        parentId: null,
      },
      {
        headers: {
          Authorization: 'Bearer mock-jwt-token',
        },
      }
    );
    expect(result).toEqual(mockResponse);
  });
});

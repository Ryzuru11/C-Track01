import { describe, it, expect } from 'vitest';
import { parseJson, formatTakenTaskResponse, formatTakenTasksResponse } from '../../src/utils/json';

describe('JSON Utils', () => {
  describe('parseJson', () => {
    it('should parse valid JSON strings', () => {
      const data = { key: 'value', numbers: [1, 2, 3] };
      const parsed = parseJson(JSON.stringify(data));
      expect(parsed).toEqual(data);
    });

    it('should return original string if JSON parsing fails', () => {
      const invalidJson = '{ invalid_json: 123 ';
      const result = parseJson(invalidJson);
      expect(result).toBe(invalidJson);
    });

    it('should return non-string inputs as-is', () => {
      expect(parseJson(42)).toBe(42);
      expect(parseJson(null)).toBeNull();
      expect(parseJson(undefined)).toBeUndefined();
    });
  });

  describe('formatTakenTaskResponse', () => {
    it('should parse userIds and userStatuses if they are JSON strings', () => {
      const mockTask = {
        id: 'task-1',
        userIds: '["u1", "u2"]',
        userStatuses: '{"u1": "completed", "u2": "pending"}',
        users: [{ id: 'u1', name: 'User 1' }],
      };

      const result = formatTakenTaskResponse(mockTask);
      expect(result.userIds).toEqual(['u1', 'u2']);
      expect(result.userStatuses).toEqual({ u1: 'completed', u2: 'pending' });
    });

    it('should handle malformed JSON strings gracefully', () => {
      const mockTask = {
        id: 'task-2',
        userIds: 'invalid-json',
        userStatuses: 'invalid-json',
      };

      const result = formatTakenTaskResponse(mockTask);
      expect(result.userIds).toEqual([]);
      expect(result.userStatuses).toEqual({});
    });
  });

  describe('formatTakenTasksResponse', () => {
    it('should format an array of taken tasks', () => {
      const tasks = [
        { id: '1', userIds: '["u1"]', userStatuses: '{}' },
        { id: '2', userIds: '["u2"]', userStatuses: '{}' },
      ];

      const results = formatTakenTasksResponse(tasks);
      expect(results).toHaveLength(2);
      expect(results[0].userIds).toEqual(['u1']);
      expect(results[1].userIds).toEqual(['u2']);
    });
  });
});

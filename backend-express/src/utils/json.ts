/**
 * Utility functions for handling JSON fields in responses
 * Ensures proper parsing and serialization of JSON data
 */

/**
 * Parse a JSON string or return as-is if already parsed
 */
export const parseJson = (value: unknown): unknown => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      console.warn('Failed to parse JSON string:', value);
      return value;
    }
  }
  return value;
};

/**
 * Format a takenTask object with properly parsed JSON fields
 */
export const formatTakenTaskResponse = (takenTask: any) => {
  // Parse userIds
  let parsedUserIds = takenTask.userIds;
  if (typeof takenTask.userIds === 'string') {
    try {
      parsedUserIds = JSON.parse(takenTask.userIds);
    } catch (e) {
      console.warn(`[json.ts] Failed to parse userIds: ${takenTask.userIds}`);
      parsedUserIds = [];
    }
  }

  // Parse userStatuses (critical for multi-user tasks)
  let parsedUserStatuses = takenTask.userStatuses;
  if (typeof takenTask.userStatuses === 'string') {
    try {
      parsedUserStatuses = JSON.parse(takenTask.userStatuses);
    } catch (e) {
      console.warn(`[json.ts] Failed to parse userStatuses: ${takenTask.userStatuses}`);
      parsedUserStatuses = {};
    }
  } else if (!parsedUserStatuses || typeof parsedUserStatuses !== 'object') {
    parsedUserStatuses = {};
  }

  return {
    ...takenTask,
    userIds: parsedUserIds,
    userStatuses: parsedUserStatuses,
    users: takenTask.users || [],
    // Format location timestamps if locations are included
    locations: takenTask.locations ? takenTask.locations.map((loc: any) => ({
      ...loc,
      // Convert recordedAt to proper timezone (MySQL stores as Jakarta time)
      recordedAt: new Date(new Date(loc.recordedAt).getTime() - 7 * 60 * 60 * 1000).toISOString(),
    })) : undefined,
  };
};

/**
 * Format an array of takenTasks with properly parsed JSON fields
 */
export const formatTakenTasksResponse = (takenTasks: any[]) => {
  return takenTasks.map((tt) => formatTakenTaskResponse(tt));
};

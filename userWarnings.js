/**
 * Discord AI Moderation Bot - User Warnings System
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

// In-memory store for user warnings
// In a production environment, this should be replaced with a database
import config from './config.js';

const userWarnings = new Map();

/**
 * Add a warning to a user
 * @param {string} userId - The Discord user ID
 * @param {string} reason - The reason for the warning
 * @param {string} severity - The severity of the violation
 * @returns {Object} - Updated user warning data
 */
export function addWarning(userId, reason, severity) {
  // Get existing warnings or initialize a new record
  const userData = userWarnings.get(userId) || {
    count: 0,
    warnings: [],
    lastWarning: null,
    actionsTaken: []
  };

  // Remove expired warnings if configured
  if (config.warnings.expiresAfterDays > 0) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.warnings.expiresAfterDays);
    
    // Remove warnings older than the cutoff date
    userData.warnings = userData.warnings.filter(warning => {
      const warningDate = new Date(warning.timestamp);
      return warningDate >= cutoffDate;
    });
    
    // Update the count to reflect current valid warnings
    userData.count = userData.warnings.length;
  }

  // Add new warning
  userData.count += 1;
  userData.warnings.push({
    reason,
    severity,
    timestamp: new Date().toISOString()
  });
  userData.lastWarning = new Date();

  // Determine if further action should be taken based on warning count
  const action = determineAction(userData.count);
  if (action) {
    userData.actionsTaken.push({
      type: action,
      timestamp: new Date().toISOString()
    });
  }

  // Save updated data
  userWarnings.set(userId, userData);
  
  // Log if console logging is enabled
  if (config.logging.consoleLog) {
    console.log(`Warning added for user ${userId}. Total warnings: ${userData.count}`);
    if (action) {
      console.log(`Recommended action for user ${userId}: ${action}`);
    }
  }
  
  return {
    userData,
    recommendedAction: action
  };
}

/**
 * Get warnings for a specific user
 * @param {string} userId - The Discord user ID
 * @returns {Object|null} - User warning data or null if not found
 */
export function getUserWarnings(userId) {
  return userWarnings.get(userId) || null;
}

/**
 * Determine what action to take based on warning count
 * @param {number} warningCount - Number of warnings the user has
 * @returns {string|null} - Recommended action or null if no action needed
 */
function determineAction(warningCount) {
  const thresholds = config.warnings.actionThresholds;
  
  // Define escalating actions based on warning count
  if (warningCount >= thresholds.ban) {
    return 'ban';
  } else if (warningCount >= thresholds.kick) {
    return 'kick';
  } else if (warningCount >= thresholds.timeout24h) {
    return 'timeout_24h';
  } else if (warningCount >= thresholds.timeout1h) {
    return 'timeout_1h';
  }
  
  return null;
}

/**
 * Reset warnings for a user (e.g., after a period of good behavior)
 * @param {string} userId - The Discord user ID
 */
export function resetWarnings(userId) {
  userWarnings.delete(userId);
  
  if (config.logging.consoleLog) {
    console.log(`Warnings reset for user ${userId}`);
  }
}

/**
 * Get all users with warnings
 * @returns {Map} - Map of user IDs to their warning data
 */
export function getAllWarnings() {
  return userWarnings;
} 
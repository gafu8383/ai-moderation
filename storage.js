/**
 * Discord AI Moderation Bot - Storage System
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import fs from 'fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';

// Get the directory name where the script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define data storage paths
const DATA_DIR = path.join(__dirname, 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const WARNINGS_FILE = path.join(DATA_DIR, 'warnings.json');

// Initialize storage
let warningsData = new Map();
let autoSaveInterval = null;

/**
 * Ensure the data directory exists
 */
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch (error) {
    // Directory doesn't exist, create it
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
  }
  
  // Ensure backups directory exists
  try {
    await fs.access(BACKUPS_DIR);
  } catch (error) {
    await fs.mkdir(BACKUPS_DIR, { recursive: true });
    console.log(`Created backups directory: ${BACKUPS_DIR}`);
  }
}

/**
 * Create a backup of the warnings file
 * @param {Object} config - The configuration settings
 */
async function createBackup(config) {
  if (!config.storage.createBackups) return;
  
  try {
    // Ensure the warnings file exists
    if (!existsSync(WARNINGS_FILE)) return;
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupFile = path.join(BACKUPS_DIR, `warnings-${timestamp}.json`);
    
    // Copy the file
    await pipeline(
      createReadStream(WARNINGS_FILE),
      createWriteStream(backupFile)
    );
    
    console.log(`Created backup: ${backupFile}`);
    
    // Cleanup old backups if needed
    await cleanupOldBackups(config);
  } catch (error) {
    console.error('Error creating backup:', error);
  }
}

/**
 * Clean up old backup files
 * @param {Object} config - The configuration settings
 */
async function cleanupOldBackups(config) {
  try {
    if (!config.storage.maxBackups) return;
    
    const backupFiles = await fs.readdir(BACKUPS_DIR);
    const jsonBackups = backupFiles.filter(file => file.startsWith('warnings-') && file.endsWith('.json'));
    
    // Sort by name (which includes the timestamp)
    jsonBackups.sort();
    
    // If we have more than the max allowed backups, delete the oldest ones
    if (jsonBackups.length > config.storage.maxBackups) {
      const filesToDelete = jsonBackups.slice(0, jsonBackups.length - config.storage.maxBackups);
      
      for (const file of filesToDelete) {
        await fs.unlink(path.join(BACKUPS_DIR, file));
        console.log(`Deleted old backup: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up old backups:', error);
  }
}

/**
 * Initialize the storage system
 * @param {Object} config - The configuration settings
 */
export async function initStorage(config) {
  await ensureDataDir();
  await loadWarnings();
  
  // Set up auto-save interval if configured
  if (config.storage.autoSaveInterval > 0) {
    // Clear any existing interval
    if (autoSaveInterval) {
      clearInterval(autoSaveInterval);
    }
    
    // Set up new interval (convert minutes to milliseconds)
    const intervalMs = config.storage.autoSaveInterval * 60 * 1000;
    autoSaveInterval = setInterval(async () => {
      console.log('Auto-saving warnings data...');
      await saveWarnings(config);
    }, intervalMs);
    
    console.log(`Auto-save enabled, interval: ${config.storage.autoSaveInterval} minutes`);
  }
  
  // Set up process exit handler to save data on shutdown
  if (config.storage.saveOnShutdown) {
    process.on('SIGINT', async () => {
      console.log('Bot shutting down, saving data...');
      await saveWarnings(config);
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Bot shutting down, saving data...');
      await saveWarnings(config);
      process.exit(0);
    });
  }
}

/**
 * Load warnings data from file
 */
export async function loadWarnings() {
  try {
    await ensureDataDir();
    
    try {
      // Check if file exists before trying to read it
      await fs.access(WARNINGS_FILE);
      
      const data = await fs.readFile(WARNINGS_FILE, 'utf8');
      const jsonData = JSON.parse(data);
      
      // Convert from JSON object to Map
      warningsData = new Map();
      for (const [userId, userData] of Object.entries(jsonData)) {
        warningsData.set(userId, userData);
      }
      
      console.log(`Loaded warnings data for ${warningsData.size} users`);
    } catch (error) {
      // File doesn't exist yet, start with empty data
      warningsData = new Map();
      console.log('No existing warnings data found, starting fresh');
      
      // Save empty data to create the file
      await saveWarnings();
    }
    
    return warningsData;
  } catch (error) {
    console.error('Error loading warnings data:', error);
    return new Map(); // Return empty map in case of error
  }
}

/**
 * Save warnings data to file
 * @param {Object} config - The configuration settings (optional)
 */
export async function saveWarnings(config = null) {
  try {
    await ensureDataDir();
    
    // Create a backup if configured
    if (config && config.storage.createBackups) {
      await createBackup(config);
    }
    
    // Convert Map to a plain object for JSON serialization
    const jsonData = {};
    for (const [userId, userData] of warningsData.entries()) {
      jsonData[userId] = userData;
    }
    
    await fs.writeFile(WARNINGS_FILE, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`Saved warnings data for ${warningsData.size} users`);
    return true;
  } catch (error) {
    console.error('Error saving warnings data:', error);
    return false;
  }
}

/**
 * Get user warnings
 * @param {string} userId - The user ID to get warnings for
 * @returns {Object|null} - User warnings data or null if not found
 */
export function getUserWarnings(userId) {
  return warningsData.get(userId) || null;
}

/**
 * Add a warning to a user and save to disk
 * @param {string} userId - The user ID
 * @param {string} reason - Reason for the warning
 * @param {string} severity - Severity of the warning
 * @param {Object} config - Configuration settings
 * @returns {Object} - Updated user data and recommended action
 */
export async function addWarning(userId, reason, severity, config) {
  // Get existing warnings or initialize a new record
  const userData = warningsData.get(userId) || {
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
  userData.lastWarning = new Date().toISOString();

  // Determine if further action should be taken based on warning count
  const action = determineAction(userData.count, config);
  if (action) {
    userData.actionsTaken.push({
      type: action,
      timestamp: new Date().toISOString()
    });
  }

  // Save updated data
  warningsData.set(userId, userData);
  
  // Log if console logging is enabled
  if (config.logging.consoleLog) {
    console.log(`Warning added for user ${userId}. Total warnings: ${userData.count}`);
    if (action) {
      console.log(`Recommended action for user ${userId}: ${action}`);
    }
  }
  
  // Save to disk
  await saveWarnings(config);
  
  return {
    userData,
    recommendedAction: action
  };
}

/**
 * Reset warnings for a user
 * @param {string} userId - The user ID
 * @param {Object} config - Configuration settings
 */
export async function resetWarnings(userId, config) {
  warningsData.delete(userId);
  
  if (config.logging.consoleLog) {
    console.log(`Warnings reset for user ${userId}`);
  }
  
  // Save to disk
  await saveWarnings(config);
}

/**
 * Get all users with warnings
 * @returns {Map} - Map of user IDs to warning data
 */
export function getAllWarnings() {
  return warningsData;
}

/**
 * Get server statistics for warnings
 * @param {string} guildId - The guild ID to get statistics for
 * @returns {Object} - Warning statistics
 */
export function getServerStatistics(guildId) {
  // Count warnings and actions for this guild
  let totalWarnings = 0;
  let activeUsers = 0;
  let actionsTaken = {
    timeout1h: 0,
    timeout24h: 0,
    kick: 0,
    ban: 0
  };
  
  // For now, we don't track guild IDs in the warnings
  // This would require refactoring the warnings storage
  // So we'll just return global stats
  
  warningsData.forEach(userData => {
    totalWarnings += userData.count;
    activeUsers++;
    
    // Count actions
    userData.actionsTaken.forEach(action => {
      switch(action.type) {
        case 'timeout_1h':
          actionsTaken.timeout1h++;
          break;
        case 'timeout_24h':
          actionsTaken.timeout24h++;
          break;
        case 'kick':
          actionsTaken.kick++;
          break;
        case 'ban':
          actionsTaken.ban++;
          break;
      }
    });
  });
  
  return {
    totalWarnings,
    activeUsers,
    actionsTaken
  };
}

/**
 * Force save all data
 * @param {Object} config - Configuration settings
 */
export async function forceSave(config) {
  return await saveWarnings(config);
}

/**
 * Determine what action to take based on warning count
 * @param {number} warningCount - Number of warnings
 * @param {Object} config - Configuration settings
 * @returns {string|null} - Recommended action
 */
function determineAction(warningCount, config) {
  const thresholds = config.warnings.actionThresholds;
  
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
/**
 * Discord AI Moderation Bot - AI Moderation System
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import config from './config.js';

dotenv.config();

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Moderates a message using Groq's AI
 * @param {string} messageContent - The message content to moderate
 * @returns {Object} - Moderation result with isFlagged, reason, and severity
 */
export async function moderateMessage(messageContent) {
  try {
    // Skip moderation for very short messages
    if (messageContent.trim().length < config.moderation.minMessageLength) {
      return { isFlagged: false, reason: '', severity: 'none' };
    }

    const prompt = `
      You are a content moderator for a Discord server. Your task is to detect inappropriate content.
      The moderation sensitivity level is set to: ${config.moderation.sensitivity * 10}/10 (where 10 is extremely strict).
      
      Analyze the following message and determine if it contains any of these categories:
      - Hate speech or discrimination based on race, gender, sexuality, religion, etc.
      - Explicit sexual content or excessive vulgarity
      - Violent threats or glorification of violence
      - Personal attacks, harassment, or bullying
      - Spam, scams, or malicious links
      - Self-harm or suicide content
      - Personal information sharing (doxxing)
      
      Message to analyze: "${messageContent}"
      
      Respond in JSON format only:
      {
        "isFlagged": true/false,
        "reason": "brief description of violation if flagged",
        "severity": "low/medium/high/none",
        "categories": ["list of violated categories if any"],
        "confidence": 0.0 to 1.0
      }

      Only flag content that is clearly inappropriate. When in doubt, do not flag unless strict mode is enabled.
      Strict mode is currently: ${config.moderation.strictMode ? "ENABLED" : "DISABLED"}.
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      model: config.ai.model,
      temperature: config.ai.temperature,
      max_tokens: config.ai.maxTokens,
      top_p: config.ai.topP,
      response_format: { type: "json_object" }
    });

    // Extract and parse the JSON response
    const responseText = completion.choices[0]?.message?.content || '';
    const moderationResult = JSON.parse(responseText);
    
    // Apply our sensitivity threshold
    let shouldFlag = moderationResult.isFlagged;
    
    // If in strict mode and confidence is high enough, flag even when the AI didn't flag it
    if (!shouldFlag && config.moderation.strictMode && 
        moderationResult.confidence && moderationResult.confidence > 0.4) {
      shouldFlag = true;
      moderationResult.reason = `[Strict mode] ${moderationResult.reason || "Potentially inappropriate content"}`;
    }
    
    // Log decision if enabled
    if (config.logging.logAllDecisions && config.logging.consoleLog) {
      console.log(`Moderation decision for message: ${messageContent.substring(0, 30)}...`);
      console.log(`Decision: ${shouldFlag ? "FLAGGED" : "ALLOWED"}, Reason: ${moderationResult.reason || "N/A"}`);
    }
    
    return {
      isFlagged: shouldFlag,
      reason: moderationResult.reason || "Inappropriate content",
      severity: moderationResult.severity || "medium",
      categories: moderationResult.categories || [],
      confidence: moderationResult.confidence || 0.5
    };
  } catch (error) {
    console.error('Error in AI moderation:', error);
    // Return a safe default if moderation fails
    return { isFlagged: false, reason: '', severity: 'none' };
  }
} 
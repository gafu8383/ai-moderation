/**
 * Discord AI Moderation Bot
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import { Client, GatewayIntentBits, Events, EmbedBuilder, PermissionFlagsBits, REST, Routes, Collection, ActivityType } from 'discord.js';
import dotenv from 'dotenv';
import { moderateMessage } from './moderation.js';
import { addWarning, getUserWarnings, initStorage, getServerStatistics } from './storage.js';
import { commands } from './commands.js';
import config from './config.js';

// Load environment variables
dotenv.config();

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Collection for slash commands
client.commands = new Collection();

// Register all commands
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

// Track recent moderation activities for status display
const recentActivity = {
  lastModeration: null,
  moderationCount: 0,
  resetTime: Date.now()
};

// Handle interactions (slash commands)
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction, config);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}`);
    console.error(error);
    
    const errorReply = {
      content: 'There was an error while executing this command!',
      ephemeral: true
    };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply);
    } else {
      await interaction.reply(errorReply);
    }
  }
});

// When the client is ready, run this code
client.once(Events.ClientReady, async readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  console.log(`Monitoring messages with sensitivity level: ${config.moderation.sensitivity * 10}/10`);
  console.log(`Strict mode: ${config.moderation.strictMode ? "ENABLED" : "DISABLED"}`);
  console.log(`Using Groq model: ${config.ai.model}`);
  
  // Initialize the storage system
  await initStorage(config);
  console.log('Storage system initialized');
  
  // Set up status rotation
  setupStatusRotation(readyClient);
  
  // Register slash commands
  try {
    console.log('Started refreshing application (/) commands.');

    const commandsData = commands.map(command => command.data.toJSON());
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    // Deploy commands to all guilds the bot is in
    await Promise.all(client.guilds.cache.map(async guild => {
      try {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: commandsData },
        );
        console.log(`Successfully registered commands in guild: ${guild.name}`);
      } catch (error) {
        console.error(`Failed to register commands in guild ${guild.name}:`, error);
      }
    }));

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
  
  // Check for mod-logs channels in all guilds if configured to create them
  if (config.logging.createLogChannel) {
    console.log(`Checking for mod-logs channels in all servers...`);
    
    client.guilds.cache.forEach(async (guild) => {
      try {
        // Check if a mod-logs channel already exists
        let logChannelExists = false;
        
        for (const channelName of config.logging.modLogChannels) {
          const existingChannel = guild.channels.cache.find(
            ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
          );
          
          if (existingChannel) {
            logChannelExists = true;
            console.log(`Found existing mod-logs channel in ${guild.name}: ${existingChannel.name}`);
            
            // Send statistics to the mod-logs channel
            try {
              const stats = getServerStatistics(guild.id);
              const statsEmbed = new EmbedBuilder()
                .setColor(config.appearance.colors.info)
                .setTitle('📊 Moderation Statistics')
                .setDescription(`AI moderation system has been restarted.`)
                .addFields(
                  { name: '👥 Active Users', value: `${stats.activeUsers}`, inline: true },
                  { name: '⚠️ Total Warnings', value: `${stats.totalWarnings}`, inline: true },
                  { name: '🔨 Actions Taken', value: 
                    `Timeouts (1h): ${stats.actionsTaken.timeout1h}\n` +
                    `Timeouts (24h): ${stats.actionsTaken.timeout24h}\n` + 
                    `Kicks: ${stats.actionsTaken.kick}\n` +
                    `Bans: ${stats.actionsTaken.ban}`
                  }
                )
                .setFooter({ text: `${readyClient.user.tag} | AI Moderation` })
                .setTimestamp();
                
              await existingChannel.send({ embeds: [statsEmbed] });
            } catch (statsError) {
              console.error(`Error sending statistics to mod-logs channel: ${statsError}`);
            }
            
            break;
          }
        }
        
        // Create mod-logs channel if it doesn't exist
        if (!logChannelExists) {
          await createModLogsChannel(guild, 'Created for AI moderation logs (initialization)');
        }
      } catch (guildError) {
        console.error(`Error processing guild ${guild.name}: ${guildError}`);
      }
    });
  }
});

// Process messages for moderation
client.on(Events.MessageCreate, async message => {
  // Ignore messages from bots (including itself)
  if (message.author.bot) return;
  
  // Check if channel is in ignored list
  if (config.moderation.ignoredChannels.includes(message.channel.id)) return;
  
  // Check if user has an ignored role
  if (message.member && message.member.roles.cache.some(role => 
    config.moderation.ignoredRoles.includes(role.id))) return;
  
  try {
    const moderationResult = await moderateMessage(message.content);
    
    if (moderationResult.isFlagged) {
      // Delete the message if it's flagged
      await message.delete();
      
      // Update recent activity counters
      recentActivity.lastModeration = Date.now();
      recentActivity.moderationCount++;
      
      // Record the warning
      const userId = message.author.id;
      const { userData, recommendedAction } = await addWarning(
        userId, 
        moderationResult.reason, 
        moderationResult.severity,
        config
      );
      
      // Log the action to console
      const channelMessage = `A message from ${message.author.tag} was removed for violating community guidelines.`;
      if (config.logging.consoleLog) {
        console.log(channelMessage);
      }
      
      // Log to mod-logs channel
      await logMessageModeration(
        message.guild,
        message.member,
        message.channel,
        moderationResult,
        userData,
        recommendedAction,
        message.content
      );
      
      // Send an enhanced DM to the user
      try {
        // Choose emoji based on severity
        let severityEmoji = '⚠️';
        let severityColor = config.appearance.colors.warning;
        
        switch(moderationResult.severity.toLowerCase()) {
          case 'high':
            severityEmoji = '🔴';
            severityColor = config.appearance.colors.highSeverity;
            break;
          case 'medium':
            severityEmoji = '🟠';
            severityColor = config.appearance.colors.mediumSeverity;
            break;
          case 'low':
            severityEmoji = '🟡';
            severityColor = config.appearance.colors.lowSeverity;
            break;
          default:
            severityEmoji = '⚠️';
            severityColor = config.appearance.colors.warning;
        }
        
        // Create a warning message based on warning count
        let warningMessage = 'Please be mindful of our community guidelines.';
        if (userData.count >= 3) {
          warningMessage = '**⚠️ Warning:** Continued violations will result in moderation actions.';
        }
        if (userData.count >= 5) {
          warningMessage = '**⛔ Caution:** Your account is at risk of temporary restrictions.';
        }
        if (userData.count >= 7) {
          warningMessage = '**🚫 Final Warning:** Further violations will result in removal from the server.';
        }
        
        const dmEmbed = new EmbedBuilder()
          .setColor(severityColor)
          .setTitle(`${severityEmoji} Your Message Was Moderated`)
          .setDescription(`Your message in ${message.channel} was removed for violating our community guidelines.`)
          .addFields(
            { name: '📝 Reason', value: `\`${moderationResult.reason}\`` },
            { name: `${severityEmoji} Severity`, value: `\`${moderationResult.severity.toUpperCase()}\``, inline: true },
            { name: '🔄 Warning Count', value: `\`${userData.count}\``, inline: true }
          )
          .addFields(
            { name: '⚠️ Notice', value: warningMessage }
          )
          .setFooter({ text: 'AI-powered moderation' })
          .setTimestamp();
        
        await message.author.send({ embeds: [dmEmbed] });
        
        // If this resulted in a moderation action, let them know
        if (recommendedAction) {
          const actionEmbed = new EmbedBuilder()
            .setColor(config.appearance.colors.error)
            .setTitle('🛑 Moderation Action Applied')
            .setDescription(`Due to multiple violations, the following action has been taken:`)
            .addFields(
              { name: '🔨 Action', value: getActionDescription(recommendedAction) }
            )
            .setFooter({ text: 'This action was applied automatically based on your warning history' })
            .setTimestamp();
            
          await message.author.send({ embeds: [actionEmbed] });
        }
      } catch (error) {
        console.log(`Could not send DM to ${message.author.tag}: ${error}`);
        
        // If we can't DM them, send a minimal message in the channel if configured to do so
        if (config.appearance.sendChannelNotificationsWhenDMFails) {
          try {
            const warningMsg = await message.channel.send(`${message.author}, your message was removed for violating community guidelines. Please check server rules.`);
            // Delete the notification after the configured timeout to keep the channel clean
            setTimeout(() => warningMsg.delete().catch(e => {}), config.appearance.channelNotificationTimeout);
          } catch (err) {
            console.error(`Could not send channel notification: ${err}`);
          }
        }
      }
      
      // Take automated actions based on warning count
      if (recommendedAction && message.member) {
        await takeModAction(message.member, recommendedAction, message.guild, moderationResult.reason);
      }
    }
  } catch (error) {
    console.error(`Error moderating message: ${error}`);
  }
});

/**
 * Take a moderation action against a member
 * @param {GuildMember} member - The guild member to take action against
 * @param {string} action - The action to take
 * @param {Guild} guild - The guild where the action should be taken
 * @param {string} reason - The reason for the action
 */
async function takeModAction(member, action, guild, reason) {
  try {
    const fullReason = `AI Moderation: ${reason}`;
    
    switch(action) {
      case 'timeout_1h':
        await member.timeout(60 * 60 * 1000, fullReason); // 1 hour in milliseconds
        logModAction(guild, member, 'timeout (1 hour)', fullReason);
        break;
        
      case 'timeout_24h':
        await member.timeout(24 * 60 * 60 * 1000, fullReason); // 24 hours in milliseconds
        logModAction(guild, member, 'timeout (24 hours)', fullReason);
        break;
        
      case 'kick':
        await member.kick(fullReason);
        logModAction(guild, member, 'kick', fullReason);
        break;
        
      case 'ban':
        await member.ban({ reason: fullReason, deleteMessageSeconds: 60 * 60 * 24 }); // Delete 24h of messages
        logModAction(guild, member, 'ban', fullReason);
        break;
    }
  } catch (error) {
    console.error(`Error taking mod action: ${error}`);
  }
}

/**
 * Log a moderation action to the mod-logs channel (if it exists)
 * @param {Guild} guild - The guild where the action was taken
 * @param {GuildMember} member - The member the action was taken against
 * @param {string} action - The action taken
 * @param {string} reason - The reason for the action
 */
async function logModAction(guild, member, action, reason) {
  // Try to find a channel for mod logs
  let logChannel;
  
  for (const channelName of config.logging.modLogChannels) {
    const channel = guild.channels.cache.find(
      ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
    );
    if (channel) {
      logChannel = channel;
      break;
    }
  }
  
  // If no log channel is found, create a private one if configured to do so
  if (!logChannel && config.logging.createLogChannel) {
    logChannel = await createModLogsChannel(guild, 'Created for AI moderation logs');
    
    // If channel creation failed, log to console and exit
    if (!logChannel) {
      if (config.logging.consoleLog) {
        console.log(`Action: ${action.toUpperCase()} against ${member.user.tag} for: ${reason}`);
      }
      return;
    }
  } else if (!logChannel) {
    // No log channel and not configured to create one
    if (config.logging.consoleLog) {
      console.log(`No log channel found. Action: ${action.toUpperCase()} against ${member.user.tag} for: ${reason}`);
    }
    return;
  }
  
  // Choose color and emoji based on action severity
  let actionColor = config.appearance.colors.warning;
  let actionEmoji = '🛡️';
  
  switch(action.toLowerCase()) {
    case 'timeout (1 hour)':
      actionColor = config.appearance.colors.lowSeverity;
      actionEmoji = '⏱️';
      break;
    case 'timeout (24 hours)':
      actionColor = config.appearance.colors.warning;
      actionEmoji = '⏱️';
      break;
    case 'kick':
      actionColor = config.appearance.colors.mediumSeverity;
      actionEmoji = '👢';
      break;
    case 'ban':
      actionColor = config.appearance.colors.error;
      actionEmoji = '🔨';
      break;
    default:
      actionColor = config.appearance.colors.warning;
      actionEmoji = '🛡️';
  }
  
  // Get member's warnings count
  const warnings = getUserWarnings(member.id);
  const warningCount = warnings ? warnings.count : 0;
  
  // Get account age
  const creationDate = new Date(member.user.createdAt);
  const now = new Date();
  const accountAgeDays = Math.floor((now - creationDate) / (1000 * 60 * 60 * 24));
  const joinDate = new Date(member.joinedAt);
  const serverAgeDays = Math.floor((now - joinDate) / (1000 * 60 * 60 * 24));
  
  const logEmbed = new EmbedBuilder()
    .setColor(actionColor)
    .setTitle(`${actionEmoji} Moderation Action: ${action.toUpperCase()}`)
    .setDescription(`Action taken against ${member.user.tag} (${member.id})`)
    .addFields(
      { name: '👤 User', value: `${member.user.tag} (<@${member.id}>)` },
      { name: '🔨 Action', value: action.toUpperCase(), inline: true },
      { name: '⚠️ Warnings', value: `${warningCount}`, inline: true },
      { name: '📝 Reason', value: reason },
      { name: '🕒 Account Info', value: `Account Age: ${accountAgeDays} days\nServer Member: ${serverAgeDays} days` }
    )
    .setFooter({ text: `Moderator: ${client.user.tag} | AI Moderation` })
    .setTimestamp();
  
  // Include user avatar if available and configured
  if (config.appearance.showUserAvatarsInLogs && member.user.avatarURL()) {
    logEmbed.setThumbnail(member.user.avatarURL());
  }
  
  try {
    await logChannel.send({ embeds: [logEmbed] });
    if (config.logging.consoleLog) {
      console.log(`Successfully logged moderation action in ${logChannel.name}`);
    }
  } catch (sendError) {
    console.error(`Failed to send message to mod-logs channel: ${sendError}`);
  }
}

/**
 * Get a human-readable description of a moderation action
 * @param {string} action - The action code
 * @returns {string} - Descriptive text for the action
 */
function getActionDescription(action) {
  switch(action) {
    case 'timeout_1h':
      return '⏱️ **Timeout (1 hour)** - You have been temporarily muted for 1 hour';
    case 'timeout_24h':
      return '⏱️ **Timeout (24 hours)** - You have been temporarily muted for 24 hours';
    case 'kick':
      return '👢 **Kicked** - You have been removed from the server but may rejoin with an invite';
    case 'ban':
      return '🔨 **Banned** - You have been permanently removed from the server';
    default:
      return `⚠️ **${action}**`;
  }
}

/**
 * Create a mod-logs channel in a guild
 * @param {Guild} guild - The guild to create the channel in
 * @param {string} reason - The reason for creating the channel
 * @returns {Promise<TextChannel|null>} - The created channel or null if failed
 */
async function createModLogsChannel(guild, reason = 'AI moderation logs') {
  try {
    console.log(`Creating mod-logs channel in ${guild.name}...`);
    
    // Create a private channel that only admins and moderators can see
    const logChannel = await guild.channels.create({
      name: 'mod-logs',
      type: 0, // Text channel
      permissionOverwrites: [
        {
          id: guild.id, // @everyone role
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: client.user.id, // Bot's user ID
          allow: [
            PermissionFlagsBits.ViewChannel, 
            PermissionFlagsBits.SendMessages, 
            PermissionFlagsBits.EmbedLinks
          ]
        }
      ],
      reason: reason,
      topic: 'Automatic moderation logs - Do not delete this channel'
    });
    
    console.log(`Successfully created mod-logs channel in ${guild.name}`);
    
    // Set permissions for admin and mod roles
    try {
      const roles = guild.roles.cache.filter(role => 
        role.permissions.has(PermissionFlagsBits.Administrator) || 
        role.permissions.has(PermissionFlagsBits.ModerateMembers)
      );
      
      for (const [id, role] of roles) {
        await logChannel.permissionOverwrites.create(role, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });
        console.log(`Added permissions for role ${role.name} to mod-logs channel`);
      }
    } catch (permError) {
      console.error(`Error setting role permissions: ${permError}`);
      // Continue anyway, at least the bot has access
    }
    
    // Send an initialization message
    const initEmbed = new EmbedBuilder()
      .setColor(config.appearance.colors.info)
      .setTitle('🔄 Moderation System Initialized')
      .setDescription(`AI moderation system is now active in this server.`)
      .addFields(
        { name: '⚙️ Settings', value: `Sensitivity: ${config.moderation.sensitivity * 10}/10\nStrict Mode: ${config.moderation.strictMode ? "Enabled" : "Disabled"}` },
        { name: '📊 Monitoring', value: 'The bot will automatically moderate messages for inappropriate content.' }
      )
      .setFooter({ text: `${client.user.tag} | AI Moderation` })
      .setTimestamp();
      
    await logChannel.send({ embeds: [initEmbed] });
    
    return logChannel;
  } catch (error) {
    console.error(`Error creating mod-logs channel in ${guild.name}: ${error}`);
    
    // Try fallback method with simpler settings
    try {
      console.log(`Attempting to create fallback mod-logs channel in ${guild.name}...`);
      
      // Create a basic channel without complex permission overwrites
      const logChannel = await guild.channels.create({
        name: 'mod-logs',
        reason: `${reason} (fallback method)`
      });
      
      // Then try to set it to private after creation
      await logChannel.permissionOverwrites.create(guild.id, { ViewChannel: false });
      await logChannel.permissionOverwrites.create(client.user.id, { ViewChannel: true, SendMessages: true });
      
      console.log(`Created fallback mod-logs channel in ${guild.name}`);
      
      // Add permissions for admin roles in a simpler way
      const adminRole = guild.roles.cache.find(role => 
        role.permissions.has(PermissionFlagsBits.Administrator)
      );
      
      if (adminRole) {
        await logChannel.permissionOverwrites.create(adminRole, { ViewChannel: true });
      }
      
      // Send a simple initialization message
      const initEmbed = new EmbedBuilder()
        .setColor(config.appearance.colors.info)
        .setTitle('🔄 Moderation System Initialized')
        .setDescription(`AI moderation system is now active in this server.`)
        .setFooter({ text: `${client.user.tag} | AI Moderation` })
        .setTimestamp();
        
      await logChannel.send({ embeds: [initEmbed] });
      
      return logChannel;
    } catch (fallbackError) {
      console.error(`Failed to create fallback mod-logs channel: ${fallbackError}`);
      return null;
    }
  }
}

// Handle when bot is added to a new guild
client.on(Events.GuildCreate, async guild => {
  console.log(`Bot was added to a new server: ${guild.name}`);
  
  // Check if we should create a mod-logs channel
  if (config.logging.createLogChannel) {
    // Check if a mod-logs channel already exists
    let logChannelExists = false;
    
    for (const channelName of config.logging.modLogChannels) {
      const existingChannel = guild.channels.cache.find(
        ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
      );
      
      if (existingChannel) {
        logChannelExists = true;
        console.log(`Found existing mod-logs channel in ${guild.name}: ${existingChannel.name}`);
        
        // Send a welcome message to the existing channel
        try {
          const welcomeEmbed = new EmbedBuilder()
            .setColor(config.appearance.colors.info)
            .setTitle('🔄 AI Moderation Bot Added')
            .setDescription(`Thank you for adding the AI Moderation Bot to your server!`)
            .addFields(
              { name: '⚙️ Settings', value: `Sensitivity: ${config.moderation.sensitivity * 10}/10\nStrict Mode: ${config.moderation.strictMode ? "Enabled" : "Disabled"}` },
              { name: '📊 Status', value: 'The bot is now monitoring messages for inappropriate content.' }
            )
            .setFooter({ text: `${client.user.tag} | AI Moderation` })
            .setTimestamp();
            
          await existingChannel.send({ embeds: [welcomeEmbed] });
        } catch (error) {
          console.error(`Error sending welcome message to existing mod-logs channel: ${error}`);
        }
        
        break;
      }
    }
    
    // Create a new mod-logs channel if none exists
    if (!logChannelExists) {
      const channel = await createModLogsChannel(guild, 'Created for AI moderation logs (new server)');
      
      if (channel) {
        console.log(`Created mod-logs channel in new server ${guild.name}`);
      } else {
        console.error(`Failed to create mod-logs channel in new server ${guild.name}`);
      }
    }
  }
});

/**
 * Log a message moderation action to the mod-logs channel
 * @param {Guild} guild - The guild where the message was moderated
 * @param {GuildMember} member - The member whose message was moderated
 * @param {TextChannel} channel - The channel where the message was posted
 * @param {Object} modResult - The moderation result object
 * @param {Object} userData - The user's warning data
 * @param {string|null} recommendedAction - The recommended action to take
 * @param {string} messageContent - The content of the moderated message
 */
async function logMessageModeration(guild, member, channel, modResult, userData, recommendedAction, messageContent) {
  // Find the mod logs channel
  let logChannel;
  
  for (const channelName of config.logging.modLogChannels) {
    const foundChannel = guild.channels.cache.find(
      ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
    );
    if (foundChannel) {
      logChannel = foundChannel;
      break;
    }
  }
  
  // If no log channel is found, create a private one if configured to do so
  if (!logChannel && config.logging.createLogChannel) {
    logChannel = await createModLogsChannel(guild, 'Created for AI moderation logs');
    
    // If channel creation failed, exit
    if (!logChannel) return;
  } else if (!logChannel) {
    // No log channel and not configured to create one
    return;
  }
  
  // Choose color based on severity
  let severityColor;
  switch(modResult.severity.toLowerCase()) {
    case 'high':
      severityColor = config.appearance.colors.highSeverity;
      break;
    case 'medium':
      severityColor = config.appearance.colors.mediumSeverity;
      break;
    case 'low':
      severityColor = config.appearance.colors.lowSeverity;
      break;
    default:
      severityColor = config.appearance.colors.warning;
  }
  
  // Create message log embed
  const logEmbed = new EmbedBuilder()
    .setColor(severityColor)
    .setTitle('🛡️ Message Moderated')
    .setDescription(`A message by ${member.user.tag} was removed from ${channel}.`)
    .addFields(
      { name: '👤 User', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: '📊 Warning Count', value: `${userData.count}`, inline: true },
      { name: '⚠️ Severity', value: modResult.severity.toUpperCase(), inline: true },
      { name: '📝 Reason', value: modResult.reason }
    )
    .setFooter({ text: `AI Moderation | User ID: ${member.id}` })
    .setTimestamp();
  
  // Include message content if configured
  if (config.logging.includeMessageContent && messageContent) {
    let contentToShow = messageContent;
    
    // Censor content if configured
    if (config.logging.censorMessageContent) {
      // Simple censoring by replacing potentially offensive words with asterisks
      // In a real implementation, use a more sophisticated filter
      contentToShow = contentToShow.replace(/(\w{1})(\w+)/g, (match, first, rest) => {
        return first + rest.replace(/./g, '*');
      });
    }
    
    // Truncate if too long
    const maxLength = config.logging.maxContentLength || 1024;
    if (contentToShow.length > maxLength) {
      contentToShow = contentToShow.substring(0, maxLength - 3) + '...';
    }
    
    logEmbed.addFields({ name: '📋 Message Content', value: contentToShow });
  }
  
  // Include user avatar if configured
  if (config.appearance.showUserAvatarsInLogs && member.user.avatarURL()) {
    logEmbed.setThumbnail(member.user.avatarURL());
  }
  
  // Add recommended action field if applicable
  if (recommendedAction) {
    logEmbed.addFields({
      name: '🔨 Recommended Action',
      value: getActionDescription(recommendedAction)
    });
  }
  
  try {
    await logChannel.send({ embeds: [logEmbed] });
    if (config.logging.consoleLog) {
      console.log(`Message moderation logged to ${logChannel.name}`);
    }
  } catch (error) {
    console.error(`Error sending message moderation log: ${error}`);
  }
}

/**
 * Sets up rotating status messages for the bot
 * @param {Client} client - The Discord.js client
 */
function setupStatusRotation(client) {
  // Default status objects with type and text
  const defaultStatuses = [
    { type: ActivityType.Watching, text: 'for violations' },
    { type: ActivityType.Listening, text: 'to conversations' },
    { type: ActivityType.Playing, text: `with {serverCount} servers` },
    { type: ActivityType.Watching, text: `sensitivity: {sensitivity}` },
    { type: ActivityType.Custom, text: `AI Moderation Active` },
    { type: ActivityType.Watching, text: `strict mode: {strictMode}` },
    { type: ActivityType.Watching, text: `{recentActivity}` },
  ];

  // Use custom statuses from config if available, otherwise use defaults
  let statuses = defaultStatuses;
  
  if (config.appearance.customStatuses && config.appearance.customStatuses.length > 0) {
    // Convert string types to ActivityType enum values
    statuses = config.appearance.customStatuses.map(status => {
      const activityTypeKey = status.type.toUpperCase();
      return {
        type: ActivityType[activityTypeKey] || ActivityType.Custom,
        text: status.text
      };
    });
  }

  // Set initial status
  updateStatus(client, statuses[0]);

  // Set up the rotation interval
  let currentIndex = 0;
  setInterval(() => {
    currentIndex = (currentIndex + 1) % statuses.length;
    
    // Update dynamic status elements
    const currentStatus = {...statuses[currentIndex]};
    
    // Update server count for the Playing status
    if (currentStatus.text.includes('{serverCount}')) {
      currentStatus.text = currentStatus.text.replace('{serverCount}', client.guilds.cache.size);
    }
    
    // Update sensitivity for status that shows sensitivity
    if (currentStatus.text.includes('{sensitivity}')) {
      currentStatus.text = currentStatus.text.replace('{sensitivity}', `${config.moderation.sensitivity * 10}/10`);
    }
    
    // Update strict mode status
    if (currentStatus.text.includes('{strictMode}')) {
      currentStatus.text = currentStatus.text.replace('{strictMode}', config.moderation.strictMode ? "ON" : "OFF");
    }
    
    // Update recent activity status
    if (currentStatus.text.includes('{recentActivity}')) {
      // Reset counter if it's been more than an hour
      if (Date.now() - recentActivity.resetTime > 3600000) {
        recentActivity.moderationCount = 0;
        recentActivity.resetTime = Date.now();
      }
      
      const minutesSinceLastAction = recentActivity.lastModeration ? 
        Math.floor((Date.now() - recentActivity.lastModeration) / 60000) : null;
      
      let activityText;
      if (recentActivity.moderationCount === 0) {
        activityText = "all clear";
      } else if (minutesSinceLastAction !== null && minutesSinceLastAction < 10) {
        activityText = `${recentActivity.moderationCount} flags (active)`;
      } else {
        activityText = `${recentActivity.moderationCount} flags this hour`;
      }
      
      currentStatus.text = currentStatus.text.replace('{recentActivity}', activityText);
    }
    
    updateStatus(client, currentStatus);
  }, config.appearance.statusRotationInterval || 60000); // Default to 1 minute if not configured
}

/**
 * Updates the bot's status
 * @param {Client} client - The Discord.js client 
 * @param {Object} status - Status object with type and text
 */
function updateStatus(client, status) {
  client.user.setActivity(status.text, { type: status.type });
  if (config.logging.consoleLog) {
    console.log(`Status updated: ${status.text} (${ActivityType[status.type]})`);
  }
}

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN); 
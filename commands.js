/**
 * Discord AI Moderation Bot - Commands
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getUserWarnings, resetWarnings, getAllWarnings, forceSave, getServerStatistics } from './storage.js';

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('View warnings for a user')
      .addUserOption(option => 
        option.setName('user')
          .setDescription('The user to check warnings for')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
    async execute(interaction, config) {
      const user = interaction.options.getUser('user');
      const warnings = getUserWarnings(user.id);
      
      if (!warnings || warnings.count === 0) {
        return interaction.reply({
          content: `${user.tag} has no warnings.`,
          ephemeral: true
        });
      }
      
      const embed = new EmbedBuilder()
        .setColor(config.appearance.colors.info)
        .setTitle(`Warning History for ${user.tag}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: 'Total Warnings', value: `${warnings.count}`, inline: true },
          { name: 'Last Warning', value: formatDate(warnings.lastWarning), inline: true }
        )
        .setFooter({ text: 'AI Moderation System' })
        .setTimestamp();
      
      // Add up to 10 most recent warnings
      const recentWarnings = warnings.warnings.slice(-10).reverse();
      
      if (recentWarnings.length > 0) {
        let warningsText = '';
        recentWarnings.forEach((warning, index) => {
          warningsText += `**${index + 1}.** ${formatDate(warning.timestamp)}\n`;
          warningsText += `⟶ Reason: ${warning.reason}\n`;
          warningsText += `⟶ Severity: ${warning.severity}\n\n`;
        });
        
        embed.addFields({ name: 'Recent Warnings', value: warningsText });
      }
      
      // Add actions taken
      if (warnings.actionsTaken && warnings.actionsTaken.length > 0) {
        let actionsText = '';
        warnings.actionsTaken.forEach((action, index) => {
          actionsText += `**${index + 1}.** ${formatActionType(action.type)} - ${formatDate(action.timestamp)}\n`;
        });
        
        embed.addFields({ name: 'Actions Taken', value: actionsText });
      }
      
      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }
  },
  
  {
    data: new SlashCommandBuilder()
      .setName('clearwarnings')
      .setDescription('Clear all warnings for a user')
      .addUserOption(option => 
        option.setName('user')
          .setDescription('The user to clear warnings for')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
    async execute(interaction, config) {
      const user = interaction.options.getUser('user');
      const warnings = getUserWarnings(user.id);
      
      if (!warnings || warnings.count === 0) {
        return interaction.reply({
          content: `${user.tag} has no warnings to clear.`,
          ephemeral: true
        });
      }
      
      await resetWarnings(user.id, config);
      
      return interaction.reply({
        content: `Cleared all warnings for ${user.tag}.`,
        ephemeral: true
      });
    }
  },
  
  {
    data: new SlashCommandBuilder()
      .setName('modstats')
      .setDescription('View moderation statistics')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
    async execute(interaction, config) {
      const stats = getServerStatistics(interaction.guild.id);
      
      const embed = new EmbedBuilder()
        .setColor(config.appearance.colors.info)
        .setTitle('Moderation Statistics')
        .addFields(
          { name: 'Total Users with Warnings', value: `${stats.activeUsers}`, inline: true },
          { name: 'Total Warnings Issued', value: `${stats.totalWarnings}`, inline: true },
          { name: 'Actions Taken', value: 
            `Timeouts (1h): ${stats.actionsTaken.timeout1h}\n` +
            `Timeouts (24h): ${stats.actionsTaken.timeout24h}\n` + 
            `Kicks: ${stats.actionsTaken.kick}\n` +
            `Bans: ${stats.actionsTaken.ban}`
          }
        )
        .setFooter({ text: 'AI Moderation System' })
        .setTimestamp();
      
      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }
  },
  
  {
    data: new SlashCommandBuilder()
      .setName('forcesave')
      .setDescription('Force save all warning data')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction, config) {
      await interaction.deferReply({ ephemeral: true });
      
      const saved = await forceSave(config);
      
      if (saved) {
        return interaction.editReply({
          content: 'Successfully saved all warning data.',
          ephemeral: true
        });
      } else {
        return interaction.editReply({
          content: 'Failed to save warning data. Check console for details.',
          ephemeral: true
        });
      }
    }
  }
];

// Helper function to format dates
function formatDate(dateString) {
  const date = new Date(dateString);
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

// Helper function to format action types
function formatActionType(actionType) {
  switch (actionType) {
    case 'timeout_1h':
      return 'Timeout (1 hour)';
    case 'timeout_24h':
      return 'Timeout (24 hours)';
    case 'kick':
      return 'Kick';
    case 'ban':
      return 'Ban';
    default:
      return actionType;
  }
} 
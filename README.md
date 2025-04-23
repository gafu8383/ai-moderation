# Discord AI Moderation Bot

A powerful Discord bot that automatically moderates messages using the Groq API for AI-based content analysis. The bot detects inappropriate content, including hate speech, explicit content, harassment, and more, without requiring any manual commands.

## Features

- **Automatic Message Moderation**: Analyzes all messages in real-time using Groq's AI models
- **Configurable Sensitivity**: Adjust how strict the moderation should be
- **Graduated Warning System**: Tracks user warnings with automatic escalating actions
- **Automatic Actions**: Timeouts, kicks, and bans based on violation history
- **Detailed Logging**: Records all moderation actions in private mod-logs channels
- **Auto-create Moderation Logs**: Creates a private mod-logs channel automatically if one doesn't exist
- **Dual Notifications**: Sends moderation notices to both user DMs and staff mod-logs
- **Status Rotation**: Displays dynamic bot status messages that rotate periodically
- **Persistent Storage**: Local file storage with automatic backups
- **Slash Commands**: Moderator commands for checking and managing warnings
- **Customizable Settings**: Extensive configuration options

## Setup

### Prerequisites

- Node.js 16.9.0 or higher
- A Discord bot token
- A Groq API key

### Installation

1. Clone the repository:
```
git clone https://github.com/friday2su/ai-moderation.git
cd ai-moderation
```

2. Install dependencies:
```
npm install
```

3. Configure your environment variables:
   - Rename `.env.example` to `.env`
   - Add your Discord bot token and Groq API key:
   ```
   DISCORD_TOKEN=your_discord_bot_token
   GROQ_API_KEY=your_groq_api_key
   ```

4. Start the bot:
```
npm start
```

### Creating a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" tab and click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - MESSAGE CONTENT INTENT
   - SERVER MEMBERS INTENT
5. Copy your bot token and add it to the `.env` file
6. Go to OAuth2 > URL Generator, select:
   - Scopes: bot, applications.commands
   - Bot Permissions: 
     - Read Messages/View Channels
     - Send Messages
     - Manage Messages
     - Kick Members
     - Ban Members
     - Moderate Members
     - Read Message History
     - Manage Channels (needed to create mod-log channels)
7. Use the generated URL to invite the bot to your server

### Getting a Groq API Key

1. Sign up for an account at [Groq](https://console.groq.com/)
2. Generate an API key from your dashboard
3. Add the API key to your `.env` file

## Configuration

The bot is highly configurable through the `config.js` file:

### Moderation Settings

- `strictMode`: Set to `true` for stricter moderation
- `ignoredChannels`: Array of channel IDs to skip moderation
- `ignoredRoles`: Array of role IDs that are exempt from moderation
- `sensitivity`: Value between 0-1 controlling moderation sensitivity

### Logging Settings

- `modLogChannels`: Channel names to look for when logging moderation actions
- `createLogChannel`: When set to `true`, the bot will automatically create a private mod-logs channel if none exists
- `logAllDecisions`: Whether to log all moderation decisions
- `includeMessageContent`: Whether to include the moderated message content in logs
- `censorMessageContent`: Whether to censor potentially offensive words in log messages
- `maxContentLength`: Maximum length of message content to show in logs

### Status Rotation Settings

- `statusRotationInterval`: How often to rotate the bot's status messages (in milliseconds)
- `customStatuses`: Array of custom status objects to display, with format:
  ```js
  { type: "WATCHING", text: "for violations" }
  ```
  - Valid types: `PLAYING`, `STREAMING`, `LISTENING`, `WATCHING`, `CUSTOM`, `COMPETING`
  - Dynamic placeholders:
    - `{serverCount}` - Number of servers the bot is in
    - `{sensitivity}` - Current moderation sensitivity level
    - `{strictMode}` - Whether strict mode is enabled (ON/OFF)
    - `{recentActivity}` - Shows recent moderation activity with formats:
      - "all clear" - when no flags in the last hour
      - "X flags (active)" - when flagged messages in the last 10 minutes
      - "X flags this hour" - summary of flags in the current hour

### Storage Settings

- `autoSaveInterval`: How often to save data to disk (in minutes)
- `createBackups`: Whether to create backups before overwriting data files
- `maxBackups`: Maximum number of backup files to keep
- `saveOnShutdown`: Whether to save data when the bot shuts down

### Warning System

- `expiresAfterDays`: Days until warnings expire (set to 0 for no expiration)
- `actionThresholds`: Warning counts that trigger different moderation actions

### Advanced Settings

See `config.js` for all available configuration options.

## Moderation Commands

The bot provides several slash commands for moderators:

- `/warnings <user>`: View the warning history for a specific user
- `/clearwarnings <user>`: Clear all warnings for a specific user
- `/modstats`: View moderation statistics for the server
- `/forcesave`: Force save all warning data to disk (requires Admin permissions)

## Data Storage

Warning data is stored locally in the `data` directory:

- `warnings.json`: Contains all user warnings and action history
- `backups/`: Contains automatic backups created before overwriting data

The storage system includes:
- Automatic saving at configurable intervals
- File backups with rotation
- Graceful shutdown to prevent data loss

## License

MIT

## Credits

Made By Friday | Powered By Cortex Realm 

Support Server: [Join Here](https://discord.gg/EWr3GgP6fe)

Copyright (c) 2025 Friday | Cortex Realm 
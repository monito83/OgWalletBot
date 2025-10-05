# 🤖 Discord OG Wallet Verification Bot

A Discord bot that allows users to verify their wallet addresses against an OG list and automatically receive OG roles.

## ✨ Features

- ✅ Automatic wallet verification
- 🎭 Automatic OG role assignment
- 📝 Verification logging system
- 🔧 Admin management commands
- 📁 Bulk wallet upload from files
- 🛡️ Permission validation

## 📋 Available Commands

### For Users:
- `/verify <wallet>` - Verify your wallet and get OG role if eligible

### For Administrators:
- `/add-wallet <wallet>` - Add a wallet to OG list
- `/remove-wallet <wallet>` - Remove a wallet from OG list
- `/list-wallets` - List all OG wallets
- `/upload-wallets <file>` - Upload a .txt file with multiple OG wallets
- `/help` - Show bot help

## 🚀 Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env`
   - Add your Discord bot token to `DISCORD_TOKEN`

3. **Get Discord bot token:**
   - Go to https://discord.com/developers/applications
   - Create a new application
   - Go to 'Bot' and create a bot
   - Copy the token and paste it in your `.env` file

4. **Invite bot to your server:**
   - Go to 'OAuth2' > 'URL Generator'
   - Select 'bot' and 'applications.commands'
   - Copy the generated URL and use it to invite the bot

5. **Run the bot:**
   ```bash
   npm start
   ```

## 📁 File Structure

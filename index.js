const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ]
});

// Configuration
const CONFIG = {
    OG_ROLE_NAME: 'OG',
    OG_WALLETS_FILE: './og_wallets.txt',
    VERIFIED_WALLETS_FILE: './verified_wallets.json',
    LOG_CHANNEL_NAME: 'verifications'
};

// OG wallets list
let ogWallets = new Set();

// Verified wallets tracking (wallet -> user info)
let verifiedWallets = new Map();

// Load OG wallets from file
function loadOGWallets() {
    try {
        if (fs.existsSync(CONFIG.OG_WALLETS_FILE)) {
            const data = fs.readFileSync(CONFIG.OG_WALLETS_FILE, 'utf8');
            const wallets = data.split('\n').map(wallet => wallet.trim().toLowerCase()).filter(wallet => wallet);
            ogWallets = new Set(wallets);
            console.log(`✅ Loaded ${ogWallets.size} OG wallets`);
        } else {
            console.log('⚠️ OG wallets file not found, creating empty one...');
            fs.writeFileSync(CONFIG.OG_WALLETS_FILE, '');
        }
    } catch (error) {
        console.error('❌ Error loading OG wallets:', error);
    }
}

// Save OG wallets to file
function saveOGWallets() {
    try {
        const walletsArray = Array.from(ogWallets).join('\n');
        fs.writeFileSync(CONFIG.OG_WALLETS_FILE, walletsArray);
        console.log(`✅ OG wallets saved: ${ogWallets.size} wallets`);
    } catch (error) {
        console.error('❌ Error saving OG wallets:', error);
    }
}

// Load verified wallets from file
function loadVerifiedWallets() {
    try {
        if (fs.existsSync(CONFIG.VERIFIED_WALLETS_FILE)) {
            const data = fs.readFileSync(CONFIG.VERIFIED_WALLETS_FILE, 'utf8');
            const verified = JSON.parse(data);
            verifiedWallets = new Map(Object.entries(verified));
            console.log(`✅ Loaded ${verifiedWallets.size} verified wallets`);
        } else {
            console.log('⚠️ Verified wallets file not found, creating empty one...');
            fs.writeFileSync(CONFIG.VERIFIED_WALLETS_FILE, '{}');
        }
    } catch (error) {
        console.error('❌ Error loading verified wallets:', error);
    }
}

// Save verified wallets to file
function saveVerifiedWallets() {
    try {
        const verifiedObj = Object.fromEntries(verifiedWallets);
        fs.writeFileSync(CONFIG.VERIFIED_WALLETS_FILE, JSON.stringify(verifiedObj, null, 2));
        console.log(`✅ Verified wallets saved: ${verifiedWallets.size} wallets`);
    } catch (error) {
        console.error('❌ Error saving verified wallets:', error);
    }
}

// Check if wallet is in OG list
function isOGWallet(wallet) {
    return ogWallets.has(wallet.toLowerCase().trim());
}

// Check if wallet is already verified by another user
function isWalletVerified(wallet) {
    return verifiedWallets.has(wallet.toLowerCase().trim());
}

// Get user info for verified wallet
function getWalletOwner(wallet) {
    return verifiedWallets.get(wallet.toLowerCase().trim());
}

// Mark wallet as verified by user
function markWalletVerified(wallet, userId, username, timestamp) {
    verifiedWallets.set(wallet.toLowerCase().trim(), {
        userId: userId,
        username: username,
        verifiedAt: timestamp
    });
    saveVerifiedWallets();
}

// Create OG role if it doesn't exist
async function ensureOGRole(guild) {
    try {
        let ogRole = guild.roles.cache.find(role => role.name === CONFIG.OG_ROLE_NAME);
        
        if (!ogRole) {
            ogRole = await guild.roles.create({
                name: CONFIG.OG_ROLE_NAME,
                color: '#FFD700',
                permissions: [],
                mentionable: false,
                reason: 'OG role created automatically by bot'
            });
            console.log(`✅ OG role created in ${guild.name}`);
        }
        
        return ogRole;
    } catch (error) {
        console.error('❌ Error creating OG role:', error);
        return null;
    }
}

// Create log channel if it doesn't exist
async function ensureLogChannel(guild) {
    try {
        let logChannel = guild.channels.cache.find(channel => 
            channel.name === CONFIG.LOG_CHANNEL_NAME && channel.type === 0
        );
        
        if (!logChannel) {
            logChannel = await guild.channels.create({
                name: CONFIG.LOG_CHANNEL_NAME,
                type: 0,
                topic: 'Channel for OG wallet verification logs',
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone,
                        deny: [PermissionFlagsBits.SendMessages],
                        allow: [PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ViewChannel]
                    }
                ]
            });
            console.log(`✅ Log channel created in ${guild.name}`);
        }
        
        return logChannel;
    } catch (error) {
        console.error('❌ Error creating log channel:', error);
        return null;
    }
}

// Verify wallet command
async function verifyWallet(interaction) {
    const wallet = interaction.options.getString('wallet');
    
    if (!wallet) {
        return await interaction.reply({
            content: '❌ Please provide a valid wallet address.',
            ephemeral: true
        });
    }
    
    if (wallet.length < 20 || wallet.length > 100) {
        return await interaction.reply({
            content: '❌ The wallet address doesn\'t seem valid. Must be between 20 and 100 characters.',
            ephemeral: true
        });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    const walletLower = wallet.toLowerCase().trim();
    const member = interaction.member;
    const guild = interaction.guild;
    
    // Check if wallet is already verified by another user
    if (isWalletVerified(wallet)) {
        const ownerInfo = getWalletOwner(wallet);
        const ownerUsername = ownerInfo ? ownerInfo.username : 'Usuario desconocido';
        
        return await interaction.editReply({
            content: `❌ **Wallet ya verificada**\n\nLa wallet \`${wallet}\` ya fue verificada por **${ownerUsername}** y tiene el rol OG.\n\nCada wallet solo puede ser verificada por un usuario.`
        });
    }
    
    const isOG = isOGWallet(wallet);
    
    try {
        const ogRole = await ensureOGRole(guild);
        const logChannel = await ensureLogChannel(guild);
        
        if (isOG) {
            if (!member.roles.cache.has(ogRole.id)) {
                await member.roles.add(ogRole);
                
                // Mark wallet as verified by this user
                markWalletVerified(wallet, member.user.id, member.user.tag, new Date().toISOString());
                
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('✅ OG Verification Successful')
                        .setDescription(`**User:** ${member.user.tag}\n**Wallet:** \`${wallet}\`\n**Role granted:** ${ogRole.name}`)
                        .setColor('#00FF00')
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [embed] });
                }
                
                await interaction.editReply({
                    content: `🎉 **¡Felicidades!** Tu wallet \`${wallet}\` está en la lista OG y has recibido el rol **${CONFIG.OG_ROLE_NAME}**.\n\n⚠️ **Importante:** Esta wallet ahora está vinculada a tu cuenta y no puede ser verificada por otro usuario.`
                });
            } else {
                await interaction.editReply({
                    content: `✅ Tu wallet \`${wallet}\` está verificada y ya tienes el rol **${CONFIG.OG_ROLE_NAME}**.`
                });
            }
        } else {
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ OG Verification Failed')
                    .setDescription(`**User:** ${member.user.tag}\n**Wallet:** \`${wallet}\`\n**Reason:** Wallet not in OG list`)
                    .setColor('#FF0000')
                    .setTimestamp();
                
                await logChannel.send({ embeds: [embed] });
            }
            
            await interaction.editReply({
                content: `❌ Sorry, your wallet \`${wallet}\` is not in the OG list. If you believe this is an error, contact an administrator.`
            });
        }
    } catch (error) {
        console.error('❌ Error in verification:', error);
        await interaction.editReply({
            content: '❌ An error occurred during verification. Please try again later.'
        });
    }
}

// Admin command - add OG wallet
async function addOGWallet(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }
    
    const wallet = interaction.options.getString('wallet');
    
    if (!wallet) {
        return await interaction.reply({
            content: '❌ Please provide a valid wallet address.',
            ephemeral: true
        });
    }
    
    const walletLower = wallet.toLowerCase().trim();
    
    if (ogWallets.has(walletLower)) {
        return await interaction.reply({
            content: `⚠️ The wallet \`${wallet}\` is already in the OG list.`,
            ephemeral: true
        });
    }
    
    ogWallets.add(walletLower);
    saveOGWallets();
    
    await interaction.reply({
        content: `✅ Wallet \`${wallet}\` successfully added to OG list.`,
        ephemeral: true
    });
}

// Admin command - remove OG wallet
async function removeOGWallet(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }
    
    const wallet = interaction.options.getString('wallet');
    
    if (!wallet) {
        return await interaction.reply({
            content: '❌ Please provide a valid wallet address.',
            ephemeral: true
        });
    }
    
    const walletLower = wallet.toLowerCase().trim();
    
    if (!ogWallets.has(walletLower)) {
        return await interaction.reply({
            content: `⚠️ The wallet \`${wallet}\` is not in the OG list.`,
            ephemeral: true
        });
    }
    
    ogWallets.delete(walletLower);
    saveOGWallets();
    
    await interaction.reply({
        content: `✅ Wallet \`${wallet}\` successfully removed from OG list.`,
        ephemeral: true
    });
}

// Admin command - list OG wallets
async function listOGWallets(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }
    
    const wallets = Array.from(ogWallets);
    
    if (wallets.length === 0) {
        return await interaction.reply({
            content: '📝 The OG wallets list is empty.',
            ephemeral: true
        });
    }
    
    const chunks = [];
    for (let i = 0; i < wallets.length; i += 20) {
        chunks.push(wallets.slice(i, i + 20));
    }
    
    for (let i = 0; i < chunks.length; i++) {
        const embed = new EmbedBuilder()
            .setTitle(`📋 OG Wallets List (${i + 1}/${chunks.length})`)
            .setDescription(chunks[i].map((wallet, index) => `${i * 20 + index + 1}. \`${wallet}\``).join('\n'))
            .setColor('#0099FF')
            .setFooter({ text: `Total: ${wallets.length} wallets` });
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
}

// Admin command - upload wallets file
async function uploadOGWallets(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }
    
    const attachment = interaction.options.getAttachment('file');
    
    if (!attachment) {
        return await interaction.reply({
            content: '❌ Please attach a text file with OG wallets.',
            ephemeral: true
        });
    }
    
    if (!attachment.name.endsWith('.txt')) {
        return await interaction.reply({
            content: '❌ The file must be a text file (.txt).',
            ephemeral: true
        });
    }
    
    try {
        const response = await fetch(attachment.url);
        const content = await response.text();
        
        const wallets = content.split('\n')
            .map(wallet => wallet.trim().toLowerCase())
            .filter(wallet => wallet && wallet.length >= 20);
        
        if (wallets.length === 0) {
            return await interaction.reply({
                content: '❌ No valid wallets found in the file.',
                ephemeral: true
            });
        }
        
        ogWallets = new Set(wallets);
        saveOGWallets();
        
        await interaction.reply({
            content: `✅ Successfully loaded ${wallets.length} OG wallets from file.`,
            ephemeral: true
        });
        
    } catch (error) {
        console.error('❌ Error processing file:', error);
        await interaction.reply({
            content: '❌ Error processing the file. Make sure it\'s a valid text file.',
            ephemeral: true
        });
    }
}

// Admin command - check wallet owner
async function checkWalletOwner(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }
    
    const wallet = interaction.options.getString('wallet');
    
    if (!wallet) {
        return await interaction.reply({
            content: '❌ Please provide a valid wallet address.',
            ephemeral: true
        });
    }
    
    const walletLower = wallet.toLowerCase().trim();
    
    if (!isWalletVerified(wallet)) {
        return await interaction.reply({
            content: `❌ La wallet \`${wallet}\` no ha sido verificada por ningún usuario.`,
            ephemeral: true
        });
    }
    
    const ownerInfo = getWalletOwner(wallet);
    
    if (!ownerInfo) {
        return await interaction.reply({
            content: `❌ Error al obtener información del propietario de la wallet \`${wallet}\`.`,
            ephemeral: true
        });
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🔍 Información de Wallet')
        .setDescription(`**Wallet:** \`${wallet}\``)
        .addFields(
            {
                name: '👤 Usuario',
                value: ownerInfo.username || 'Usuario desconocido',
                inline: true
            },
            {
                name: '🆔 ID de Usuario',
                value: ownerInfo.userId || 'N/A',
                inline: true
            },
            {
                name: '📅 Fecha de Verificación',
                value: ownerInfo.verifiedAt ? new Date(ownerInfo.verifiedAt).toLocaleString('es-ES') : 'N/A',
                inline: false
            }
        )
        .setColor('#0099FF')
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Help command
async function showHelp(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🤖 OG Wallet Verification Bot')
        .setDescription('Available commands for wallet verification and OG role assignment.')
        .addFields(
            {
                name: '👤 User Commands',
                value: '`/verify` - Verify your wallet and get OG role if eligible',
                inline: false
            },
            {
                name: '⚙️ Admin Commands',
                value: '`/add-wallet` - Add a wallet to OG list\n' +
                       '`/remove-wallet` - Remove a wallet from OG list\n' +
                       '`/list-wallets` - List all OG wallets\n' +
                       '`/upload-wallets` - Upload a file with multiple OG wallets\n' +
                       '`/check-wallet` - Check who verified a specific wallet',
                inline: false
            }
        )
        .setColor('#0099FF')
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Bot events
client.once('ready', () => {
    console.log(`🤖 Bot started as ${client.user.tag}`);
    console.log(`📊 Connected to ${client.guilds.cache.size} servers`);
    
    loadOGWallets();
    loadVerifiedWallets();
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    try {
        switch (interaction.commandName) {
            case 'verify':
                await verifyWallet(interaction);
                break;
            case 'add-wallet':
                await addOGWallet(interaction);
                break;
            case 'remove-wallet':
                await removeOGWallet(interaction);
                break;
            case 'list-wallets':
                await listOGWallets(interaction);
                break;
            case 'upload-wallets':
                await uploadOGWallets(interaction);
                break;
            case 'check-wallet':
                await checkWalletOwner(interaction);
                break;
            case 'help':
                await showHelp(interaction);
                break;
            default:
                await interaction.reply({
                    content: '❌ Command not recognized. Use `/help` to see available commands.',
                    ephemeral: true
                });
        }
    } catch (error) {
        console.error('❌ Error handling command:', error);
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                content: '❌ An error occurred while processing your command.'
            });
        } else {
            await interaction.reply({
                content: '❌ An error occurred while processing your command.',
                ephemeral: true
            });
        }
    }
});

// Register slash commands
async function registerCommands() {
    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('verify')
                .setDescription('Verify your wallet to get OG role')
                .addStringOption(option =>
                    option.setName('wallet')
                        .setDescription('Your wallet address')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('add-wallet')
                .setDescription('Add a wallet to OG list (Admin only)')
                .addStringOption(option =>
                    option.setName('wallet')
                        .setDescription('Wallet address to add')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('remove-wallet')
                .setDescription('Remove a wallet from OG list (Admin only)')
                .addStringOption(option =>
                    option.setName('wallet')
                        .setDescription('Wallet address to remove')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('list-wallets')
                .setDescription('List all OG wallets (Admin only)'),
            
            new SlashCommandBuilder()
                .setName('upload-wallets')
                .setDescription('Upload a file with multiple OG wallets (Admin only)')
                .addAttachmentOption(option =>
                    option.setName('file')
                        .setDescription('.txt file with wallets (one per line)')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('check-wallet')
                .setDescription('Check who verified a specific wallet (Admin only)')
                .addStringOption(option =>
                    option.setName('wallet')
                        .setDescription('Wallet address to check')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show bot help')
        ];
        
        await client.application.commands.set(commands);
        console.log('✅ Slash commands registered successfully');
        
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

// Start bot
async function startBot() {
    try {
        await client.login(process.env.DISCORD_TOKEN);
        
        client.once('ready', async () => {
            await registerCommands();
        });
        
    } catch (error) {
        console.error('❌ Error starting bot:', error);
        process.exit(1);
    }
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Start the bot
startBot();

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const { ethers } = require('ethers');
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
    LOG_CHANNEL_NAME: 'verifications',
    
    // Monad Testnet Configuration
    MONAD_TESTNET_RPC: process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz',
    BOT_WALLET_ADDRESS: process.env.BOT_WALLET_ADDRESS,
    BOT_PRIVATE_KEY: process.env.BOT_PRIVATE_KEY,
    VERIFICATION_AMOUNT: '0.001', // MON to send for verification
    REFUND_AMOUNT: '0.001', // MON to refund
    VERIFICATION_TIMEOUT: 10 * 60 * 1000, // 10 minutes in milliseconds
    TX_MONITOR_INTERVAL: 30000 // Check for new transactions every 30 seconds
};

// OG wallets list
let ogWallets = new Set();

// Verified wallets tracking (wallet -> user info)
let verifiedWallets = new Map();

// Pending verifications tracking (verificationCode -> user info)
let pendingVerifications = new Map();

// Monad provider and wallet
let provider;
let botWallet;

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

// Initialize Monad connection
async function initializeMonadConnection() {
    try {
        if (!CONFIG.BOT_PRIVATE_KEY || !CONFIG.BOT_WALLET_ADDRESS) {
            console.log('⚠️ Monad wallet not configured. Transaction verification disabled.');
            return false;
        }

        // Initialize provider
        provider = new ethers.JsonRpcProvider(CONFIG.MONAD_TESTNET_RPC);
        
        // Initialize bot wallet
        botWallet = new ethers.Wallet(CONFIG.BOT_PRIVATE_KEY, provider);
        
        // Verify wallet address matches
        if (botWallet.address.toLowerCase() !== CONFIG.BOT_WALLET_ADDRESS.toLowerCase()) {
            console.error('❌ Bot wallet address mismatch!');
            return false;
        }
        
        // Get balance
        const balance = await provider.getBalance(botWallet.address);
        const balanceInMON = ethers.formatEther(balance);
        
        console.log(`✅ Monad connection established`);
        console.log(`💰 Bot wallet: ${botWallet.address}`);
        console.log(`💰 Bot balance: ${balanceInMON} MON`);
        
        if (parseFloat(balanceInMON) < 0.1) {
            console.log('⚠️ Low bot balance! Consider adding more MON for refunds.');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error initializing Monad connection:', error);
        return false;
    }
}

// Generate unique verification code
function generateVerificationCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Get pending verification by code
function getPendingVerification(code) {
    return pendingVerifications.get(code);
}

// Add pending verification
function addPendingVerification(code, userId, username, wallet, guildId) {
    pendingVerifications.set(code, {
        userId,
        username,
        wallet: wallet.toLowerCase().trim(),
        guildId,
        timestamp: Date.now(),
        code
    });
}

// Remove pending verification
function removePendingVerification(code) {
    pendingVerifications.delete(code);
}

// Send refund transaction
async function sendRefund(toAddress, amount) {
    try {
        const tx = await botWallet.sendTransaction({
            to: toAddress,
            value: ethers.parseEther(amount)
        });
        
        console.log(`💰 Refund sent: ${tx.hash} to ${toAddress}`);
        return tx.hash;
    } catch (error) {
        console.error('❌ Error sending refund:', error);
        return null;
    }
}


// Process successful verification
async function processSuccessfulVerification(verification, tx) {
    try {
        const guild = client.guilds.cache.get(verification.guildId);
        if (!guild) {
            console.log('⚠️ Guild not found for verification');
            return;
        }
        
        const member = await guild.members.fetch(verification.userId);
        if (!member) {
            console.log('⚠️ Member not found for verification');
            return;
        }
        
        // Grant OG role
        const ogRole = await ensureOGRole(guild);
        await member.roles.add(ogRole);
        
        // Mark wallet as verified
        markWalletVerified(verification.wallet, verification.userId, member.user.tag, new Date().toISOString());
        
        // Remove from pending
        removePendingVerification(verification.code);
        
        // Notify user
        try {
            await member.send({
                content: `🎉 **Verification Successful!**\n\nYour wallet \`${verification.wallet}\` has been verified and you've received the OG role!\n\n💰 Your ${CONFIG.REFUND_AMOUNT} MON refund is being processed...\n\n📝 Transaction: \`${tx.hash}\``
            });
        } catch (dmError) {
            console.log('⚠️ Could not send DM to user');
        }
        
        // Log in verification channel
        const logChannel = await ensureLogChannel(guild);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('✅ OG Verification Successful')
                .setDescription(`**User:** ${member.user.tag}\n**Wallet:** \`${verification.wallet}\`\n**Transaction:** \`${tx.hash}\`\n**Method:** Transaction Verification`)
                .setColor('#00FF00')
                .setTimestamp();
            
            await logChannel.send({ embeds: [embed] });
        }
        
        console.log(`✅ Verification successful for ${member.user.tag} - Wallet: ${verification.wallet}`);
        
    } catch (error) {
        console.error('❌ Error processing successful verification:', error);
    }
}


// Force process specific transaction for pending verification
async function forceProcessPendingTransaction(txHash) {
    try {
        if (!provider) {
            console.log('❌ Provider not available');
            return;
        }
        
        console.log(`🔍 Force processing transaction: ${txHash}`);
        
        const tx = await provider.getTransaction(txHash);
        if (!tx) {
            console.log('❌ Transaction not found');
            return;
        }
        
        console.log(`📝 Transaction details:`);
        console.log(`   From: ${tx.from}`);
        console.log(`   To: ${tx.to}`);
        console.log(`   Amount: ${ethers.formatEther(tx.value)} MON`);
        console.log(`   Hash: ${tx.hash}`);
        
        if (tx.to && tx.to.toLowerCase() === botWallet.address.toLowerCase()) {
            console.log('✅ Transaction is to bot wallet');
            
            // Check if there's a pending verification for this wallet
            let pendingVerification = null;
            for (const [code, verification] of pendingVerifications) {
                if (verification.wallet.toLowerCase() === tx.from.toLowerCase()) {
                    pendingVerification = verification;
                    console.log(`✅ Found pending verification for wallet: ${tx.from}`);
                    break;
                }
            }
            
            if (pendingVerification) {
                console.log('🔄 Processing verification...');
                await processSuccessfulVerification(pendingVerification, tx);
                await sendRefund(tx.from, CONFIG.REFUND_AMOUNT);
                console.log('✅ Verification completed successfully!');
            } else {
                console.log('⚠️ No pending verification found for this wallet');
            }
        } else {
            console.log('❌ Transaction is not to bot wallet');
        }
        
    } catch (error) {
        console.error('❌ Error force processing transaction:', error);
    }
}

// Clean up expired pending verifications
function cleanupExpiredVerifications() {
    const now = Date.now();
    const expired = [];
    
    for (const [code, verification] of pendingVerifications) {
        if (now - verification.timestamp > CONFIG.VERIFICATION_TIMEOUT) {
            expired.push(code);
        }
    }
    
    for (const code of expired) {
        removePendingVerification(code);
        console.log(`🧹 Cleaned up expired verification: ${code}`);
    }
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
        const ownerUsername = ownerInfo ? ownerInfo.username : 'Unknown User';
        
        return await interaction.editReply({
            content: `❌ **Wallet Already Verified**\n\nThe wallet \`${wallet}\` has already been verified by **${ownerUsername}** and has the OG role.\n\nEach wallet can only be verified by one user.`
        });
    }
    
    const isOG = isOGWallet(wallet);
    
    // Check if Monad verification is available
    if (botWallet && isOG) {
        return await startTransactionVerification(interaction, wallet, member, guild);
    }
    
    // Fallback to original verification method
    return await originalVerificationMethod(interaction, wallet, member, guild);
}

// Start transaction-based verification
async function startTransactionVerification(interaction, wallet, member, guild) {
    try {
        // Generate unique verification code
        const verificationCode = generateVerificationCode();
        
        // Add to pending verifications
        addPendingVerification(verificationCode, member.user.id, member.user.tag, wallet, guild.id);
        
        // Create verification embed
        const embed = new EmbedBuilder()
            .setTitle('💰 Wallet Verification Required')
            .setDescription(`
**Step 1:** Send exactly **${CONFIG.VERIFICATION_AMOUNT} MON** to:
\`${botWallet.address}\`

**Step 2:** Copy your transaction hash and use:
\`/submit-tx <hash>\`

**Step 3:** Get verified and receive automatic refund!

⏱️ **Time limit:** 10 minutes
🔒 **Secure:** Your MON will be refunded automatically
            `)
            .addFields(
                {
                    name: '📝 Instructions',
                    value: `1. Open your wallet (Phantom, MetaMask, etc.)\n2. Send exactly **${CONFIG.VERIFICATION_AMOUNT} MON** to the address above\n3. Copy the transaction hash from your wallet\n4. Use \`/submit-tx <hash>\` to complete verification\n5. Receive automatic refund and OG role`,
                    inline: false
                },
                {
                    name: '⚠️ Important',
                    value: `• Amount must be **exactly ${CONFIG.VERIFICATION_AMOUNT} MON**\n• Transaction must come from: \`${wallet}\`\n• Copy the transaction hash after sending\n• Use \`/submit-tx <hash>\` immediately after sending\n• Verification code: \`${verificationCode}\` (for reference only)`,
                    inline: false
                },
                {
                    name: '💡 Compatible Wallets',
                    value: '✅ Phantom, MetaMask, Trust Wallet, Coinbase Wallet, and any EVM-compatible wallet',
                    inline: false
                }
            )
            .setColor('#FFD700')
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        
        console.log(`🔄 Transaction verification started for ${member.user.tag} - Wallet: ${wallet} - Code: ${verificationCode}`);
        
    } catch (error) {
        console.error('❌ Error starting transaction verification:', error);
        await interaction.editReply({
            content: '❌ An error occurred while starting verification. Please try again later.'
        });
    }
}

// Original verification method (fallback)
async function originalVerificationMethod(interaction, wallet, member, guild) {
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
                    content: `🎉 **Congratulations!** Your wallet \`${wallet}\` is in the OG list and you have received the **${CONFIG.OG_ROLE_NAME}** role.\n\n⚠️ **Important:** This wallet is now linked to your account and cannot be verified by another user.`
                });
            } else {
                await interaction.editReply({
                    content: `✅ Your wallet \`${wallet}\` is verified and you already have the **${CONFIG.OG_ROLE_NAME}** role.`
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

// Command - submit transaction hash for verification
async function submitTransactionHash(interaction) {
    const txHash = interaction.options.getString('hash');
    
    if (!txHash) {
        return await interaction.reply({
            content: '❌ Please provide a valid transaction hash.',
            ephemeral: true
        });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        console.log(`🔍 Transaction submission requested by ${interaction.user.tag} for tx: ${txHash}`);
        
        if (!provider) {
            return await interaction.editReply({
                content: '❌ Blockchain connection not available. Please try again later.'
            });
        }
        
        const tx = await provider.getTransaction(txHash);
        if (!tx) {
            return await interaction.editReply({
                content: '❌ Transaction not found. Please check the hash and try again.'
            });
        }
        
        console.log(`📝 Transaction details:`);
        console.log(`   From: ${tx.from}`);
        console.log(`   To: ${tx.to}`);
        console.log(`   Amount: ${ethers.formatEther(tx.value)} MON`);
        console.log(`   Hash: ${tx.hash}`);
        
        if (tx.to && tx.to.toLowerCase() === botWallet.address.toLowerCase()) {
            console.log('✅ Transaction is to bot wallet');
            
            // Check if there's a pending verification for this wallet
            let pendingVerification = null;
            for (const [code, verification] of pendingVerifications) {
                if (verification.wallet.toLowerCase() === tx.from.toLowerCase() && 
                    verification.userId === interaction.user.id) {
                    pendingVerification = verification;
                    console.log(`✅ Found pending verification for user: ${interaction.user.tag}`);
                    break;
                }
            }
            
            if (pendingVerification) {
                // Check if wallet is in OG list
                if (!isOGWallet(pendingVerification.wallet)) {
                    return await interaction.editReply({
                        content: '❌ Your wallet is not in the OG list. Contact an administrator if you believe this is an error.'
                    });
                }
                
                // Check if wallet already verified
                if (isWalletVerified(pendingVerification.wallet)) {
                    return await interaction.editReply({
                        content: '❌ This wallet has already been verified by another user.'
                    });
                }
                
                // Check transaction amount
                const txAmount = ethers.formatEther(tx.value);
                if (parseFloat(txAmount) !== parseFloat(CONFIG.VERIFICATION_AMOUNT)) {
                    return await interaction.editReply({
                        content: `❌ Wrong transaction amount. Expected ${CONFIG.VERIFICATION_AMOUNT} MON, got ${txAmount} MON.`
                    });
                }
                
                console.log('🔄 Processing verification...');
                await processSuccessfulVerification(pendingVerification, tx);
                await sendRefund(tx.from, CONFIG.REFUND_AMOUNT);
                
                await interaction.editReply({
                    content: `🎉 **Verification Successful!**\n\nYour wallet \`${pendingVerification.wallet}\` has been verified and you've received the OG role!\n\n💰 Your ${CONFIG.REFUND_AMOUNT} MON refund is being processed...\n\n📝 Transaction: \`${tx.hash}\``
                });
                
                console.log('✅ Verification completed successfully!');
                
            } else {
                return await interaction.editReply({
                    content: '❌ No pending verification found for your wallet. Please use `/verify <wallet>` first.'
                });
            }
        } else {
            return await interaction.editReply({
                content: `❌ Transaction is not sent to the bot wallet. Expected: \`${botWallet.address}\`, Got: \`${tx.to}\``
            });
        }
        
    } catch (error) {
        console.error('❌ Error in transaction submission:', error);
        await interaction.editReply({
            content: '❌ An error occurred while processing your transaction. Please try again later.'
        });
    }
}

// Command - test bot updates
async function testCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🧪 Bot Test Command')
        .setDescription('✅ Bot is working and updated!')
        .addFields(
            {
                name: '📅 Update Time',
                value: new Date().toLocaleString('es-ES'),
                inline: true
            },
            {
                name: '🔧 System Status',
                value: botWallet ? '✅ Monad Connected' : '❌ Monad Disconnected',
                inline: true
            },
            {
                name: '💰 Bot Balance',
                value: botWallet ? 'Check logs for balance' : 'N/A',
                inline: true
            }
        )
        .setColor('#00FF00')
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    
    console.log(`🧪 Test command executed by ${interaction.user.tag}`);
}

// Command - force process pending transaction (Admin only)
async function forceProcessTransaction(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return await interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true
        });
    }
    
    const txHash = interaction.options.getString('hash');
    
    if (!txHash) {
        return await interaction.reply({
            content: '❌ Please provide a valid transaction hash.',
            ephemeral: true
        });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        console.log(`🔍 Force processing requested for tx: ${txHash}`);
        await forceProcessPendingTransaction(txHash);
        
        await interaction.editReply({
            content: `✅ Force processing completed.\n\nHash: \`${txHash}\`\n\nCheck the logs for detailed results.`
        });
        
    } catch (error) {
        console.error('❌ Error in force processing:', error);
        await interaction.editReply({
            content: '❌ An error occurred while force processing the transaction. Check the logs for details.'
        });
    }
}

// Command - check verification status
async function checkVerificationStatus(interaction) {
    const wallet = interaction.options.getString('wallet');
    
    if (!wallet) {
        return await interaction.reply({
            content: '❌ Please provide a valid wallet address.',
            ephemeral: true
        });
    }
    
    const walletLower = wallet.toLowerCase().trim();
    
    // Check if wallet is already verified
    if (isWalletVerified(wallet)) {
        const ownerInfo = getWalletOwner(wallet);
        return await interaction.reply({
            content: `✅ **Wallet Already Verified**\n\nWallet \`${wallet}\` is already verified by **${ownerInfo.username}** and has the OG role.`,
            ephemeral: true
        });
    }
    
    // Check if there's a pending verification
    let pendingVerification = null;
    for (const [code, verification] of pendingVerifications) {
        if (verification.wallet.toLowerCase() === walletLower) {
            pendingVerification = verification;
            break;
        }
    }
    
    if (pendingVerification) {
        const timeRemaining = Math.max(0, CONFIG.VERIFICATION_TIMEOUT - (Date.now() - pendingVerification.timestamp));
        const minutesRemaining = Math.ceil(timeRemaining / 60000);
        
        return await interaction.reply({
            content: `⏳ **Pending Verification**\n\nWallet \`${wallet}\` has a pending verification.\n⏱️ Time remaining: ${minutesRemaining} minutes\n\nPlease send **${CONFIG.VERIFICATION_AMOUNT} MON** to \`${botWallet.address}\` to complete verification.`,
            ephemeral: true
        });
    }
    
    // Check if wallet is in OG list
    if (isOGWallet(wallet)) {
        return await interaction.reply({
            content: `📝 **Ready for Verification**\n\nWallet \`${wallet}\` is in the OG list and ready for verification.\n\nUse \`/verify ${wallet}\` to start the verification process.`,
            ephemeral: true
        });
    }
    
    return await interaction.reply({
        content: `❌ **Wallet Not in OG List**\n\nWallet \`${wallet}\` is not in the OG list.\n\nContact an administrator if you believe this is an error.`,
        ephemeral: true
    });
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
            content: `❌ The wallet \`${wallet}\` has not been verified by any user.`,
            ephemeral: true
        });
    }
    
    const ownerInfo = getWalletOwner(wallet);
    
    if (!ownerInfo) {
        return await interaction.reply({
            content: `❌ Error getting wallet owner information for \`${wallet}\`.`,
            ephemeral: true
        });
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🔍 Wallet Information')
        .setDescription(`**Wallet:** \`${wallet}\``)
        .addFields(
            {
                name: '👤 User',
                value: ownerInfo.username || 'Unknown User',
                inline: true
            },
            {
                name: '🆔 User ID',
                value: ownerInfo.userId || 'N/A',
                inline: true
            },
            {
                name: '📅 Verification Date',
                value: ownerInfo.verifiedAt ? new Date(ownerInfo.verifiedAt).toLocaleString('en-US') : 'N/A',
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
                value: '`/verify` - Start wallet verification process\n`/submit-tx` - Submit transaction hash to complete verification\n`/check-status` - Check verification status of a wallet',
                inline: false
            },
            {
                name: '⚙️ Admin Commands',
                value: '`/add-wallet` - Add a wallet to OG list\n' +
                       '`/remove-wallet` - Remove a wallet from OG list\n' +
                       '`/list-wallets` - List all OG wallets\n' +
                       '`/upload-wallets` - Upload a file with multiple OG wallets\n' +
                       '`/check-wallet` - Check who verified a specific wallet\n' +
                       '`/force-process` - Force process a transaction (Admin only)',
                inline: false
            }
        )
        .setColor('#0099FF')
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Bot events
client.once('ready', async () => {
    console.log(`🤖 Bot started as ${client.user.tag}`);
    console.log(`📊 Connected to ${client.guilds.cache.size} servers`);
    
    loadOGWallets();
    loadVerifiedWallets();
    
    // Initialize Monad connection
    const monadConnected = await initializeMonadConnection();
    
    if (monadConnected) {
        // Manual hash submission system active
        console.log('🔄 Manual transaction verification system active');
        console.log('📝 Users must use /submit-tx <hash> after sending transaction');
        
        // Start cleanup of expired verifications
        setInterval(cleanupExpiredVerifications, 60000); // Every minute
        console.log('🧹 Expired verification cleanup started');
    }
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
            case 'check-status':
                await checkVerificationStatus(interaction);
                break;
            case 'submit-tx':
                await submitTransactionHash(interaction);
                break;
            case 'force-process':
                await forceProcessTransaction(interaction);
                break;
            case 'test':
                await testCommand(interaction);
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
                .setName('check-status')
                .setDescription('Check verification status of a wallet')
                .addStringOption(option =>
                    option.setName('wallet')
                        .setDescription('Wallet address to check status')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('submit-tx')
                .setDescription('Submit transaction hash to complete verification')
                .addStringOption(option =>
                    option.setName('hash')
                        .setDescription('Your transaction hash')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('force-process')
                .setDescription('Force process a pending verification transaction (Admin only)')
                .addStringOption(option =>
                    option.setName('hash')
                        .setDescription('Transaction hash to force process')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('test')
                .setDescription('Test command to verify bot updates'),
            
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show bot help')
        ];
        
        await client.application.commands.set(commands);
        console.log('✅ Slash commands registered successfully');
        console.log('📋 Registered commands:', commands.map(cmd => cmd.name).join(', '));
        
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

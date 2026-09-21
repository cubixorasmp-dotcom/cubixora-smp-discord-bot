/**
 * Cubixora Discord Bot
 * Node.js 18+ / discord.js v14
 *
 * Render/GitHub:
 *   npm i discord.js dotenv
 *   node dcs.js
 *
 * Gerekli Environment Variables:
 *   DISCORD_TOKEN=bot_token
 *   CLIENT_ID=application_id
 *   GUILD_ID=server_id                 # test sunucusunda slash komutları anında gelir
 *   OWNER_IDS=123,456                   # bot sahipleri
 *   MC_HOST=cubixorasmp.play.hosting
 *   MC_JAVA_PORT=25565
 *   MC_BEDROCK_PORT=19132
 *   MC_WEBHOOK_SECRET=uzun-rastgele-sifre
 *   PORT=10000
 *
 * Not: Discord Developer Portal'da Message Content Intent ve Server Members
 * Intent'i açılmalıdır. Botun Manage Roles, Moderate Members, Ban Members,
 * Manage Messages ve Manage Channels izinleri olmalıdır.
 */

require("dotenv").config();
const fs = require("node:fs");
const http = require("node:http");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const PREFIX = process.env.PREFIX || "e!";
const TOKEN = process.env.DISCORD_TOKEN;
const MC_HOST = process.env.MC_HOST || "cubixorasmp.play.hosting";
const MC_JAVA_PORT = Number(process.env.MC_JAVA_PORT || 25565);
const MC_BEDROCK_PORT = Number(process.env.MC_BEDROCK_PORT || 19132);
const OWNER_IDS = new Set((process.env.OWNER_IDS || "").split(",").map(x => x.trim()).filter(Boolean));
const DATA_FILE = process.env.DATA_FILE || "./bot-data.json";
const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;

if (!TOKEN) {
  console.error("DISCORD_TOKEN bulunamadı. Render Environment Variables kısmına ekleyin.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const defaultGuild = () => ({
  prefix: PREFIX,
  autoRoleId: null,
  staffRoleId: null,
  welcomeChannelId: null,
  goodbyeChannelId: null,
  punishmentChannelId: null,
  mcPunishmentChannelId: null,
  mcChatChannelId: null,
  ticketCategoryId: null,
  site: "https://cubixoraweb.onrender.com",
  protectRoleIds: [],
  owners: [],
  linkProtection: false,
  maintenance: false,
  wordGameChannelId: null,
  wordLastUserId: null,
  countChannelId: null,
  countNext: 1,
});

let data = { guilds: {} };
try {
  if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (error) {
  console.error("bot-data.json okunamadı, boş veri ile başlanıyor:", error.message);
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Veri kaydedilemedi:", error.message);
  }
}

function cfg(guildId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = defaultGuild();
  return data.guilds[guildId];
}

function clean(text, max = 1024) {
  return String(text || "Belirtilmedi").slice(0, max);
}

function embed(title, description, color = 0x5865f2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(clean(description, 4000))
    .setTimestamp();
}

function durationMs(value) {
  const match = String(value || "").toLowerCase().replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*(sn|saniye|dk|dakika|d|sa|saat|g|gün|gun|h|hour|m|minute|w|hafta|ay)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const units = {
    sn: 1000, saniye: 1000,
    dk: 60_000, dakika: 60_000, d: 60_000,
    sa: 3_600_000, saat: 3_600_000, h: 3_600_000,
    g: 86_400_000, gün: 86_400_000, gun: 86_400_000,
    m: 60_000, minute: 60_000,
    w: 604_800_000, hafta: 604_800_000,
    ay: 2_592_000_000,
  };
  return Math.round(amount * units[match[2]]);
}

function durationText(ms) {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} gün`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} saat`;
  if (ms % 60_000 === 0) return `${ms / 60_000} dakika`;
  return `${Math.round(ms / 1000)} saniye`;
}

function canManage(member, guildConfig, action = "moderate") {
  if (!member) return false;
  if (OWNER_IDS.has(member.id) || guildConfig.owners.includes(member.id)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  const allowed = guildConfig.staffRoleId && member.roles.cache.has(guildConfig.staffRoleId);
  if (allowed) return true;
  const permissionMap = {
    messages: PermissionsBitField.Flags.ManageMessages,
    moderate: PermissionsBitField.Flags.ModerateMembers,
    ban: PermissionsBitField.Flags.BanMembers,
    channels: PermissionsBitField.Flags.ManageChannels,
    manage: PermissionsBitField.Flags.ManageGuild,
  };
  return Boolean(permissionMap[action] && member.permissions.has(permissionMap[action]));
}

function isOwner(userId, guildConfig) {
  return OWNER_IDS.has(userId) || guildConfig.owners.includes(userId);
}

function mentionedRole(message) {
  return message.mentions.roles.first() || null;
}

function mentionedUser(message) {
  return message.mentions.members.first() || null;
}

async function sendLog(guild, guildConfig, title, fields, color = 0xed4245, minecraft = false) {
  const channelId = minecraft ? guildConfig.mcPunishmentChannelId : guildConfig.punishmentChannelId;
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;
  const e = new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setTimestamp()
    .setFooter({ text: "Cubixora Ceza Takip Sistemi" });
  await channel.send({ embeds: [e] }).catch(() => {});
}

async function applyMute(member, ms, reason, moderator, guildConfig, automatic = false) {
  const safeMs = Math.min(Math.max(ms, 5_000), MAX_TIMEOUT);
  await member.timeout(safeMs, reason).catch(error => {
    throw new Error(`Mute uygulanamadı: ${error.message}`);
  });
  await sendLog(member.guild, guildConfig, automatic ? "🔇 Otomatik Susturma (Mute)" : "🔇 Discord Ceza — MUTE", [
    { name: "👤 Cezalandırılan Üye", value: `${member} (${member.user.tag})` },
    { name: "👥 Yetkili", value: automatic ? "Otomatik Sistem" : `${moderator}` },
    { name: "⏱️ Mute Süresi", value: durationText(safeMs), inline: true },
    { name: "📄 Ceza Sebebi", value: clean(reason), inline: true },
  ], 0xffc107, automatic);
  return safeMs;
}

async function executeMute(message, member, rawDuration, reason) {
  const guildConfig = cfg(message.guild.id);
  if (!canManage(message.member, guildConfig, "moderate")) return message.reply("❌ Bu komut için yetkin yok.");
  const ms = durationMs(rawDuration);
  if (!member || !ms) return message.reply(`Kullanım: \`${PREFIX}mute @üye 30 dakika sebep\``);
  if (member.id === message.author.id || member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("❌ Bu üyeye mute uygulanamaz.");
  }
  try {
    await applyMute(member, ms, reason || "Sebep belirtilmedi", message.member, guildConfig);
    return message.reply(`🔇 ${member} **${durationText(ms)}** susturuldu.`);
  } catch (error) {
    return message.reply(`❌ ${error.message}`);
  }
}

async function executeBan(message, member, reason) {
  const guildConfig = cfg(message.guild.id);
  if (!canManage(message.member, guildConfig, "ban")) return message.reply("❌ Ban yetkin yok.");
  if (!member) return message.reply(`Kullanım: \`${PREFIX}ban @üye sebep\``);
  if (!member.bannable) return message.reply("❌ Bu üyeyi banlayamıyorum; rolü benden yüksek olabilir.");
  try {
    await member.ban({ reason: reason || "Sebep belirtilmedi" });
    await sendLog(message.guild, guildConfig, "🔨 Discord Ceza — BAN", [
      { name: "👤 Yasaklanan Üye", value: `${member.user.tag} (${member.id})` },
      { name: "👥 Yetkili", value: `${message.member}` },
      { name: "📄 Sebep", value: clean(reason || "Sebep belirtilmedi") },
    ]);
    return message.reply(`🔨 **${member.user.tag}** banlandı.`);
  } catch (error) {
    return message.reply(`❌ Ban uygulanamadı: ${error.message}`);
  }
}

async function setChannel(message, key, channel) {
  const guildConfig = cfg(message.guild.id);
  if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Sunucu yönetme yetkin yok.");
  if (!channel || !channel.isTextBased()) return message.reply(`Kullanım: \`${PREFIX}kanal-ayarla ${key} #kanal\``);
  guildConfig[key] = channel.id;
  save();
  return message.reply(`✅ **${key}** kanalı ${channel} olarak ayarlandı.`);
}

function splitPipes(text) {
  return text.split("|").map(x => x.trim()).filter(Boolean);
}

async function createGiveaway(channel, title, prize, winners, ms) {
  const message = await channel.send({
    embeds: [embed("🎉 Çekiliş", `**${title}**\n\n🎁 Ödül: **${prize}**\n🏆 Kazanan: **${winners}** kişi\n⏳ Süre: **${durationText(ms)}**\n\nKatılmak için 🎉 tepkisine basın.`, 0xf1c40f)],
  });
  await message.react("🎉");
  const collector = message.createReactionCollector({ time: ms });
  collector.on("end", async () => {
    const reaction = message.reactions.cache.get("🎉");
    const users = reaction ? [...(await reaction.users.fetch()).values()].filter(u => !u.bot) : [];
    const shuffled = users.sort(() => Math.random() - 0.5).slice(0, winners);
    if (!shuffled.length) return channel.send("🎉 Çekiliş bitti ancak katılan olmadı.");
    channel.send({ content: `🎉 Tebrikler ${shuffled.map(u => `<@${u.id}>`).join(", ")}! **${prize}** kazandınız.` });
  });
}

async function createPoll(channel, title, options, ms) {
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  const text = options.map((option, i) => `${emojis[i]} ${option}`).join("\n");
  const message = await channel.send({ embeds: [embed(`📊 ${title}`, `${text}\n\n⏳ Süre: **${durationText(ms)}**`, 0x3498db)] });
  for (let i = 0; i < options.length; i++) await message.react(emojis[i]);
  const collector = message.createReactionCollector({ time: ms });
  collector.on("end", async () => {
    const results = options.map((option, i) => {
      const count = Math.max(0, (message.reactions.cache.get(emojis[i])?.count || 1) - 1);
      return `${emojis[i]} ${option}: **${count}** oy`;
    }).join("\n");
    channel.send({ embeds: [embed("📊 Anket Sonucu", results, 0x2ecc71)] });
  });
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("ip").setDescription("Minecraft sunucu bilgilerini gösterir"),
    new SlashCommandBuilder().setName("otorol-ayarla").setDescription("Yeni üyeye otomatik verilecek rolü ayarlar").addRoleOption(o => o.setName("rol").setDescription("Rol").setRequired(true)),
    new SlashCommandBuilder().setName("sil").setDescription("Mesaj siler").addIntegerOption(o => o.setName("miktar").setDescription("1-1000").setMinValue(1).setMaxValue(1000).setRequired(true)),
    new SlashCommandBuilder().setName("ban").setDescription("Üyeyi banlar").addUserOption(o => o.setName("uye").setDescription("Üye").setRequired(true)).addStringOption(o => o.setName("sebep").setDescription("Sebep")),
    new SlashCommandBuilder().setName("mute").setDescription("Üyeyi susturur").addUserOption(o => o.setName("uye").setDescription("Üye").setRequired(true)).addStringOption(o => o.setName("sure").setDescription("30 dakika, 1 saat").setRequired(true)).addStringOption(o => o.setName("sebep").setDescription("Sebep")),
    new SlashCommandBuilder().setName("unmute").setDescription("Üyenin susturmasını kaldırır").addUserOption(o => o.setName("uye").setDescription("Üye").setRequired(true)),
    new SlashCommandBuilder().setName("koruma-rol").setDescription("Etiketlenince otomatik mute olacak rolü ekler").addRoleOption(o => o.setName("rol").setDescription("Rol").setRequired(true)),
    new SlashCommandBuilder().setName("koruma-list").setDescription("Koruma rollerini listeler"),
    new SlashCommandBuilder().setName("koruma-cikar").setDescription("Koruma rolünü kaldırır").addRoleOption(o => o.setName("rol").setDescription("Rol").setRequired(true)),
    new SlashCommandBuilder().setName("linkkoruma").setDescription("Link korumasını açar/kapatır").addBooleanOption(o => o.setName("durum").setDescription("Açık veya kapalı").setRequired(true)),
    new SlashCommandBuilder().setName("cekilis").setDescription("Çekiliş başlatır").addStringOption(o => o.setName("baslik").setDescription("Başlık").setRequired(true)).addStringOption(o => o.setName("odul").setDescription("Ödül").setRequired(true)).addIntegerOption(o => o.setName("kazanan").setDescription("Kazanan sayısı").setMinValue(1).setMaxValue(20).setRequired(true)).addStringOption(o => o.setName("sure").setDescription("10 dakika, 1 saat").setRequired(true)),
    new SlashCommandBuilder().setName("anket").setDescription("Anket başlatır").addStringOption(o => o.setName("baslik").setDescription("Başlık").setRequired(true)).addStringOption(o => o.setName("sure").setDescription("10 dakika").setRequired(true)).addStringOption(o => o.setName("secenekler").setDescription("Virgülle ayrılmış en az 2 seçenek").setRequired(true)),
    new SlashCommandBuilder().setName("ticket-kur").setDescription("Ticket paneli kurar").addRoleOption(o => o.setName("yetkili").setDescription("Yetkili rolü").setRequired(true)).addStringOption(o => o.setName("baslik").setDescription("Panel başlığı").setRequired(true)).addStringOption(o => o.setName("metin").setDescription("Panel metni").setRequired(true)),
    new SlashCommandBuilder().setName("kelime-kanal").setDescription("Kelime oyun kanalını ayarlar").addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("sayisayma").setDescription("Sayı sayma kanalını ayarlar").addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("dc-ceza").setDescription("Discord ceza log kanalını ayarlar").addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("mc-ceza").setDescription("Minecraft ceza log kanalını ayarlar").addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("mcsohbet").setDescription("Minecraft sohbet kanalını ayarlar").addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("owner-ekle").setDescription("Bot sahibine yetkili ekler").addUserOption(o => o.setName("uye").setDescription("Üye").setRequired(true)),
    new SlashCommandBuilder().setName("owner-cikar").setDescription("Bot sahibini kaldırır").addUserOption(o => o.setName("uye").setDescription("Üye").setRequired(true)),
    new SlashCommandBuilder().setName("owner-list").setDescription("Bot sahiplerini listeler"),
    new SlashCommandBuilder().setName("siteekle").setDescription("Site adresini ayarlar").addStringOption(o => o.setName("url").setDescription("URL").setRequired(true)),
    new SlashCommandBuilder().setName("sitecikar").setDescription("Site adresini kaldırır"),
    new SlashCommandBuilder().setName("aktif").setDescription("Site ve bot durumunu gösterir"),
    new SlashCommandBuilder().setName("bakim").setDescription("Bakım modunu açar/kapatır").addBooleanOption(o => o.setName("durum").setDescription("Durum").setRequired(true)),
    new SlashCommandBuilder().setName("kanal-ayarla").setDescription("Karşılama/güle güle kanalı ayarlar").addStringOption(o => o.setName("tur").setDescription("welcome veya goodbye").setRequired(true)).addChannelOption(o => o.setName("kanal").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  ].map(command => command.toJSON());
  if (process.env.GUILD_ID) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
    if (guild) await guild.commands.set(commands);
  } else {
    await client.application.commands.set(commands);
  }
}

async function showIp(target) {
  const description = [
    `🌐 Java IP: \`${MC_HOST}\``,
    `🟩 Java sürümü: \`1.16.5\``,
    `🟦 Bedrock IP: \`${MC_HOST}\``,
    `🔌 Bedrock port: \`${MC_BEDROCK_PORT}\``,
    `🔌 Java port: \`${MC_JAVA_PORT}\``,
    `🌍 Site: ${target}`,
  ].join("\n");
  return embed("🎮 Cubixora SMP Sunucu Bilgileri", description, 0x2ecc71);
}

async function fetchMcStatus() {
  const url = `https://api.mcsrvstat.us/3/${MC_HOST}:${MC_JAVA_PORT}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function updatePresence() {
  const status = await fetchMcStatus();
  const online = status?.online ? `${status.players?.online || 0}/${status.players?.max || "?"} oyuncu` : "Sunucu kapalı";
  client.user?.setPresence({
    activities: [{ name: `${online} | ${MC_HOST}`, type: 0 }],
    status: "online",
  });
}

async function handleSlash(interaction) {
  const guildConfig = cfg(interaction.guild.id);
  const name = interaction.commandName;
  const reply = options => interaction.reply(options);
  const member = interaction.member;
  const requireStaff = action => {
    if (!canManage(member, guildConfig, action)) {
      reply({ content: "❌ Bu işlem için yetkin yok.", ephemeral: true });
      return false;
    }
    return true;
  };

  if (name === "ip") return reply({ embeds: [await showIp(guildConfig.site)] });
  if (["owner-ekle", "owner-cikar", "owner-list"].includes(name) && !isOwner(interaction.user.id, guildConfig)) {
    return reply({ content: "❌ Sadece bot sahibi bu komutu kullanabilir.", ephemeral: true });
  }
  if (name === "owner-list") return reply({ embeds: [embed("👑 Bot Sahipleri", [...OWNER_IDS, ...guildConfig.owners].map(id => `<@${id}>`).join("\n") || "Kayıtlı owner yok.")] });
  if (name === "owner-ekle") {
    const id = interaction.options.getUser("uye").id;
    if (!guildConfig.owners.includes(id)) guildConfig.owners.push(id);
    save();
    return reply(`✅ <@${id}> owner listesine eklendi.`);
  }
  if (name === "owner-cikar") {
    const id = interaction.options.getUser("uye").id;
    guildConfig.owners = guildConfig.owners.filter(x => x !== id);
    save();
    return reply(`✅ <@${id}> owner listesinden çıkarıldı.`);
  }
  if (name === "otorol-ayarla") {
    if (!requireStaff("manage")) return;
    guildConfig.autoRoleId = interaction.options.getRole("rol").id; save();
    return reply("✅ Otorol ayarlandı.");
  }
  if (name === "sil") {
    if (!requireStaff("messages")) return;
    const amount = interaction.options.getInteger("miktar");
    await interaction.deferReply({ ephemeral: true });
    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    return interaction.editReply(`✅ ${deleted?.size || 0} mesaj silindi.`);
  }
  if (name === "ban" || name === "mute" || name === "unmute") {
    const target = interaction.guild.members.cache.get(interaction.options.getUser("uye").id)
      || await interaction.guild.members.fetch(interaction.options.getUser("uye").id).catch(() => null);
    if (!target) return reply({ content: "❌ Üye bulunamadı.", ephemeral: true });
    if (name === "ban") {
      if (!requireStaff("ban")) return;
      await target.ban({ reason: interaction.options.getString("sebep") || "Sebep belirtilmedi" }).catch(error => reply({ content: `❌ ${error.message}`, ephemeral: true }));
      await sendLog(interaction.guild, guildConfig, "🔨 Discord Ceza — BAN", [{ name: "Üye", value: `${target.user.tag}` }, { name: "Yetkili", value: `${interaction.user}` }, { name: "Sebep", value: interaction.options.getString("sebep") || "Belirtilmedi" }]);
      return reply(`🔨 ${target.user.tag} banlandı.`);
    }
    if (!requireStaff("moderate")) return;
    if (name === "unmute") {
      await target.timeout(null, "Yetkili tarafından açıldı").catch(error => reply({ content: `❌ ${error.message}`, ephemeral: true }));
      return reply(`🔊 ${target} susturması kaldırıldı.`);
    }
    const ms = durationMs(interaction.options.getString("sure"));
    if (!ms) return reply({ content: "❌ Süre örneği: `30 dakika`, `1 saat`, `1 gün`.", ephemeral: true });
    await target.timeout(Math.min(ms, MAX_TIMEOUT), interaction.options.getString("sebep") || "Sebep belirtilmedi").catch(error => reply({ content: `❌ ${error.message}`, ephemeral: true }));
    return reply(`🔇 ${target} ${durationText(ms)} susturuldu.`);
  }
  if (["koruma-rol", "koruma-cikar", "linkkoruma"].includes(name)) {
    if (!requireStaff("manage")) return;
    if (name === "linkkoruma") guildConfig.linkProtection = interaction.options.getBoolean("durum");
    else {
      const id = interaction.options.getRole("rol").id;
      if (name === "koruma-rol" && !guildConfig.protectRoleIds.includes(id)) guildConfig.protectRoleIds.push(id);
      if (name === "koruma-cikar") guildConfig.protectRoleIds = guildConfig.protectRoleIds.filter(x => x !== id);
    }
    save();
    return reply("✅ Koruma ayarı güncellendi.");
  }
  if (name === "koruma-list") return reply({ embeds: [embed("🛡️ Koruma Rolleri", guildConfig.protectRoleIds.map(id => `<@&${id}>`).join("\n") || "Koruma rolü yok.")] });
  if (name === "cekilis") {
    if (!requireStaff("manage")) return;
    const ms = durationMs(interaction.options.getString("sure"));
    if (!ms) return reply({ content: "❌ Geçerli bir süre yazın: `10 dakika`.", ephemeral: true });
    await reply("✅ Çekiliş başlatıldı.");
    return createGiveaway(interaction.channel, interaction.options.getString("baslik"), interaction.options.getString("odul"), interaction.options.getInteger("kazanan"), ms);
  }
  if (name === "anket") {
    if (!requireStaff("manage")) return;
    const ms = durationMs(interaction.options.getString("sure"));
    const options = interaction.options.getString("secenekler").split(",").map(x => x.trim()).filter(Boolean).slice(0, 10);
    if (!ms || options.length < 2) return reply({ content: "❌ En az 2 seçenek ve geçerli süre gerekli.", ephemeral: true });
    await reply("✅ Anket başlatıldı.");
    return createPoll(interaction.channel, interaction.options.getString("baslik"), options, ms);
  }
  if (name === "ticket-kur") {
    if (!requireStaff("channels")) return;
    const role = interaction.options.getRole("yetkili");
    guildConfig.staffRoleId = role.id; save();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket:open").setLabel("🎫 Ticket Aç").setStyle(ButtonStyle.Primary));
    return interaction.channel.send({ embeds: [embed(interaction.options.getString("baslik"), interaction.options.getString("metin"), 0x5865f2)], components: [row] }).then(() => reply("✅ Ticket paneli kuruldu."));
  }
  if (["kelime-kanal", "sayisayma", "dc-ceza", "mc-ceza", "mcsohbet"].includes(name)) {
    if (!requireStaff("manage")) return;
    const key = { "kelime-kanal": "wordGameChannelId", sayisayma: "countChannelId", "dc-ceza": "punishmentChannelId", "mc-ceza": "mcPunishmentChannelId", mcsohbet: "mcChatChannelId" }[name];
    guildConfig[key] = interaction.options.getChannel("kanal").id;
    if (key === "countChannelId") guildConfig.countNext = 1;
    save();
    return reply(`✅ ${interaction.options.getChannel("kanal")} ayarlandı.`);
  }
  if (name === "siteekle") {
    if (!requireStaff("manage")) return;
    guildConfig.site = interaction.options.getString("url"); save();
    return reply(`✅ Site ayarlandı: ${guildConfig.site}`);
  }
  if (name === "sitecikar") {
    if (!requireStaff("manage")) return;
    guildConfig.site = null; save();
    return reply("✅ Site kaldırıldı.");
  }
  if (name === "aktif") return reply({ embeds: [embed("✅ Bot Aktif", `🌐 Site: ${guildConfig.site || "Ayarlanmadı"}\n🎮 Minecraft: \`${MC_HOST}\``, 0x2ecc71)] });
  if (name === "bakim") {
    if (!requireStaff("manage")) return;
    guildConfig.maintenance = interaction.options.getBoolean("durum"); save();
    return reply(`✅ Bakım modu **${guildConfig.maintenance ? "açıldı" : "kapatıldı"}**.`);
  }
  if (name === "kanal-ayarla") {
    if (!requireStaff("manage")) return;
    const type = interaction.options.getString("tur");
    guildConfig[type === "welcome" ? "welcomeChannelId" : "goodbyeChannelId"] = interaction.options.getChannel("kanal").id;
    save();
    return reply("✅ Karşılama kanalı ayarlandı.");
  }
}

async function handlePrefix(message) {
  const guildConfig = cfg(message.guild.id);
  const content = message.content.trim();
  const prefix = guildConfig.prefix || PREFIX;
  if (!content.toLowerCase().startsWith(prefix.toLowerCase())) return;
  const [commandRaw, ...args] = content.slice(prefix.length).trim().split(/\s+/);
  const command = commandRaw?.toLowerCase();
  if (!command) return;

  if (command === "ip") return message.reply({ embeds: [await showIp(guildConfig.site)] });
  if (command === "yardım" || command === "help") {
    return message.reply({ embeds: [embed("📚 Cubixora Bot Komutları", [
      `**${prefix}ip** • Minecraft bilgileri`,
      `**${prefix}sil 10** • Mesaj temizler`,
      `**${prefix}ban @üye sebep** • Ban`,
      `**${prefix}mute @üye 30 dakika sebep** • Mute`,
      `**${prefix}otorol-ayarla @rol** • Otorol`,
      `**${prefix}koruma-rol @rol** • Etiket koruması`,
      `**${prefix}cekilis başlık | ödül | 1 | 1 saat**`,
      `**${prefix}anket başlık | 10 dakika | seçenek 1 | seçenek 2**`,
      `**${prefix}ticket-kur @yetkili | Başlık | Metin**`,
      `**${prefix}kanal-ayarla welcome #kanal**`,
    ].join("\n"))] });
  }
  if (command === "sil" || command === "temizle") {
    if (!canManage(message.member, guildConfig, "messages")) return message.reply("❌ Mesaj yönetme yetkin yok.");
    const amount = Number(args[0]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000) return message.reply(`Kullanım: \`${prefix}sil 1-1000\``);
    const deleted = await message.channel.bulkDelete(amount + 1, true).catch(() => null);
    return message.channel.send(`✅ ${Math.max(0, (deleted?.size || 1) - 1)} mesaj silindi.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
  }
  if (command === "ban") return executeBan(message, mentionedUser(message), args.slice(1).join(" "));
  if (command === "mute") return executeMute(message, mentionedUser(message), args[1], args.slice(2).join(" "));
  if (command === "unmute") {
    if (!canManage(message.member, guildConfig, "moderate")) return message.reply("❌ Yetkin yok.");
    const member = mentionedUser(message);
    if (!member) return message.reply(`Kullanım: \`${prefix}unmute @üye\``);
    await member.timeout(null, "Yetkili tarafından açıldı").catch(error => message.reply(`❌ ${error.message}`));
    return message.reply(`🔊 ${member} susturması kaldırıldı.`);
  }
  if (command === "otorol-ayarla") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Sunucu yönetme yetkin yok.");
    const role = mentionedRole(message);
    if (!role) return message.reply(`Kullanım: \`${prefix}otorol-ayarla @rol\``);
    guildConfig.autoRoleId = role.id; save();
    return message.reply(`✅ Yeni üyelere ${role} otomatik verilecek.`);
  }
  if (command === "koruma-rol" || command === "koruma-ekle" || command === "koruma-cikar") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    const role = mentionedRole(message);
    if (!role) return message.reply(`Kullanım: \`${prefix}${command} @rol\``);
    if (command === "koruma-cikar") guildConfig.protectRoleIds = guildConfig.protectRoleIds.filter(id => id !== role.id);
    else if (!guildConfig.protectRoleIds.includes(role.id)) guildConfig.protectRoleIds.push(role.id);
    save();
    return message.reply("✅ Koruma rol listesi güncellendi.");
  }
  if (command === "koruma-list") return message.reply({ embeds: [embed("🛡️ Koruma Rolleri", guildConfig.protectRoleIds.map(id => `<@&${id}>`).join("\n") || "Yok.")] });
  if (command === "linkkoruma") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    guildConfig.linkProtection = ["aç", "ac", "on", "açık"].includes((args[0] || "").toLowerCase()); save();
    return message.reply(`✅ Link koruması ${guildConfig.linkProtection ? "açıldı" : "kapatıldı"}.`);
  }
  if (command === "cekilis") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    const parts = splitPipes(args.join(" "));
    const ms = durationMs(parts[3]);
    if (parts.length < 4 || !ms || !Number(parts[2])) return message.reply(`Kullanım: \`${prefix}cekilis başlık | ödül | kazanan sayısı | 1 saat\``);
    await message.reply("✅ Çekiliş başlatıldı.");
    return createGiveaway(message.channel, parts[0], parts[1], Number(parts[2]), ms);
  }
  if (command === "anket") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    const parts = splitPipes(args.join(" "));
    const options = parts.slice(2);
    const ms = durationMs(parts[1]);
    if (parts.length < 4 || !ms) return message.reply(`Kullanım: \`${prefix}anket başlık | 10 dakika | seçenek 1 | seçenek 2\``);
    await message.reply("✅ Anket başlatıldı.");
    return createPoll(message.channel, parts[0], options, ms);
  }
  if (command === "ticket-kur") {
    if (!canManage(message.member, guildConfig, "channels")) return message.reply("❌ Kanal yönetme yetkin yok.");
    const parts = splitPipes(args.join(" "));
    const role = message.mentions.roles.first();
    if (!role || parts.length < 3) return message.reply(`Kullanım: \`${prefix}ticket-kur @yetkili | Başlık | Metin\``);
    guildConfig.staffRoleId = role.id; save();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket:open").setLabel("🎫 Ticket Aç").setStyle(ButtonStyle.Primary));
    await message.channel.send({ embeds: [embed(parts[1], parts.slice(2).join(" | "))], components: [row] });
    return message.reply("✅ Ticket paneli kuruldu.");
  }
  if (command === "kanal-ayarla") {
    const type = args[0] === "welcome" || args[0] === "hosgeldin" ? "welcomeChannelId" : "goodbyeChannelId";
    return setChannel(message, type, message.mentions.channels.first());
  }
  if (["kelime-kanal", "sayisayma", "dc-ceza", "mc-ceza", "mcsohbet"].includes(command)) {
    const key = { "kelime-kanal": "wordGameChannelId", sayisayma: "countChannelId", "dc-ceza": "punishmentChannelId", "mc-ceza": "mcPunishmentChannelId", mcsohbet: "mcChatChannelId" }[command];
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply(`Kullanım: \`${prefix}${command} #kanal\``);
    guildConfig[key] = channel.id; if (key === "countChannelId") guildConfig.countNext = 1; save();
    return message.reply(`✅ ${channel} ayarlandı.`);
  }
  if (command === "owner-ekle" || command === "owner-cikar") {
    if (!isOwner(message.author.id, guildConfig)) return message.reply("❌ Sadece owner kullanabilir.");
    const user = message.mentions.users.first();
    if (!user) return message.reply(`Kullanım: \`${prefix}${command} @üye\``);
    if (command === "owner-ekle" && !guildConfig.owners.includes(user.id)) guildConfig.owners.push(user.id);
    if (command === "owner-cikar") guildConfig.owners = guildConfig.owners.filter(id => id !== user.id);
    save(); return message.reply("✅ Owner listesi güncellendi.");
  }
  if (command === "owner-list") return message.reply({ embeds: [embed("👑 Owner Listesi", [...OWNER_IDS, ...guildConfig.owners].map(id => `<@${id}>`).join("\n") || "Yok.")] });
  if (command === "siteekle") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    guildConfig.site = args[0]; save(); return message.reply(`✅ Site: ${guildConfig.site}`);
  }
  if (command === "sitecikar") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    guildConfig.site = null; save(); return message.reply("✅ Site kaldırıldı.");
  }
  if (command === "aktif") return message.reply({ embeds: [embed("✅ Bot Aktif", `🌐 Site: ${guildConfig.site || "Yok"}\n🎮 Minecraft: \`${MC_HOST}\``, 0x2ecc71)] });
  if (command === "bakim") {
    if (!canManage(message.member, guildConfig, "manage")) return message.reply("❌ Yetkin yok.");
    guildConfig.maintenance = ["aç", "ac", "on"].includes((args[0] || "").toLowerCase()); save();
    return message.reply(`✅ Bakım modu ${guildConfig.maintenance ? "açıldı" : "kapatıldı"}.`);
  }
}

client.once("ready", async () => {
  console.log(`✅ ${client.user.tag} olarak giriş yapıldı.`);
  await registerCommands();
  await updatePresence();
  setInterval(updatePresence, 60_000);
  console.log("✅ Slash komutları kaydedildi; bot çalışıyor.");
});

client.on("guildMemberAdd", async member => {
  const guildConfig = cfg(member.guild.id);
  if (guildConfig.autoRoleId) {
    const role = member.guild.roles.cache.get(guildConfig.autoRoleId);
    if (role) await member.roles.add(role).catch(() => {});
  }
  const channel = guildConfig.welcomeChannelId && member.guild.channels.cache.get(guildConfig.welcomeChannelId);
  if (channel?.isTextBased()) {
    await channel.send({ embeds: [embed("👋 Hoş Geldin!", `${member} sunucuya hoş geldin!\n\nKuralları okuyup sohbete başlayabilirsin. Sunucuda şu an **${member.guild.memberCount}** kişi var.`, 0x2ecc71)] });
  }
});

client.on("guildMemberRemove", async member => {
  const guildConfig = cfg(member.guild.id);
  const channel = guildConfig.goodbyeChannelId && member.guild.channels.cache.get(guildConfig.goodbyeChannelId);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed("👋 Güle Güle!", `**${member.user.tag}** sunucudan ayrıldı.\nSunucuda şu an **${member.guild.memberCount}** kişi var.`, 0xed4245)] });
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;
  const guildConfig = cfg(message.guild.id);
  const text = message.content.trim();

  if (/^(s\.?a\.?|sa)$/i.test(text)) {
    await message.reply("Aleyküm Selam, Hoş Geldin! 👋");
  }

  const isStaff = canManage(message.member, guildConfig, "manage");
  const hasUrl = /(https?:\/\/|www\.|discord\.gg\/)/i.test(text);
  if (guildConfig.linkProtection && hasUrl && !isStaff) {
    await message.delete().catch(() => {});
    await applyMute(message.member, 86_400_000, "Link koruması", null, guildConfig, true).catch(() => {});
    return;
  }

  const protectedMention = guildConfig.protectRoleIds.some(id => message.mentions.roles.has(id));
  if (protectedMention && !isStaff) {
    await message.delete().catch(() => {});
    await applyMute(message.member, 3_600_000, "Korumalı rolü etiketleme", null, guildConfig, true).catch(() => {});
    return;
  }

  if (guildConfig.wordGameChannelId === message.channel.id && !text.startsWith(guildConfig.prefix)) {
    if (!/^[^\s]+$/.test(text)) return message.delete().catch(() => {});
    if (guildConfig.wordLastUserId === message.author.id) return message.delete().catch(() => {});
    guildConfig.wordLastUserId = message.author.id; save();
    return message.react("✅").catch(() => {});
  }

  if (guildConfig.countChannelId === message.channel.id && !text.startsWith(guildConfig.prefix)) {
    const number = Number(text);
    if (!Number.isInteger(number)) return message.delete().catch(() => {});
    if (guildConfig.wordLastUserId === message.author.id || number !== guildConfig.countNext) {
      await message.react("🔴").catch(() => {});
      return message.delete().catch(() => {});
    }
    guildConfig.wordLastUserId = message.author.id;
    guildConfig.countNext++;
    save();
    return message.react("✅").catch(() => {});
  }

  if (text.startsWith(guildConfig.prefix)) await handlePrefix(message);
});

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) return handleSlash(interaction).catch(error => {
    console.error(error);
    const payload = { content: "❌ Komut çalıştırılırken hata oluştu.", ephemeral: true };
    return interaction.replied || interaction.deferred ? interaction.editReply(payload).catch(() => {}) : interaction.reply(payload).catch(() => {});
  });
  if (!interaction.isButton() || !interaction.guild) return;
  const guildConfig = cfg(interaction.guild.id);
  if (interaction.customId === "ticket:open") {
    const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18)}`);
    if (existing) return interaction.reply({ content: `❌ Zaten açık ticketın var: ${existing}`, ephemeral: true });
    const permissionOverwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
    ];
    if (guildConfig.staffRoleId) permissionOverwrites.push({ id: guildConfig.staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18)}`,
      type: ChannelType.GuildText,
      parent: guildConfig.ticketCategoryId || undefined,
      permissionOverwrites,
    }).catch(() => null);
    if (!channel) return interaction.reply({ content: "❌ Ticket kanalı oluşturulamadı.", ephemeral: true });
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId("ticket:claim").setLabel("✋ Üstlen").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("ticket:close").setLabel("🔒 Kapat").setStyle(ButtonStyle.Danger),
      );
    await channel.send({ content: `${interaction.user} ticket açtı. Yetkili ekibi en kısa sürede ilgilenecek.`, components: [row] });
    return interaction.reply({ content: `✅ Ticket oluşturuldu: ${channel}`, ephemeral: true });
  }
  if (interaction.customId === "ticket:claim") {
    if (!canManage(interaction.member, guildConfig, "manage")) return interaction.reply({ content: "❌ Sadece yetkililer üstlenebilir.", ephemeral: true });
    return interaction.reply(`✋ Ticket ${interaction.user} tarafından üstlenildi.`);
  }
  if (interaction.customId === "ticket:close") {
    if (!canManage(interaction.member, guildConfig, "manage")) return interaction.reply({ content: "❌ Sadece yetkililer kapatabilir.", ephemeral: true });
    await interaction.reply("🔒 Ticket 5 saniye içinde kapatılıyor.");
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
});

// Minecraft plugin/RCON köprüsü için basit webhook.
// POST /minecraft/event
// Header: x-webhook-secret: MC_WEBHOOK_SECRET
// Body örnekleri:
// { "type":"chat", "player":"Steve", "message":"Merhaba" }
// { "type":"punishment", "player":"Steve", "action":"BAN", "reason":"Hile" }
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, bot: client.isReady(), time: new Date().toISOString() }));
  }
  if (req.method !== "POST" || req.url !== "/minecraft/event") {
    res.writeHead(404); return res.end("Not found");
  }
  let body = "";
  req.on("data", chunk => { body += chunk; if (body.length > 100_000) req.destroy(); });
  req.on("end", async () => {
    if (process.env.MC_WEBHOOK_SECRET && req.headers["x-webhook-secret"] !== process.env.MC_WEBHOOK_SECRET) {
      res.writeHead(401); return res.end("Unauthorized");
    }
    try {
      const event = JSON.parse(body);
      const guild = process.env.GUILD_ID && client.guilds.cache.get(process.env.GUILD_ID);
      if (guild) {
        const guildConfig = cfg(guild.id);
        const isChat = event.type === "chat";
        const channelId = isChat ? guildConfig.mcChatChannelId : guildConfig.mcPunishmentChannelId;
        const channel = channelId && guild.channels.cache.get(channelId);
        if (channel?.isTextBased()) {
          const title = isChat ? "💬 Minecraft Sohbet" : `⚖️ Minecraft Ceza — ${String(event.action || "İŞLEM").toUpperCase()}`;
          const desc = isChat ? `**${clean(event.player, 80)}:** ${clean(event.message, 1500)}` : `👤 Oyuncu: **${clean(event.player, 80)}**\n📄 Sebep: **${clean(event.reason, 500)}**\n⏱️ Süre: **${clean(event.duration, 100)}`;
          await channel.send({ embeds: [embed(title, desc, isChat ? 0x3498db : 0xed4245)] });
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400); res.end("Invalid JSON");
    }
  });
});

server.listen(Number(process.env.PORT || 10000), "0.0.0.0", () => {
  console.log(`✅ Health/webhook server :${process.env.PORT || 10000} portunda.`);
});

client.login(TOKEN).catch(error => {
  console.error("Discord giriş hatası:", error.message);
  process.exit(1);
});

process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));
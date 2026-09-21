/**
 * Cubixora SMP Discord Botu
 * ------------------------------------------------------------
 * Kurulum:
 *   npm i discord.js express minecraft-server-util
 *   Node.js 18+
 *
 * Render ortam değişkenleri:
 *   DISCORD_TOKEN        = Bot tokeni
 *   CLIENT_ID            = Discord application ID
 *   GUILD_ID             = Komutların hızlı yüklenmesi için sunucu ID'si
 *   PREFIX               = e!  (varsayılan)
 *   MC_HOST              = cubixorasmp.play.hosting
 *   MC_JAVA_PORT         = 25565
 *   MC_BEDROCK_PORT      = 19132
 *   MC_RCON_HOST         = (isteğe bağlı)
 *   MC_RCON_PORT         = 25575
 *   MC_RCON_PASSWORD     = (isteğe bağlı)
 *   PORT                 = Render'ın verdiği port
 *
 * Discord Developer Portal > Bot > Privileged Gateway Intents:
 *   Server Members Intent, Message Content Intent, Presence Intent açılmalıdır.
 *
 * Not:
 *   - Discord slash komut adlarında Türkçe karakter kullanılamaz.
 *     Bu nedenle /çekiliş yerine /cekilis, /anket, /ticket-kur kullanılır.
 *   - Minecraft sohbet/ceza olaylarının Minecraft'tan Discord'a otomatik
 *     aktarılması için RCON veya sunucu eklentisinin bu botun webhook'una
 *     veri göndermesi gerekir. Bot, canlı sunucu sayısını ve çevrim içi
 *     durumunu tek başına gösterir.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

let minecraftUtil = null;
try {
  minecraftUtil = require("minecraft-server-util");
} catch {
  console.warn("[MC] minecraft-server-util bulunamadı; MC durum sorgusu kapalı.");
}

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "settings.json");
const PREFIX = process.env.PREFIX || "e!";
const MC_HOST = process.env.MC_HOST || "cubixorasmp.play.hosting";
const MC_JAVA_PORT = Number(process.env.MC_JAVA_PORT || 25565);
const MC_BEDROCK_PORT = Number(process.env.MC_BEDROCK_PORT || 19132);
const SITE_URL = "https://cubixoraweb.onrender.com";
const COLORS = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  orange: 0xf39c12,
  blue: 0x3498db,
  purple: 0x9b59b6,
  gray: 0x5865f2,
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  guilds: {},
  owners: [],
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
  } catch (error) {
    console.error("[DATA] settings.json okunamadı:", error.message);
    return structuredClone(DEFAULTS);
  }
}

let db = loadData();
let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }, 250);
}

function guildSettings(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      prefix: PREFIX,
      welcomeChannelId: null,
      goodbyeChannelId: null,
      punishmentChannelId: null,
      mcPunishmentChannelId: null,
      mcChatChannelId: null,
      autoRoleId: null,
      protectionRoleId: null,
      linkProtection: false,
      wordChannelId: null,
      countChannelId: null,
      ticket: { roleId: null, title: "Destek Talebi", text: "Yetkililerimiz kısa süre içinde ilgilenecektir." },
      website: SITE_URL,
      active: true,
      activeText: "Cubixora SMP",
      wordGame: { lastWord: null, lastUserId: null },
      countGame: { next: 1, lastUserId: null },
      mutes: {},
      giveaways: {},
      polls: {},
    };
    saveData();
  }
  return db.guilds[guildId];
}

function mentionUser(user) {
  return user ? `<@${user.id}>` : "Bilinmeyen üye";
}

function mentionRole(roleId) {
  return roleId ? `<@&${roleId}>` : "Ayarlanmamış";
}

function parseDuration(value, unit = "dakika") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const factors = {
    saniye: 1000,
    saniye: 1000,
    dakika: 60 * 1000,
    saat: 60 * 60 * 1000,
    gün: 24 * 60 * 60 * 1000,
    gun: 24 * 60 * 60 * 1000,
    hafta: 7 * 24 * 60 * 60 * 1000,
  };
  return factors[String(unit).toLocaleLowerCase("tr-TR")] ? amount * factors[String(unit).toLocaleLowerCase("tr-TR")] : null;
}

function durationText(ms) {
  if (!ms) return "Süresiz";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} saniye`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dakika`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat`;
  return `${Math.floor(hours / 24)} gün`;
}

function splitArgs(input) {
  const matches = input.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ""));
}

function getMemberFromArg(message, text) {
  const id = String(text || "").replace(/[<@!>]/g, "");
  return message.mentions.members.first() || message.guild.members.cache.get(id) || null;
}

function isOwner(member) {
  return Boolean(member && (db.owners.includes(member.id) || member.id === member.guild.ownerId));
}

function canManage(member, permission) {
  return Boolean(member && (isOwner(member) || member.permissions.has(permission)));
}

function canUseRole(member, roleId, permission) {
  if (!member) return false;
  return isOwner(member) || member.permissions.has(permission) || (roleId && member.roles.cache.has(roleId));
}

function cleanText(text, max = 1024) {
  return String(text || "").replace(/@everyone|@here/g, "@\u200beveryone").slice(0, max);
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(COLORS.red).setDescription(`❌ ${message}`);
}

function successEmbed(message) {
  return new EmbedBuilder().setColor(COLORS.green).setDescription(`✅ ${message}`);
}

function infoEmbed(title, description) {
  return new EmbedBuilder().setColor(COLORS.blue).setTitle(title).setDescription(description);
}

async function reply(messageOrInteraction, payload) {
  if (messageOrInteraction.isChatInputCommand?.()) {
    if (messageOrInteraction.replied || messageOrInteraction.deferred) return messageOrInteraction.followUp(payload);
    return messageOrInteraction.reply(payload);
  }
  return messageOrInteraction.reply(payload);
}

async function sendLog(guild, type, data) {
  const settings = guildSettings(guild.id);
  const channelId = type === "mc" ? settings.mcPunishmentChannelId : settings.punishmentChannelId;
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return;

  const colors = { mute: COLORS.orange, ban: COLORS.red, unmute: COLORS.green, welcome: COLORS.green, link: COLORS.red };
  const titles = { mute: "🔇 Discord Ceza — MUTE", ban: "🔨 Discord Ceza — BAN", unmute: "🔓 Ceza Kaldırıldı — UNMUTE", welcome: "✅ Üye İşlemi", link: "🔗 Link Koruma" };
  const embed = new EmbedBuilder()
    .setColor(colors[type] || COLORS.gray)
    .setTitle(titles[type] || "📋 İşlem Logu")
    .setTimestamp();

  for (const [name, value] of Object.entries(data || {})) {
    embed.addFields({ name: cleanText(name, 256), value: cleanText(value, 1024), inline: false });
  }
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function safeDelete(message) {
  if (message.deletable) await message.delete().catch(() => {});
}

async function timeoutMember(member, durationMs, reason) {
  if (!member.moderatable) throw new Error("Bu üyeyi susturamıyorum. Bot rolünü hedef rolden yukarı taşıyın.");
  const max = 28 * 24 * 60 * 60 * 1000;
  await member.timeout(Math.min(durationMs, max), reason);
}

function makeWelcomeEmbed(member, count) {
  return new EmbedBuilder()
    .setColor(COLORS.green)
    .setTitle("👋 Hoş Geldin!")
    .setDescription(`**${member.user.username}**, ${member.guild.name} sunucusuna hoş geldin ${member}!`)
    .addFields(
      { name: "📚 Başlangıç", value: "Kuralları okuyup onayladıktan sonra sohbete başlayabilirsin.", inline: false },
      { name: "👥 Sunucudaki Üye", value: String(count), inline: true },
    )
    .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }))
    .setFooter({ text: "Cubixora SMP • Hoş geldin" })
    .setTimestamp();
}

function makeGoodbyeEmbed(member, count) {
  return new EmbedBuilder()
    .setColor(COLORS.red)
    .setTitle("👋 Güle Güle!")
    .setDescription(`**${member.user.username}** sunucudan ayrıldı. Güle güle! 😢`)
    .addFields({ name: "👥 Kalan Üye", value: String(count), inline: true })
    .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }))
    .setFooter({ text: "Cubixora SMP • Üye sistemi" })
    .setTimestamp();
}

function commandHelp() {
  return [
    `**${PREFIX}ip** — Java/Bedrock sunucu bilgisi`,
    `**${PREFIX}sil <1-1000>** — Mesaj temizler`,
    `**${PREFIX}ban @üye [sebep]** — Üye banlar`,
    `**${PREFIX}mute @üye <süre> <birim> [sebep]** — Üyeyi susturur`,
    `**${PREFIX}unmute @üye** — Susturmayı kaldırır`,
    `**${PREFIX}koruma-rolism @rol** — Koruma rolü ayarlar`,
    `**${PREFIX}koruma-list / koruma-cikar** — Koruma ayarları`,
    `**${PREFIX}hoşgeldin-kanal #kanal** / **${PREFIX}gülegüle-kanal #kanal**`,
    `**${PREFIX}kelime-kanal #kanal** / **${PREFIX}sayısayma-kanal #kanal**`,
    `**${PREFIX}dc-ceza #kanal** / **${PREFIX}mc-ceza #kanal** / **${PREFIX}mcsohbet #kanal**`,
    `**${PREFIX}likkoruma** / **${PREFIX}likkormakapat**`,
    `**${PREFIX}ticket-kur @rol | başlık | metin**`,
    `**${PREFIX}owner-ekle @üye** / **owner-list** / **owner-çıkar @üye**`,
    `**${PREFIX}siteekle <url>** / **site-cikar** / **site** / **aktif**`,
    "**/cekilis** — Çekiliş başlatır",
    "**/anket** — En az iki seçenekli anket açar",
    "**/ticket-kur** — Ticket paneli gönderir",
  ].join("\n");
}

async function getMinecraftStatus() {
  if (!minecraftUtil) return null;
  try {
    const java = await minecraftUtil.status(MC_HOST, MC_JAVA_PORT, { timeout: 5000 });
    return {
      online: true,
      players: java.players?.online ?? 0,
      max: java.players?.max ?? "?",
      version: java.version?.name || "Java 1.16.5",
      address: `${MC_HOST}:${MC_JAVA_PORT}`,
      bedrock: `${MC_HOST}:${MC_BEDROCK_PORT}`,
    };
  } catch {
    try {
      const bedrock = await minecraftUtil.statusBedrock(MC_HOST, MC_BEDROCK_PORT, { timeout: 5000 });
      return {
        online: true,
        players: bedrock.players?.online ?? 0,
        max: bedrock.players?.max ?? "?",
        version: bedrock.version?.name || "Bedrock",
        address: `${MC_HOST}:${MC_JAVA_PORT}`,
        bedrock: `${MC_HOST}:${MC_BEDROCK_PORT}`,
      };
    } catch {
      return { online: false, players: 0, max: "?", address: `${MC_HOST}:${MC_JAVA_PORT}`, bedrock: `${MC_HOST}:${MC_BEDROCK_PORT}` };
    }
  }
}

async function setMinecraftPresence() {
  if (!client.user) return;
  const status = await getMinecraftStatus();
  const settingsList = Object.values(db.guilds);
  const active = settingsList.find((item) => item.active);
  const text = active?.activeText || "Cubixora SMP";
  if (!status) return client.user.setActivity(text, { type: 0 });
  client.user.setActivity(`${text} • ${status.players} kişi`, { type: 0 });
}

async function createTicket(interaction, settings) {
  const guild = interaction.guild;
  const existing = guild.channels.cache.find((channel) => channel.topic === `ticket:${interaction.user.id}`);
  if (existing) return interaction.reply({ embeds: [errorEmbed(`Zaten açık bir ticket'ın var: ${existing}`)], ephemeral: true });

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 18);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
  ];
  if (settings.ticket.roleId) {
    overwrites.push({ id: settings.ticket.roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }
  const channel = await guild.channels.create({
    name: `ticket-${safeName}`,
    type: ChannelType.GuildText,
    topic: `ticket:${interaction.user.id}`,
    permissionOverwrites: overwrites,
  });
  const closeButton = new ButtonBuilder().setCustomId("ticket_close").setLabel("Ticket Kapat").setEmoji("🔒").setStyle(ButtonStyle.Danger);
  await channel.send({
    content: `${interaction.user} ${settings.ticket.roleId ? mentionRole(settings.ticket.roleId) : ""}`,
    embeds: [new EmbedBuilder().setColor(COLORS.gray).setTitle(settings.ticket.title).setDescription(settings.ticket.text).setFooter({ text: "Ticket sahibi ve yetkililer görebilir." })],
    components: [new ActionRowBuilder().addComponents(closeButton)],
  });
  return interaction.reply({ embeds: [successEmbed(`Ticket oluşturuldu: ${channel}`)], ephemeral: true });
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName("ip").setDescription("Cubixora SMP Java ve Bedrock bilgilerini gösterir"),
    new SlashCommandBuilder()
      .setName("otorol-ayarla")
      .setDescription("Sunucuya girenlere otomatik verilecek rolü ayarlar")
      .addRoleOption((option) => option.setName("rol").setDescription("Otomatik verilecek rol").setRequired(true)),
    new SlashCommandBuilder()
      .setName("cekilis")
      .setDescription("Çekiliş başlatır")
      .addStringOption((o) => o.setName("baslik").setDescription("Çekiliş başlığı").setRequired(true))
      .addStringOption((o) => o.setName("odul").setDescription("Birinci ödül").setRequired(true))
      .addIntegerOption((o) => o.setName("kazanan").setDescription("Kazanan sayısı").setMinValue(1).setMaxValue(50).setRequired(true))
      .addIntegerOption((o) => o.setName("sure").setDescription("Süre miktarı").setMinValue(1).setMaxValue(100000).setRequired(true))
      .addStringOption((o) => o.setName("birim").setDescription("Süre birimi").setRequired(true).addChoices(
        { name: "Saniye", value: "saniye" }, { name: "Dakika", value: "dakika" }, { name: "Saat", value: "saat" }, { name: "Gün", value: "gün" },
      ))
      .addStringOption((o) => o.setName("ikinci_odul").setDescription("İkinci ödül").setRequired(false)),
    new SlashCommandBuilder()
      .setName("anket")
      .setDescription("En az iki seçenekli anket açar")
      .addStringOption((o) => o.setName("baslik").setDescription("Anket başlığı").setRequired(true))
      .addStringOption((o) => o.setName("secenekler").setDescription("Seçenekleri virgülle ayırın").setRequired(true))
      .addIntegerOption((o) => o.setName("sure").setDescription("Süre miktarı").setMinValue(1).setRequired(true))
      .addStringOption((o) => o.setName("birim").setDescription("Süre birimi").setRequired(true).addChoices(
        { name: "Dakika", value: "dakika" }, { name: "Saat", value: "saat" }, { name: "Gün", value: "gün" },
      )),
    new SlashCommandBuilder()
      .setName("ticket-kur")
      .setDescription("Ticket panelini mevcut kanala gönderir")
      .addRoleOption((o) => o.setName("yetkili").setDescription("Ticket yetkili rolü").setRequired(true))
      .addStringOption((o) => o.setName("baslik").setDescription("Panel başlığı").setRequired(true))
      .addStringOption((o) => o.setName("metin").setDescription("Panel açıklaması").setRequired(true)),
    new SlashCommandBuilder().setName("likkoruma").setDescription("Discord davet linki korumasını açar"),
    new SlashCommandBuilder().setName("likkormakapat").setDescription("Discord davet linki korumasını kapatır"),
    new SlashCommandBuilder().setName("yardim").setDescription("Bot komutlarını gösterir"),
  ].map((command) => command.toJSON());
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

client.once("clientReady", async () => {
  console.log(`[BOT] ${client.user.tag} olarak giriş yapıldı.`);
  try {
    if (process.env.GUILD_ID) {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      await guild.commands.set(buildSlashCommands());
      console.log(`[SLASH] ${guild.name} komutları yüklendi.`);
    } else {
      await client.application.commands.set(buildSlashCommands());
      console.log("[SLASH] Genel komutlar yüklendi; Discord'a yayılması zaman alabilir.");
    }
  } catch (error) {
    console.error("[SLASH] Komut yükleme hatası:", error.message);
  }
  await setMinecraftPresence();
  setInterval(setMinecraftPresence, 60_000);
});

client.on("guildMemberAdd", async (member) => {
  const settings = guildSettings(member.guild.id);
  if (settings.autoRoleId) {
    const role = member.guild.roles.cache.get(settings.autoRoleId);
    if (role && role.position < member.guild.members.me.roles.highest.position) await member.roles.add(role).catch(() => {});
  }
  const channel = settings.welcomeChannelId && member.guild.channels.cache.get(settings.welcomeChannelId);
  if (channel?.isTextBased()) await channel.send({ content: `👋 Hoş geldin ${member}!`, embeds: [makeWelcomeEmbed(member, member.guild.memberCount)] }).catch(() => {});
});

client.on("guildMemberRemove", async (member) => {
  const settings = guildSettings(member.guild.id);
  const channel = settings.goodbyeChannelId && member.guild.channels.cache.get(settings.goodbyeChannelId);
  if (channel?.isTextBased()) await channel.send({ content: `👋 Güle güle **${member.user.username}**!`, embeds: [makeGoodbyeEmbed(member, member.guild.memberCount)] }).catch(() => {});
});

client.on("messageDelete", async () => {});

const invitePattern = /(discord(?:\.gg|\.com\/invite|app\.com\/invite)\/[a-z0-9-]+)/i;
const URL_PATTERN = /https?:\/\/\S+/i;

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  const settings = guildSettings(message.guild.id);
  const content = message.content.trim();

  if (/^(s\.?a|sa)$/i.test(content)) {
    return message.reply("**Aleyküm Selam, hoş geldin!** 👋").catch(() => {});
  }

  if (settings.protectionRoleId && message.mentions.roles.has(settings.protectionRoleId)) {
    await safeDelete(message);
    const member = message.member;
    if (member && !member.permissions.has(PermissionsBitField.Flags.Administrator) && !isOwner(member)) {
      try {
        await timeoutMember(member, 60 * 60 * 1000, "Koruma rolünü etiketleme");
        await sendLog(message.guild, "mute", {
          "👤 Cezalandırılan Üye": `${member.user.tag} (${member.id})`,
          "👮 Yetkili": "Otomatik Koruma Sistemi",
          "⏱️ Mute Süresi": "1 saat",
          "📄 Ceza Sebebi": "Koruma rolünü etiketleme",
        });
      } catch {}
    }
    return;
  }

  if (settings.linkProtection && invitePattern.test(content)) {
    await safeDelete(message);
    const member = message.member;
    if (member && !member.permissions.has(PermissionsBitField.Flags.Administrator) && !isOwner(member)) {
      try {
        await timeoutMember(member, 24 * 60 * 60 * 1000, "Yetkisiz Discord sunucu linki");
        await sendLog(message.guild, "link", {
          "👤 Cezalandırılan Üye": `${member.user.tag} (${member.id})`,
          "⏱️ Mute Süresi": "1 gün",
          "📄 Ceza Sebebi": "Başka sunucu davet linki paylaşımı",
        });
      } catch {}
    }
    return;
  }

  if (settings.wordChannelId === message.channel.id && !content.startsWith(settings.prefix)) {
    const word = content.toLocaleLowerCase("tr-TR").replace(/[^a-zçğıöşü0-9]/gi, "");
    const previous = settings.wordGame;
    if (!word || previous.lastUserId === message.author.id) {
      await safeDelete(message);
      return;
    }
    previous.lastWord = word;
    previous.lastUserId = message.author.id;
    await message.react("✅").catch(() => {});
  }

  if (settings.countChannelId === message.channel.id && !content.startsWith(settings.prefix)) {
    const number = Number(content);
    if (number !== settings.countGame.next || settings.countGame.lastUserId === message.author.id) {
      await safeDelete(message);
      await message.channel.send({ content: "🔴 Sıra veya sayı hatalı!" }).then((m) => setTimeout(() => m.delete().catch(() => {}), 3000)).catch(() => {});
      return;
    }
    settings.countGame.next += 1;
    settings.countGame.lastUserId = message.author.id;
    await message.react("✅").catch(() => {});
    saveData();
  }

  if (!content.toLocaleLowerCase("tr-TR").startsWith(settings.prefix.toLocaleLowerCase("tr-TR"))) return;
  const raw = content.slice(settings.prefix.length).trim();
  const [command, ...args] = splitArgs(raw);
  const cmd = (command || "").toLocaleLowerCase("tr-TR");

  if (cmd === "yardım" || cmd === "help") return message.reply({ embeds: [infoEmbed("📖 Cubixora Bot Komutları", commandHelp())] });

  if (cmd === "ip") {
    const status = await getMinecraftStatus();
    const online = status?.online ? `🟢 Açık — ${status.players}/${status.max}` : "🔴 Kapalı veya sorgulanamıyor";
    return message.reply({ embeds: [new EmbedBuilder().setColor(status?.online ? COLORS.green : COLORS.red).setTitle("🌐 Cubixora SMP Sunucu Bilgileri").addFields(
      { name: "☕ Java 1.16.5", value: `\`${MC_HOST}:${MC_JAVA_PORT}\``, inline: false },
      { name: "📱 Bedrock", value: `\`${MC_HOST}\`\nPort: \`${MC_BEDROCK_PORT}\``, inline: false },
      { name: "📡 Durum", value: online, inline: false },
      { name: "🌍 Site", value: settings.website || SITE_URL, inline: false },
    ).setFooter({ text: "Cubixora SMP • Sunucu bilgileri" }).setTimestamp()] });
  }

  if (cmd === "sil" || cmd === "temizle") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageMessages)) return message.reply({ embeds: [errorEmbed("Bu komut için Mesajları Yönet yetkisi veya owner olmalısın.")] });
    const amount = Number(args[0]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000) return message.reply({ embeds: [errorEmbed("1 ile 1000 arasında bir sayı yazmalısın.")] });
    const deleted = await message.channel.bulkDelete(amount, true).catch(() => null);
    if (!deleted) return message.reply({ embeds: [errorEmbed("Mesajlar silinemedi; botun Mesajları Yönet iznini kontrol edin.")] });
    const info = await message.channel.send({ embeds: [successEmbed(`${deleted.size} mesaj silindi.`)] });
    setTimeout(() => info.delete().catch(() => {}), 4000);
    return;
  }

  if (cmd === "ban") {
    if (!canUseRole(message.member, settings.banRoleId, PermissionsBitField.Flags.BanMembers)) return message.reply({ embeds: [errorEmbed("Ban yetkin yok.")] });
    const target = getMemberFromArg(message, args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed("Banlanacak üyeyi etiketle.")] });
    if (!target.bannable) return message.reply({ embeds: [errorEmbed("Bu üyeyi banlayamıyorum; rol hiyerarşisini kontrol edin.")] });
    const reason = args.slice(1).join(" ") || "Sebep belirtilmedi";
    await target.ban({ reason }).catch((error) => { throw error; });
    await sendLog(message.guild, "ban", {
      "👤 Cezalandırılan Üye": `${target.user.tag} (${target.id})`,
      "👮 Yetkili": `${message.author.tag}`,
      "📄 Ban Sebebi": reason,
    });
    return message.reply({ embeds: [successEmbed(`${target.user.tag} banlandı.`)] });
  }

  if (cmd === "mute") {
    if (!canUseRole(message.member, settings.muteRoleId, PermissionsBitField.Flags.ModerateMembers)) return message.reply({ embeds: [errorEmbed("Mute yetkin yok.")] });
    const target = getMemberFromArg(message, args[0]);
    const duration = parseDuration(args[1], args[2] || "dakika");
    if (!target || !duration) return message.reply({ embeds: [errorEmbed(`Kullanım: ${settings.prefix}mute @üye <süre> <saniye|dakika|saat|gün> [sebep]`)] });
    const reason = args.slice(3).join(" ") || "Sebep belirtilmedi";
    await timeoutMember(target, duration, reason);
    await sendLog(message.guild, "mute", {
      "👤 Cezalandırılan Üye": `${target.user.tag} (${target.id})`,
      "👮 Yetkili": `${message.author.tag}`,
      "⏱️ Mute Süresi": durationText(duration),
      "📄 Ceza Sebebi": reason,
    });
    return message.reply({ embeds: [successEmbed(`${target.user.tag}, ${durationText(duration)} susturuldu.`)] });
  }

  if (cmd === "unmute") {
    if (!canManage(message.member, PermissionsBitField.Flags.ModerateMembers)) return message.reply({ embeds: [errorEmbed("Mute kaldırma yetkin yok.")] });
    const target = getMemberFromArg(message, args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed("Üyeyi etiketle.")] });
    await target.timeout(null, "Yetkili tarafından mute kaldırıldı");
    await sendLog(message.guild, "unmute", {
      "👤 Susturması Kaldırılan Üye": `${target.user.tag} (${target.id})`,
      "👮 İşlemi Gerçekleştiren": message.author.tag,
      "📄 Açılma Sebebi": "Bir yetkili tarafından manuel olarak açıldı.",
    });
    return message.reply({ embeds: [successEmbed(`${target.user.tag} artık susturulmuyor.`)] });
  }

  if (cmd === "otorol-ayarla" || cmd === "otorol-ayarla-rolsim") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageRoles)) return message.reply({ embeds: [errorEmbed("Rol yönetme yetkin yok.")] });
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]?.replace(/[<@&>]/g, ""));
    if (!role) return message.reply({ embeds: [errorEmbed(`Kullanım: ${settings.prefix}otorol-ayarla @Rol`)] });
    settings.autoRoleId = role.id;
    saveData();
    return message.reply({ embeds: [successEmbed(`${role} otomatik rol olarak ayarlandı.`)] });
  }

  if (cmd === "hoşgeldin-kanal" || cmd === "hosgeldin-kanal") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]?.replace(/[<#>]/g, ""));
    if (!channel) return message.reply({ embeds: [errorEmbed("Bir kanal etiketle.")] });
    settings.welcomeChannelId = channel.id;
    saveData();
    return message.reply({ embeds: [successEmbed(`Hoş geldin kanalı ${channel} olarak ayarlandı.`)] });
  }

  if (cmd === "gülegüle-kanal" || cmd === "gulegule-kanal") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]?.replace(/[<#>]/g, ""));
    if (!channel) return message.reply({ embeds: [errorEmbed("Bir kanal etiketle.")] });
    settings.goodbyeChannelId = channel.id;
    saveData();
    return message.reply({ embeds: [successEmbed(`Güle güle kanalı ${channel} olarak ayarlandı.`)] });
  }

  if (cmd === "koruma-rolism" || cmd === "koruma-rol") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]?.replace(/[<@&>]/g, ""));
    if (!role) return message.reply({ embeds: [errorEmbed("Korunacak rolü etiketle.")] });
    settings.protectionRoleId = role.id;
    saveData();
    return message.reply({ embeds: [successEmbed(`${role} koruma rolü olarak ayarlandı. Etiketleyen 1 saat susturulur.`)] });
  }

  if (cmd === "koruma-list") return message.reply({ embeds: [infoEmbed("🛡️ Koruma Ayarları", `Koruma rolü: ${mentionRole(settings.protectionRoleId)}\nLink koruma: ${settings.linkProtection ? "Açık" : "Kapalı"}`)] });
  if (cmd === "koruma-cikar") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    settings.protectionRoleId = null;
    saveData();
    return message.reply({ embeds: [successEmbed("Koruma rolü kaldırıldı.")] });
  }

  if (cmd === "dc-ceza" || cmd === "ceza-kanal") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]?.replace(/[<#>]/g, ""));
    if (!channel) return message.reply({ embeds: [errorEmbed("Bir log kanalı etiketle.")] });
    settings.punishmentChannelId = channel.id;
    saveData();
    return message.reply({ embeds: [successEmbed(`Discord ceza log kanalı ${channel} olarak ayarlandı.`)] });
  }

  if (cmd === "mc-ceza") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]?.replace(/[<#>]/g, ""));
    if (!channel) return message.reply({ embeds: [errorEmbed("Bir kanal etiketle.")] });
    settings.mcPunishmentChannelId = channel.id;
    saveData();
    return message.reply({ embeds: [successEmbed(`Minecraft ceza log kanalı ${channel} olarak ayarlandı.`)] });
  }

  if (cmd === "mcsohbet" || cmd === "mc-sohbet") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]?.replace(/[<#>]/g, ""));
    if (!channel) return message.reply({ embeds: [errorEmbed("Bir kanal etiketle.")] });
    settings.mcChatChannelId = channel.id;
    saveData();
    return message.reply({ embeds: [successEmbed(`Minecraft sohbet kanalı ${channel} olarak ayarlandı.`)] });
  }

  if (cmd === "kelime-kanal") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]?.replace(/[<#>]/g, ""));
    if (!channel) return message.reply({ embeds: [errorEmbed("Bir kanal etiketle.")] });
    settings.wordChannelId = channel.id;
    settings.wordGame = { lastWord: null, lastUserId: null };
    saveData();
    return message.reply({ embeds: [successEmbed(`Kelime oyunu kanalı ${channel} olarak ayarlandı.`)] });
  }

  if (cmd === "sayısayma-kanal" || cmd === "sayisayma-kanal") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]?.replace(/[<#>]/g, ""));
    if (!channel) return message.reply({ embeds: [errorEmbed("Bir kanal etiketle.")] });
    settings.countChannelId = channel.id;
    settings.countGame = { next: 1, lastUserId: null };
    saveData();
    return message.reply({ embeds: [successEmbed(`Sayı sayma kanalı ${channel} olarak ayarlandı. İlk sayı: 1`)] });
  }

  if (cmd === "likkoruma") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Koruma açma yetkin yok.")] });
    settings.linkProtection = true;
    saveData();
    return message.reply({ embeds: [successEmbed("Link koruması açıldı. Discord davet linki atanlar 1 gün susturulur.")] });
  }
  if (cmd === "likkormakapat" || cmd === "linkkoruma-kapat") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Koruma kapatma yetkin yok.")] });
    settings.linkProtection = false;
    saveData();
    return message.reply({ embeds: [successEmbed("Link koruması kapatıldı.")] });
  }

  if (cmd === "ticket-kur") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageChannels)) return message.reply({ embeds: [errorEmbed("Kanal yönetme yetkin yok.")] });
    const role = message.mentions.roles.first();
    const parts = raw.split("|").map((item) => item.trim());
    const title = parts[1] || "🎫 Destek Talebi";
    const text = parts[2] || "Talebinizi ve sorununuzu detaylıca yazın. Bir yetkili sizinle ilgilenecektir.";
    if (!role) return message.reply({ embeds: [errorEmbed(`Kullanım: ${settings.prefix}ticket-kur @YetkiliRol | Başlık | Metin`)] });
    settings.ticket = { roleId: role.id, title, text };
    saveData();
    const button = new ButtonBuilder().setCustomId("ticket_open").setLabel("Ticket Aç").setEmoji("🎫").setStyle(ButtonStyle.Primary);
    await message.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.gray).setTitle(title).setDescription(text)], components: [new ActionRowBuilder().addComponents(button)] });
    return message.reply({ embeds: [successEmbed("Ticket paneli gönderildi.")], allowedMentions: { repliedUser: false } });
  }

  if (cmd === "owner-ekle" || cmd === "owner-çıkar" || cmd === "owner-cikar") {
    if (message.author.id !== message.guild.ownerId) return message.reply({ embeds: [errorEmbed("Bu işlem sadece sunucu sahibi tarafından yapılabilir.")] });
    const target = getMemberFromArg(message, args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed("Bir üyeyi etiketle.")] });
    if (cmd === "owner-ekle") {
      if (!db.owners.includes(target.id)) db.owners.push(target.id);
      saveData();
      return message.reply({ embeds: [successEmbed(`${target} owner listesine eklendi.`)] });
    }
    db.owners = db.owners.filter((id) => id !== target.id);
    saveData();
    return message.reply({ embeds: [successEmbed(`${target} owner listesinden çıkarıldı.`)] });
  }
  if (cmd === "owner-list") {
    const list = db.owners.length ? db.owners.map((id) => `<@${id}>`).join("\n") : "Owner listesi boş.";
    return message.reply({ embeds: [infoEmbed("👑 Owner Listesi", list)] });
  }
  if (cmd === "owner") {
    return message.reply({ embeds: [infoEmbed("👑 Owner", isOwner(message.member) ? "Owner yetkin var." : "Owner yetkin yok.")] });
  }

  if (cmd === "siteekle") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    if (!URL_PATTERN.test(args[0] || "")) return message.reply({ embeds: [errorEmbed("Geçerli bir site adresi yaz.")] });
    settings.website = args[0];
    saveData();
    return message.reply({ embeds: [successEmbed(`Site adresi ayarlandı: ${settings.website}`)] });
  }
  if (cmd === "site-cikar" || cmd === "siteçıkar") {
    if (!canManage(message.member, PermissionsBitField.Flags.ManageGuild)) return message.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")] });
    settings.website = SITE_URL;
    saveData();
    return message.reply({ embeds: [successEmbed("Site adresi varsayılana döndürüldü.")] });
  }
  if (cmd === "site") return message.reply({ embeds: [infoEmbed("🌐 Cubixora SMP Sitesi", settings.website || SITE_URL)] });
  if (cmd === "aktif") {
    const status = args[0]?.toLowerCase();
    if (status === "kapat" || status === "off") {
      settings.active = false;
      saveData();
      await setMinecraftPresence();
      return message.reply({ embeds: [successEmbed("Bot durum mesajı kapatıldı.")] });
    }
    settings.active = true;
    settings.activeText = args.slice(1).join(" ") || settings.activeText || "Cubixora SMP";
    saveData();
    await setMinecraftPresence();
    return message.reply({ embeds: [successEmbed(`Bot durum mesajı açıldı: ${settings.activeText}`)] });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    const settings = guildSettings(interaction.guild.id);
    if (interaction.customId === "ticket_open") return createTicket(interaction, settings);
    if (interaction.customId === "ticket_close") {
      const canClose = isOwner(interaction.member) || interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) || interaction.channel.topic === `ticket:${interaction.user.id}`;
      if (!canClose) return interaction.reply({ embeds: [errorEmbed("Bu ticket'ı kapatma yetkin yok.")], ephemeral: true });
      await interaction.reply({ embeds: [successEmbed("Ticket 5 saniye içinde kapatılıyor.")] });
      return setTimeout(() => interaction.channel.delete("Ticket kapatıldı").catch(() => {}), 5000);
    }
    if (interaction.customId.startsWith("giveaway:")) {
      const id = interaction.customId.split(":")[1];
      const giveaway = settings.giveaways[id];
      if (!giveaway) return interaction.reply({ embeds: [errorEmbed("Bu çekiliş artık aktif değil.")], ephemeral: true });
      if (!giveaway.entries.includes(interaction.user.id)) {
        giveaway.entries.push(interaction.user.id);
        saveData();
        return interaction.reply({ embeds: [successEmbed("Çekilişe katıldın! Bol şans 🎉")], ephemeral: true });
      }
      return interaction.reply({ embeds: [infoEmbed("Zaten katıldın", "Bu çekilişe daha önce katıldın.")] , ephemeral: true });
    }
  }

  if (!interaction.isChatInputCommand()) return;
  const settings = guildSettings(interaction.guild.id);

  if (interaction.commandName === "yardim") return interaction.reply({ embeds: [infoEmbed("📖 Cubixora Bot Komutları", commandHelp())] });
  if (interaction.commandName === "ip") {
    const status = await getMinecraftStatus();
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(status?.online ? COLORS.green : COLORS.red).setTitle("🌐 Cubixora SMP").addFields(
      { name: "Java 1.16.5", value: `\`${MC_HOST}:${MC_JAVA_PORT}\``, inline: false },
      { name: "Bedrock", value: `\`${MC_HOST}\` • Port \`${MC_BEDROCK_PORT}\``, inline: false },
      { name: "Durum", value: status?.online ? `🟢 Açık — ${status.players}/${status.max}` : "🔴 Kapalı veya sorgulanamıyor", inline: false },
      { name: "Site", value: settings.website || SITE_URL, inline: false },
    )] });
  }

  if (interaction.commandName === "otorol-ayarla") {
    if (!canManage(interaction.member, PermissionsBitField.Flags.ManageRoles)) return interaction.reply({ embeds: [errorEmbed("Rol yönetme yetkin yok.")], ephemeral: true });
    const role = interaction.options.getRole("rol");
    if (role.position >= interaction.guild.members.me.roles.highest.position) return interaction.reply({ embeds: [errorEmbed("Bot rolü seçilen rolden yukarıda olmalı.")], ephemeral: true });
    settings.autoRoleId = role.id;
    saveData();
    return interaction.reply({ embeds: [successEmbed(`${role} otomatik rol olarak ayarlandı.`)] });
  }

  if (interaction.commandName === "likkoruma" || interaction.commandName === "likkormakapat") {
    if (!canManage(interaction.member, PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ embeds: [errorEmbed("Sunucuyu Yönet yetkin yok.")], ephemeral: true });
    settings.linkProtection = interaction.commandName === "likkoruma";
    saveData();
    return interaction.reply({ embeds: [successEmbed(`Link koruması ${settings.linkProtection ? "açıldı" : "kapatıldı"}.`)] });
  }

  if (interaction.commandName === "ticket-kur") {
    if (!canManage(interaction.member, PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ embeds: [errorEmbed("Kanal yönetme yetkin yok.")], ephemeral: true });
    settings.ticket = {
      roleId: interaction.options.getRole("yetkili").id,
      title: interaction.options.getString("baslik"),
      text: interaction.options.getString("metin"),
    };
    saveData();
    const button = new ButtonBuilder().setCustomId("ticket_open").setLabel("Ticket Aç").setEmoji("🎫").setStyle(ButtonStyle.Primary);
    await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.gray).setTitle(settings.ticket.title).setDescription(settings.ticket.text)], components: [new ActionRowBuilder().addComponents(button)] });
    return interaction.reply({ embeds: [successEmbed("Ticket paneli gönderildi.")], ephemeral: true });
  }

  if (interaction.commandName === "cekilis") {
    if (!canManage(interaction.member, PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ embeds: [errorEmbed("Çekiliş başlatma yetkin yok.")], ephemeral: true });
    const duration = parseDuration(interaction.options.getInteger("sure"), interaction.options.getString("birim"));
    if (!duration) return interaction.reply({ embeds: [errorEmbed("Geçerli bir süre gir.")], ephemeral: true });
    const id = `${Date.now()}-${interaction.user.id}`;
    const title = interaction.options.getString("baslik");
    const prize = interaction.options.getString("odul");
    const secondPrize = interaction.options.getString("ikinci_odul");
    const winners = interaction.options.getInteger("kazanan");
    const endAt = Date.now() + duration;
    settings.giveaways[id] = { entries: [], title, prize, secondPrize, winners, endAt };
    saveData();
    const button = new ButtonBuilder().setCustomId(`giveaway:${id}`).setLabel("Çekilişe Katıl").setEmoji("🎉").setStyle(ButtonStyle.Success);
    const giveawayMessage = await interaction.channel.send({
      embeds: [new EmbedBuilder().setColor(COLORS.purple).setTitle(`🎉 ${title}`).setDescription(`Ödül: **${prize}**${secondPrize ? `\nİkinci ödül: **${secondPrize}**` : ""}\n\nKazanan sayısı: **${winners}**\nBitiş: <t:${Math.floor(endAt / 1000)}:R>\n\nKatılmak için aşağıdaki butona basın.`).setFooter({ text: "Cubixora SMP • Çekiliş" })],
      components: [new ActionRowBuilder().addComponents(button)],
    });
    await interaction.reply({ embeds: [successEmbed("Çekiliş başlatıldı.")], ephemeral: true });
    setTimeout(async () => {
      const giveaway = settings.giveaways[id];
      if (!giveaway) return;
      const entries = giveaway.entries.filter((userId) => interaction.guild.members.cache.has(userId));
      const picked = [...entries].sort(() => Math.random() - 0.5).slice(0, giveaway.winners);
      const result = picked.length ? picked.map((id2) => `<@${id2}>`).join(", ") : "Katılan olmadı.";
      await giveawayMessage.edit({ embeds: [new EmbedBuilder().setColor(COLORS.gray).setTitle(`🎉 ${title} — Sona Erdi`).setDescription(`Ödül: **${prize}**\nKazananlar: ${result}`)], components: [] }).catch(() => {});
      delete settings.giveaways[id];
      saveData();
    }, duration);
    return;
  }

  if (interaction.commandName === "anket") {
    if (!canManage(interaction.member, PermissionsBitField.Flags.ManageMessages)) return interaction.reply({ embeds: [errorEmbed("Anket açma yetkin yok.")], ephemeral: true });
    const options = interaction.options.getString("secenekler").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
    if (options.length < 2) return interaction.reply({ embeds: [errorEmbed("En az 2 seçenek yazmalısın. Örnek: Java, Bedrock")], ephemeral: true });
    const duration = parseDuration(interaction.options.getInteger("sure"), interaction.options.getString("birim"));
    const letters = ["🇦", "🇧", "🇨", "🇩", "🇪", "🇫", "🇬", "🇭", "🇮", "🇯"];
    const endAt = Date.now() + duration;
    const pollId = `${Date.now()}-${interaction.user.id}`;
    settings.polls[pollId] = { endAt };
    saveData();
    const description = options.map((option, index) => `${letters[index]} **${cleanText(option, 100)}**`).join("\n");
    const poll = await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.blue).setTitle(`📊 ${interaction.options.getString("baslik")}`).setDescription(`${description}\n\nBitiş: <t:${Math.floor(endAt / 1000)}:R>`).setFooter({ text: "Oy vermek için emojiye basın." })] });
    for (let i = 0; i < options.length; i++) await poll.react(letters[i]).catch(() => {});
    await interaction.reply({ embeds: [successEmbed("Anket oluşturuldu.")], ephemeral: true });
    setTimeout(() => {
      poll.edit({ embeds: [new EmbedBuilder().setColor(COLORS.gray).setTitle(`📊 ${interaction.options.getString("baslik")} — Sona Erdi`).setDescription(description)] }).catch(() => {});
      delete settings.polls[pollId];
      saveData();
    }, duration);
  }
});

// Render sağlık kontrolü. Discord botunu Web Service olarak çalıştıracaksanız gereklidir.
const app = express();
app.get("/", (_req, res) => res.status(200).send("Cubixora SMP Discord Botu aktif ✅"));
app.get("/health", (_req, res) => res.json({ ok: true, bot: client.user?.tag || null, uptime: process.uptime() }));
app.use(express.json());

// Minecraft eklentisi/webhook'u bu endpoint'e JSON gönderebilir:
// { "type":"chat", "player":"Steve", "message":"Merhaba" }
// { "type":"punishment", "action":"ban", "player":"Steve", "reason":"Hile", "duration":"Süresiz" }
app.post("/minecraft/webhook", async (req, res) => {
  const secret = process.env.MC_WEBHOOK_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false });
  const body = req.body || {};
  const guild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
  if (!guild) return res.status(503).json({ ok: false, error: "Discord sunucusu hazır değil" });
  const settings = guildSettings(guild.id);
  if (body.type === "chat" && settings.mcChatChannelId) {
    const channel = guild.channels.cache.get(settings.mcChatChannelId);
    if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.green).setTitle("⛏️ Minecraft Sohbet").setDescription(`**${cleanText(body.player, 64)}:** ${cleanText(body.message, 1000)}`)] }).catch(() => {});
  }
  if (body.type === "punishment" && settings.mcPunishmentChannelId) {
    await sendLog(guild, "mc", {
      "⛏️ Oyuncu": body.player || "Bilinmiyor",
      "⚖️ İşlem": body.action || "Bilinmiyor",
      "⏱️ Süre": body.duration || "Belirtilmedi",
      "📄 Sebep": body.reason || "Belirtilmedi",
    });
  }
  return res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
const server = http.createServer(app);
server.listen(port, () => console.log(`[WEB] Sağlık sunucusu :${port} üzerinde çalışıyor.`));

process.on("unhandledRejection", (error) => console.error("[UNHANDLED]", error));
process.on("uncaughtException", (error) => console.error("[UNCAUGHT]", error));

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN eksik. Render Environment Variables bölümüne bot tokenini ekleyin.");
} else {
  client.login(process.env.DISCORD_TOKEN).catch((error) => console.error("[LOGIN] Discord giriş hatası:", error.message));
}

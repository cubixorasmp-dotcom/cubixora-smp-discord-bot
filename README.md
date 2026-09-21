# Cubixora Discord Bot

Discord.js v14 botu. Replit ve Render üzerinde çalışır; telefon veya bilgisayar kapalı olsa da uzak servis çalıştığı sürece bot açık kalır.

## Kurulum

```bash
pnpm install
pnpm run bot
```

Gerekli değişkenleri Replit Secrets/Environment Variables kısmına ekleyin. Örnek isimler `.env.example` dosyasındadır. `DISCORD_TOKEN` hiçbir zaman GitHub'a yazılmamalıdır.

Discord Developer Portal'da **Message Content Intent** ve **Server Members Intent** açılmalı; botta mesaj yönetme, rol yönetme, üyeleri susturma, banlama ve kanal yönetme izinleri verilmelidir.

## Prefix komutları

Varsayılan prefix `e!`:

- `e!ip`
- `e!sil 10`
- `e!ban @üye sebep`
- `e!mute @üye 30 dakika sebep`
- `e!otorol-ayarla @rol`
- `e!koruma-rol @rol`
- `e!cekilis başlık | ödül | 1 | 1 saat`
- `e!anket başlık | 10 dakika | seçenek 1 | seçenek 2`
- `e!ticket-kur @yetkili | Başlık | Metin`

Slash komutları da hazırdır. `GUILD_ID` verilirse test sunucusuna anında kaydedilir; verilmezse global kayıtta Discord'un yayma süresi olabilir.

## Minecraft webhook

Bot tek başına Minecraft sohbetini göremez. Sunucudaki plugin veya köprü şu endpoint'e istek gönderebilir:

```text
POST /minecraft/event
Header: x-webhook-secret: MC_WEBHOOK_SECRET
```

Sohbet örneği:

```json
{"type":"chat","player":"Steve","message":"Merhaba"}
```

Ceza örneği:

```json
{"type":"punishment","player":"Steve","action":"BAN","reason":"Hile","duration":"Süresiz"}
```

`/health` endpoint'i Render sağlık kontrolü içindir.
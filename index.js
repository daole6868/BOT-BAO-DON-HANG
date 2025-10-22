// index.js - Final version (MongoDB integrated)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { PassThrough } = require('stream');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose'); // added
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
  Events
} = require('discord.js');

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ===== MongoDB Setup =====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB Atlas!'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Ticket schema + model
const ticketSchema = new mongoose.Schema({
  uid: String,
  desc: String,
  userId: String,
  channelId: String,
  images: [{ url: String, public_id: String }],
  createdAt: { type: Number, default: Date.now }
});
const Ticket = mongoose.model('Ticket', ticketSchema);

// Helper functions
async function getTickets(filter = {}) {
  return await Ticket.find(filter);
}
async function addTicket(data) {
  const t = new Ticket(data);
  await t.save();
  return t;
}
async function updateTicket(filter, update) {
  return await Ticket.findOneAndUpdate(filter, update, { new: true });
}
async function deleteOldTickets(days) {
  const limit = Date.now() - days * 24 * 60 * 60 * 1000;
  const oldTickets = await Ticket.find({ createdAt: { $lt: limit } });
  for (const t of oldTickets) {
    if (t.images && t.images.length) {
      for (const img of t.images) {
        if (img.public_id) {
          try {
            await cloudinary.uploader.destroy(img.public_id);
            console.log(`🗑️ Deleted Cloudinary image ${img.public_id}`);
            await wait(300);
          } catch (err) {
            console.error('Cloudinary destroy error:', err);
          }
        }
      }
    }
    await t.deleteOne();
    console.log(`🧾 Deleted ticket data UID=${t.uid}`);
  }
}

// small delay helper
const wait = (ms) => new Promise(res => setTimeout(res, ms));

// Upload buffer to Cloudinary (returns result)
function uploadBufferToCloudinary(buffer, folder, publicIdWithoutExt) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, public_id: publicIdWithoutExt }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    const pass = new PassThrough();
    pass.end(buffer);
    pass.pipe(stream);
  });
}

// Create Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

// On ready: send announce embeds (one per start)
client.once(Events.ClientReady, async () => {
  console.log(`📡 Logged in as ${client.user.tag}`);

  try {
    const sellerAnn = await client.channels.fetch(process.env.SELLER_ANNOUNCE_CHANNEL_ID).catch(()=>null);
    const buyerAnn = await client.channels.fetch(process.env.BUYER_ANNOUNCE_CHANNEL_ID).catch(()=>null);
    if (sellerAnn) {
      const embed = new EmbedBuilder()
        .setTitle('📦 NỘP ĐƠN HÀNG TẠI ĐÂY')
        .setDescription(
          [
            '🧾 **Hướng dẫn:**',
            '1️⃣ Nhấn **Nộp đơn hàng** để tạo ticket riêng cho bạn.',
            '2️⃣ Điền **UID** - **nội dung đơn** và nhấn **GỬI**.',
            '3️⃣ Gửi ảnh vào kênh ticket vừa tạo, nhấn **Lưu ảnh** để bot upload ảnh.',
            '',
            '⚠️ **Lưu ý:** Hãy điền đúng thông tin và đầy đủ các bước.',
            '🚫 **Cảnh báo:** Tuyệt đối không spam — trường hợp vi phạm sẽ bị xử lý!',
          ].join('\n')
        )
        .setColor('Green')
        .setImage('https://i.redd.it/t8tluko64vd61.jpg') // 👈 Ảnh mẫu hiển thị trực tiếp
        .setFooter({ text: 'Khu vực dành riêng cho CTV — Hãy tuân thủ quy định!' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_seller_ticket')
          .setLabel('📤 Nộp đơn hàng')
          .setStyle(ButtonStyle.Success)
      );

      await sellerAnn.send({ embeds: [embed], components: [row] }).catch(e => console.error('Send seller announce failed:', e));
    }
    if (buyerAnn) {
      const embed = new EmbedBuilder()
        .setTitle('🔍 TRA CỨ ĐƠN HÀNG TẠI ĐÂY')
        .setDescription(
          [
            '💡 **Hướng dẫn:**',
            '1️⃣ Nhấn **Tìm UID** để mở ticket tra cứu đơn hàng.',
            '2️⃣ Trong ticket, nhập **UID của bạn** để bot hiển thị thông tin đơn hàng và hình ảnh liên quan.',
            '',
            '⚠️ **Lưu ý:** Không nhập UID sai hoặc spam yêu cầu tra cứu.',
            '🚫 Vi phạm nhiều lần sẽ bị **từ chối hỗ trợ** ngay lập tức!',
          ].join('\n')
        )
        .setColor('Blue')
        .setImage('https://i.redd.it/t8tluko64vd61.jpg') // 👈 ảnh minh họa ví dụ
        .setFooter({ text: 'Khu vực tra cứu đơn hàng — Hãy sử dụng đúng cách!' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_buyer_ticket')
          .setLabel('🔎 Tìm UID')
          .setStyle(ButtonStyle.Primary)
      );
      await buyerAnn
        .send({ embeds: [embed], components: [row] })
        .catch(e => console.error('Send buyer announce failed:', e));
    }
  } catch (err) {
    console.error('Ready error:', err);
  }

  // Start hourly cleanup of old tickets
  setInterval(() => deleteOldTickets(15), 60 * 60 * 1000); // every 1 hour
});

// Interaction handling (buttons & modals)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // --- BUTTONS: open seller / buyer ---
    if (interaction.isButton()) {

      // Open seller modal
      if (interaction.customId === 'open_seller_ticket') {
        const modal = new ModalBuilder().setCustomId('seller_modal').setTitle('Nộp đơn hàng');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('uid').setLabel('UID').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('desc').setLabel('Nội Dung Đơn').setStyle(TextInputStyle.Paragraph).setRequired(false)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      // Open buyer modal
      if (interaction.customId === 'open_buyer_ticket') {
        const modal = new ModalBuilder().setCustomId('buyer_modal').setTitle('Tìm UID');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('uid').setLabel('Nhập UID cần tìm').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      // Save images (seller pressed button)
      if (interaction.customId === 'save_images') {
        // long operation -> defer
        await interaction.deferReply({ flags: 64 });
        const channel = interaction.channel;
        const ticket = await Ticket.findOne({ channelId: channel.id });
        if (!ticket) {
          await interaction.editReply({ content: '❌ Không tìm thấy dữ liệu ticket.' });
          return;
        }

        console.log(`📩 [SAVE_IMAGES] User ${interaction.user.tag} saving images for UID ${ticket.uid}`);

        const messages = await channel.messages.fetch({ limit: 100 }).catch(()=>new Map());
        let uploadedCount = 0;

        for (const msg of messages.values()) {
          for (const att of msg.attachments.values()) {
            try {
              const res = await axios.get(att.url, { responseType: 'arraybuffer' });
              const buffer = Buffer.from(res.data, 'binary');
              const filename = path.parse(att.name || att.url).name;
              const folder = `tickets/${ticket.uid}`;
              // create public id with timestamp to avoid collision
              const publicId = `${filename}-${Date.now()}`;
              const result = await uploadBufferToCloudinary(buffer, folder, publicId);
              if (!ticket.images) ticket.images = [];
              ticket.images.push({ url: result.secure_url, public_id: result.public_id });
              uploadedCount++;
              console.log(`☁️ Uploaded: ${result.secure_url}`);
              await wait(500); // small delay
            } catch (err) {
              console.error('Upload error:', err);
            }
          }
        }

        await ticket.save();
        await interaction.editReply({ content: `✅ Đã upload ${uploadedCount} ảnh thành công **bạn có thể thoát**.` });

        // notify admin announce channel
        try {
          const adminAnn = await client.channels.fetch(process.env.ADMIN_ANNOUNCE_CHANNEL_ID).catch(()=>null);
          if (adminAnn) {
            const adminEmbed = new EmbedBuilder()
              .setTitle('📌 Đơn hàng mới đã hoàn thành')
              .setDescription(`**UID:** ${ticket.uid}\n**Nội dung đơn:** ${ticket.desc || '—'}\n**Người tạo:** <@${ticket.userId}>\n**Ngày tạo:** <t:${Math.floor(ticket.createdAt/1000)}:f>`)
              .setColor('DarkRed')
              .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`view_ticket_${ticket.channelId}`).setLabel('Xem đơn hàng').setStyle(ButtonStyle.Primary),
              

            await adminAnn.send({ embeds: [adminEmbed], components: [buttons] }).catch(e => console.error('Admin announce send failed', e));
            console.log(`🧾 Notified admin about UID ${ticket.uid}`);
          }
        } catch (err) {
          console.error('Notify admin error:', err);
        }

        return;
      }

      // Delete channel (quick delete) - user pressed delete button
      if (interaction.customId === 'delete_channel') {
        // quick reply
        await interaction.reply({ content: '🗑️ Kênh sẽ bị xóa.', flags: 64 });
        // delay a bit so reply can be seen
        setTimeout(() => {
          interaction.channel.delete().catch(e => console.error('Delete channel error:', e));
        }, 1000);
        return;
      }

      // Admin clicked view ticket in admin announce
      if (interaction.customId.startsWith('view_ticket_')) {
        await interaction.deferReply({ flags: 64 });
        const originalChannelId = interaction.customId.replace('view_ticket_', '');
        const ticket = await Ticket.findOne({ channelId: originalChannelId });
        if (!ticket) {
          await interaction.editReply({ content: '❌ Không tìm thấy dữ liệu ticket.' });
          return;
        }

        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        let ch = await guild.channels.fetch(ticket.channelId).catch(()=>null);

        if (!ch) {
          // recreate in seller category
          ch = await guild.channels.create({
            name: `ticket-seller-${ticket.uid}`,
            type: ChannelType.GuildText,
            parent: process.env.SELLER_CATEGORY_ID,
            permissionOverwrites: [
              { id: guild.roles.everyone.id || guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: ticket.userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
          }).catch(e => { console.error('Recreate channel error:', e); return null; });

          if (ch) {
            // update channelId in ticket
            ticket.channelId = ch.id;
            await ticket.save();

            // send embed + buttons + images
            const embed = new EmbedBuilder()
              .setTitle('Ticket Người Bán (Khôi phục)')
              .setDescription(`**UID:** ${ticket.uid}\n**Nội dung đơn:** ${ticket.desc || '—'}\n**Người tạo:** <@${ticket.userId}>\n**Ngày tạo:** <t:${Math.floor(ticket.createdAt/1000)}:f>`)
              .setColor('Green')
              .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('save_images').setLabel('Lưu ảnh').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('delete_channel').setLabel('Xóa nhanh').setStyle(ButtonStyle.Danger)
            );

            await ch.send({ embeds: [embed], components: [row] }).catch(e => console.error('Send to recreated channel failed', e));
            if (ticket.images && ticket.images.length) {
              for (const img of ticket.images) {
                await ch.send({ content: img.url }).catch(e => console.error('Send image failed', e));
                await wait(300);
              }
            }
          }
        }

        await interaction.editReply({ content: `✅ Đơn hàng đã được mở: ${ch || '—'}` });
        return;
      }
    }

    // --- MODALS ---
    if (interaction.isModalSubmit()) {

      // Seller modal submit (create seller ticket)
      if (interaction.customId === 'seller_modal') {
        await interaction.deferReply({ flags: 64 });
        const uid = interaction.fields.getTextInputValue('uid').trim();
        const desc = interaction.fields.getTextInputValue('desc')?.trim() || '';
        const guild = await client.guilds.fetch(process.env.GUILD_ID);

        // create channel in seller category
        const channel = await guild.channels.create({
          name: `ticket-seller-${uid}`,
          type: ChannelType.GuildText,
          parent: process.env.SELLER_CATEGORY_ID,
          permissionOverwrites: [
            { id: guild.roles.everyone.id || guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
          ]
        }).catch(e => { console.error('Create seller channel failed:', e); return null; });

        if (!channel) {
          await interaction.editReply({ content: '❌ Tạo kênh thất bại.' });
          return;
        }

        // create ticket in DB
        const ticketObj = {
          uid,
          desc,
          userId: interaction.user.id,
          channelId: channel.id,
          images: [], // {url, public_id}
          createdAt: Date.now()
        };
        const savedTicket = await addTicket(ticketObj);

        const embed = new EmbedBuilder()
          .setTitle(`🧾 Đơn hàng — ${uid}`)
          .setDescription(`**Người tạo:** ${interaction.user}\n**UID:** ${uid}\n**Nội dung:** ${desc || '—'}\n**Ngày tạo:** <t:${Math.floor(savedTicket.createdAt/1000)}:f>`)
          .setColor('Green')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('save_images').setLabel('Lưu ảnh (upload)').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('delete_channel').setLabel('Xóa nhanh').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [embed], components: [row] }).catch(e => console.error('Send to seller channel failed:', e));
        await interaction.editReply({ content: `✅ Đơn hàng của bạn đã được tạo nhấn để gửi ảnh: ${channel}` });
        console.log(`📩 [CREATE] Seller ${interaction.user.tag} created ticket UID=${uid}`);

        // auto-delete channel after 10 minutes (only channel)
        setTimeout(async () => {
          const ch = await guild.channels.fetch(channel.id).catch(()=>null);
          if (ch) {
            await ch.delete().catch(e => console.error('Auto-delete channel error:', e));
            console.log(`🗑️ Auto-deleted channel ${channel.id}`);
          }
        }, 10 * 60 * 1000);

        return;
      }

      // Buyer modal submit (search by UID and create buyer ticket)
      if (interaction.customId === 'buyer_modal') {
        await interaction.deferReply({ flags: 64 });
        const uid = interaction.fields.getTextInputValue('uid').trim();
        const matches = await getTickets({ uid });
        if (!matches.length) {
          await interaction.editReply({ content: '❌ Không tìm thấy đơn hàng với UID này.' });
          return;
        }

        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const channel = await guild.channels.create({
          name: `ticket-buyer-${uid}`,
          type: ChannelType.GuildText,
          parent: process.env.BUYER_CATEGORY_ID,
          permissionOverwrites: [
            { id: guild.roles.everyone.id || guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
          ]
        }).catch(e => { console.error('Create buyer channel failed:', e); return null; });

        if (!channel) {
          await interaction.editReply({ content: '❌ Tạo kênh người mua thất bại.' });
          return;
        }

        for (const order of matches) {
          const embed = new EmbedBuilder()
            .setTitle(`📦 Đơn hàng — UID: ${order.uid}`)
            .setDescription(`**Người cày:** <@${order.userId}>\n**Nội dung:** ${order.desc || '—'}\n**Ngày tạo:** <t:${Math.floor(order.createdAt/1000)}:f>`)
            .setColor('Blue')
            .setTimestamp();

          await channel.send({ embeds: [embed] }).catch(e => console.error('Send order embed failed', e));

          if (order.images && order.images.length) {
            for (const img of order.images) {
              await channel.send({ content: img.url }).catch(e => console.error('Send image to buyer failed', e));
              await wait(300);
            }
          }
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('delete_channel').setLabel('Xóa nhanh').setStyle(ButtonStyle.Danger)
        );
        await channel.send({ content: '🎫 Kênh ticket người mua đã được tạo.', components: [row] }).catch(() => {});
        await interaction.editReply({ content: `✅ Đơn hàng của bạn đã hoàn thành nhấn để xem tại. ${channel}` });
        console.log(`🔍 [BUYER] ${interaction.user.tag} searched UID=${uid} and received ${matches.length} orders`);

        // auto-delete buyer channel after 10 minutes
        setTimeout(async () => {
          const ch = await guild.channels.fetch(channel.id).catch(()=>null);
          if (ch) await ch.delete().catch(() => {});
        }, 10 * 60 * 1000);

        // If multiple matches, notify sellers & admin_check channel
        if (matches.length > 1) {
          try {
            const adminCheck = await client.channels.fetch(process.env.ADMIN_CHECK_CHANNEL_ID).catch(()=>null);
            for (const ord of matches) {
              // DM seller
              const sellerUser = await client.users.fetch(ord.userId).catch(()=>null);
              if (sellerUser) {
                sellerUser.send(`⚠️ Có ${matches.length} đơn trùng UID ${uid}. Vui lòng kiểm tra.`).catch(()=>{});
              }
            }
            if (adminCheck) {
              const mEmbed = new EmbedBuilder()
                .setTitle('⚠️ Nhiều đơn trùng UID')
                .setDescription(`Tìm thấy ${matches.length} đơn hàng trùng UID: ${uid}`)
                .setColor('Orange')
                .setTimestamp();
              adminCheck.send({ embeds: [mEmbed] }).catch(()=>{});
            }
          } catch (err) {
            console.error('Notify multiple matches error:', err);
          }
        }

        return;
      }
    }

  } catch (err) {
    // Log interaction errors with context
    try {
      const id = interaction?.customId || interaction?.commandName || 'unknown-interaction';
      console.error(`❌ [Interaction:${id}] Error:`, err);
    } catch (e) {
      console.error('❌ [Interaction:unknown] Error:', err);
    }
  }
});

// Admin check via simple message command in ADMIN_CHECK_CHANNEL_ID
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.content.startsWith('/check')) return;
    if (msg.channel.id !== process.env.ADMIN_CHECK_CHANNEL_ID) return;

    const parts = msg.content.trim().split(/\s+/);
    const uid = parts[1];
    if (!uid) return msg.reply('⚠️ Vui lòng nhập UID: `/check <uid>`');

    const matches = await getTickets({ uid });
    if (!matches.length) return msg.reply('❌ Không tìm thấy đơn hàng nào.');

    for (const order of matches) {
      const embed = new EmbedBuilder()
        .setTitle('Thông tin đơn hàng (ADMIN)')
        .setDescription(`**UID:** ${order.uid}\n**Nội dung:** ${order.desc || '—'}\n**Người tạo:** <@${order.userId}>\n**Ngày tạo:** <t:${Math.floor(order.createdAt/1000)}:f>`)
        .setColor('Purple')
        .setTimestamp();
      await msg.channel.send({ embeds: [embed] });
      if (order.images && order.images.length) {
        for (const img of order.images) {
          await msg.channel.send({ content: img.url });
          await wait(300);
        }
      }
    }

    // if multiple matches, notify sellers
    if (matches.length > 1) {
      for (const ord of matches) {
        const sellerUser = await client.users.fetch(ord.userId).catch(()=>null);
        if (sellerUser) sellerUser.send(`⚠️ Có ${matches.length} đơn trùng UID ${uid}.`).catch(()=>{});
      }
    }

  } catch (err) {
    console.error('Check command error:', err);
  }
});

// Cleanup old tickets (>15 days) and delete cloudinary resources
async function cleanupOldTickets() {
  try {
    console.log('🧹 Running cleanupOldTickets...');
    await deleteOldTickets(15);
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// Start bot
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Login failed:', err);
});

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

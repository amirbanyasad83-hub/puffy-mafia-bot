// mafia_bot.js – Puffy Mafia Slim Full
// - انتخاب اسم در PV (اجباری برای ورود به بازی)
// - MongoDB + لیگ + سکه + امتیاز
// - برترین‌های روزانه با ریست خودکار
// - انتقال سکه با ریپلای
// - MVP هر بازی با جایزه سکه
// - سیستم مسدودی ساده (ban بر اساس ساعت)
// - بدون جوین اجباری کانال
// - پورت فیک برای Render

'use strict';

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const http = require('http');

// ================= تنظیمات محیط =================

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  throw new Error('EFATAL: TOKEN not provided');
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.warn('⚠️ MONGO_URI not provided – لیگ و سکه کار نمی‌کند.');
}

// تعداد بازیکنان
const MIN_PLAYERS = 6;
const MAX_PLAYERS = 6;

// ================= اتصال دیتابیس =================

let dbReady = false;

if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
      dbReady = true;
      console.log('✅ MongoDB connected (Puffy Mafia)');
    })
    .catch(err => {
      console.error('❌ MongoDB error:', err);
    });
}

// ================= مدل‌ها =================

const playerSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, index: true },
  name: String,
  username: String,

  // اسم انتخابی داخل ربات
  displayName: { type: String, default: null },

  // سیستم ban
  banUntil: { type: Date, default: null },

  totalGames: { type: Number, default: 0 },
  totalWins: { type: Number, default: 0 },
  totalLosses: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },      // امتیاز کلی لیگ
  dailyPoints: { type: Number, default: 0 },      // امتیاز امروز
  coins: { type: Number, default: 0 },            // سکه‌ها

  league: { type: String, default: 'بدون لیگ 🌱' },

  lastUpdated: { type: Date, default: Date.now }
});

const metaSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: { type: String }
});

const Player = mongoose.models.Player || mongoose.model('Player', playerSchema);
const Meta = mongoose.models.Meta || mongoose.model('Meta', metaSchema);

// ================= لیگ، روزانه، امتیاز =================

function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeLeague(points) {
  if (points >= 200) return 'لیگ افسانه‌ای ✨🐉';
  if (points >= 120) return 'لیگ الماسی 💎';
  if (points >= 70)  return 'لیگ طلایی 🥇';
  if (points >= 40)  return 'لیگ نقره‌ای 🥈';
  if (points >= 15)  return 'لیگ برنزی 🥉';
  if (points >= 1)   return 'لیگ پُفی تازه‌کار 🌸';
  return 'بدون لیگ 🌱';
}

async function ensureDailyReset() {
  if (!dbReady) return;

  const key = 'dailyResetDate';
  const today = todayKey();

  let meta = await Meta.findOne({ key }).exec();
  if (!meta) {
    meta = new Meta({ key, value: today });
    await meta.save();
    return;
  }

  if (meta.value !== today) {
    await Player.updateMany({}, { $set: { dailyPoints: 0 } }).exec();
    meta.value = today;
    await meta.save();
    console.log('🔁 Daily points reset:', today);
  }
}

// ================= ربات =================

const bot = new TelegramBot(TOKEN, { polling: true });

// ================= وضعیت بازی =================

let lobbyPlayers = [];
let game = null;

// game = {
//   chatId,
//   phase,
//   day,
//   night,
//   players: [ { id, displayName, emoji, roleKey, dead, shieldUsed } ],
//   nightActions: {...},
//   gameScore: { [userId]: { points: Number } }
// }

// ================= نقش‌ها =================

const ROLES = [
  { key: 'moosh_afshagar',   name: 'موش‌افشاگر 🧀',     team: 'town',
    desc: 'در ابتدای بازی می‌تواند نقش خود را در گروه افشا کند.' },
  { key: 'hamkhaab_pofy',    name: 'پُفی‌همخواب 💞',    team: 'town',
    desc: 'هر شب کنار یک نفر می‌خوابد؛ بسته به حمله مافیا، خودش/هر دو می‌میرند.' },
  { key: 'khar_goosh_tirpofi', name: 'خرگوش‌تیرپُفی 🐰💥', team: 'town',
    desc: 'هر شب یک نفر را هدف تیر پُفی قرار می‌دهد.' },
  { key: 'pashmak_plus',     name: 'پشمک‌پلاس 🍬',      team: 'town',
    desc: 'پزشک؛ هر شب یک نفر را نجات می‌دهد.' },
  { key: 'nish_poof',        name: 'نیش‌پوف 🐝',        team: 'mafia',
    desc: 'قاتل مافیا.' },
  { key: 'moosh_saye',       name: 'موش‌سایه 🐾',       team: 'mafia',
    desc: 'مافیای همراه.' },
  { key: 'pof_abri',         name: 'پُف‌اَبری ☁️',      team: 'independent',
    desc: 'مستقل؛ اولین حمله شبانه روی او بی‌اثر است.' }
];

const PLAYER_EMOJIS = ['🦄', '🐲', '🐉', '🐺', '🦊', '🐯', '🐵', '🐼', '🐰', '🐱', '🐻', '🐹'];

// ================= توابع عمومی بازی =================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getRoleByKey(key) {
  return ROLES.find(r => r.key === key);
}

function getPlayer(gameObj, userId) {
  if (!gameObj) return null;
  return gameObj.players.find(p => p.id === userId);
}

function formatPlayersList(gameObj, revealRolesForDead = false) {
  if (!gameObj || !gameObj.players || gameObj.players.length === 0) {
    return 'هنوز بازیکنی در بازی نیست.';
  }
  let text = '';
  gameObj.players.forEach((p, idx) => {
    const num = idx + 1;
    const role = getRoleByKey(p.roleKey);
    let line = `${num}. ${p.emoji} ${p.displayName}`;
    if (p.dead) {
      line = `~${line}~`;
      if (revealRolesForDead && role) {
        line += ` 🟣 ${role.name}`;
      }
    }
    text += line + '\n';
  });
  return text;
}

function checkWinner(gameObj) {
  const alive = gameObj.players.filter(p => !p.dead);
  const mafia = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'mafia').length;
  const town  = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'town').length;
  const indep = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'independent').length;

  if (mafia === 0 && town > 0) return 'town';
  if (mafia > 0 && mafia >= town && town > 0) return 'mafia';
  if (indep > 0 && mafia === 0 && town === 0) return 'independent';
  return null;
}

function resetAll() {
  lobbyPlayers = [];
  game = null;
}

// ================= انتخاب اسم در PV =================

// /start در PV: ثبت / یادآوری اسم
bot.onText(/\/start(?:@[\w_]+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';

  if (!isPrivate) {
    return bot.sendMessage(
      chatId,
      'سلام! من ربات مافیای پافی‌لند هستم.\nبرای بازی از /newgame در گروه استفاده کنید.'
    );
  }

  if (!dbReady) {
    return bot.sendMessage(
      chatId,
      'سلام! هنوز دیتابیس آماده نیست، کمی بعد دوباره تلاش کن.'
    );
  }

  await ensureDailyReset();

  let userDoc = await Player.findOne({ telegramId: msg.from.id }).exec();
  if (!userDoc) {
    userDoc = new Player({
      telegramId: msg.from.id,
      name: msg.from.first_name,
      username: msg.from.username || null
    });
    await userDoc.save();
  }

  // اگر قبلاً بن بوده ولی زمانش گذشته، پاک کنیم
  if (userDoc.banUntil && userDoc.banUntil <= new Date()) {
    userDoc.banUntil = null;
    await userDoc.save();
  }

  if (!userDoc.displayName) {
    return bot.sendMessage(
      chatId,
      '🎀 خوش اومدی به پافی‌لند!\n\n' +
      'برای ورود به بازی، یک اسم پُفی برای خودت انتخاب کن.\n' +
      'اسم دلخواهت رو همین‌جا بفرست (حداکثر ۲۰ کاراکتر).'
    );
  }

  return bot.sendMessage(
    chatId,
    `سلام ${userDoc.displayName} 🌸\nمی‌تونی تو گروه با /join وارد بازی بشی.\n` +
    'برای دیدن لیگ و سکه‌هات: /league'
  );
});

// هر پیام متنی در PV برای ثبت اسم اگر هنوز انتخاب نشده
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'private') return;
  if (!msg.text || msg.text.startsWith('/')) return;
  if (!dbReady) return;

  let userDoc = await Player.findOne({ telegramId: msg.from.id }).exec();
  if (!userDoc || userDoc.displayName) return;

  const name = msg.text.trim().slice(0, 20);
  if (!name) {
    return bot.sendMessage(chatId, 'لطفاً یک اسم معتبر بفرست.');
  }

  userDoc.displayName = name;
  await userDoc.save();

  return bot.sendMessage(
    chatId,
    `اسم پُفی شما ثبت شد: ${name} 🎀\n` +
    'حالا می‌تونی در گروه با /join وارد بازی شوی.'
  );
});

// ================= ساخت لابی و جوین =================

bot.onText(/\/newgame(?:@[\w_]+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type.endsWith('group');
  if (!isGroup) {
    return bot.sendMessage(chatId, 'این دستور فقط داخل گروه قابل استفاده است.');
  }

  if (game) {
    return bot.sendMessage(chatId, 'یک بازی در حال اجراست. صبر کنید تا تمام شود.');
  }

  resetAll();
  game = null;

  await bot.sendMessage(
    chatId,
    '🎭 لابی جدید مافیای پافی‌لند ساخته شد!\n\n' +
    `برای شرکت در بازی از /join استفاده کنید.\n` +
    `این نسخه فقط برای ${MIN_PLAYERS} نفر (دقیقاً) است.`
  );
});

bot.onText(/\/join(?:@[\w_]+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  const isGroup = msg.chat.type.endsWith('group');
  if (!isGroup) return;

  if (!dbReady) {
    return bot.sendMessage(chatId, 'سیستم دیتابیس هنوز آماده نیست. بعداً دوباره تلاش کنید.');
  }

  let userDoc = await Player.findOne({ telegramId: user.id }).exec();
  if (!userDoc) {
    userDoc = new Player({
      telegramId: user.id,
      name: user.first_name,
      username: user.username || null
    });
    await userDoc.save();
  }

  // اگر بن است و هنوز زمانش تمام نشده
  if (userDoc.banUntil && userDoc.banUntil > new Date()) {
    const diffHours = Math.ceil((userDoc.banUntil - new Date()) / 3600000);
    return bot.sendMessage(
      chatId,
      `${userDoc.displayName || userDoc.name} مسدود است.\n` +
      `مدت باقی‌مانده: حدود ${diffHours} ساعت`
    );
  }

  // اگر بن بود ولی تمام شده
  if (userDoc.banUntil && userDoc.banUntil <= new Date()) {
    userDoc.banUntil = null;
    await userDoc.save();
  }

  if (!userDoc.displayName) {
    return bot.sendMessage(
      chatId,
      `${user.first_name} عزیز، قبل از ورود به بازی باید در PV ربات یک اسم انتخاب کنی.\n` +
      'به ربات پیام بده و /start بزن و اسم رو ثبت کن 🎀'
    );
  }

  if (lobbyPlayers.find(p => p.id === user.id)) {
    return bot.sendMessage(chatId, `${userDoc.displayName}، قبلاً وارد لابی شده‌ای.`);
  }

  if (lobbyPlayers.length >= MAX_PLAYERS) {
    return bot.sendMessage(chatId, 'ظرفیت لابی پر شده است.');
  }

  lobbyPlayers.push({
    id: user.id,
    displayName: userDoc.displayName,
    username: user.username || null
  });

  await bot.sendMessage(
    chatId,
    `${userDoc.displayName} وارد لابی شد.\n` +
    `تعداد فعلی: ${lobbyPlayers.length}/${MAX_PLAYERS}`
  );

  if (lobbyPlayers.length === MAX_PLAYERS) {
    await bot.sendMessage(chatId, 'ظرفیت تکمیل شد! بازی در حال شروع است...');
    await startGame(chatId);
  }
});

// ================= شروع بازی =================

async function startGame(chatId) {
  const count = lobbyPlayers.length;
  if (count !== 6) {
    await bot.sendMessage(
      chatId,
      'در این نسخه باید دقیقاً ۶ نفر در لابی باشند.'
    );
    return;
  }

  const shuffledPlayers = shuffle(lobbyPlayers);
  const emojis = shuffle(PLAYER_EMOJIS).slice(0, count);

  // نقش‌ها: ۲ مافیا، ۳ شهر، ۱ تصادفی (مستقل یا دکتر)
  const baseRoles = [
    'nish_poof',
    'moosh_saye',
    'moosh_afshagar',
    'hamkhaab_pofy',
    'khar_goosh_tirpofi'
  ];
  const lastRole = Math.random() < 0.5 ? 'pof_abri' : 'pashmak_plus';
  baseRoles.push(lastRole);
  const roles = shuffle(baseRoles);

  game = {
    chatId,
    phase: 'night',
    day: 0,
    night: 0,
    players: [],
    nightActions: {
      mafiaVotes: {},
      doctorTargetId: null,
      hamkhaabTargetId: null,
      tirpofiTargetId: null
    },
    gameScore: {}    // امتیاز عملکرد برای MVP
  };

  shuffledPlayers.forEach((p, i) => {
    game.players.push({
      id: p.id,
      displayName: p.displayName,
      username: p.username,
      emoji: emojis[i],
      roleKey: roles[i],
      dead: false,
      shieldUsed: false
    });
    game.gameScore[p.id] = { points: 0 };
  });

  let intro =
    '🎭 بازی مافیای پافی‌لند شروع شد!\n\n' +
    '🌞 #روز اول\n' +
    'بازیکنان وارد شهر پُفی شدند...\n\n' +
    'نقش شما به PV ارسال می‌شود.\n\n' +
    '👥 بازیکنان:\n\n' +
    formatPlayersList(game, false);

  await bot.sendMessage(chatId, intro, { parse_mode: 'Markdown' });

  // ارسال نقش‌ها در PV
  for (const p of game.players) {
    const role = getRoleByKey(p.roleKey);
    if (!role) continue;

    let goalText =
      role.team === 'mafia'
        ? 'کاهش تعداد شهروندها تا تسلط مافیا.'
        : role.team === 'town'
        ? 'شناسایی مافیا و نجات شهر پُفی.'
        : 'زنده ماندن تا پایان و برد مستقل.';

    const roleText =
      `🎭 نقش شما:\n${role.name}\n\n` +
      `📜 توضیح:\n${role.desc}\n\n` +
      `🎯 هدف:\n${goalText}`;

    await bot.sendMessage(p.id, roleText).catch(() => {});
  }

  // موش‌افشاگر
  const mouse = game.players.find(pl => pl.roleKey === 'moosh_afshagar' && !pl.dead);
  if (mouse) {
    await bot.sendMessage(
      chatId,
      '📢 موش‌افشاگر در میان شماست و می‌تواند نقش خود را افشا کند.'
    );
    await bot.sendMessage(
      mouse.id,
      'اگر می‌خواهی نقش خود را در گروه افشا کنی دکمه زیر را بزن:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 افشای نقش موش‌افشاگر', callback_data: 'reveal_mouse' }]
          ]
        }
      }
    ).catch(() => {});
  }

  lobbyPlayers = [];
  game.night = 1;

  await bot.sendMessage(
    chatId,
    '🌙 #شب اول\nشهر در سکوت فرو رفت...\nپنل‌های شبانه برای نقش‌ها ارسال می‌شود.'
  );

  await nightPhase();
}

// ================= فاز شب =================

async function nightPhase() {
  if (!game) return;
  const chatId = game.chatId;
  game.phase = 'night';

  game.nightActions = {
    mafiaVotes: {},
    doctorTargetId: null,
    hamkhaabTargetId: null,
    tirpofiTargetId: null
  };

  const alive = game.players.filter(p => !p.dead);

  // مافیا – داخل گروه
  const mafiaAlive = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'mafia');
  const mafiaTargets = alive.filter(p => getRoleByKey(p.roleKey)?.team !== 'mafia');

  if (mafiaAlive.length > 0 && mafiaTargets.length > 0) {
    const keyboard = [];
    for (let i = 0; i < mafiaTargets.length; i += 3) {
      const row = [];
      for (let j = i; j < i + 3 && j < mafiaTargets.length; j++) {
        const t = mafiaTargets[j];
        row.push({
          text: `${t.emoji}`,
          callback_data: `night_mafia:${t.id}`
        });
      }
      keyboard.push(row);
    }

    await bot.sendMessage(
      chatId,
      '🔴 مافیا، هدف خود را انتخاب کنید (فقط مافیا می‌تواند روی دکمه‌ها بزند).',
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }

  const doctor = alive.find(p => p.roleKey === 'pashmak_plus');
  if (doctor) {
    const keyboard = [];
    for (let i = 0; i < alive.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < alive.length; j++) {
        const t = alive[j];
        row.push({
          text: `${t.emoji}`,
          callback_data: `night_doc:${t.id}`
        });
      }
      keyboard.push(row);
    }
    await bot.sendMessage(
      doctor.id,
      '🍬 امشب می‌خواهی چه کسی را نجات دهی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  const hamkhaab = alive.find(p => p.roleKey === 'hamkhaab_pofy');
  if (hamkhaab) {
    const targets = alive.filter(p => p.id !== hamkhaab.id);
    const keyboard = [];
    for (let i = 0; i < targets.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < targets.length; j++) {
        const t = targets[j];
        row.push({
          text: `${t.emoji}`,
          callback_data: `night_ham:${t.id}`
        });
      }
      keyboard.push(row);
    }
    await bot.sendMessage(
      hamkhaab.id,
      '💞 امشب کنار چه کسی می‌خوابی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  const tirpofi = alive.find(p => p.roleKey === 'khar_goosh_tirpofi');
  if (tirpofi) {
    await bot.sendMessage(chatId, '🐰💥 خرگوش‌تیرپُفی امشب تیر خود را شارژ کرد...');
    const targets = alive.filter(p => p.id !== tirpofi.id);
    const keyboard = [];
    for (let i = 0; i < targets.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < targets.length; j++) {
        const t = targets[j];
        row.push({
          text: `${t.emoji}`,
          callback_data: `night_tir:${t.id}`
        });
      }
      keyboard.push(row);
    }
    await bot.sendMessage(
      tirpofi.id,
      '💥 امشب چه کسی را هدف تیر پُفی قرار می‌دهی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }
}

function allNightActionsReady() {
  if (!game) return false;
  const alive = game.players.filter(p => !p.dead);
  const hasMafia = alive.some(p => getRoleByKey(p.roleKey)?.team === 'mafia');
  const hasDoc = alive.some(p => p.roleKey === 'pashmak_plus');
  const hasHam = alive.some(p => p.roleKey === 'hamkhaab_pofy');
  const hasTir = alive.some(p => p.roleKey === 'khar_goosh_tirpofi');

  if (hasMafia && Object.keys(game.nightActions.mafiaVotes).length === 0) return false;
  if (hasDoc && game.nightActions.doctorTargetId === null) return false;
  if (hasHam && game.nightActions.hamkhaabTargetId === null) return false;
  if (hasTir && game.nightActions.tirpofiTargetId === null) return false;

  return true;
}

async function resolveNight() {
  if (!game) return;
  const chatId = game.chatId;
  const alive = game.players.filter(p => !p.dead);

  let report = `🌙 گزارش شب ${game.night} پافی‌لند\n\n`;

  // هدف مافیا
  let mafiaTarget = null;
  const mafiaVotes = game.nightActions.mafiaVotes;
  if (Object.keys(mafiaVotes).length > 0) {
    const counts = {};
    Object.values(mafiaVotes).forEach(tid => {
      counts[tid] = (counts[tid] || 0) + 1;
    });
    let bestId = null;
    let bestCount = 0;
    for (const [tid, c] of Object.entries(counts)) {
      if (c > bestCount) {
        bestCount = c;
        bestId = parseInt(tid, 10);
      }
    }
    mafiaTarget = getPlayer(game, bestId);
  }

  const doctorTarget = game.nightActions.doctorTargetId
    ? getPlayer(game, game.nightActions.doctorTargetId)
    : null;
  const hamkhaabPl = alive.find(p => p.roleKey === 'hamkhaab_pofy');
  const hamTarget = game.nightActions.hamkhaabTargetId
    ? getPlayer(game, game.nightActions.hamkhaabTargetId)
    : null;
  const tirpofiPl = alive.find(p => p.roleKey === 'khar_goosh_tirpofi');
  const tirTarget = game.nightActions.tirpofiTargetId
    ? getPlayer(game, game.nightActions.tirpofiTargetId)
    : null;
  const pofAbri = alive.find(p => p.roleKey === 'pof_abri');

  const toDie = new Set();
  const saved = new Set();

  // همخواب
  if (hamkhaabPl && !hamkhaabPl.dead && hamTarget && !hamTarget.dead) {
    const hamRole = getRoleByKey(hamTarget.roleKey);
    if (hamRole && hamRole.team === 'mafia') {
      toDie.add(hamkhaabPl.id);
      report += `💞 پُفی‌همخواب امشب کنار مافیا خوابید و از ترس مرد...\n\n`;
      if (game.gameScore[hamkhaabPl.id]) game.gameScore[hamkhaabPl.id].points -= 1;
    } else {
      if (mafiaTarget && (mafiaTarget.id === hamTarget.id || mafiaTarget.id === hamkhaabPl.id)) {
        toDie.add(hamkhaabPl.id);
        toDie.add(hamTarget.id);
        report += `💞 مافیا به تخت خواب پُفی‌همخواب حمله کردند؛ هر دو کشته شدند.\n\n`;
        mafiaTarget = null;
      } else {
        report += `💞 پُفی‌همخواب امشب کنار ${hamTarget.emoji} ${hamTarget.displayName} خوابید و شب آرام گذشت.\n\n`;
      }
    }
  }

  // پزشک
  if (doctorTarget && mafiaTarget && doctorTarget.id === mafiaTarget.id) {
    saved.add(doctorTarget.id);
    report += `🍬 پشمک‌پلاس ${doctorTarget.emoji} ${doctorTarget.displayName} را از مرگ نجات داد.\n\n`;
    if (game.gameScore[doctorTarget.id]) game.gameScore[doctorTarget.id].points += 1;
    mafiaTarget = null;
  }

  // پُف‌اَبری
  if (pofAbri && !pofAbri.dead && mafiaTarget && mafiaTarget.id === pofAbri.id && !pofAbri.shieldUsed) {
    pofAbri.shieldUsed = true;
    saved.add(pofAbri.id);
    report += `☁️ پُف‌اَبری مورد حمله قرار گرفت ولی به خاطر حالت ابری‌اش زنده ماند.\n\n`;
    mafiaTarget = null;
  }

  // تیرپُفی
  if (tirpofiPl && !tirpofiPl.dead && tirTarget && !tirTarget.dead) {
    const roleT = getRoleByKey(tirTarget.roleKey);
    if (roleT && roleT.team === 'mafia') {
      toDie.add(tirTarget.id);
      report += `🐰💥 تیر پُفی خرگوش به مافیا خورد و ${tirTarget.emoji} ${tirTarget.displayName} کشته شد!\n\n`;
      if (game.gameScore[tirpofiPl.id]) game.gameScore[tirpofiPl.id].points += 2;
    } else {
      report += `🐰💥 تیر پُفی به ${tirTarget.emoji} ${tirTarget.displayName} خورد ولی فقط گیجش کرد.\n\n`;
      if (game.gameScore[tirpofiPl.id]) game.gameScore[tirpofiPl.id].points -= 1;
    }
  }

  // حمله مافیا
  if (mafiaTarget && !mafiaTarget.dead && !saved.has(mafiaTarget.id)) {
    toDie.add(mafiaTarget.id);
    report += `🔴 مافیا امشب ${mafiaTarget.emoji} ${mafiaTarget.displayName} را کشت.\n\n`;
    const mafias = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'mafia');
    mafias.forEach(m => {
      if (game.gameScore[m.id]) game.gameScore[m.id].points += 1;
    });
  }

  if (toDie.size === 0) {
    report += 'امشب کسی کشته نشد.\n';
  } else {
    for (const id of toDie) {
      const pl = getPlayer(game, id);
      if (pl && !pl.dead) {
        pl.dead = true;
      }
    }
  }

  await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });

  const winner = checkWinner(game);
  if (winner) {
    await endGameWithWinner(winner);
    return;
  }

  game.phase = 'day';
  game.day += 1;

  await bot.sendMessage(
    chatId,
    `🌞 #روز ${game.day}\n\n` +
    'بازمانده‌ها بیدار شدند...\n\n' +
    '👥 وضعیت فعلی:\n\n' +
    formatPlayersList(game, true) +
    '\nدر این نسخه، رأی‌گیری روز به‌صورت دستی مدیریت می‌شود.'
  );
}

// ================= پایان بازی + آپدیت لیگ + MVP =================

async function endGameWithWinner(winnerTeam) {
  if (!game) return;
  const chatId = game.chatId;

  let text = '🏁 بازی به پایان رسید!\n\n';
  if (winnerTeam === 'town') text += '🎉 شهر پُفی برنده شد!\n\n';
  else if (winnerTeam === 'mafia') text += '🩸 مافیا بر شهر مسلط شد!\n\n';
  else if (winnerTeam === 'independent') text += '☁️ پُف‌اَبری مستقل برنده شد!\n\n';

  text += '👥 وضعیت نهایی:\n\n' + formatPlayersList(game, true);

  // MVP بر اساس gameScore
  let mvpId = null;
  let bestScore = -9999;
  for (const [uidStr, sc] of Object.entries(game.gameScore || {})) {
    if (sc.points > bestScore) {
      bestScore = sc.points;
      mvpId = parseInt(uidStr, 10);
    }
  }

  if (mvpId !== null && bestScore > 0) {
    const mvp = getPlayer(game, mvpId);
    if (mvp) {
      text += `\n\n🏅 MVP این بازی: ${mvp.emoji} ${mvp.displayName}\n` +
              `امتیاز عملکرد: ${bestScore} ⭐\n` +
              '۱۰ سکه جایزه MVP دریافت کرد.\n';
    }
  }

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  if (dbReady) {
    try {
      await ensureDailyReset();
      for (const pl of game.players) {
        const role = getRoleByKey(pl.roleKey);
        const team = role ? role.team : null;
        if (!team) continue;

        const isWinner =
          (winnerTeam === 'town' && team === 'town') ||
          (winnerTeam === 'mafia' && team === 'mafia') ||
          (winnerTeam === 'independent' && team === 'independent');

        let doc = await Player.findOne({ telegramId: pl.id }).exec();
        if (!doc) continue;

        doc.totalGames += 1;
        if (isWinner) {
          doc.totalWins += 1;
          doc.totalPoints += 5;
          doc.dailyPoints += 5;
          doc.coins += 5;
        } else {
          doc.totalLosses += 1;
          doc.totalPoints += 1;
          doc.dailyPoints += 1;
          doc.coins += 1;
        }

        // MVP bonus
        if (mvpId && pl.id === mvpId && bestScore > 0) {
          doc.coins += 10;
        }

        doc.league = computeLeague(doc.totalPoints);
        doc.lastUpdated = new Date();
        await doc.save();
      }
    } catch (e) {
      console.error('Stats update error:', e);
    }
  }

  resetAll();
}

// ================= کال‌بک‌ها (شب + افشا) =================

bot.on('callback_query', async (query) => {
  if (!game) return;
  const data = query.data;
  const fromId = query.from.id;

  // افشای موش‌افشاگر
  if (data === 'reveal_mouse') {
    const mouse = game.players.find(
      p => p.id === fromId && p.roleKey === 'moosh_afshagar' && !p.dead
    );
    if (!mouse) {
      return bot.answerCallbackQuery(query.id, {
        text: 'این دکمه فقط برای موش‌افشاگر است.',
        show_alert: true
      });
    }
    await bot.sendMessage(
      game.chatId,
      `📢 افشاگری رسمی:\n\n${mouse.emoji} ${mouse.displayName} خودش را «موش‌افشاگر 🧀» معرفی کرد!`
    );
    return bot.answerCallbackQuery(query.id, {
      text: 'نقشت در گروه افشا شد.',
      show_alert: true
    });
  }

  if (!data.includes(':')) {
    return bot.answerCallbackQuery(query.id);
  }

  const [type, rawTarget] = data.split(':');
  const targetId = parseInt(rawTarget, 10);

  const player = getPlayer(game, fromId);
  if (!player || player.dead) {
    return bot.answerCallbackQuery(query.id, {
      text: 'شما در بازی زنده نیستید.',
      show_alert: true
    });
  }

  if (game.phase !== 'night') {
    return bot.answerCallbackQuery(query.id, {
      text: 'الان فاز شب فعال نیست.',
      show_alert: true
    });
  }

  const target = getPlayer(game, targetId);
  if (!target || target.dead) {
    return bot.answerCallbackQuery(query.id, {
      text: 'هدف معتبر نیست.',
      show_alert: true
    });
  }

  if (type === 'night_mafia') {
    if (getRoleByKey(player.roleKey)?.team !== 'mafia') {
      return bot.answerCallbackQuery(query.id, {
        text: 'این گزینه فقط برای مافیاست.',
        show_alert: true
      });
    }
    game.nightActions.mafiaVotes[fromId] = targetId;
    return bot.answerCallbackQuery(query.id, { text: `هدف شما: ${target.displayName}` });
  }

  if (type === 'night_doc') {
    if (player.roleKey !== 'pashmak_plus') {
      return bot.answerCallbackQuery(query.id, {
        text: 'این گزینه فقط برای پشمک‌پلاس است.',
        show_alert: true
      });
    }
    game.nightActions.doctorTargetId = targetId;
    return bot.answerCallbackQuery(query.id, { text: `امشب ${target.displayName} را نجات می‌دهی.` });
  }

  if (type === 'night_ham') {
    if (player.roleKey !== 'hamkhaab_pofy') {
      return bot.answerCallbackQuery(query.id, {
        text: 'این گزینه فقط برای پُفی‌همخواب است.',
        show_alert: true
      });
    }
    if (targetId === fromId) {
      return bot.answerCallbackQuery(query.id, {
        text: 'نمی‌توانی کنار خودت بخوابی!',
        show_alert: true
      });
    }
    game.nightActions.hamkhaabTargetId = targetId;
    return bot.answerCallbackQuery(query.id, { text: `امشب کنار ${target.displayName} می‌خوابی.` });
  }

  if (type === 'night_tir') {
    if (player.roleKey !== 'khar_goosh_tirpofi') {
      return bot.answerCallbackQuery(query.id, {
        text: 'این گزینه فقط برای خرگوش‌تیرپُفی است.',
        show_alert: true
      });
    }
    if (targetId === fromId) {
      return bot.answerCallbackQuery(query.id, {
        text: 'خودت را نمی‌توانی هدف بگیری!',
        show_alert: true
      });
    }
    game.nightActions.tirpofiTargetId = targetId;
    return bot.answerCallbackQuery(query.id, { text: `امشب ${target.displayName} را هدف گرفتی.` });
  }

  if (allNightActionsReady()) {
    await resolveNight();
  }
});

// ================= لیگ و برترین‌ها =================

bot.onText(/\/league(?:@[\w_]+)?/i, async (msg) => {
  if (!dbReady) {
    return bot.sendMessage(msg.chat.id, 'سیستم لیگ فعال نیست (دیتابیس متصل نیست).');
  }
  await ensureDailyReset();

  const user = msg.from;
  let doc = await Player.findOne({ telegramId: user.id }).exec();
  if (!doc) {
    return bot.sendMessage(
      msg.chat.id,
      'هنوز در پافی‌لند بازی نکرده‌ای. با شرکت در بازی‌ها، وارد لیگ می‌شوی.'
    );
  }

  const text =
    `🎟 پروفایل پافی‌لند\n\n` +
    `👤 نام: ${doc.displayName || doc.name}\n` +
    (doc.username ? `🔗 یوزرنیم: @${doc.username}\n` : '') +
    `🏅 لیگ: ${doc.league}\n\n` +
    `🎮 بازی‌ها: ${doc.totalGames}\n` +
    `✅ بردها: ${doc.totalWins}\n` +
    `❌ باخت‌ها: ${doc.totalLosses}\n\n` +
    `⭐ امتیاز کلی: ${doc.totalPoints}\n` +
    `🔥 امتیاز امروز: ${doc.dailyPoints}\n` +
    `🪙 سکه‌ها: ${doc.coins}`;

  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/top(?:@[\w_]+)?/i, async (msg) => {
  if (!dbReady) {
    return bot.sendMessage(msg.chat.id, 'سیستم لیگ فعال نیست.');
  }
  await ensureDailyReset();

  const top = await Player.find({}).sort({ totalPoints: -1 }).limit(10).exec();
  if (!top.length) {
    return bot.sendMessage(msg.chat.id, 'هنوز کسی در جدول لیگ نیست.');
  }

  let text = '🏆 Top 10 لیگ پافی‌لند\n\n';
  top.forEach((p, i) => {
    text += `${i + 1}. ${p.displayName || p.name} ${p.league}\n` +
            `   ⭐ ${p.totalPoints} | 🎮 ${p.totalGames}\n\n`;
  });

  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/top_daily(?:@[\w_]+)?/i, async (msg) => {
  if (!dbReady) {
    return bot.sendMessage(msg.chat.id, 'سیستم لیگ فعال نیست.');
  }
  await ensureDailyReset();

  const top = await Player.find({}).sort({ dailyPoints: -1 }).limit(10).exec();
  if (!top.length || top.every(p => p.dailyPoints === 0)) {
    return bot.sendMessage(msg.chat.id, 'امروز هنوز کسی امتیاز نگرفته.');
  }

  let text = '🔥 Top 10 امروز پافی‌لند\n\n';
  top.forEach((p, i) => {
    text += `${i + 1}. ${p.displayName || p.name}\n` +
            `   🔥 ${p.dailyPoints} | ⭐ ${p.totalPoints}\n\n`;
  });

  await bot.sendMessage(msg.chat.id, text);
});

// ================= انتقال سکه با ریپلای =================
//
// دستور: در گروه یا PV، روی پیام کاربر ریپلای کن و بنویس:
// /pay 5   (یعنی ۵ سکه انتقال بده)

bot.onText(/\/pay(?:@[\w_]+)?\s+(\d+)/i, async (msg, match) => {
  if (!dbReady) {
    return bot.sendMessage(msg.chat.id, 'سیستم سکه فعال نیست (دیتابیس آماده نیست).');
  }

  const amount = parseInt(match[1], 10);
  if (!msg.reply_to_message) {
    return bot.sendMessage(msg.chat.id, 'برای انتقال سکه، روی پیام کاربر ریپلای کن و بعد /pay تعداد رو بزن.');
  }
  if (amount <= 0) {
    return bot.sendMessage(msg.chat.id, 'مقدار سکه باید بیشتر از صفر باشد.');
  }

  const fromUser = msg.from;
  const toUser = msg.reply_to_message.from;

  if (fromUser.id === toUser.id) {
    return bot.sendMessage(msg.chat.id, 'نمی‌توانی به خودت سکه بفرستی.');
  }

  await ensureDailyReset();

  let fromDoc = await Player.findOne({ telegramId: fromUser.id }).exec();
  let toDoc   = await Player.findOne({ telegramId: toUser.id }).exec();

  if (!fromDoc) {
    fromDoc = new Player({
      telegramId: fromUser.id,
      name: fromUser.first_name,
      username: fromUser.username || null
    });
  }
  if (!toDoc) {
    toDoc = new Player({
      telegramId: toUser.id,
      name: toUser.first_name,
      username: toUser.username || null
    });
  }

  if (fromDoc.coins < amount) {
    return bot.sendMessage(
      msg.chat.id,
      `سکه‌های شما کافی نیست.\nسکه فعلی: ${fromDoc.coins}`
    );
  }

  fromDoc.coins -= amount;
  toDoc.coins += amount;

  fromDoc.lastUpdated = new Date();
  toDoc.lastUpdated = new Date();

  await fromDoc.save();
  await toDoc.save();

  const fromName = fromDoc.displayName || fromDoc.name;
  const toName   = toDoc.displayName || toDoc.name;

  await bot.sendMessage(
    msg.chat.id,
    `🪙 انتقال سکه انجام شد:\n\n` +
    `${fromName} → ${toName}\n` +
    `مقدار: ${amount} سکه\n\n` +
    `${fromName} | سکه جدید: ${fromDoc.coins}\n` +
    `${toName} | سکه جدید: ${toDoc.coins}`
  );
});

// ================= سیستم ban ساده =================
//
// دستور: /ban 10 Ali
// یعنی: بن کردن کاربر با displayName = "Ali" به مدت ۱۰ ساعت
// فقط ادمین گروه می‌تواند.

bot.onText(/\/ban(?:@[\w_]+)?\s+(\d+)\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const hours = parseInt(match[1], 10);
  const name = match[2].trim();

  if (!dbReady) {
    return bot.sendMessage(chatId, 'دیتابیس آماده نیست.');
  }

  // فقط ادمین یا کریتور
  try {
    const member = await bot.getChatMember(chatId, msg.from.id);
    if (member.status !== 'administrator' && member.status !== 'creator') {
      return bot.sendMessage(chatId, 'فقط ادمین می‌تواند مسدود کند.');
    }
  } catch (e) {
    return bot.sendMessage(chatId, 'خطا در تشخیص ادمین بودن.');
  }

  if (hours <= 0) {
    return bot.sendMessage(chatId, 'ساعت مسدودی باید بیشتر از صفر باشد.');
  }

  const userDoc = await Player.findOne({ displayName: name }).exec();
  if (!userDoc) {
    return bot.sendMessage(chatId, `کاربری با نام ${name} پیدا نشد.`);
  }

  const until = new Date(Date.now() + hours * 3600000);
  userDoc.banUntil = until;
  await userDoc.save();

  await bot.sendMessage(
    chatId,
    `🚫 کاربر ${name} به مدت ${hours} ساعت از بازی مسدود شد.\n` +
    'در این مدت نمی‌تواند با /join وارد لابی شود.'
  );
});

// ================= خطاهای polling =================

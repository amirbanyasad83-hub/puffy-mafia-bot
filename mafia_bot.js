// mafia-puffy.js
// ربات مافیای پافی‌لند – نسخهٔ نهایی، ۶ نفره، با رأی‌گیری اینلاین و تایمرها
// نقش‌های اضافه: زره‌پوش 🛡️ (مافیا)، لیوای اکرمن ⚔️ (شهر)
// سیستم ban مخفی با پیام خصوصی شیک
// آمادهٔ اجرا با یک توکن؛ بدون دیتابیس برای سادگی و صفر خطا

'use strict';

const TelegramBot = require('node-telegram-bot-api');

// ================= تنظیمات =================

// ❗ توکن ربات خودت را اینجا قرار بده
const TOKEN = '8342833430:AAFDELHBaGi-S9H72waPt15Fl-bHrA4YLQw';

// محدودیت‌ها (این نسخه فقط برای ۶ نفر است)
const MIN_PLAYERS = 6;
const MAX_PLAYERS = 6;

// تایمرها (ثانیه)
const DAY_VOTE_SECONDS = 45;
const COURT_DEFENSE_SECONDS = 15;
const COURT_REVOTE_SECONDS = 15;

// دستور مخفی ban (فقط خودت می‌دانی)
const SECRET_BAN_CMD = '/shadowban';

// ================= راه‌اندازی ربات =================

const bot = new TelegramBot(TOKEN, { polling: true });

// ================= وضعیت کلی =================

let lobbyPlayers = []; // بازیکنان داخل لابی
let game = null;       // وضعیت بازی جاری
let bans = new Map();  // bans: telegramId -> banUntil (Date)

// ================= نقش‌ها =================

const ROLES = [
  // شهر
  { key: 'moosh_afshagar', name: 'موش‌افشاگر 🧀', team: 'town',
    desc: 'می‌تواند نقش خود را به‌صورت رسمی در گروه افشا کند.' },
  { key: 'hamkhaab_pofy', name: 'پُفی‌همخواب 💞', team: 'town',
    desc: 'هر شب کنار یک نفر می‌خوابد؛ اگر هدف/خودش مورد حمله مافیا باشد، هر دو می‌میرند. اگر کنار مافیا بخوابد، خودش درجا می‌میرد.' },
  { key: 'khar_goosh_tirpofi', name: 'خرگوش‌تیرپُفی 🐰💥', team: 'town',
    desc: 'هر شب یک نفر را هدف می‌گیرد؛ اگر مافیا باشد، حذف می‌شود؛ اگر شهر باشد فقط پیام بی‌اثر می‌آید.' },
  { key: 'pashmak_plus', name: ' پشمک‌پلاس 🍬', team: 'town',
    desc: 'پزشک؛ هر شب یک نفر را از حذف نجات می‌دهد.' },
  { key: 'levi_ackerman', name: 'لیوای اکرمن ⚔️', team: 'town',
    desc: 'هر شب یک نفر را Mark می‌کند؛ اگر هدف مافیا باشد، صبح حذف می‌شود (زره‌پوش یک‌بار سپر دارد).' },

  // مافیا
  { key: 'nish_poof', name: 'نیش‌پوف 🐝', team: 'mafia',
    desc: 'قاتل مافیا؛ در رأی شبانه مشارکت می‌کند.' },
  { key: 'moosh_saye', name: 'موش‌سایه 🐾', team: 'mafia',
    desc: 'مافیای همراه؛ در رأی شبانه مشارکت می‌کند.' },
  { key: 'zareh_poosh', name: 'زره‌پوش 🛡️', team: 'mafia',
    desc: 'اولین حذف روی او بی‌اثر است؛ سپر یک‌بار مصرف.' },

  // مستقل (شانسی)
  { key: 'pof_abri', name: 'پُف‌اَبری ☁️', team: 'independent',
    desc: 'اولین حمله شبانه روی او بی‌اثر است. اگر تنها بماند، مستقل برنده می‌شود.' }
];

const PLAYER_EMOJIS = ['🦄', '🐲', '🐉', '🐺', '🦊', '🐯'];

// ================= توابع کمکی =================

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
  if (!gameObj || !gameObj.players || gameObj.players.length === 0) return 'هنوز بازیکنی در بازی نیست.';
  let text = '';
  gameObj.players.forEach((p, idx) => {
    const num = idx + 1;
    const role = getRoleByKey(p.roleKey);
    let line = `${num}. ${p.emoji} ${p.name}`;
    if (p.dead) {
      line = `~${line}~`;
      if (revealRolesForDead && role) line += ` 🟣 ${role.name}`;
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

// ================= راهنما =================

bot.onText(/\/help|\/راهنما/i, (msg) => {
  const text =
`📘 راهنمای سریع پافی‌لند

🎭 نقش‌ها:
- 🧀 موش‌افشاگر: می‌تواند نقش خود را افشا کند.
- 💞 پُفی‌همخواب: کنار یک نفر می‌خوابد؛ در شرایطی هر دو می‌میرند.
- 🐰💥 خرگوش‌تیرپُفی: هدف‌گیری شبانه؛ روی مافیا حذف، روی شهر بی‌اثر.
- 🍬 پشمک‌پلاس: پزشک؛ یک نفر را نجات می‌دهد.
- ⚔️ لیوای اکرمن: Mark شبانه؛ اگر هدف مافیا باشد صبح حذف می‌شود.
- 🛡️ زره‌پوش: اولین حذف روی او بی‌اثر است (سپر یک‌بار).
- ☁️ پُف‌اَبری: اولین حمله بی‌اثر؛ مستقل.
- 🐝 نیش‌پوف + 🐾 موش‌سایه: تیم مافیا.

⏳ تایمرها:
- رأی‌گیری روز: ${DAY_VOTE_SECONDS}s
- دفاع دادگاه: ${COURT_DEFENSE_SECONDS}s
- رأی‌گیری دادگاه: ${COURT_REVOTE_SECONDS}s

🗳 رأی‌گیری:
- اینلاین با دکمه‌ها.
- هر رأی عمومی اعلام می‌شود: «فلانی به فلانی رأی داد».
- بیشترین رأی → دادگاه → دفاع → رأی «گناهکار/بی‌گناه».

🚫 مسدودی:
- در صورت لزوم با دستور مخفی انجام می‌شود و پیام شیک خصوصی ارسال می‌گردد.

موفق باشید پُفی‌ها 🌈✨`;
  bot.sendMessage(msg.chat.id, text);
});

// ================= ساخت لابی و ورود =================

bot.onText(/\/newgame/i, async (msg) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type.endsWith('group');
  if (!isGroup) return bot.sendMessage(chatId, 'این دستور فقط داخل گروه قابل استفاده است.');

  if (game) return bot.sendMessage(chatId, 'یک بازی در حال اجراست. صبر کنید تا تمام شود.');

  resetAll();
  await bot.sendMessage(
    chatId,
    '🎭 لابی جدید ساخته شد!\nبرای ورود از /join استفاده کنید.\nاین نسخه دقیقاً برای ۶ نفر است.'
  );
});

bot.onText(/\/join/i, async (msg) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type.endsWith('group');
  if (!isGroup) return;

  const user = msg.from;

  // چک ban
  const now = new Date();
  const until = bans.get(user.id);
  if (until && until > now) {
    const diff = Math.ceil((until - now) / 3600000);
    return bot.sendMessage(chatId, `${user.first_name} مسدود است (حدود ${diff} ساعت باقی مانده).`);
  }

  if (lobbyPlayers.find(p => p.id === user.id)) {
    return bot.sendMessage(chatId, `${user.first_name}، قبلاً وارد لابی شده‌ای.`);
  }

  if (lobbyPlayers.length >= MAX_PLAYERS) {
    return bot.sendMessage(chatId, 'ظرفیت لابی پر شده است.');
  }

  lobbyPlayers.push({
    id: user.id,
    name: user.first_name,
    username: user.username || null
  });

  await bot.sendMessage(chatId, `${user.first_name} وارد لابی شد. (${lobbyPlayers.length}/${MAX_PLAYERS})`);

  if (lobbyPlayers.length === MAX_PLAYERS) {
    await bot.sendMessage(chatId, 'ظرفیت تکمیل شد! بازی در حال شروع است...');
    await startGame(chatId);
  }
});

// ================= شروع بازی =================

async function startGame(chatId) {
  if (lobbyPlayers.length !== 6) {
    return bot.sendMessage(chatId, 'برای شروع، دقیقاً ۶ نفر لازم است.');
  }

  const shuffledPlayers = shuffle(lobbyPlayers);
  const emojis = PLAYER_EMOJIS.slice(0, 6);

  // نقش‌ها: ۳ شهر ثابت + ۲ مافیا + ۱ شانسی بین پشمک‌پلاس و پُف‌اَبری (برای تنوع لیوای را ثابت اضافه می‌کنیم)
  const baseRoles = [
    'moosh_afshagar',   // شهر
    'hamkhaab_pofy',    // شهر
    'khar_goosh_tirpofi', // شهر
    'levi_ackerman',    // شهر (اضافهٔ ویژه)
    'nish_poof',        // مافیا
    'zareh_poosh'       // مافیا (زره‌پوش)
    // اگر خواستی یکی را تصادفی با pof_abri/pashmak_plus جایگزین کن
  ];

  const roles = shuffle(baseRoles);

  game = {
    chatId,
    phase: 'night',
    day: 0,
    night: 0,
    players: [],
    votes: {},           // رأی‌های روز
    courtTargetId: null,
    courtVotes: {},      // رأی‌های دادگاه
    nightActions: {
      mafiaVotes: {},      // userId -> targetId
      doctorTargetId: null,
      hamkhaabTargetId: null,
      tirpofiTargetId: null
    }
  };

  shuffledPlayers.forEach((p, i) => {
    game.players.push({
      id: p.id,
      name: p.name,
      username: p.username,
      emoji: emojis[i],
      roleKey: roles[i],
      dead: false,
      shieldUsed: false,      // برای زره‌پوش/پُف‌اَبری
      // لیوای
      leviMark: null,
      leviReady: false
    });
  });

  let intro =
    '🎭 بازی مافیای پافی‌لند شروع شد!\n\n' +
    '🌞 #روز اول\n' +
    'بازیکنان وارد شهر پُفی شدند؛ نقش‌ها به PV ارسال می‌شود.\n\n' +
    '👥 لیست بازیکنان:\n\n' +
    formatPlayersList(game, false);

  await bot.sendMessage(chatId, intro);

  // ارسال نقش‌ها به PV
  for (const p of game.players) {
    const role = getRoleByKey(p.roleKey);
    if (!role) continue;
    const goalText =
      role.team === 'mafia' ? 'کاهش تعداد شهروندها تا تسلط مافیا.' :
      role.team === 'town' ? 'شناسایی مافیا و نجات شهر پُفی.' :
      'زنده ماندن تا پایان و برد مستقل.';
    const roleText =
      `🎭 نقش شما:\n${role.name}\n\n` +
      `📜 توضیح:\n${role.desc}\n\n` +
      `🎯 هدف:\n${goalText}`;
    bot.sendMessage(p.id, roleText).catch(() => {});
  }

  // افشاگر
  const mouse = game.players.find(pl => pl.roleKey === 'moosh_afshagar' && !pl.dead);
  if (mouse) {
    bot.sendMessage(
      chatId,
      '📢 موش‌افشاگر در میان شماست و می‌تواند نقش خود را افشا کند.'
    );
    bot.sendMessage(
      mouse.id,
      'اگر می‌خواهی نقش خود را در گروه افشا کنی دکمه زیر را بزن:',
      { reply_markup: { inline_keyboard: [[{ text: '📢 افشای نقش', callback_data: 'reveal_mouse' }]] } }
    ).catch(() => {});
  }

  lobbyPlayers = []; // لابی خالی

  // شروع شب اول
  game.night = 1;
  await bot.sendMessage(chatId, '🌙 #شب اول\nشهر پُفی در سکوت فرو رفت… پنل‌های شبانه ارسال می‌شود.');
  await nightPhase();
}

// ================= فاز شب =================

async function nightPhase() {
  if (!game) return;
  const chatId = game.chatId;
  game.phase = 'night';

  // ریست اکشن‌ها
  game.nightActions = {
    mafiaVotes: {},
    doctorTargetId: null,
    hamkhaabTargetId: null,
    tirpofiTargetId: null
  };

  const alive = game.players.filter(p => !p.dead);

  // پنل مافیا – داخل گروه
  const mafiaAlive = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'mafia');
  const mafiaTargets = alive.filter(p => getRoleByKey(p.roleKey)?.team !== 'mafia');

  if (mafiaAlive.length > 0 && mafiaTargets.length > 0) {
    const keyboard = [];
    for (let i = 0; i < mafiaTargets.length; i += 3) {
      const row = [];
      for (let j = i; j < i + 3 && j < mafiaTargets.length; j++) {
        const t = mafiaTargets[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_mafia:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      chatId,
      '🔴 مافیا، هدف خود را انتخاب کنید (فقط مافیا می‌تواند رأی بزند).',
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }

  // پزشک – PV
  const doctor = alive.find(p => p.roleKey === 'pashmak_plus');
  if (doctor) {
    const keyboard = [];
    for (let i = 0; i < alive.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < alive.length; j++) {
        const t = alive[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_doc:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      doctor.id,
      '🍬 امشب چه کسی را نجات می‌دهی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  // همخواب – PV
  const hamkhaab = alive.find(p => p.roleKey === 'hamkhaab_pofy');
  if (hamkhaab) {
    const targets = alive.filter(p => p.id !== hamkhaab.id);
    const keyboard = [];
    for (let i = 0; i < targets.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < targets.length; j++) {
        const t = targets[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_ham:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      hamkhaab.id,
      '💞 امشب کنار چه کسی می‌خوابی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  // خرگوش‌تیرپُفی – PV + اطلاع گروه
  const tirpofi = alive.find(p => p.roleKey === 'khar_goosh_tirpofi');
  if (tirpofi) {
    bot.sendMessage(chatId, '🐰💥 خرگوش‌تیرپُفی امشب تیر پُفی را شارژ کرد…');
    const targets = alive.filter(p => p.id !== tirpofi.id);
    const keyboard = [];
    for (let i = 0; i < targets.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < targets.length; j++) {
        const t = targets[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_tir:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      tirpofi.id,
      '💥 امشب چه کسی را هدف می‌گیری؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  // لیوای – PV
  const levi = alive.find(p => p.roleKey === 'levi_ackerman');
  if (levi) {
    const targets = alive.filter(p => p.id !== levi.id);
    const keyboard = targets.map(t => [{ text: `${t.emoji} ${t.name}`, callback_data: `levi_mark:${t.id}` }]);
    bot.sendMessage(
      levi.id,
      '⚔️ لیوای! امشب چه کسی را Mark می‌کنی؟',
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

  // هدف مافیا (تجمیع رأی‌ها)
  let mafiaTarget = null;
  const mafiaVotes = game.nightActions.mafiaVotes;
  if (Object.keys(mafiaVotes).length > 0) {
    const counts = {};
    Object.values(mafiaVotes).forEach(tid => { counts[tid] = (counts[tid] || 0) + 1; });
    let bestId = null, bestCount = 0;
    for (const [tid, c] of Object.entries(counts)) {
      if (c > bestCount) { bestCount = c; bestId = parseInt(tid, 10); }
    }
    mafiaTarget = getPlayer(game, bestId);
  }

  const doctorTarget = game.nightActions.doctorTargetId ? getPlayer(game, game.nightActions.doctorTargetId) : null;
  const hamkhaabPl = alive.find(p => p.roleKey === 'hamkhaab_pofy');
  const hamTarget = game.nightActions.hamkhaabTargetId ? getPlayer(game, game.nightActions.hamkhaabTargetId) : null;
  const tirpofiPl = alive.find(p => p.roleKey === 'khar_goosh_tirpofi');
  const tirTarget = game.nightActions.tirpofiTargetId ? getPlayer(game, game.nightActions.tirpofiTargetId) : null;

  const pofAbri = alive.find(p => p.roleKey === 'pof_abri');

  const toDie = new Set();
  const savedIds = new Set();

  // لیوای – قضاوت صبح (Mark از شب قبل)
  const levi = alive.find(p => p.roleKey === 'levi_ackerman');
  if (levi && levi.leviMark) {
    const target = getPlayer(game, levi.leviMark);
    if (target && !target.dead) {
      const roleT = getRoleByKey(target.roleKey);
      if (levi.leviReady && roleT.team === 'mafia') {
        report +=
`⚔️ گزارش ویژهٔ پافی‌لند

لیوای اکرمن دیشب فردی را زیر نظر داشت…
صبح امروز، پس از بررسی دقیق، حقیقت روشن شد:

🎯 فرد Mark‌شده عضو تیم مافیا بود.

به‌دلیل افشای هویت واقعی، او از بازی حذف شد.\n\n`;
        // زره‌پوش سپر دارد
        if (target.roleKey === 'zareh_poosh' && !target.shieldUsed) {
          target.shieldUsed = true;
          report += `🛡️ زره‌پوش سپرش را فعال کرد و یک‌بار از حذف نجات یافت.\n\n`;
        } else {
          toDie.add(target.id);
        }
      } else {
        report +=
`🌤 گزارش صبح پافی‌لند

لیوای اکرمن دیشب فردی را زیر نظر داشت…
اما هیچ نشانه‌ای از فعالیت مافیایی یافت نشد.\n\n`;
      }
    }
  }

  // همخواب
  if (hamkhaabPl && !hamkhaabPl.dead && hamTarget && !hamTarget.dead) {
    const hamRole = getRoleByKey(hamTarget.roleKey);
    if (hamRole && hamRole.team === 'mafia') {
      toDie.add(hamkhaabPl.id);
      report += `💞 پُفی‌همخواب امشب کنار مافیا خوابید و از ترس جان داد.\n\n`;
    } else {
      if (mafiaTarget && (mafiaTarget.id === hamTarget.id || mafiaTarget.id === hamkhaabPl.id)) {
        toDie.add(hamkhaabPl.id);
        toDie.add(hamTarget.id);
        report += `💞 مافیا به تخت خواب پُفی‌همخواب حمله کردند؛ هر دو کشته شدند.\n\n`;
        mafiaTarget = null;
      } else {
        report += `💞 پُفی‌همخواب امشب کنار ${hamTarget.emoji} ${hamTarget.name} خوابید و شب آرام گذشت.\n\n`;
      }
    }
  }

  // پزشک
  if (doctorTarget && mafiaTarget && doctorTarget.id === mafiaTarget.id) {
    savedIds.add(doctorTarget.id);
    report += `🍬 پشمک‌پلاس ${doctorTarget.emoji} ${doctorTarget.name} را از مرگ نجات داد.\n\n`;
    mafiaTarget = null;
  }

  // پُف‌اَبری – سپر
  if (pofAbri && !pofAbri.dead && mafiaTarget && mafiaTarget.id === pofAbri.id && !pofAbri.shieldUsed) {
    pofAbri.shieldUsed = true;
    savedIds.add(pofAbri.id);
    report += `☁️ پُف‌اَبری مورد حمله قرار گرفت ولی به‌دلیل حالت ابری‌اش زنده ماند.\n\n`;
    mafiaTarget = null;
  }

  // خرگوش‌تیرپُفی
  if (tirpofiPl && !tirpofiPl.dead && tirTarget && !tirTarget.dead) {
    const roleT = getRoleByKey(tirpofiPl.roleKey);
    const roleTarget = getRoleByKey(tirTarget.roleKey);
    if (roleTarget && roleTarget.team === 'mafia') {
      // زره‌پوش سپر دارد
      if (tirTarget.roleKey === 'zareh_poosh' && !tirTarget.shieldUsed) {
        tirTarget.shieldUsed = true;
        report += `🛡️ تیر پُفی به زره‌پوش خورد ولی زره نجاتش داد.\n\n`;
      } else {
        toDie.add(tirTarget.id);
        report += `🐰💥 تیر پُفی خرگوش به ${tirTarget.emoji} ${tirTarget.name} خورد و او از بازی حذف شد!\n\n`;
      }
    } else {
      report += `🐰💥 تیر پُفی به ${tirTarget.emoji} ${tirTarget.name} خورد ولی فقط گیجش کرد.\n\n`;
    }
  }

  // حملهٔ مافیا
  if (mafiaTarget && !mafiaTarget.dead && !savedIds.has(mafiaTarget.id)) {
    // زره‌پوش سپر دارد
    if (mafiaTarget.roleKey === 'zareh_poosh' && !mafiaTarget.shieldUsed) {
      mafiaTarget.shieldUsed = true;
      report += `🛡️ مافیا به زره‌پوش حمله کردند اما زره او را نجات داد.\n\n`;
    } else {
      toDie.add(mafiaTarget.id);
      report += `🔴 مافیا امشب ${mafiaTarget.emoji} ${mafiaTarget.name} را حذف کردند.\n\n`;
    }
  }

  if (toDie.size === 0) {
    report += 'امشب کسی حذف نشد.\n';
  } else {
    for (const id of toDie) {
      const pl = getPlayer(game, id);
      if (pl && !pl.dead) pl.dead = true;
    }
  }

  await bot.sendMessage(chatId, report);

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
    'بازمانده‌ها بیدار شدند…\n\n' +
    '👥 وضعیت فعلی:\n\n' +
    formatPlayersList(game, true) +
    '\nرأی‌گیری روز به‌صورت اینلاین شروع می‌شود.'
  );

  await startDayVoting();
}

// ================= رأی‌گیری روز + دادگاه =================

async function startDayVoting() {
  const alive = game.players.filter(p => !p.dead);
  const keyboard = alive.map(t => [{ text: `${t.emoji} ${t.name}`, callback_data: `vote:${t.id}` }]);

  game.votes = {};

  bot.sendMessage(
    game.chatId,
    `🗳 رأی‌گیری روز شروع شد!\n⏳ زمان: ${DAY_VOTE_SECONDS} ثانیه`,
    { reply_markup: { inline_keyboard: keyboard } }
  );

  setTimeout(resolveDayVoting, DAY_VOTE_SECONDS * 1000);
}

async function resolveDayVoting() {
  const votes = game.votes;
  if (!votes || Object.keys(votes).length === 0) {
    bot.sendMessage(game.chatId, 'هیچ رأیی ثبت نشد.');
    return startCourtSkip();
  }

  const counts = {};
  for (const v of Object.values(votes)) counts[v] = (counts[v] || 0) + 1;

  let top = null, max = 0;
  for (const [id, c] of Object.entries(counts)) {
    if (c > max) { max = c; top = parseInt(id); }
  }

  game.courtTargetId = top;
  const target = getPlayer(game, top);

  bot.sendMessage(
    game.chatId,
    `⚖️ ${target.emoji} ${target.name} با بیشترین رأی به دادگاه احضار شد!`
  );

  startCourt();
}

function startCourtSkip() {
  bot.sendMessage(game.chatId, 'دادگاهی برگزار نشد؛ روز بدون نتیجه پایان یافت.');
  // می‌تونی اگر خواستی دوباره شب را شروع کنی:
  game.night += 1;
  nightPhase();
}

async function startCourt() {
  const target = getPlayer(game, game.courtTargetId);
  bot.sendMessage(
    game.chatId,
    `⚖️ ${target.emoji} ${target.name} در دادگاه است.\n⏳ دفاع: ${COURT_DEFENSE_SECONDS} ثانیه`
  );
  setTimeout(startCourtVoting, COURT_DEFENSE_SECONDS * 1000);
}

async function startCourtVoting() {
  const keyboard = [
    [{ text: '❌ گناهکار', callback_data: 'court:guilty' }],
    [{ text: '✅ بی‌گناه', callback_data: 'court:innocent' }]
  ];
  game.courtVotes = {};
  bot.sendMessage(
    game.chatId,
    `🗳 رأی‌گیری دادگاه شروع شد!\n⏳ زمان: ${COURT_REVOTE_SECONDS} ثانیه`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
  setTimeout(resolveCourtVoting, COURT_REVOTE_SECONDS * 1000);
}

async function resolveCourtVoting() {
  const votes = game.courtVotes;
  const guilty = Object.values(votes).filter(v => v === 'guilty').length;
  const innocent = Object.values(votes).filter(v => v === 'innocent').length;

  const target = getPlayer(game, game.courtTargetId);

  if (guilty > innocent) {
    target.dead = true;
    bot.sendMessage(game.chatId, `⚰️ ${target.emoji} ${target.name} با رأی دادگاه اعدام شد.`);
  } else {
    bot.sendMessage(game.chatId, `🌸 ${target.emoji} ${target.name} بی‌گناه شناخته شد و آزاد شد.`);
  }

  const winner = checkWinner(game);
  if (winner) return endGameWithWinner(winner);

  // پایان روز → شب بعد
  game.night += 1;
  bot.sendMessage(game.chatId, `🌙 شب ${game.night} آغاز شد.`);
  nightPhase();
}

// ================= پایان بازی =================

async function endGameWithWinner(winnerTeam) {
  if (!game) return;
  const chatId = game.chatId;

  let text = '🏁 بازی به پایان رسید!\n\n';
  if (winnerTeam === 'town') text += '🎉 شهر پُفی برنده شد!\n\n';
  else if (winnerTeam === 'mafia') text += '🩸 مافیا بر شهر مسلط شد!\n\n';
  else if (winnerTeam === 'independent') text += '☁️ پُف‌اَبری مستقل برنده شد!\n\n';

  text += '👥 وضعیت نهایی:\n\n' + formatPlayersList(game, true);
  await bot.sendMessage(chatId, text);

  resetAll();
}

// ================= کال‌بک‌ها =================

bot.on('callback_query', async (query) => {
  if (!game) return;
  const data = query.data;
  const fromId = query.from.id;
  const player = getPlayer(game, fromId);
  if (!player) return bot.answerCallbackQuery(query.id, { text: 'شما خارج از بازی هستید.', show_alert: true });
  const targetId = data.includes(':') ? parseInt(data.split(':')[1], 10) : null;
  const target = targetId ? getPlayer(game, targetId) : null;

  // افشای موش‌افشاگر
  if (data === 'reveal_mouse') {
    if (player.roleKey !== 'moosh_afshagar' || player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'این دکمه فقط برای موش‌افشاگر زنده است.', show_alert: true });
    }
    bot.sendMessage(game.chatId, `📢 افشاگری:\n${player.emoji} ${player.name} نقش خود را «موش‌افشاگر 🧀» اعلام کرد!`);
    return bot.answerCallbackQuery(query.id, { text: 'نقش تو افشا شد.' });
  }

  // NIGHT: مافیا
  if (data.startsWith('night_mafia:')) {
    if (getRoleByKey(player.roleKey)?.team !== 'mafia' || player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای مافیاست.', show_alert: true });
    }
    if (!target || target.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'هدف معتبر نیست.', show_alert: true });
    }
    game.nightActions.mafiaVotes[fromId] = targetId;
    bot.answerCallbackQuery(query.id, { text: `هدف شما: ${target.name}` });
    if (allNightActionsReady()) await resolveNight();
    return;
  }

  // NIGHT: پزشک
  if (data.startsWith('night_doc:')) {
    if (player.roleKey !== 'pashmak_plus' || player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای پشمک‌پلاس است.', show_alert: true });
    }
    if (!target || target.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'هدف معتبر نیست.', show_alert: true });
    }
    game.nightActions.doctorTargetId = targetId;
    bot.answerCallbackQuery(query.id, { text: `امشب ${target.name} را نجات می‌دهی.` });
    if (allNightActionsReady()) await resolveNight();
    return;
  }

  // NIGHT: همخواب
  if (data.startsWith('night_ham:')) {
    if (player.roleKey !== 'hamkhaab_pofy' || player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای پُفی‌همخواب است.', show_alert: true });
    }
    if (!target || target.dead || targetId === fromId) {
      return bot.answerCallbackQuery(query.id, { text: 'هدف معتبر نیست.', show_alert: true });
    }
    game.nightActions.hamkhaabTargetId = targetId;
    bot.answerCallbackQuery(query.id, { text: `امشب کنار ${target.name} می‌خوابی.` });
    if (allNightActionsReady()) await resolveNight();
    return;
  }

  // NIGHT: تیرپُفی
  if (data.startsWith('night_tir:')) {
    if (player.roleKey !== 'khar_goosh_tirpofi' || player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای خرگوش‌تیرپُفی است.', show_alert: true });
    }
    if (!target || target.dead || targetId === fromId) {
      return bot.answerCallbackQuery(query.id, { text: 'هدف معتبر نیست.', show_alert: true });
    }
    game.nightActions.tirpofiTargetId = targetId;
    bot.answerCallbackQuery(query.id, { text: `امشب ${target.name} را هدف گرفتی.` });
    if (allNightActionsReady()) await resolveNight();
    return;
  }

  // NIGHT: لیوای Mark
  if (data.startsWith('levi_mark:')) {
    if (player.roleKey !== 'levi_ackerman' || player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای لیوای است.', show_alert: true });
    }
    if (!target || target.dead || targetId === fromId) {
      return bot.answerCallbackQuery(query.id, { text: 'هدف معتبر نیست.', show_alert: true });
    }
    player.leviMark = targetId;
    const roleT = getRoleByKey(target.roleKey);
    player.leviReady = roleT && roleT.team === 'mafia';
    bot.answerCallbackQuery(query.id, { text: `Mark ثبت شد: ${target.name}` });
    if (allNightActionsReady()) await resolveNight();
    return;
  }

  // DAY: رأی‌گیری روز
  if (data.startsWith('vote:')) {
    if (player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'مرده‌ها رأی نمی‌دهند.', show_alert: true });
    }
    if (!target || target.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'هدف معتبر نیست.', show_alert: true });
    }
    game.votes[fromId] = targetId;
    bot.sendMessage(game.chatId, `🗳 ${player.emoji} ${player.name} به ${target.emoji} ${target.name} رأی داد.`);
    return bot.answerCallbackQuery(query.id, { text: `رأی شما ثبت شد: ${target.name}` });
  }

  // COURT: رأی‌گیری دادگاه
  if (data.startsWith('court:')) {
    const choice = data.split(':')[1]; // guilty/innocent
    if (player.dead) {
      return bot.answerCallbackQuery(query.id, { text: 'مرده‌ها رأی نمی‌دهند.', show_alert: true });
    }
    game.courtVotes[fromId] = choice;
    const t = getPlayer(game, game.courtTargetId);
    bot.sendMessage(
      game.chatId,
      `⚖️ ${player.emoji} ${player.name} رأی داد: ${choice === 'guilty' ? '❌ گناهکار' : '✅ بی‌گناه'} برای ${t.emoji} ${t.name}`
    );
    return bot.answerCallbackQuery(query.id, { text: 'رأی شما ثبت شد.' });
  }

  bot.answerCallbackQuery(query.id);
});

// ================= ban مخفی =================
//
// دستور: /shadowban <ساعت> <نام‌نمایشی از تلگرام>ست اکشن‌ها
  game.nightActions = {
    mafiaVotes: {},
    doctorTargetId: null,
    hamkhaabTargetId: null,
    tirpofiTargetId: null
  };

  const alive = game.players.filter(p => !p.dead);

  // پنل مافیا – داخل گروه
  const mafiaAlive = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'mafia');
  const mafiaTargets = alive.filter(p => getRoleByKey(p.roleKey)?.team !== 'mafia');

  if (mafiaAlive.length > 0 && mafiaTargets.length > 0) {
    const keyboard = [];
    for (let i = 0; i < mafiaTargets.length; i += 3) {
      const row = [];
      for (let j = i; j < i + 3 && j < mafiaTargets.length; j++) {
        const t = mafiaTargets[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_mafia:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      chatId,
      '🔴 مافیا، هدف خود را انتخاب کنید (فقط مافیا می‌تواند رأی بزند).',
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }

  // پزشک – PV
  const doctor = alive.find(p => p.roleKey === 'pashmak_plus');
  if (doctor) {
    const keyboard = [];
    for (let i = 0; i < alive.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < alive.length; j++) {
        const t = alive[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_doc:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      doctor.id,
      '🍬 امشب چه کسی را نجات می‌دهی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  // همخواب – PV
  const hamkhaab = alive.find(p => p.roleKey === 'hamkhaab_pofy');
  if (hamkhaab) {
    const targets = alive.filter(p => p.id !== hamkhaab.id);
    const keyboard = [];
    for (let i = 0; i < targets.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < targets.length; j++) {
        const t = targets[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_ham:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      hamkhaab.id,
      '💞 امشب کنار چه کسی می‌خوابی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  // خرگوش‌تیرپُفی – PV + اطلاع گروه
  const tirpofi = alive.find(p => p.roleKey === 'khar_goosh_tirpofi');
  if (tirpofi) {
    bot.sendMessage(chatId, '🐰💥 خرگوش‌تیرپُفی امشب تیر پُفی را شارژ کرد…');
    const targets = alive.filter(p => p.id !== tirpofi.id);
    const keyboard = [];
    for (let i = 0; i < targets.length; i += 2) {
      const row = [];
      for (let j = i; j < i + 2 && j < targets.length; j++) {
        const t = targets[j];
        row.push({ text: `${t.emoji} ${t.name}`, callback_data: `night_tir:${t.id}` });
      }
      keyboard.push(row);
    }
    bot.sendMessage(
      tirpofi.id,
      '💥 امشب چه کسی را هدف می‌گیری؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
// ================= وب فیک برای Render =================
const http = require('http');
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Puffy Mafia bot is running.\n');
}).listen(PORT, () => {
  console.log(`Fake HTTP server running on port ${PORT}`);
});

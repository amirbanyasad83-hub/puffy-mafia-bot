// mafia_bot.js
// ربات مافیای پافی‌لند – نسخه کیوت، ۶ نفره، با نقش‌های خاص

'use strict';

const TelegramBot = require('node-telegram-bot-api');

// ================= تنظیمات =================

// توکن ربات از Environment Variable
const TOKEN = process.env.TOKEN;

// اگر توکن تنظیم نشده باشد، ربات را متوقف می‌کنیم
if (!TOKEN) {
  throw new Error('EFATAL: Telegram Bot Token not provided! متغیر محیطی TOKEN را در Render تنظیم کن.');
}

// کانال برای جوین اجباری (بدون @) – اگر نمی‌خوای، در Render خالی بذار
const FORCE_CHANNEL = process.env.FORCE_CHANNEL || 'Puffy_Landmafia';

// محدودیت‌ها
const MIN_PLAYERS = 6;
const MAX_PLAYERS = 6; // این نسخه فقط برای ۶ نفر تنظیم شده

// زمان‌ها فقط در متن نمایش داده می‌شوند (واقعی قطع نمی‌کنند)
const DAY_VOTE_SECONDS = 45;
const COURT_DEFENSE_SECONDS = 15;
const COURT_REVOTE_SECONDS = 15;

// ================= راه‌اندازی ربات =================

const bot = new TelegramBot(TOKEN, { polling: true });

// ================= وضعیت بازی =================

let lobbyPlayers = []; // بازیکنان ثبت‌نام‌شده
let game = null;       // وضعیت بازی در حال اجرا

// game = {
//   chatId,
//   phase: 'lobby' | 'night' | 'day' | 'court' | 'end',
//   day: 0,
//   night: 0,
//   players: [ { id, name, username, emoji, roleKey, dead, shieldUsed } ],
//   votes: {},            // day: userId -> targetId
//   courtTargetId: null,  // بازیکن احضار شده
//   courtVotes: {},       // userId -> 'guilty' | 'innocent'
//   nightActions: {
//     mafiaVotes: { userId: targetId },
//     doctorTargetId: null,
//     hamkhaabTargetId: null,
//     tirpofiTargetId: null
//   }
// }

// ================= نقش‌ها =================

const ROLES = [
  {
    key: 'moosh_afshagar',
    name: 'موش‌افشاگر 🧀',
    team: 'town',
    desc: 'در ابتدای بازی می‌تواند نقش خود را به‌صورت رسمی افشا کند تا شهر با او هماهنگ شود.'
  },
  {
    key: 'hamkhaab_pofy',
    name: 'پُفی‌همخواب 💞',
    team: 'town',
    desc: 'هر شب کنار یک نفر می‌خوابد؛ اگر مافیا همان شب حمله کند، هر دو می‌میرند. اگر طرفش مافیا باشد، خودش درجا می‌میرد.'
  },
  {
    key: 'khar_goosh_tirpofi',
    name: 'خرگوش‌تیرپُفی 🐰💥',
    team: 'town',
    desc: 'هر شب تیر پُفی شارژ می‌کند و یک نفر را هدف می‌گیرد؛ اگر مافیا باشد، کشته می‌شود؛ اگر شهر باشد فقط گیج می‌شود.'
  },
  {
    key: 'pashmak_plus',
    name: 'پشمک‌پلاس 🍬',
    team: 'town',
    desc: 'پزشک؛ هر شب یک نفر را از مرگ نجات می‌دهد.'
  },
  {
    key: 'nish_poof',
    name: 'نیش‌پوف 🐝',
    team: 'mafia',
    desc: 'قاتل مافیا؛ در عملیات حذف شبانه شرکت می‌کند.'
  },
  {
    key: 'moosh_saye',
    name: 'موش‌سایه 🐾',
    team: 'mafia',
    desc: 'مافیا سایلنسر؛ در تصمیم حمله شبانه مشارکت می‌کند.'
  },
  {
    key: 'pof_abri',
    name: 'پُف‌اَبری ☁️',
    team: 'independent',
    desc: 'مستقل مصون؛ اولین حمله شبانه روی او بی‌اثر است. اگر زنده بماند و شهر و مافیا هر دو از بین بروند، به‌تنهایی برنده می‌شود.'
  }
];

const PLAYER_EMOJIS = ['🦄', '🐲', '🐉', '🐺', '🦊', '🐯', '🐵', '🐼', '🐰', '🐱', '🐻', '🐹'];

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
  if (!gameObj || !gameObj.players || gameObj.players.length === 0) {
    return 'هنوز بازیکنی در بازی ثبت نشده.';
  }

  let text = '';
  gameObj.players.forEach((p, idx) => {
    const num = idx + 1;
    const role = getRoleByKey(p.roleKey);
    let line = `${num}. ${p.emoji} ${p.name}`;

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
  const town = alive.filter(p => getRoleByKey(p.roleKey)?.team === 'town').length;
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

// ================= جوین اجباری =================

async function checkForceJoin(chatId, userId) {
  if (!FORCE_CHANNEL) return true;
  try {
    const m = await bot.getChatMember(`@${FORCE_CHANNEL}`, userId);
    if (m.status === 'left' || m.status === 'kicked') {
      await bot.sendMessage(
        chatId,
        '⚠️ برای شرکت در بازی، ابتدا باید عضو کانال شوید:\n' + `https://t.me/${FORCE_CHANNEL}`
      );
      return false;
    }
    return true;
  } catch (e) {
    await bot.sendMessage(
      chatId,
      '⚠️ خطا در بررسی عضویت کانال. بعداً دوباره تلاش کنید.'
    );
    return false;
  }
}

// ================= شروع بازی =================

async function startGame(chatId) {
  const count = lobbyPlayers.length;
  if (count !== 6) {
    await bot.sendMessage(
      chatId,
      '⚠️ در این نسخه، فقط بازی ۶ نفره پشتیبانی می‌شود.\n' +
      'لطفاً دقیقاً ۶ نفر وارد لابی کنید.'
    );
    return;
  }

  const shuffledPlayers = shuffle(lobbyPlayers);
  const shuffledEmojis = shuffle(PLAYER_EMOJIS).slice(0, count);

  // نقش‌ها برای ۶ نفر:
  // ۲ مافیا ثابت: نیش‌پوف + موش‌سایه
  // ۳ شهروند ثابت: موش‌افشاگر + پُفی‌همخواب + خرگوش‌تیرپُفی
  // ۱ جای خالی: ۵۰٪ مستقل پُف‌اَبری، ۵۰٪ پشمک‌پلاس (پزشک)
  const baseRoles = [
    'nish_poof',
    'moosh_saye',
    'moosh_afshagar',
    'hamkhaab_pofy',
    'khar_goosh_tirpofi'
  ];

  const lastRole = Math.random() < 0.5 ? 'pof_abri' : 'pashmak_plus';
  baseRoles.push(lastRole);

  const shuffledRoles = shuffle(baseRoles);

  game = {
    chatId,
    phase: 'night',
    day: 0,
    night: 0,
    players: [],
    votes: {},
    courtTargetId: null,
    courtVotes: {},
    nightActions: {
      mafiaVotes: {},
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
      emoji: shuffledEmojis[i],
      roleKey: shuffledRoles[i],
      dead: false,
      shieldUsed: false
    });
  });

  // پیام بزرگ شروع بازی
  let intro =
    '🎭 بازی آنلاین مافیای پافی‌لند شروع شد!\n\n' +
    '🌞 #روز اول\n' +
    'بازیکنان وارد شهر پُفی شدند؛ هیچ‌کس هنوز چیزی نمی‌داند...\n\n' +
    'نقش شما در پیام خصوصی ارسال می‌شود. حتماً PV ربات را چک کنید.\n\n' +
    '👥 لیست بازیکنان:\n\n' +
    formatPlayersList(game, false);

  await bot.sendMessage(chatId, intro, { parse_mode: 'Markdown' });

  // ارسال نقش‌ها به پی‌وی
  for (const p of game.players) {
    const role = getRoleByKey(p.roleKey);
    if (!role) continue;

    let goalText =
      role.team === 'mafia'
        ? 'کاهش تعداد شهروندها تا جایی که مافیا بر شهر تسلط پیدا کند.'
        : role.team === 'town'
        ? 'شناسایی مافیا و نجات شهر پُفی.'
        : 'زنده ماندن تا پایان بازی و برد مستقل!';

    const roleText =
      `🎭 نقش شما در پافی‌لند:\n` +
      `${role.name}\n\n` +
      `📜 توضیح نقش:\n${role.desc}\n\n` +
      `🎯 هدف شما:\n${goalText}`;

    await bot.sendMessage(p.id, roleText).catch(() => {});
  }

  // پیام رسمی برای موش‌افشاگر (افشاگری)
  const mouse = game.players.find(pl => pl.roleKey === 'moosh_afshagar' && !pl.dead);
  if (mouse) {
    await bot.sendMessage(
      chatId,
      '📢 توجه بازیکنان شهر پافی‌لند\n\n' +
      '🧀 موش‌افشاگر در میان شما حضور دارد.\n' +
      'او می‌تواند نقش خود را افشا کند تا شهر با او هماهنگ شود.'
    );

    await bot.sendMessage(
      mouse.id,
      '🔍 اگر می‌خواهی نقش خود را در گروه افشا کنی، روی دکمه زیر بزن:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 افشای نقش من در گروه', callback_data: 'reveal_mouse' }]
          ]
        }
      }
    );
  }

  lobbyPlayers = []; // لابی خالی می‌شود چون بازی شروع شده

  // شروع شب اول
  game.night = 1;
  await bot.sendMessage(
    chatId,
    '🌙 #شب اول\n' +
    'شهر پُفی در سکوت فرو می‌رود...\n' +
    'نقش‌ها آمادهٔ حرکت‌اند. پنل‌های شبانه برای شما ارسال می‌شود.'
  );
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
        row.push({
          text: `${t.emoji}`,
          callback_data: `night_mafia:${t.id}`
        });
      }
      keyboard.push(row);
    }

    await bot.sendMessage(
      chatId,
      '🔴 مافیا، هدف خود را انتخاب کنید.\n' +
      'با زدن روی ایموجی هر بازیکن، رأی شما ثبت می‌شود.',
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }

  // پنل پزشک – PV
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
      '🍬 پشمک‌پلاس عزیز!\nامشب می‌خواهی چه کسی را نجات بدهی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  // پنل همخواب – PV
  const hamkhaab = alive.find(p => p.roleKey === 'hamkhaab_pofy');
  if (hamkhaab) {
    const keyboard = [];
    const targets = alive.filter(p => p.id !== hamkhaab.id);
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
      '💞 پُفی‌همخواب!\nامشب می‌خواهی کنار چه کسی بخوابی؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }

  // پنل خرگوش‌تیرپُفی – PV + پیام داخل گروه
  const tirpofi = alive.find(p => p.roleKey === 'khar_goosh_tirpofi');
  if (tirpofi) {
    await bot.sendMessage(
      chatId,
      '🐰💥 خرگوش‌تیرپُفی امشب تیر پُفی رو شارژ کرد...'
    );

    const keyboard = [];
    const targets = alive.filter(p => p.id !== tirpofi.id);
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
      '🐰💥 خرگوش‌تیرپُفی!\nتیر پُفی شارژ شد؛ امشب چه کسی را هدف می‌گیری؟',
      { reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {});
  }
}

// چک‌کردن اینکه آیا همهٔ اکشن‌های لازم برای شب ثبت شده یا نه
function allNightActionsReady() {
  if (!game) return false;
  const alive = game.players.filter(p => !p.dead);
  const hasMafia = alive.some(p => getRoleByKey(p.roleKey)?.team === 'mafia');
  const hasDoctor = alive.some(p => p.roleKey === 'pashmak_plus');
  const hasHam = alive.some(p => p.roleKey === 'hamkhaab_pofy');
  const hasTir = alive.some(p => p.roleKey === 'khar_goosh_tirpofi');

  // مافیا حداقل یک رأی داشته باشد (اگر مافیا زنده است)
  if (hasMafia && Object.keys(game.nightActions.mafiaVotes).length === 0) return false;
  if (hasDoctor && game.nightActions.doctorTargetId === null) return false;
  if (hasHam && game.nightActions.hamkhaabTargetId === null) return false;
  if (hasTir && game.nightActions.tirpofiTargetId === null) return false;

  return true;
}

// جمع‌بندی شب
async function resolveNight() {
  if (!game) return;
  const chatId = game.chatId;
  const alive = game.players.filter(p => !p.dead);

  let report = `🌙 گزارش شب ${game.night} پافی‌لند\n\n`;

  // ۱) هدف مافیا
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

  // وضعیت مرگ/نجات
  const toDie = new Set();
  const savedIds = new Set();

  // ۲) منطق همخواب
  if (hamkhaabPl && !hamkhaabPl.dead && hamTarget && !hamTarget.dead) {
    const hamRoleOfTarget = getRoleByKey(hamTarget.roleKey);
    if (hamRoleOfTarget && hamRoleOfTarget.team === 'mafia') {
      // کنار مافیا خوابیده → همخواب درجا می‌میرد
      toDie.add(hamkhaabPl.id);
      report += `💞 پُفی‌همخواب امشب انتخاب اشتباهی کرد و کنار مافیا خوابید...\n`;
      report += `${hamkhaabPl.emoji} ${hamkhaabPl.name} از ترس قلبش وایستاد.\n\n`;
    } else {
      // اگر مافیا همان هدف را بزند یا خود همخواب را بزند → هر دو می‌میرند
      if (mafiaTarget && (mafiaTarget.id === hamTarget.id || mafiaTarget.id === hamkhaabPl.id)) {
        toDie.add(hamkhaabPl.id);
        toDie.add(hamTarget.id);
        report += `💞 مافیا به تخت خواب پُفی‌همخواب حمله کردند!\n`;
        report += `${hamkhaabPl.emoji} ${hamkhaabPl.name} و ${hamTarget.emoji} ${hamTarget.name} هر دو کشته شدند.\n\n`;
        mafiaTarget = null;
      } else {
        report += `💞 پُفی‌همخواب امشب کنار ${hamTarget.emoji} ${hamTarget.name} خوابید و شب بدون حادثه‌ای گذشت...\n\n`;
      }
    }
  }

  // ۳) منطق پزشک
  if (doctorTarget && mafiaTarget && doctorTarget.id === mafiaTarget.id) {
    savedIds.add(doctorTarget.id);
    report += `🍬 پشمک‌پلاس با یک درمان قندی، ${doctorTarget.emoji} ${doctorTarget.name} را از مرگ نجات داد.\n\n`;
    mafiaTarget = null; // حمله برای این هدف بی‌اثر شد
  }

  // ۴) منطق پُف‌اَبری (مصونیت شب اول از یک حمله)
  if (pofAbri && !pofAbri.dead && mafiaTarget && mafiaTarget.id === pofAbri.id && !pofAbri.shieldUsed) {
    pofAbri.shieldUsed = true;
    savedIds.add(pofAbri.id);
    report += `☁️ پُف‌اَبری امشب مورد حمله قرار گرفت اما به‌خاطر حالت ابری‌اش آسیبی ندید!\n\n`;
    mafiaTarget = null;
  }

  // ۵) منطق تیرپُفی
  if (tirpofiPl && !tirpofiPl.dead && tirTarget && !tirTarget.dead) {
    const roleOfTarget = getRoleByKey(tirTarget.roleKey);
    if (roleOfTarget && roleOfTarget.team === 'mafia') {
      toDie.add(tirTarget.id);
      report += `🐰💥 تیر پُفی خرگوش به هدف مافیایی خورد و ${tirTarget.emoji} ${tirTarget.name} کشته شد!\n\n`;
    } else if (!roleOfTarget || roleOfTarget.team === 'town' || roleOfTarget.team === 'independent') {
      report += `🐰💥 تیر پُفی خرگوش به ${tirTarget.emoji} ${tirTarget.name} خورد ولی فقط گیجش کرد!\n\n`;
    }
  }

  // ۶) اعمال حملهٔ مافیا اگر هنوز هدفی مانده
  if (mafiaTarget && !mafiaTarget.dead && !savedIds.has(mafiaTarget.id)) {
    toDie.add(mafiaTarget.id);
    report += `🔴 مافیا امشب ${mafiaTarget.emoji} ${mafiaTarget.name} را هدف قرار داد و او کشته شد.\n\n`;
  }

  // اعمال مرگ‌ها
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

  // چک برنده بعد از شب
  const winner = checkWinner(game);
  if (winner) {
    await endGameWithWinner(winner);
    return;
  }

  // شروع روز
  game.phase = 'day';
  game.day += 1;
  game.votes = {};

  let dayText =
    `🌞 #روز ${game.day} پافی‌لند\n\n` +
    'بازمانده‌ها بیدار شدند و سر میز گرد پُفی جمع شدند...\n\n' +
    '👥 وضعیت فعلی بازیکنان:\n\n' +
    formatPlayersList(game, true) +
    `\n⏳ زمان رای‌گیری (نمایشی): ${DAY_VOTE_SECONDS} ثانیه\n` +
    'با استفاده از /vote@BotUsername روی یک نفر رأی دهید. (در این نسخه، رای‌گیری باید دستی مدیریت شود.)';

  await bot.sendMessage(chatId, dayText, { parse_mode: 'Markdown' });
}

// پایان بازی با اعلام برنده
async function endGameWithWinner(winnerTeam) {
  if (!game) return;
  const chatId = game.chatId;

  let text = '🏁 بازی به پایان رسید!\n\n';
  if (winnerTeam === 'town') {
    text += '🎉 شهر پُفی برنده شد!\n\n';
  } else if (winnerTeam === 'mafia') {
    text += '🩸 مافیا بر شهر پُفی مسلط شد!\n\n';
  } else if (winnerTeam === 'independent') {
    text += '☁️ پُف‌اَبری به‌تنهایی برنده شد و روی شهر سایه انداخت!\n\n';
  }

  text += '👥 وضعیت نهایی بازیکنان (با نقش‌ها):\n\n';
  text += formatPlayersList(game, true);

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  resetAll();
}

// ================= هندلینگ دستورات ساده =================

// /start برای پی‌وی و گروه
bot.onText(/\/start(?:@[\w_]+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type.endsWith('group');

  if (!isGroup) {
    await bot.sendMessage(
      chatId,
      'سلام! من ربات مافیای پافی‌لند هستم.\n\n' +
      'برای بازی، من را داخل یک گروه اضافه کنید و از دستور /newgame استفاده کنید.'
    );
  } else {
    await bot.sendMessage(
      chatId,
      '🎭 مافیای پافی‌لند اینجاست!\n\n' +
      'برای ساخت لابی جدید، از دستور /newgame استفاده کنید.'
    );
  }
});

// ساخت لابی جدید
bot.onText(/\/newgame(?:@[\w_]+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type.endsWith('group');
  if (!isGroup) {
    await bot.sendMessage(chatId, 'این دستور فقط داخل گروه قابل استفاده است.');
    return;
  }

  if (game) {
    await bot.sendMessage(chatId, 'یک بازی در حال اجراست. تا پایان آن صبر کنید یا منتظر نسخهٔ پیشرفته با مدیریت چندبازی باشید.');
    return;
  }

  resetAll();
  game = null;
  lobbyPlayers = [];

  await bot.sendMessage(
    chatId,
    '🎭 لابی جدید مافیای پافی‌لند ساخته شد!\n\n' +
    `برای شرکت در بازی، از دستور /join استفاده کنید.\n` +
    `حداقل و حداکثر بازیکن در این نسخه: ${MIN_PLAYERS} نفر (دقیقاً ۶ نفر).`
  );
});

// جوین بازیکن
bot.onText(/\/join(?:@[\w_]+)?/i, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  const isGroup = msg.chat.type.endsWith('group');

  if (!isGroup) {
    await bot.sendMessage(chatId, 'این دستور فقط داخل گروه قابل استفاده است.');
    return;
  }

  if (game && game.chatId === chatId && game.phase !== 'lobby') {
    await bot.sendMessage(chatId, 'بازی شروع شده؛ نمی‌توانید وارد شوید.');
    return;
  }

  const joined = await checkForceJoin(chatId, user.id);
  if (!joined) return;

  if (lobbyPlayers.find(p => p.id === user.id)) {
    await bot.sendMessage(chatId, `${user.first_name}، قبلاً وارد لابی شده‌ای.`);
    return;
  }

  if (lobbyPlayers.length >= MAX_PLAYERS) {
    await bot.sendMessage(chatId, 'ظرفیت لابی پر شده است.');
    return;
  }

  lobbyPlayers.push({
    id: user.id,
    name: user.first_name,
    username: user.username || null
  });

  await bot.sendMessage(
    chatId,
    `${user.first_name} وارد لابی شد.\n\n` +
    `تعداد فعلی بازیکنان: ${lobbyPlayers.length}/${MAX_PLAYERS}`
  );

  if (lobbyPlayers.length === MAX_PLAYERS) {
    await bot.sendMessage(chatId, 'ظرفیت تکمیل شد! بازی در حال شروع است...');
    await startGame(chatId);
  }
});

// هندل کال‌بک‌ها برای شب
bot.on('callback_query', async (query) => {
  if (!game) return;
  const data = query.data;
  const fromId = query.from.id;

  // افشای موش‌افشاگر
  if (data === 'reveal_mouse') {
    const mouse = game.players.find(p => p.id === fromId && p.roleKey === 'moosh_afshagar' && !p.dead);
    if (!mouse) {
      await bot.answerCallbackQuery(query.id, { text: 'این دکمه برای موش‌افشاگر است.', show_alert: true });
      return;
    }
    await bot.sendMessage(
      game.chatId,
      `📢 افشاگری رسمی:\n\n${mouse.emoji} ${mouse.name} خود را به‌عنوان «موش‌افشاگر 🧀» معرفی کرد!`
    );
    await bot.answerCallbackQuery(query.id, { text: 'نقش تو در گروه افشا شد.', show_alert: true });
    return;
  }

  // اکشن‌های شب
  if (!data.includes(':')) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  const [type, rawTarget] = data.split(':');
  const targetId = parseInt(rawTarget, 10);

  const player = getPlayer(game, fromId);
  if (!player || player.dead) {
    await bot.answerCallbackQuery(query.id, { text: 'شما در بازی زنده نیستید.', show_alert: true });
    return;
  }

  if (game.phase !== 'night') {
    await bot.answerCallbackQuery(query.id, { text: 'الان فاز شب فعال نیست.', show_alert: true });
    return;
  }

  const target = getPlayer(game, targetId);
  if (!target || target.dead) {
    await bot.answerCallbackQuery(query.id, { text: 'هدف معتبر نیست.', show_alert: true });
    return;
  }

  if (type === 'night_mafia') {
    if (getRoleByKey(player.roleKey)?.team !== 'mafia') {
      await bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای مافیا است.', show_alert: true });
      return;
    }
    game.nightActions.mafiaVotes[fromId] = targetId;
    await bot.answerCallbackQuery(query.id, { text: `هدف شما ثبت شد: ${target.name}` });
  }

  if (type === 'night_doc') {
    if (player.roleKey !== 'pashmak_plus') {
      await bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای پشمک‌پلاس است.', show_alert: true });
      return;
    }
    game.nightActions.doctorTargetId = targetId;
    await bot.answerCallbackQuery(query.id, { text: `امشب از ${target.name} محافظت می‌کنی.` });
  }

  if (type === 'night_ham') {
    if (player.roleKey !== 'hamkhaab_pofy') {
      await bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای پُفی‌همخواب است.', show_alert: true });
      return;
    }
    if (targetId === fromId) {
      await bot.answerCallbackQuery(query.id, { text: 'نمی‌توانی کنار خودت بخوابی!', show_alert: true });
      return;
    }
    game.nightActions.hamkhaabTargetId = targetId;
    await bot.answerCallbackQuery(query.id, { text: `امشب کنار ${target.name} می‌خوابی.` });
  }

  if (type === 'night_tir') {
    if (player.roleKey !== 'khar_goosh_tirpofi') {
      await bot.answerCallbackQuery(query.id, { text: 'این گزینه فقط برای خرگوش‌تیرپُفی است.', show_alert: true });
      return;
    }
    if (targetId === fromId) {
      await bot.answerCallbackQuery(query.id, { text: 'نمی‌توانی خودت را هدف بگیری!', show_alert: true });
      return;
    }
    game.nightActions.tirpofiTargetId = targetId;
    await bot.answerCallbackQuery(query.id, { text: `امشب ${target.name} را هدف گرفتی.` });
  }

  // اگر همهٔ اکشن‌های شب پر شده، جمع‌بندی
  if (allNightActionsReady()) {
    await resolveNight();
  }
});

// هندل خطاهای polling
bot.on('polling_error', (err) => {
  console.error('Polling error:', err);
});

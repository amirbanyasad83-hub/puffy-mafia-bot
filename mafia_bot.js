const TelegramBot = require('node-telegram-bot-api');

// ================== تنظیمات اصلی ==================

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN تنظیم نشده است.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ================== داده‌ها در حافظه ==================

const players = new Map();      // userId → پروفایل کلی
const rooms = new Map();        // roomId → وضعیت بازی
const coupons = new Map();      // code → { amount, description, createdAt, usedBy }
const blockedUsers = new Map(); // userId → { until, reason }
const emojis = new Map();       // emoji → { price, unlocked }
let supportLink = null;
const admins = new Set();       // userId
let lastDailyRewardDate = null;

// ================== سناریوها ==================

const SCENARIOS = {
  HARD: 'HARD',
  CUTE: 'CUTE'
};

// ================== لیگ‌ها (۹ تا، هرچه بالاتر کیوت‌تر) ==================

const LEAGUES = [
  { id: 'STONE',   emoji: '🪨', name: 'لیگ سنگیِ بی‌روح',           requiredScore: 0,     requiresSupport: false },
  { id: 'RUST',    emoji: '🧱', name: 'لیگ زنگ‌زدهٔ خاموش',        requiredScore: 300,   requiresSupport: false },
  { id: 'MIST',    emoji: '🌫️', name: 'لیگ مه‌آلودِ خاکستری',      requiredScore: 1000,  requiresSupport: false },
  { id: 'LEAF',    emoji: '🍃', name: 'لیگ برگِ نرم',              requiredScore: 2500,  requiresSupport: false },
  { id: 'CLOUD',   emoji: '☁️', name: 'لیگ ابرِ پفی',              requiredScore: 5000,  requiresSupport: false },
  { id: 'BLOSSOM', emoji: '🌸', name: 'لیگ شکوفهٔ نُنُری',         requiredScore: 10000, requiresSupport: false },
  { id: 'VELVET',  emoji: '🩷', name: 'لیگ مخملیِ گوگولی',         requiredScore: 20000, requiresSupport: true  },
  { id: 'CRYSTAL', emoji: '💎', name: 'لیگ بلورِ نورانی',          requiredScore: 35000, requiresSupport: true  },
  { id: 'STAR',    emoji: '⭐️', name: 'لیگ ستارهٔ خواب‌آلود',      requiredScore: 50000, requiresSupport: true  }
];

function getLeagueById(id) {
  return LEAGUES.find(l => l.id === id) || LEAGUES[0];
}
function leagueLabel(id) {
  const l = getLeagueById(id);
  return `${l.emoji} ${l.name}`;
}

// ================== نقش‌ها ==================

const ROLES = {
  // سخت
  HARD_GODFATHER: 'HARD_GODFATHER',
  HARD_SERIAL_KILLER: 'HARD_SERIAL_KILLER',
  HARD_SEER: 'HARD_SEER',
  HARD_NECROMANCER: 'HARD_NECROMANCER',
  HARD_DARK_WIZARD: 'HARD_DARK_WIZARD',
  HARD_WEREWOLF: 'HARD_WEREWOLF',
  HARD_CITIZEN: 'HARD_CITIZEN',
  HARD_INTERROGATOR: 'HARD_INTERROGATOR', // 🧸 بازجوی نُنُری

  // کیوت
  CUTE_CAT: 'CUTE_CAT',
  CUTE_ANGEL: 'CUTE_ANGEL',
  CUTE_PUZZLER: 'CUTE_PUZZLER',
  CUTE_RAINBOW_WIZARD: 'CUTE_RAINBOW_WIZARD', // اسم، ولی رنگین‌کمون به معنی لیگ نیست
  CUTE_SLEEPY: 'CUTE_SLEEPY',
  CUTE_CITIZEN: 'CUTE_CITIZEN',

  // عمومی
  MAFIA: 'MAFIA',
  CITIZEN: 'CITIZEN',
  INDEPENDENT: 'INDEPENDENT'
};

function roleTeam(role) {
  switch (role) {
    case ROLES.HARD_GODFATHER:
    case ROLES.HARD_DARK_WIZARD:
    case ROLES.MAFIA:
      return 'MAFIA';

    case ROLES.HARD_SERIAL_KILLER:
    case ROLES.HARD_WEREWOLF:
      return 'INDEPENDENT';

    case ROLES.HARD_SEER:
    case ROLES.HARD_NECROMANCER:
    case ROLES.HARD_CITIZEN:
    case ROLES.HARD_INTERROGATOR:
    case ROLES.CUTE_CAT:
    case ROLES.CUTE_ANGEL:
    case ROLES.CUTE_PUZZLER:
    case ROLES.CUTE_RAINBOW_WIZARD:
    case ROLES.CUTE_SLEEPY:
    case ROLES.CUTE_CITIZEN:
    case ROLES.CITIZEN:
      return 'CITY';

    default:
      return 'UNKNOWN';
  }
}

function roleLabel(role) {
  switch (role) {
    case ROLES.HARD_GODFATHER:      return '😈 گادفادر (شهر خونین)';
    case ROLES.HARD_SERIAL_KILLER:  return '🩸 قاتل سریالی';
    case ROLES.HARD_SEER:           return '👁️ پیشگو';
    case ROLES.HARD_NECROMANCER:    return '🕯 احضارگر';
    case ROLES.HARD_DARK_WIZARD:    return '🧿 جادوگر تاریکی';
    case ROLES.HARD_WEREWOLF:       return '🐺 گرگ‌نما';
    case ROLES.HARD_CITIZEN:        return '🧑‍🌾 شهروند (شهر خونین)';
    case ROLES.HARD_INTERROGATOR:   return '🧸 بازجوی نُنُری';

    case ROLES.CUTE_CAT:            return '🐾 گربه‌گوگولی';
    case ROLES.CUTE_ANGEL:          return '🪽 فرشته کوچولو';
    case ROLES.CUTE_PUZZLER:        return '🧩 پازل‌ساز';
    case ROLES.CUTE_RAINBOW_WIZARD: return '🪄 جادوگر رنگی';
    case ROLES.CUTE_SLEEPY:         return '🌙 خواب‌آلود';
    case ROLES.CUTE_CITIZEN:        return '🌸 شهروند کیوت';

    case ROLES.MAFIA:               return '🔴 عضو مافیا';
    case ROLES.CITIZEN:             return '🟢 شهروند';
    case ROLES.INDEPENDENT:         return '🟡 مستقل';

    default:                        return 'نقش ناشناس';
  }
}

// نقش‌های خریدنی (ترجیح نقش)
const SPECIAL_ROLES = [
  { id: 'PREF_SEER',      role: ROLES.HARD_SEER,        name: '👁️ دیدبان سایه',   price: 300 },
  { id: 'PREF_GODFATHER', role: ROLES.HARD_GODFATHER,   name: '😈 رئیس زیرزمین',   price: 500 },
  { id: 'PREF_CAT',       role: ROLES.CUTE_CAT,         name: '🐾 گربهٔ شلوغ‌کار', price: 200 },
  { id: 'PREF_ANGEL',     role: ROLES.CUTE_ANGEL,       name: '🪽 فرشتهٔ نگهبان',  price: 250 }
];

// جادوها
const MAGIC_SPELLS = [
  { id: 'MAG_LUCK',    name: '🍀 جادوی شانس',  price: 150 },
  { id: 'MAG_SHIELD',  name: '🛡 جادوی سپر',   price: 250 },
  { id: 'MAG_SILENCE', name: '🤫 جادوی سکوت',  price: 200 }
];

// ================== کمک‌تابع‌های پروفایل ==================

function autoUpdateLeague(player) {
  let best = LEAGUES[0];
  for (const l of LEAGUES) {
    if (player.totalScore >= l.requiredScore && !l.requiresSupport) {
      if (l.requiredScore >= best.requiredScore) best = l;
    }
  }
  if (player.leagueId !== best.id) player.leagueId = best.id;
}

function ensurePlayer(user) {
  const id = user.id;
  if (!players.has(id)) {
    players.set(id, {
      id,
      username: user.username || null,
      nickname: null,
      createdAt: new Date(),
      coins: 0,
      totalScore: 0,
      dailyScore: 0,
      weeklyScore: 0,
      gamesPlayed: 0,
      wins: 0,
      leagueId: 'STONE',
      emojis: new Set(),
      preferredRoles: new Set(),
      magics: new Set()
    });
  }
  const p = players.get(id);
  autoUpdateLeague(p);
  return p;
}

function isBlocked(userId) {
  const data = blockedUsers.get(userId);
  if (!data) return false;
  if (Date.now() > data.until) {
    blockedUsers.delete(userId);
    return false;
  }
  return true;
}

function isOwner(id) {
  return OWNER_ID && id === OWNER_ID;
}
function isAdmin(id) {
  return isOwner(id) || admins.has(id);
}

function inlineMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🕹 شروع بازی آنلاین', callback_data: 'MENU:START_RANKED' },
          { text: '🧑‍🤝‍🧑 بازی دوستانه', callback_data: 'MENU:START_FRIENDLY' }
        ],
        [
          { text: '👤 پروفایل', callback_data: 'MENU:PROFILE' },
          { text: '🌟 امتیازات', callback_data: 'MENU:SCORES' }
        ],
        [
          { text: '🛒 فروشگاه نقش', callback_data: 'MENU:ROLE_STORE' },
          { text: '🔮 فروشگاه جادو', callback_data: 'MENU:MAGIC_STORE' }
        ],
        [
          { text: '📚 راهنمای بازی', callback_data: 'MENU:HELP' }
        ]
      ]
    }
  };
}

function supportHintText() {
  return supportLink
    ? `📨 برای لیگ‌های ویژه و چیزهای خاص، با پشتیبانی صحبت کن:\n${supportLink}`
    : '📨 لینک پشتیبانی هنوز ثبت نشده است.';
}

// ================== کوپن ==================

function generateCouponCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PUFFY-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

bot.onText(/\/make_coupon(?:@[\w_]+)?\s+(\d+)\s+(.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const amount = Number(match[1]);
  const description = match[2].trim();
  if (amount <= 0) return bot.sendMessage(msg.chat.id, '❌ مقدار سکه باید بیشتر از صفر باشد.');
  const code = generateCouponCode();
  coupons.set(code, { amount, description, createdAt: new Date(), usedBy: null });
  bot.sendMessage(
    msg.chat.id,
    '🎁 کوپن سکه ساخته شد:\n\n' +
    `🔑 کد: \`${code}\`\n` +
    `💰 مقدار: ${amount} سکه\n` +
    `📝 توضیح: ${description}`,
    { parse_mode: 'Markdown' }
  );
});

function tryRedeemCoupon(msg) {
  const text = msg.text.trim();
  if (!text.startsWith('PUFFY-')) return false;
  const player = ensurePlayer(msg.from);
  if (isBlocked(player.id)) {
    bot.sendMessage(msg.chat.id, '🚫 حساب شما مسدود است و نمی‌توانید کوپن استفاده کنید.');
    return true;
  }
  const coupon = coupons.get(text);
  if (!coupon) {
    bot.sendMessage(msg.chat.id, '❌ این کد کوپن معتبر نیست یا وجود ندارد.');
    return true;
  }
  if (coupon.usedBy) {
    bot.sendMessage(msg.chat.id, '⚠️ این کوپن قبلاً استفاده شده است.');
    return true;
  }
  coupon.usedBy = player.id;
  player.coins += coupon.amount;
  bot.sendMessage(
    msg.chat.id,
    `✅ کوپن با موفقیت استفاده شد.\n💰 ${coupon.amount} سکه اضافه شد.\nمجموع سکه‌ها: ${player.coins}`
  );
  if (OWNER_ID) {
    bot.sendMessage(
      OWNER_ID,
      `📢 کوپن استفاده شد:\nکد: ${text}\nکاربر: ${player.nickname || player.username || player.id}\nمقدار: ${coupon.amount}`
    ).catch(() => {});
  }
  return true;
}

// ================== ایموجی‌ها ==================

bot.onText(/\/unlock_emoji(?:@[\w_]+)?\s+(.+)\s+(\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const emoji = match[1].trim();
  const price = Number(match[2]);
  if (!emoji) return bot.sendMessage(msg.chat.id, '❌ ایموجی نامعتبر است.');
  if (price < 0) return bot.sendMessage(msg.chat.id, '❌ قیمت نامعتبر است.');
  emojis.set(emoji, { price, unlocked: true });
  bot.sendMessage(msg.chat.id, `✅ ایموجی ${emoji} آزاد شد. قیمت: ${price} سکه.`);
});

bot.onText(/\/buy_emoji(?:@[\w_]+)?\s+(.+)/, (msg, match) => {
  const player = ensurePlayer(msg.from);
  if (isBlocked(player.id)) return bot.sendMessage(msg.chat.id, '🚫 حساب شما مسدود است.');
  const emoji = match[1].trim();
  const info = emojis.get(emoji);
  if (!info || !info.unlocked) return bot.sendMessage(msg.chat.id, '❌ این ایموجی برای خرید در دسترس نیست.');
  if (player.emojis.has(emoji)) return bot.sendMessage(msg.chat.id, '✅ این ایموجی را قبلاً خریده‌ای.');
  if (player.coins < info.price) return bot.sendMessage(msg.chat.id, '😢 سکه‌های شما کافی نیست.');
  player.coins -= info.price;
  player.emojis.add(emoji);
  bot.sendMessage(msg.chat.id, `🎉 ایموجی ${emoji} برای شما فعال شد.\nسکه‌های باقی‌مانده: ${player.coins}`);
});

// ================== لینک پشتیبانی ==================

bot.onText(/\/set_support_link(?:@[\w_]+)?\s+(.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  supportLink = match[1].trim();
  bot.sendMessage(msg.chat.id, `✅ لینک پشتیبانی ثبت شد:\n${supportLink}`);
});

// ================== مسدودی و ادمین ==================

bot.onText(/\/ban(?:@[\w_]+)?\s+(\d+)\s+(\d+)(h|d)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const uid = Number(match[1]);
  const amount = Number(match[2]);
  const unit = match[3];
  let ms = 0;
  if (unit === 'h') ms = amount * 60 * 60 * 1000;
  if (unit === 'd') ms = amount * 24 * 60 * 60 * 1000;
  blockedUsers.set(uid, { until: Date.now() + ms, reason: 'manual' });
  bot.sendMessage(msg.chat.id, `🚫 کاربر ${uid} برای ${amount}${unit} مسدود شد.`);
});

bot.onText(/\/unban(?:@[\w_]+)?\s+(\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const uid = Number(match[1]);
  blockedUsers.delete(uid);
  bot.sendMessage(msg.chat.id, `✅ کاربر ${uid} از مسدودی خارج شد.`);
});

bot.onText(/\/add_admin(?:@[\w_]+)?\s+(\d+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return;
  const uid = Number(match[1]);
  admins.add(uid);
  bot.sendMessage(msg.chat.id, `✅ کاربر ${uid} ادمین شد.`);
});

bot.onText(/\/remove_admin(?:@[\w_]+)?\s+(\d+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return;
  const uid = Number(match[1]);
  admins.delete(uid);
  bot.sendMessage(msg.chat.id, `✅ کاربر ${uid} از ادمین بودن خارج شد.`);
});

// ================== فروشگاه نقش و جادو ==================

function roleStoreText() {
  return SPECIAL_ROLES.map(r =>
    `🔹 ${r.name}\nنقش: ${roleLabel(r.role)}\nقیمت: ${r.price} سکه`
  ).join('\n\n');
}
function magicStoreText() {
  return MAGIC_SPELLS.map(m =>
    `🔹 ${m.name}\nقیمت: ${m.price} سکه`
  ).join('\n\n');
}
function roleStoreKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: SPECIAL_ROLES.map(r => [
        { text: `${r.name} (${r.price}💰)`, callback_data: `BUY_ROLE:${r.id}` }
      ])
    }
  };
}
function magicStoreKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: MAGIC_SPELLS.map(m => [
        { text: `${m.name} (${m.price}💰)`, callback_data: `BUY_MAGIC:${m.id}` }
      ])
    }
  };
}

// ================== اتاق‌ها ==================

function createRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const room = {
    id: roomId,
    scenario: SCENARIOS.HARD,
    status: 'WAITING',
    waiting: [],
    players: [], // { userId, nickname, role, alive, stats: {...} }
    day: 0,
    phase: null,
    timers: [],
    actions: {},
    votes: new Map(),
    friendly: false
  };
  rooms.set(roomId, room);
  return room;
}

function resetRoom(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.status = 'WAITING';
  room.waiting = [];
  room.players = [];
  room.day = 0;
  room.phase = null;
  room.actions = {};
  room.votes = new Map();
}

function autoSelectRoom(friendly) {
  const ids = ['room1', 'room2', 'room3', 'room4', 'room5'];
  let best = null;
  let bestCount = -1;
  ids.forEach(id => {
    const r = createRoom(id);
    r.friendly = friendly;
    if (r.waiting.length > bestCount) {
      bestCount = r.waiting.length;
      best = r;
    }
  });
  return best || createRoom('room1');
}

function broadcastToRoom(room, text, extra = {}) {
  room.players.forEach(p => {
    bot.sendMessage(p.userId, text, extra).catch(() => {});
  });
}

function alivePlayers(room) {
  return room.players.filter(p => p.alive);
}

// ================== ساخت نقش‌ها (سخت ۱۲ نفره) ==================

function buildRolesForRoom(room) {
  const count = room.players.length;
  const roles = [];

  if (room.scenario === SCENARIOS.HARD) {
    if (count >= 12) {
      const cityRoles = [
        ROLES.HARD_INTERROGATOR, // بازجوی نُنُری
        ROLES.HARD_SEER,         // پیشگو
        ROLES.HARD_NECROMANCER,  // احضارگر
        ROLES.HARD_DARK_WIZARD,  // جادوگر تاریکی
        ROLES.HARD_CITIZEN,
        ROLES.HARD_CITIZEN,
        ROLES.HARD_CITIZEN
      ];
      const mafiaRoles = [
        ROLES.HARD_GODFATHER,
        ROLES.MAFIA,
        ROLES.MAFIA,
        ROLES.MAFIA
      ];
      const indepPool = [ROLES.HARD_WEREWOLF, ROLES.HARD_SERIAL_KILLER];
      const indepRole = indepPool[Math.floor(Math.random() * indepPool.length)];
      roles.push(...cityRoles, ...mafiaRoles, indepRole);
      roles.length = count;
    } else {
      roles.push(
        ROLES.HARD_GODFATHER,
        ROLES.HARD_SERIAL_KILLER,
        ROLES.HARD_SEER,
        ROLES.HARD_NECROMANCER,
        ROLES.HARD_DARK_WIZARD,
        ROLES.HARD_WEREWOLF
      );
      while (roles.length < count) roles.push(ROLES.HARD_CITIZEN);
    }
  } else {
    roles.push(
      ROLES.CUTE_CAT,
      ROLES.CUTE_ANGEL,
      ROLES.CUTE_PUZZLER,
      ROLES.CUTE_RAINBOW_WIZARD,
      ROLES.CUTE_SLEEPY
    );
    while (roles.length < count) roles.push(ROLES.CUTE_CITIZEN);
  }

  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  const pool = roles.slice(0, count);
  const assigned = new Map();

  room.players.forEach(p => {
    const pl = players.get(p.userId);
    if (!pl) return;
    for (const prefId of pl.preferredRoles) {
      const pref = SPECIAL_ROLES.find(r => r.id === prefId);
      if (!pref) continue;
      const idx = pool.indexOf(pref.role);
      if (idx !== -1) {
        pool.splice(idx, 1);
        assigned.set(p.userId, pref.role);
        break;
      }
    }
  });

  room.players.forEach(p => {
    if (assigned.has(p.userId)) return;
    const r = pool.shift();
    assigned.set(p.userId, r);
  });

  return assigned;
}

const MIN_PLAYERS = 12;

// ================== شروع بازی ==================

function startGameIfReady(room) {
  if (room.status === 'RUNNING') return;
  if (room.waiting.length < MIN_PLAYERS) return;

  room.status = 'RUNNING';
  room.day = 1;
  room.phase = null;

  const selected = room.waiting.splice(0, MIN_PLAYERS);
  room.players = selected.map((userId, idx) => {
    const p = players.get(userId);
    return {
      userId,
      nickname: p.nickname || p.username || `بازیکن ${idx + 1}`,
      role: null,
      alive: true,
      stats: {
        votesGiven: 0,
        nightActions: 0,
        killsDone: 0,
        savesDone: 0,
        investigations: 0
      }
    };
  });

  room.scenario = Math.random() < 0.5 ? SCENARIOS.HARD : SCENARIOS.CUTE;

  const assigned = buildRolesForRoom(room);
  room.players.forEach(p => {
    p.role = assigned.get(p.userId);
  });

  broadcastToRoom(
    room,
    '🎲 بازی شروع شد!\n' +
    (room.scenario === SCENARIOS.HARD ? '🟥 سناریو: شهر خونین' : '🟦 سناریو: سرزمین کیوت') +
    '\n🌞 #روز اول – سلام و آشنایی 💬'
  );

  room.players.forEach(p => {
    const team = roleTeam(p.role);
    let teamLabel = '';
    if (team === 'CITY') teamLabel = '🟢 تیم شهروند';
    else if (team === 'MAFIA') teamLabel = '🔴 تیم مافیا';
    else if (team === 'INDEPENDENT') teamLabel = '🟡 مستقل';

    bot.sendMessage(
      p.userId,
      `🎭 نقش شما:\n${roleLabel(p.role)}\n\n${teamLabel}\n\nاکشن‌های شبانه برای شما اینلاین نمایش داده خواهند شد.`
    );
  });

  startDayPhase(room);
}

// ================== فاز روز و رأی ==================

const CHAT_DURATION = 25 * 1000;
const DAY_VOTE_DURATION = 45 * 1000;
const NIGHT_DURATION = 45 * 1000;

function startDayPhase(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.timers = [];
  room.phase = 'DAY';

  const list = alivePlayers(room)
    .map((p, i) => `${i + 1}. ${p.nickname}`)
    .join('\n');

  broadcastToRoom(
    room,
    `🌞 #روز ${room.day}\n\n👥 بازیکنان باقی‌مانده:\n${list}\n\n💬 چت آزاد است – مدت: ⏱ ${CHAT_DURATION / 1000} ثانیه`
  );

  const t = setTimeout(() => startVotingPhase(room), CHAT_DURATION);
  room.timers.push(t);
}

function buildVoteKeyboard(room) {
  const buttons = alivePlayers(room).map(p => [{
    text: p.nickname,
    callback_data: `VOTE:${room.id}:${p.userId}`
  }]);
  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

function startVotingPhase(room) {
  room.phase = 'DAY_VOTE';
  room.votes = new Map();

  broadcastToRoom(
    room,
    '🗳 رأی‌گیری شروع شد.\nبه یک نفر رأی بده تا به دادگاه احضار شود.\n⏱ ۴۵ ثانیه زمان رأی‌گیری.',
    buildVoteKeyboard(room)
  );

  const t = setTimeout(() => finishVotingPhase(room), DAY_VOTE_DURATION);
  room.timers.push(t);
}

function finishVotingPhase(room) {
  const countMap = new Map();
  for (const [voterId, targetId] of room.votes.entries()) {
    if (!countMap.has(targetId)) countMap.set(targetId, 0);
    countMap.set(targetId, countMap.get(targetId) + 1);
    const voter = room.players.find(p => p.userId === voterId);
    if (voter) voter.stats.votesGiven += 1;
  }

  if (countMap.size === 0) {
    broadcastToRoom(room, '⚖️ هیچ رأیی ثبت نشد. امشب بدون دادگاه به شب می‌رویم 🌙');
    return startNightPhase(room);
  }

  let pickedTargetId = null;
  let maxVotes = 0;
  for (const [targetId, count] of countMap.entries()) {
    if (count > maxVotes) {
      maxVotes = count;
      pickedTargetId = targetId;
    }
  }

  const target = room.players.find(p => p.userId === Number(pickedTargetId));
  if (!target || !target.alive) {
    broadcastToRoom(room, '⚖️ خطایی در رأی‌گیری رخ داد، امشب بدون اعدام به شب می‌رویم 🌙');
    return startNightPhase(room);
  }

  broadcastToRoom(
    room,
    `⚖️ ${target.nickname} به دادگاه احضار شد.\nمتهم چند لحظه فرصت دفاع دارد.`
  );

  const t = setTimeout(() => {
    target.alive = false;
    broadcastToRoom(
      room,
      `🪧 ${target.nickname} اعدام شد.\n♨️ نقش: ${roleLabel(target.role)}`
    );
    checkWinConditions(room);
    if (room.status === 'ENDED') return;
    startNightPhase(room);
  }, 10 * 1000);
  room.timers.push(t);
}

// ================== فاز شب ==================

function targetKeyboard(room, actor, prefix) {
  const list = alivePlayers(room)
    .filter(p => p.userId !== actor.userId)
    .map(p => [{
      text: p.nickname,
      callback_data: `${prefix}:${room.id}:${p.userId}`
    }]);
  if (!list.length) return null;
  return { reply_markup: { inline_keyboard: list } };
}

function mafiaTeamInfoText(room, selfId) {
  const mafiaPlayers = room.players.filter(p => roleTeam(p.role) === 'MAFIA');
  if (!mafiaPlayers.length) return '';
  const labels = ['گادفادر 🚬', 'معشوقه 🧕', 'مذاکره کننده 🤝', 'شیاد 👹'];
  const lines = mafiaPlayers.map((p, idx) => {
    const tag = labels[idx] || 'عضو مافیا 🔴';
    const me = p.userId === selfId ? ' {شما}' : '';
    return `${tag} : ${p.nickname}${me}`;
  }).join('\n');
  return '\n\n' + lines + '\n\n💬 چت: فقط با تیم\n🌞 روز 👈🏻 40 ثانیه';
}

function sendNightPanel(room, player) {
  const r = player.role;

  if (roleTeam(r) === 'MAFIA') {
    const textHeader =
      `🌙 #شب ${room.day}\n🎭 نقش شما: ${roleLabel(r)}\n🔖 مأموریت: زمان مذاکره و شات!\n`;
    const teamText = mafiaTeamInfoText(room, player.userId);
    bot.sendMessage(
      player.userId,
      textHeader + teamText,
      targetKeyboard(room, player, 'ACT_KILL') || {}
    ).catch(() => {});
    return;
  }

  switch (r) {
    case ROLES.HARD_SERIAL_KILLER:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🩸 یک نفر را انتخاب کن تا بکشی.`,
        targetKeyboard(room, player, 'ACT_SKILL') || {}
      ).catch(() => {});
      break;

    case ROLES.HARD_SEER:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n👁️ یک نفر را برای استعلام انتخاب کن.`,
        targetKeyboard(room, player, 'ACT_SEER') || {}
      ).catch(() => {});
      break;

    case ROLES.HARD_NECROMANCER:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🕯 می‌توانی یک مرده را در ذهن خودت احضار کنی (نمایشی).`,
        targetKeyboard(room, player, 'ACT_NECRO') || {}
      ).catch(() => {});
      break;

    case ROLES.HARD_DARK_WIZARD:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🧿 یک نفر را نفرین کن تا فردا محدود شود.`,
        targetKeyboard(room, player, 'ACT_CURSE') || {}
      ).catch(() => {});
      break;

    case ROLES.HARD_WEREWOLF:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🐺 یک نفر را برای حمله انتخاب کن.`,
        targetKeyboard(room, player, 'ACT_WOLF') || {}
      ).catch(() => {});
      break;

    case ROLES.HARD_INTERROGATOR:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🧸 یک نفر را برای بازجویی انتخاب کن.\nنتیجهٔ بازجویی فردا برایت ارسال می‌شود.`,
        targetKeyboard(room, player, 'ACT_INT') || {}
      ).catch(() => {});
      break;

    case ROLES.CUTE_CAT:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🐾 یک نفر را گیج کن تا فردا نتواند رأی بدهد.`,
        targetKeyboard(room, player, 'ACT_DIZZY') || {}
      ).catch(() => {});
      break;

    case ROLES.CUTE_ANGEL:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🪽 یک نفر را برای نجات شب انتخاب کن.`,
        targetKeyboard(room, player, 'ACT_SAVE') || {}
      ).catch(() => {});
      break;

    case ROLES.CUTE_PUZZLER:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🧩 یک نفر را انتخاب کن تا یک سرنخ از نقش او بگیری.`,
        targetKeyboard(room, player, 'ACT_HINT') || {}
      ).catch(() => {});
      break;

    case ROLES.CUTE_RAINBOW_WIZARD:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🪄 فعلاً جادوی ویژه‌ای نداری؛ نسخهٔ متا.`,
      ).catch(() => {});
      break;

    case ROLES.CUTE_SLEEPY:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🌙 اگر کسی به تو حمله کند، فردا هویتش را می‌بینی.`,
      ).catch(() => {});
      break;

    default:
      bot.sendMessage(
        player.userId,
        `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\nامشب اکشنی نداری.`,
      ).catch(() => {});
      break;
  }
}

function startNightPhase(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.timers = [];
  room.phase = 'NIGHT';

  room.actions = {
    kills: [],
    saves: [],
    reveals: [],
    curses: [],
    dizzy: [],
    serialKills: [],
    wolfKills: [],
    revived: []
  };

  broadcastToRoom(
    room,
    `🌙 #شب ${room.day}\nچت برای همه غیرفعال است.`
  );

  alivePlayers(room).forEach(p => sendNightPanel(room, p));

  const t = setTimeout(() => resolveNight(room), NIGHT_DURATION);
  room.timers.push(t);
}

function resolveNight(room) {
  const killed = new Set();
  const saved = new Set(room.actions.saves || []);

  (room.actions.kills || []).forEach(id => {
    if (!saved.has(id)) killed.add(id);
  });
  (room.actions.serialKills || []).forEach(id => {
    if (!saved.has(id)) killed.add(id);
  });
  (room.actions.wolfKills || []).forEach(id => {
    if (!saved.has(id)) killed.add(id);
  });

  const killedPlayers = [];
  killed.forEach(id => {
    const p = room.players.find(x => x.userId === id);
    if (p && p.alive) {
      p.alive = false;
      killedPlayers.push(p);
    }
  });

  if (killedPlayers.length === 0) {
    broadcastToRoom(room, '🌞 شهر آرام، دیشب کسی کشته نشد.');
  } else {
    const list = killedPlayers.map(p => `${p.nickname} (${roleLabel(p.role)})`).join('\n');
    broadcastToRoom(
      room,
      '🌞 گزارش صبح:\nدیشب این افراد کشته شدند:\n' + list
    );
  }

  (room.actions.reveals || []).forEach(item => {
    const actor = room.players.find(p => p.userId === item.actorId);
    const target = room.players.find(p => p.userId === item.targetId);
    if (!actor || !target) return;
    const team = roleTeam(target.role);
    let desc = 'تقریباً بی‌خطر';
    if (team === 'MAFIA') desc = 'مشکوک (مافیا)';
    else if (team === 'INDEPENDENT') desc = 'خطرناک (مستقل)';
    actor.stats.investigations += 1;
    bot.sendMessage(
      actor.userId,
      `👁️ نتیجه:\nنام: ${target.nickname}\nنقش: ${roleLabel(target.role)}\nتیم: ${desc}`
    ).catch(() => {});
  });

  checkWinConditions(room);
  if (room.status === 'ENDED') return;

  room.day += 1;
  startDayPhase(room);
}

// ================== پایان بازی و MVP ==================

function endGameWithResult(room, resultText) {
  room.status = 'ENDED';

  const lines = room.players.map(p => {
    const team = roleTeam(p.role);
    const aliveText = p.alive ? 'زنده' : 'مرده';
    let teamEmoji = team === 'CITY' ? '🟢' : team === 'MAFIA' ? '🔴' : team === 'INDEPENDENT' ? '🟡' : '⚪️';
    return `${teamEmoji} ${p.nickname} — ${roleLabel(p.role)} — ${aliveText}`;
  });

  // MVP
  let mvp = null;
  let bestScore = -1;
  room.players.forEach(p => {
    const s = p.stats;
    const score =
      s.votesGiven +
      2 * s.nightActions +
      3 * s.savesDone +
      3 * s.killsDone +
      2 * s.investigations;
    if (score > bestScore) {
      bestScore = score;
      mvp = { player: p, score };
    }
  });

  let mvpText = 'هنوز MVP مشخص نشد.';
  if (mvp && bestScore > 0) {
    mvpText =
      `👑 بهترین بازیکن این دست:\n` +
      `${mvp.player.nickname} با امتیاز مشارکت ${bestScore}`;
  }

  const finalText =
    `🎬 پایان بازی\n\n${resultText}\n\n` +
    '📜 نقش و تیم همهٔ بازیکنان:\n' +
    lines.join('\n') +
    '\n\n' +
    mvpText;

  broadcastToRoom(room, finalText);
  resetRoom(room);
}

function checkWinConditions(room) {
  const alive = alivePlayers(room);
  const mafias = alive.filter(p => roleTeam(p.role) === 'MAFIA');
  const citizens = alive.filter(p => roleTeam(p.role) === 'CITY');
  const independents = alive.filter(p => roleTeam(p.role) === 'INDEPENDENT');

  if (mafias.length === 0 && citizens.length > 0) {
    endGameWithResult(room, '🌅 شهروندان پیروز شدند! 🟢');
    return;
  }
  if (mafias.length > 0 && mafias.length >= citizens.length) {
    endGameWithResult(room, '🌑 مافیا شهر را بلعید! 🔴');
    return;
  }
  if (independents.length === 1 && mafias.length === 0 && citizens.length === 0) {
    endGameWithResult(room, '🔥 یک مستقل تنها، همه را شکست داد! 🟡');
    return;
  }
}

// ================== پروفایل / امتیاز / راهنما ==================

function profileInlineKeyboard(userId) {
  const rows = [
    [
      { text: '🎀 تغییر نام', callback_data: 'PROFILE:CHANGE_NAME' },
      { text: '🏆 لیگ‌ها', callback_data: 'PROFILE:LEAGUES' }
    ],
    [
      { text: '🧙‍♂️ جادوها', callback_data: 'PROFILE:MAGIC' },
      { text: '⚙ تنظیمات', callback_data: 'PROFILE:SETTINGS' }
    ],
    [
      { text: '📨 درخواست لیگ ویژه', callback_data: 'PROFILE:REQUEST_LEAGUE' }
    ]
  ];
  if (isAdmin(userId)) {
    rows.push([{ text: '🔐 پنل مدیریت', callback_data: 'OWNER:PANEL' }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function handleProfile(msg) {
  const player = ensurePlayer(msg.from);
  const chatId = msg.chat.id;
  const winRate = player.gamesPlayed > 0
    ? Math.round((player.wins / player.gamesPlayed) * 100)
    : 0;
  const league = leagueLabel(player.leagueId);
  bot.sendMessage(
    chatId,
    '💢 پروفایل بازیکن\n\n' +
    `➖ نام: ${player.nickname || 'ثبت نشده'}\n` +
    `➖ آیدی: ${player.id}\n` +
    `➖ لیگ: ${league}\n` +
    `➖ امتیاز کل: ${player.totalScore}\n` +
    `➖ امتیاز روزانه: ${player.dailyScore}\n` +
    `➖ امتیاز هفتگی: ${player.weeklyScore}\n` +
    `➖ سکه‌ها: ${player.coins}\n` +
    `➖ بازی‌ها: ${player.gamesPlayed}\n` +
    `➖ برد: ${player.wins} (${winRate}%)\n` +
    `➖ ایموجی‌ها: ${player.emojis.size ? Array.from(player.emojis).join(' ') : 'هیچی'}\n` +
    supportHintText(),
    profileInlineKeyboard(player.id)
  );
}

function handleScores(msg) {
  const chatId = msg.chat.id;
  const allPlayers = Array.from(players.values());
  allPlayers.sort((a, b) => b.totalScore - a.totalScore);
  const top = allPlayers.slice(0, 10);
  const lines = top.length
    ? top.map((p, i) =>
        `${i + 1}️⃣ ${p.nickname || p.id} — ${p.totalScore} (${leagueLabel(p.leagueId)})`
      ).join('\n')
    : 'هنوز کسی امتیازی ندارد.';
  bot.sendMessage(chatId, '📊 برترین‌ها (امتیاز کل):\n\n' + lines);
}

function handleHelp(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    '📚 راهنمای مافیا آنلاین\n\n' +
    '۱️⃣ /start → شروع و گرفتن منوی اینلاین\n' +
    '۲️⃣ ارسال کد کوپن → دریافت سکه\n' +
    '۳️⃣ شروع بازی آنلاین → ورود به صف اتاق با بیشترین بازیکن\n' +
    '۴️⃣ پایان هر بازی → افشای نقش‌ها + معرفی بهترین بازیکن\n' +
    '۵️⃣ جوایز روزانه: آخر هر روز به ۱۰ نفر اول امتیاز روزانه سکه می‌رسد.\n\n' +
    supportHintText()
  );
}

// ================== جوایز روزانه ==================

function runDailyRewardsIfNeeded() {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (hour === 23 && minute >= 59) {
    if (last} سکه`
  ).join('\n\n');
}
function magicStoreText() {
  return MAGIC_SPELLS.map(m =>
    `🔹 ${m.name}\nقیمت: ${m.price} سکه`
  ).join('\n\n');
}
function roleStoreKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: SPECIAL_ROLES.map(r => [
        { text: `${r.name} (${r.price}💰)`, callback_data: `BUY_ROLE:${r.id}` }
      ])
    }
  };
}
function magicStoreKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: MAGIC_SPELLS.map(m => [
        { text: `${m.name} (${m.price}💰)`, callback_data: `BUY_MAGIC:${m.id}` }
      ])
    }
  };
}

// ================== اتاق‌ها ==================

function createRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const room = {
    id: roomId,
    scenario: SCENARIOS.HARD,
    status: 'WAITING',
    waiting: [],
    players: [], // { userId, nickname, role, alive, stats: {...} }
    day: 0,
    phase: null,
    timers: [],
    actions: {},
    votes: new Map(),
    friendly: false
  };
  rooms.set(roomId, room);
  return room;
}

function resetRoom(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.status = 'WAITING';
  room.waiting = [];
  room.players = [];
  room.day = 0;
  room.phase = null;
  room.actions = {};
  room.votes = new Map();
}

function autoSelectRoom(friendly) {
  const ids = ['room1', 'room2', 'room3', 'room4', 'room5'];
  let best = null;
  let bestCount = -1;
  ids.forEach(id => {
    const r = createRoom(id);
    r.friendly = friendly;
    if (r.waiting.length > bestCount) {
      bestCount = r.waiting.length;
      best = r;
    }
  });
  return best || createRoom('room1');
}

function broadcastToRoom(room, text, extra = {}) {
  room.players.forEach(p => {
    bot.sendMessage(p.userId, text, extra).catch(() => {});
  });
}

function alivePlayers(room) {
  return room.players.filter(p => p.alive);
}

// ================== ساخت نقش‌ها (سخت ۱۲ نفره) ==================

function buildRolesForRoom(room) {
  const count = room.players.length;
  const roles = [];

  if (room.scenario === SCENARIOS.HARD) {
    if (count >= 12) {
      const cityRoles = [
        ROLES.HARD_INTERROGATOR, // بازجوی نُنُری
        ROLES.HARD_SEER,         // پیشگو
        ROLES.HARD_NECROMANCER,  // احضارگر
        ROLES.HARD_DARK_WIZARD,  // جادوگر تاریکی
        ROLES.HARD_CITIZEN,
        ROLES.HARD_CITIZEN,
        ROLES.HARD_CITIZEN
      ];
      const mafiaRoles = [
        ROLES.HARD_GODFATHER,
        ROLES.MAFIA,
        ROLES.MAFIA,
        ROLES.MAFIA
      ];
      const indepPool = [ROLES.HARD_WEREWOLF, ROLES.HARD_SERIAL_KILLER];
      const indepRole = indepPool[Math.floor(Math.random() * indepPool.length)];
      roles.push(...cityRoles, ...mafiaRoles, indepRole);
      roles.length = count;
    } else {
      roles.push(
        ROLES.HARD_GODFATHER,
        ROLES.HARD_SERIAL_KILLER,
        ROLES.HARD_SEER,
        ROLES.HARD_NECROMANCER,
        ROLES.HARD_DARK_WIZARD,
        ROLES.HARD_WEREWOLF
      );
      while (roles.length < count) roles.push(ROLES.HARD_CITIZEN);
    }
  } else {
    roles.push(
      ROLES.CUTE_CAT,
      ROLES.CUTE_ANGEL,
      ROLES.CUTE

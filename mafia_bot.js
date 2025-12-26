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
  CUTE: 'CUTE',
  STORY: 'STORY'
};

function scenarioLabel(s) {
  switch (s) {
    case SCENARIOS.HARD:
      return '🟥 شهر خونین';
    case SCENARIOS.CUTE:
      return '🟦 سرزمین کیوت';
    case SCENARIOS.STORY:
      return '📖 قصهٔ روستای مه‌آلود';
    default:
      return 'سناریوی ناشناس';
  }
}

function scenarioIntroText(s) {
  switch (s) {
    case SCENARIOS.STORY:
      return '📖 در روستایی کوچک و مه‌آلود، چند غریبه‌ی مشکوک وارد می‌شوند...\n' +
             'هیچ‌کس نمی‌داند چه کسی بی‌گناه است و چه کسی نقشه‌ای تاریک در سر دارد.';
    case SCENARIOS.CUTE:
      return '🩷 اینجا سرزمین کیوت است؛ همه‌چیز نُنُری و بامزه، اما خطر واقعی‌ست!';
    case SCENARIOS.HARD:
    default:
      return '🌆 شهر خونین؛ جایی که هر شب، یک نفر برنمی‌گردد...';
  }
}

// ================== لیگ‌ها ==================

const LEAGUES = [
  { id: 'STONE',   emoji: '🪨', name: 'لیگ سنگیِ خشن',           requiredScore: 0 },
  { id: 'BRONZE',  emoji: '🥉', name: 'لیگ برنزیِ تازه‌کار',     requiredScore: 500 },
  { id: 'SILVER',  emoji: '🥈', name: 'لیگ نقره‌ایِ باتجربه',    requiredScore: 2000 },
  { id: 'GOLD',    emoji: '🥇', name: 'لیگ طلاییِ حرفه‌ای',      requiredScore: 5000 },
  { id: 'AURORA',  emoji: '🌈', name: 'لیگ شفقِ پفیِ افسانه‌ای', requiredScore: 12000 }
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
  SEER: 'SEER',
  INVESTIGATOR: 'INVESTIGATOR',
  INTERROGATOR: 'INTERROGATOR',
  FREEMASON: 'FREEMASON',
  CITIZEN: 'CITIZEN',
  GODFATHER: 'GODFATHER',
  MAFIA: 'MAFIA',
  SERIAL_KILLER: 'SERIAL_KILLER'
};

function roleTeam(role) {
  switch (role) {
    case ROLES.GODFATHER:
    case ROLES.MAFIA:
      return 'MAFIA';
    case ROLES.SERIAL_KILLER:
      return 'INDEPENDENT';
    case ROLES.SEER:
    case ROLES.INVESTIGATOR:
    case ROLES.INTERROGATOR:
    case ROLES.FREEMASON:
    case ROLES.CITIZEN:
      return 'CITY';
    default:
      return 'UNKNOWN';
  }
}

function roleLabel(role) {
  switch (role) {
    case ROLES.SEER:
      return '👁️ پیشگو';
    case ROLES.INVESTIGATOR:
      return '🔍 محقق';
    case ROLES.INTERROGATOR:
      return '🧸 بازپرس نُنُری';
    case ROLES.FREEMASON:
      return '🧱 فراماسونِ کیوت\n«عضوی مرموز از محفل مخفی؛ ظاهراً شهرونده، اما همیشه یک قدم جلوتر فکر می‌کند.»';
    case ROLES.CITIZEN:
      return '🟢 شهروند ساده';
    case ROLES.GODFATHER:
      return '😈 گادفادر';
    case ROLES.MAFIA:
      return '🔴 عضو مافیا';
    case ROLES.SERIAL_KILLER:
      return '🩸 قاتل سریالی';
    default:
      return 'نقش ناشناس';
  }
}

// نقش‌های خریدنی (ترجیح نقش)
const SPECIAL_ROLES = [
  { id: 'PREF_SEER',      role: ROLES.SEER,      name: '👁️ دیدبان سایه',   price: 300 },
  { id: 'PREF_GODFATHER', role: ROLES.GODFATHER, name: '😈 رئیس زیرزمین',   price: 500 },
  { id: 'PREF_FREEMASON', role: ROLES.FREEMASON, name: '🧱 معمار پفی',      price: 350 }
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
    if (player.totalScore >= l.requiredScore && l.requiredScore >= best.requiredScore) {
      best = l;
    }
  }
  player.leagueId = best.id;
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
  if (!msg.text) return false;
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
    status: 'WAITING', // WAITING / RUNNING / ENDED
    waiting: [],
    players: [], // { userId, nickname, role, alive, stats }
    day: 0,
    phase: null, // DAY / DAY_VOTE / COURT / NIGHT
    timers: [],
    votes: new Map(),
    actions: {
      kills: [],
      serialKills: [],
      saves: [],
      jails: [],
      judgeDecisions: []
    },
    court: {
      targetId: null,
      requiredVotes: 0
    }
  };
  rooms.set(roomId, room);
  return room;
}

function resetRoom(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.timers = [];
  room.status = 'WAITING';
  room.waiting = [];
  room.players = [];
  room.day = 0;
  room.phase = null;
  room.votes = new Map();
  room.actions = {
    kills: [],
    serialKills: [],
    saves: [],
    jails: [],
    judgeDecisions: []
  };
  room.court = { targetId: null, requiredVotes: 0 };
}

function autoSelectRoom() {
  const ids = ['room1', 'room2', 'room3'];
  let best = null;
  let bestCount = -1;
  ids.forEach(id => {
    const r = createRoom(id);
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

// ================== ساخت نقش‌ها ==================

function buildRolesForRoom(room) {
  const count = room.players.length;
  const roles = [];

  if (count <= 6) {
    roles.push(
      ROLES.GODFATHER,
      ROLES.MAFIA,
      ROLES.INVESTIGATOR,
      ROLES.INTERROGATOR,
      ROLES.FREEMASON
    );
    while (roles.length < count) roles.push(ROLES.CITIZEN);
    room.scenario = SCENARIOS.STORY;
  } else {
    roles.push(
      ROLES.GODFATHER,
      ROLES.MAFIA,
      ROLES.MAFIA,
      ROLES.SEER,
      ROLES.INVESTIGATOR,
      ROLES.INTERROGATOR,
      ROLES.FREEMASON,
      ROLES.SERIAL_KILLER
    );
    while (roles.length < count) roles.push(ROLES.CITIZEN);
    const all = [SCENARIOS.HARD, SCENARIOS.CUTE, SCENARIOS.STORY];
    room.scenario = all[Math.floor(Math.random() * all.length)];
  }

  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  return roles.slice(0, count);
}

const MIN_PLAYERS = 6;

// ================== شروع بازی ==================

function startGameIfReady(room) {
  if (room.status === 'RUNNING') return;
  if (room.waiting.length < MIN_PLAYERS) return;

  room.status = 'RUNNING';
  room.day = 1;
  room.phase = null;

  const selected = room.waiting.splice(0, MIN_PLAYERS);
  room.players = selected.map((userId, idx) => {
    const prof = players.get(userId) || { username: null };
    return {
      userId,
      nickname: prof.nickname || prof.username || `بازیکن ${idx + 1}`,
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

  const roles = buildRolesForRoom(room);
  room.players.forEach((p, i) => {
    p.role = roles[i];
  });

  const intro =
    `🎲 بازی شروع شد!\n` +
    `${scenarioIntroText(room.scenario)}\n\n` +
    `سناریو: ${scenarioLabel(room.scenario)}\n🌞 #روز اول – سلام و آشنایی 💬`;

  broadcastToRoom(room, intro);

  room.players.forEach(p => {
    const team = roleTeam(p.role);
    let teamLabel = '';
    if (team === 'CITY') teamLabel = '🟢 تیم شهروند';
    else if (team === 'MAFIA') teamLabel = '🔴 تیم مافیا';
    else if (team === 'INDEPENDENT') teamLabel = '🟡 مستقل';

    bot.sendMessage(
      p.userId,
      `🎭 نقش شما:\n${roleLabel(p.role)}\n\n${teamLabel}\n\n` +
      `سناریو: ${scenarioLabel(room.scenario)}\n` +
      'اکشن‌های شبانه برای شما اینلاین نمایش داده خواهند شد.'
    ).catch(() => {});
  });

  startDayPhase(room);
}

// ================== فاز روز / رأی ==================

const CHAT_DURATION = 25 * 1000;
const DAY_VOTE_DURATION = 45 * 1000;
const COURT_DEFENSE_DURATION = 15 * 1000;
const NIGHT_DURATION = 45 * 1000;

function formatPlayerNameWithStatus(p) {
  const base = p.nickname;
  if (p.alive) return base;
  return `${base} (مرده)`;
}

function startDayPhase(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.timers = [];
  room.phase = 'DAY';
  room.court = { targetId: null, requiredVotes: 0 };
  room.votes = new Map();

  const list = room.players
    .map((p, i) => `${i + 1}. ${formatPlayerNameWithStatus(p)}`)
    .join('\n');

  broadcastToRoom(
    room,
    `🌞 #روز ${room.day}\n\n👥 وضعیت بازیکنان:\n${list}\n\n` +
    `💬 چت آزاد است – مدت: ⏱ ${CHAT_DURATION / 1000} ثانیه`
  );

  const t = setTimeout(() => startVotingPhase(room), CHAT_DURATION);
  room.timers.push(t);
}

function computeRequiredVotes(room) {
  const aliveCount = alivePlayers(room).length;
  return Math.max(2, Math.ceil(aliveCount / 2));
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
  const requiredVotes = computeRequiredVotes(room);
  room.court.requiredVotes = requiredVotes;

  broadcastToRoom(
    room,
    '🗳 ‏انتخاب کنید امروز به چه کسی رأی می‌دهید تا به دادگاه احضار شود.\n' +
    `برای احضار به دادگاه ${requiredVotes} رأی لازم است.\n` +
    `⏱ مدت زمان رأی‌گیری: ${DAY_VOTE_DURATION / 1000} ثانیه`,
    buildVoteKeyboard(room)
  );

  const t = setTimeout(() => finishVotingPhase(room), DAY_VOTE_DURATION);
  room.timers.push(t);
}

function goToCourt(room, targetId) {
  room.phase = 'COURT';
  room.court.targetId = targetId;
  const target = room.players.find(p => p.userId === targetId);
  if (!target) {
    startNightPhase(room);
    return;
  }

  broadcastToRoom(
    room,
    `⚖️ ‏${target.nickname} به دادگاه فراخوانده شد.\n` +
    `متهم ${COURT_DEFENSE_DURATION / 1000} ثانیه فرصت دارد تا از خود دفاع کند.\n` +
    '💬 چت: فقط برای متهم (در این نسخه، نمادین است)'
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
  }, COURT_DEFENSE_DURATION);
  room.timers.push(t);
}

function finishVotingPhase(room) {
  if (room.phase !== 'DAY_VOTE') return;

  const required = room.court.requiredVotes || computeRequiredVotes(room);

  const countMap = new Map();
  for (const [voterId, targetId] of room.votes.entries()) {
    if (!countMap.has(targetId)) countMap.set(targetId, 0);
    countMap.set(targetId, countMap.get(targetId) + 1);
    const voter = room.players.find(p => p.userId === voterId);
    if (voter) voter.stats.votesGiven += 1;
  }

  let pickedTargetId = null;
  let maxVotes = 0;

  for (const [targetId, count] of countMap.entries()) {
    if (count > maxVotes) {
      maxVotes = count;
      pickedTargetId = targetId;
    }
  }

  if (!pickedTargetId || maxVotes < required) {
    broadcastToRoom(
      room,
      '⚖️ هیچ‌کس به حد نصاب رأی نرسید.\n' +
      'امشب بدون دادگاه رسمی به شب می‌رویم 🌙'
    );
    return startNightPhase(room);
  }

  goToCourt(room, pickedTargetId);
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
  const lines = mafiaPlayers.map(p => {
    const me = p.userId === selfId ? ' {شما}' : '';
    return `🔴 ${p.nickname}${me}`;
  }).join('\n');
  return '\n\nهم‌تیمی‌های تو:\n' + lines;
}

function sendNightPanel(room, player) {
  const r = player.role;

  if (roleTeam(r) === 'MAFIA') {
    const header =
      `🌙 #شب ${room.day}\n🎭 نقش شما: ${roleLabel(r)}\n` +
      '🔖 مأموریت: با تیم برای شات امشب تصمیم بگیر.\n';
    const teamText = mafiaTeamInfoText(room, player.userId);
    bot.sendMessage(
      player.userId,
      header + teamText,
      targetKeyboard(room, player, 'ACT_KILL') || {}
    ).catch(() => {});
    return;
  }

  if (r === ROLES.SERIAL_KILLER) {
    bot.sendMessage(
      player.userId,
      `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n🩸 یک نفر را برای قتل انتخاب کن.`,
      targetKeyboard(room, player, 'ACT_SKILL') || {}
    ).catch(() => {});
    return;
  }

  if (r === ROLES.SEER) {
    bot.sendMessage(
      player.userId,
      `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n👁️ یک نفر را برای استعلام تیم انتخاب کن.`,
      targetKeyboard(room, player, 'ACT_SEER') || {}
    ).catch(() => {});
    return;
  }

  if (r === ROLES.INVESTIGATOR || r === ROLES.INTERROGATOR) {
    const kb = targetKeyboard(room, player, 'ACT_JAIL');
    const text =
      `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\n` +
      '🧷 می‌توانی یک نفر را برای «بازداشت شبانه» انتخاب کنی.\n' +
      'بعد از انتخاب، پنل اینلاین برای محکوم‌کردن یا بخشش او می‌آید.';
    bot.sendMessage(player.userId, text, kb || {}).catch(() => {});
    return;
  }

  bot.sendMessage(
    player.userId,
    `🌙 #شب ${room.day}\n🎭 ${roleLabel(r)}\nامشب اکشن فعالی نداری؛ فقط از حرف‌ها سرنخ بگیر.`
  ).catch(() => {});
}

function startNightPhase(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.timers = [];
  room.phase = 'NIGHT';

  room.actions = {
    kills: [],
    serialKills: [],
    saves: [],
    jails: [],
    judgeDecisions: []
  };

  broadcastToRoom(
    room,
    `🌙 #شب ${room.day}\nچت عمومی برای همه غیرفعال است.\nهر پیام متنی در این فاز حذف می‌شود.`
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

  (room.actions.judgeDecisions || []).forEach(item => {
    if (item.condemn) {
      if (!saved.has(item.targetId)) killed.add(item.targetId);
    }
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
    const list = killedPlayers
      .map(p => `${formatPlayerNameWithStatus(p)} (${roleLabel(p.role)})`)
      .join('\n');
    broadcastToRoom(
      room,
      '🌞 گزارش صبح:\nدیشب این افراد کشته شدند:\n' + list
    );
  }

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
    const statusText = p.alive ? 'زنده' : 'مرده';
    let teamEmoji =
      team === 'CITY' ? '🟢' :
      team === 'MAFIA' ? '🔴' :
      team === 'INDEPENDENT' ? '🟡' : '⚪️';
    return `${teamEmoji} ${formatPlayerNameWithStatus(p)} — ${roleLabel(p.role)} — ${statusText}`;
  });

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

// ================== منو / پروفایل / راهنما ==================

function inlineMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🕹 شروع بازی آنلاین', callback_data: 'MENU:START_RANKED' }
        ],
        [
          { text: '👤 پروفایل', callback_data: 'MENU:PROFILE' },
          { text: '📊 امتیازات', callback_data: 'MENU:SCORES' }
        ],
        [
          { text: '🛒 فروشگاه نقش', callback_data: 'MENU:ROLE_STORE' },
          { text: '🔮 فروشگاه جادو', callback_data: 'MENU:MAGIC_STORE' }
        ],
        [
          { text: '📚 راهنما', callback_data: 'MENU:HELP' }
        ]
      ]
    }
  };
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
    `➖ نام: ${player.nickname || player.username || 'ثبت نشده'}\n` +
    `➖ آیدی: ${player.id}\n` +
    `➖ لیگ: ${league}\n` +
    `➖ امتیاز کل: ${player.totalScore}\n` +
    `➖ امتیاز روزانه: ${player.dailyScore}\n` +
    `➖ امتیاز هفتگی: ${player.weeklyScore}\n` +
    `➖ سکه‌ها: ${player.coins}\n` +
    `➖ بازی‌ها: ${player.gamesPlayed}\n` +
    `➖ برد: ${player.wins} (${winRate}%)\n` +
    supportHintText()
  );
}

function handleScores(msg) {
  const chatId = msg.chat.id;
  const allPlayers = Array.from(players.values());
  allPlayers.sort((a, b) => b.totalScore - a.totalScore);
  const top = allPlayers.slice(0, 10);
  const lines = top.length
    ? top.map((p, i) =>
        `${i + 1}️⃣ ${p.nickname || p.username || p.id} — ${p.totalScore} (${leagueLabel(p.leagueId)})`
      ).join('\n')
    : 'هنوز کسی امتیازی ندارد.';
  bot.sendMessage(chatId, '📊 برترین‌ها (امتیاز کل):\n\n' + lines);
}

function handleHelp(msg) {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    '📚 راهنمای کوتاه مافیا آنلاین\n\n' +
    '۱️⃣ /start → شروع و گرفتن منوی اینلاین\n' +
    '۲️⃣ شروع بازی آنلاین → ورود به صف اتاق\n' +
    '۳️⃣ روز: چت آزاد + رأی‌گیری\n' +
    '۴️⃣ دادگاه: متهم ۱۵ ثانیه فرصت دفاع دارد\n' +
    '۵️⃣ شب: چت ممنوع؛ هر پیام حذف می‌شود\n' +
    '۶️⃣ پیام‌های داخل بازی با نام و لیگ و وضعیت (زنده/مرده) نمایش داده می‌شوند.\n' +
    '۷️⃣ لیگ‌ها، سکه، فروشگاه نقش و جادو برای پلیرهای فعال.'
  );
}

// ================== جوایز روزانه ==================

function runDailyRewardsIfNeeded() {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  if (lastDailyRewardDate === todayKey) return;
  if (now.getHours() !== 23) return;

  lastDailyRewardDate = todayKey;

  const allPlayers = Array.from(players.values());
  allPlayers.sort((a, b) => b.dailyScore - a.dailyScore);
  const top = allPlayers.slice(0, 10);

  top.forEach((p, index) => {
    const reward = 100 - index * 5;
    p.coins += reward;
    p.dailyScore = 0;
    bot.sendMessage(
      p.id,
      `🎁 جایزه روزانه!\nرتبه: ${index + 1}\nسکه: ${reward}\nمجموع سکه‌ها: ${p.coins}`
    ).catch(() => {});
  });
}

setInterval(runDailyRewardsIfNeeded, 60 * 60 * 1000);

// ================== پیام‌ها (چت روز، نایت‌چت، کوپن، پاک‌سازی) ==================

function findRoomForUser(userId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.userId === userId)) return room;
  }
  return null;
}

function formatChatLine(user, text) {
  const player = players.get(user.id);
  const league = player ? leagueLabel(player.leagueId) : 'بدون لیگ';
  const room = findRoomForUser(user.id);
  let name = user.username || `کاربر ${user.id}`;
  if (room) {
    const rp = room.players.find(p => p.userId === user.id);
    if (rp) name = formatPlayerNameWithStatus(rp);
  }
  return `💬 ${name} (${league}): ${text}`;
}

bot.onText(/\/start(?:@[\w_]+)?/, msg => {
  const player = ensurePlayer(msg.from);
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `سلام ${player.nickname || player.username || 'دوست مافیایی'} 💖\n` +
    'به بازی آنلاین مافیا خوش آمدی.\nاز منوی زیر یکی را انتخاب کن:',
    inlineMainMenu()
  );
  bot.deleteMessage(chatId, msg.message_id).catch(() => {});
});

bot.onText(/\/profile(?:@[\w_]+)?/, msg => {
  handleProfile(msg);
  bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
});

bot.onText(/\/scores(?:@[\w_]+)?/, msg => {
  handleScores(msg);
  bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
});

bot.onText(/\/help(?:@[\w_]+)?/, msg => {
  handleHelp(msg);
  bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
});

// پیام‌های معمولی

bot.on('message', msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!msg.text || msg.text.startsWith('/')) return;

  if (tryRedeemCoupon(msg)) {
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    return;
  }

  if (isBlocked(userId)) {
    bot.sendMessage(chatId, '🚫 حساب شما مسدود است.');
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    return;
  }

  const room = findRoomForUser(userId);
  if (!room) return;

  if (room.phase === 'NIGHT') {
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    bot.sendMessage(chatId, '🌙 الان فاز شب است؛ نمی‌توانی صحبت کنی.').catch(() => {});
    return;
  }

  const formatted = formatChatLine(msg.from, msg.text);
  bot.deleteMessage(chatId, msg.message_id).catch(() => {});
  bot.sendMessage(chatId, formatted).catch(() => {});
});

// ================== صف بازی ==================

function joinQueue(userId) {
  const room = autoSelectRoom();
  if (!room.waiting.includes(userId)) {
    room.waiting.push(userId);
  }
  ensurePlayer({ id: userId });
  bot.sendMessage(
    userId,
    `🕹 به صف بازی آنلاین در اتاق ${room.id} اضافه شدی.\n` +
    `تعداد در صف: ${room.waiting.length}/${MIN_PLAYERS}`
  ).catch(() => {});
  startGameIfReady(room);
}

// ================== کال‌بک‌ها ==================

bot.on('callback_query', query => {
  const data = query.data || '';
  const userId = query.from.id;

  if (data.startsWith('MENU:')) {
    const action = data.split(':')[1];
    if (action === 'START_RANKED') {
      joinQueue(userId);
    } else if (action === 'PROFILE') {
      handleProfile({ chat: { id: userId }, from: query.from });
    } else if (action === 'SCORES') {
      handleScores({ chat: { id: userId } });
    } else if (action === 'HELP') {
      handleHelp({ chat: { id: userId } });
    } else if (action === 'ROLE_STORE') {
      bot.sendMessage(userId, '🛒 فروشگاه نقش:\n\n' + roleStoreText(), roleStoreKeyboard());
    } else if (action === 'MAGIC_STORE') {
      bot.sendMessage(userId, '🔮 فروشگاه جادو:\n\n' + magicStoreText(), magicStoreKeyboard());
    }
    bot.answerCallbackQuery(query.id).catch(() => {});
    return;
  }

  if (data.startsWith('BUY_ROLE:')) {
    const id = data.split(':')[1];
    const player = ensurePlayer(query.from);
    const item = SPECIAL_ROLES.find(r => r.id === id);
    if (!item) return bot.answerCallbackQuery(query.id, { text: 'نقش یافت نشد.' }).catch(() => {});
    if (player.coins < item.price) {
      return bot.answerCallbackQuery(query.id, { text: 'سکه‌های شما کافی نیست.' }).catch(() => {});
    }
    player.coins -= item.price;
    player.preferredRoles.add(id);
    bot.answerCallbackQuery(query.id, { text: 'نقش ترجیحی خریداری شد.' }).catch(() => {});
    bot.sendMessage(
      userId,
      `✅ نقش ترجیحی "${item.name}" برای شما فعال شد.\nسکه‌های باقی‌مانده: ${player.coins}`
    ).catch(() => {});
    return;
  }

  if (data.startsWith('BUY_MAGIC:')) {
    const id = data.split(':')[1];
    const player = ensurePlayer(query.from);
    const item = MAGIC_SPELLS.find(m => m.id === id);
    if (!item) return bot.answerCallbackQuery(query.id, { text: 'جادو یافت نشد.' }).catch(() => {});
    if (player.coins < item.price) {
      return bot.answerCallbackQuery(query.id, { text: 'سکه‌های شما کافی نیست.' }).catch(() => {});
    }
    player.coins -= item.price;
    player.magics.add(id);
    bot.answerCallbackQuery(query.id, { text: 'جادو خریداری شد.' }).catch(() => {});
    bot.sendMessage(
      userId,
      `✅ "${item.name}" برای شما فعال شد.\nسکه‌های باقی‌مانده: ${player.coins}`
    ).catch(() => {});
    return;
  }

  if (data.startsWith('VOTE:')) {
    const parts = data.split(':');
    const roomId = parts[1];
    const targetId = Number(parts[2]);
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'DAY_VOTE') {
      return bot.answerCallbackQuery(query.id, { text: 'الان فاز رأی‌گیری فعال نیست.' }).catch(() => {});
    }
    room.votes.set(userId, targetId);

    const required = room.court.requiredVotes || computeRequiredVotes(room);
    const countForTarget = Array.from(room.votes.values()).filter(v => v === targetId).length;
    if (countForTarget >= required) {
      bot.answerCallbackQuery(query.id, { text: 'رأی شما ثبت شد؛ حد نصاب پر شد!' }).catch(() => {});
      goToCourt(room, targetId);
      return;
    }

    bot.answerCallbackQuery(query.id, { text: 'رأی شما ثبت شد.' }).catch(() => {});
    return;
  }

  if (data.startsWith('ACT_')) {
    const parts = data.split(':');
    const kind = parts[0];
    const roomId = parts[1];
    const targetId = Number(parts[2]);
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'NIGHT') {
      return bot.answerCallbackQuery(query.id, { text: 'الان فاز شب نیست.' }).catch(() => {});
    }

    const actor = room.players.find(p => p.userId === userId);
    if (!actor || !actor.alive) {
      return bot.answerCallbackQuery(query.id, { text: 'این اکشن برای شما فعال نیست.' }).catch(() => {});
    }

    room.actions = room.actions || {
      kills: [],
      serialKills: [],
      saves: [],
      jails: [],
      judgeDecisions: []
    };

    if (kind === 'ACT_KILL') {
      room.actions.kills.push(targetId);
      actor.stats.killsDone += 1;
      actor.stats.nightActions += 1;
      bot.answerCallbackQuery(query.id, { text: 'شلیک ثبت شد.' }).catch(() => {});
      return;
    }

    if (kind === 'ACT_SKILL') {
      room.actions.serialKills.push(targetId);
      actor.stats.killsDone += 1;
      actor.stats.nightActions += 1;
      bot.answerCallbackQuery(query.id, { text: 'قتل سریالی ثبت شد.' }).catch(() => {});
      return;
    }

    if (kind === 'ACT_SEER') {
      const target = room.players.find(p => p.userId === targetId);
      if (!target) {
        return bot.answerCallbackQuery(query.id, { text: 'هدف یافت نشد.' }).catch(() => {});
      }
      const team = roleTeam(target.role);
      let desc = 'تقریباً بی‌خطر (شهروندی)';
      if (team === 'MAFIA') desc = 'مشکوک (مافیا)';
      else if (team === 'INDEPENDENT') desc = 'بسیار خطرناک (مستقل)';

      actor.stats.investigations += 1;
      actor.stats.nightActions += 1;

      bot.answerCallbackQuery(query.id, { text: 'استعلام ثبت شد.' }).catch(() => {});
      bot.sendMessage(
        userId,
        `👁️ نتیجه‌ی استعلام:\nنام: ${target.nickname}\nنقش: ${roleLabel(target.role)}\nتیم: ${desc}`
      ).catch(() => {});
      return;
    }

    if (kind === 'ACT_JAIL') {
      room.actions.jails.push({ actorId: userId, targetId });
      actor.stats.nightActions += 1;

      const kb = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⚖️ محکوم شود', callback_data: `JUDGE:${room.id}:${targetId}:YES` },
              { text: '🕊 بخشیده شود', callback_data: `JUDGE:${room.id}:${targetId}:NO` }
            ]
          ]
        }
      };

      const target = room.players.find(p => p.userId === targetId);
      bot.answerCallbackQuery(query.id, { text: 'بازداشت ثبت شد؛ حالا قضاوت کن.' }).catch(() => {});
      bot.sendMessage(
        userId,
        `🧷 ${target ? target.nickname : targetId} بازداشت شد.\n` +
        'تصمیم بگیر: محکوم شود یا بخشیده؟',
        kb
      ).catch(() => {});
      return;
    }

    bot.answerCallbackQuery(query.id).catch(() => {});
    return;
  }

  if (data.startsWith('JUDGE:')) {
    const parts = data.split(':');
    const roomId = parts[1];
    const targetId = Number(parts[2]);
    const decision = parts[3] === 'YES';
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'NIGHT') {
      return bot.answerCallbackQuery(query.id, { text: 'زمان قضاوت تمام شده است.' }).catch(() => {});
    }

    room.actions.judgeDecisions.push({
      actorId: userId,
      targetId,
      condemn: decision
    });

    bot.answerCallbackQuery(query.id, { text: decision ? 'محکوم شد.' : 'بخشیده شد.' }).catch(() => {});
    return;
  }

  bot.answerCallbackQuery(query.id).catch(() => {});
});

console.log('🌸 Puffy Mafia bot started with leagues, formatted chat, bans, and night mute...');

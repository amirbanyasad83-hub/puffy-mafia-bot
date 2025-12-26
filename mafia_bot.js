/* --- Fake Web Server for Render (Web Service) --- */
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
}).listen(process.env.PORT || 3000);
/* ------------------------------------------------ */

const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

if (!BOT_TOKEN || !OWNER_ID) {
  console.error("BOT_TOKEN or OWNER_ID is missing.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* --- Data structures --- */

const players = {};          
const rooms = {};            
const playerRoom = {};       
const pendingTransfers = {}; 
const bans = {};             
const awaitingName = new Set();
const reports = [];          

const PHASE_CONFIG = {
  DAY_TALK: 45,
  VOTING: 40,
  NIGHT: 40,
  DEFENSE: 15,
  FINAL_VOTE: 15
};

const MIN_PLAYERS = 6;

/* --- Roles --- */

const ROLE_KEYS = {
  BRUTAL_BUNNY: "brutal_bunny",
  PINK_WOLF: "pink_wolf",
  SHADOW_KING: "shadow_king",
  BANDAGE_ANGEL: "bandage_angel",
  RED_EYE: "red_eye",
  CHAOS_JESTER: "chaos_jester",
  STRONG_MAFIA: "strong_mafia",
  MIST_GUARD: "mist_guard",
  SEER: "seer",
  DRAGON_SOLO: "dragon_solo"
};

const ROLES = {
  [ROLE_KEYS.BRUTAL_BUNNY]: {
    name: "🐰 خرگوش خشن",
    team: "شهر",
    desc: "شهروند تهاجمی."
  },
  [ROLE_KEYS.PINK_WOLF]: {
    name: "🐺 گرگ صورتی",
    team: "مافیا",
    desc: "مافیای کلاسیک."
  },
  [ROLE_KEYS.SHADOW_KING]: {
    name: "👑 پادشاه سایه‌ها",
    team: "مافیا",
    desc: "گادفادر."
  },
  [ROLE_KEYS.BANDAGE_ANGEL]: {
    name: "😇 فرشته پانسمان",
    team: "شهر",
    desc: "دکتر."
  },
  [ROLE_KEYS.RED_EYE]: {
    name: "👁 چشم‌قرمز",
    team: "شهر",
    desc: "کارآگاه."
  },
  [ROLE_KEYS.CHAOS_JESTER]: {
    name: "🤡 دلقک خون‌آشوب",
    team: "مستقل",
    desc: "با اعدام برنده می‌شود."
  },
  [ROLE_KEYS.STRONG_MAFIA]: {
    name: "🔪 سایه‌زن",
    team: "مافیا",
    desc: "مافیای قوی."
  },
  [ROLE_KEYS.MIST_GUARD]: {
    name: "🌫 بادیگارد مه‌آلود",
    team: "شهر",
    desc: "محافظ."
  },
  [ROLE_KEYS.SEER]: {
    name: "🔮 پیشگو",
    team: "شهر",
    desc: "استعلام ویژه."
  },
  [ROLE_KEYS.DRAGON_SOLO]: {
    name: "🐉 اژدهای تنها",
    team: "مستقل",
    desc: "قاتل مستقل."
  }
};

/* --- Spells (فقط دو جادو) --- */

const SPELLS = [
  {
    key: "evil_eye",
    name: "🧿 چشم‌زخم",
    price: 4,
    desc: "یک شب از دید مافیا نامرئی می‌شوی."
  },
  {
    key: "vanish",
    name: "🌫 نامرئی روز",
    price: 4,
    desc: "یک روز از پنل رأی حذف می‌شوی."
  }
];

/* --- Helpers --- */

function ensurePlayer(user) {
  const id = user.id.toString();
  if (!players[id]) {
    players[id] = {
      id,
      nickname: null,
      coins: 100,
      dailyPoints: 0,
      weeklyPoints: 0,
      totalPoints: 0,
      league: "🌱 نوب پوفی",
      energy: 0
    };
  }
  return players[id];
}

function calcLeague(totalPoints) {
  if (totalPoints >= 1000) return "💫 افسانه‌ی مهتابی";
  if (totalPoints >= 600) return "💎 گرگ کریستالی";
  if (totalPoints >= 300) return "🌟 قهرمان طلایی";
  if (totalPoints >= 150) return "✨ شبح نقره‌ای";
  if (totalPoints >= 50)  return "🍭 خرگوش آب‌نباتی";
  return "🌱 نوب پوفی";
}

function updateLeague(userId) {
  const p = players[userId];
  if (!p) return;
  p.league = calcLeague(p.totalPoints);
}

function isBanned(userId) {
  const info = bans[userId];
  if (!info) return false;
  if (info.type === "perm") return true;
  if (Date.now() > info.until) {
    delete bans[userId];
    return false;
  }
  return true;
}

function applyBan(userId, type) {
  let ms = 0;
  switch (type) {
    case "daily":  ms = 86400000; break;
    case "weekly": ms = 604800000; break;
    case "monthly":ms = 2592000000; break;
    case "yearly": ms = 31536000000; break;
    case "perm":  ms = 0; break;
  }
  if (type === "perm") bans[userId] = { type: "perm", until: null };
  else bans[userId] = { type, until: Date.now() + ms };
}

function unban(userId) {
  delete bans[userId];
}

async function isAdminOrOwner(chatId, userId) {
  if (userId.toString() === OWNER_ID.toString()) return true;
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

function guardCommand(handler) {
  return async (msg, match) => {
    if (!msg.from) return;
    const userId = msg.from.id.toString();
    ensurePlayer(msg.from);
    if (isBanned(userId)) {
      return bot.sendMessage(msg.chat.id, "⛔ شما محروم هستید.");
    }
    return handler(msg, match);
  };
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function getRoomIdByChat(chatId) {
  const id = "room_" + chatId;
  return rooms[id] ? id : null;
}

/* --- Nickname + in-game chat middleware --- */

bot.on('message', (msg) => {
  if (!msg.from  !msg.chat  !msg.text) return;

  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const text = msg.text;

  ensurePlayer(msg.from);

  if (awaitingName.has(userId) && !text.startsWith('/')) {
    let name = text.trim();
    if (name.length < 2 || name.length > 20) {
      return bot.sendMessage(chatId, "❗ اسم باید ۲ تا ۲۰ کاراکتر باشد.");
    }
    players[userId].nickname = name;
    awaitingName.delete(userId);
    return bot.sendMessage(chatId, ✅ اسم شما ثبت شد: *${name}*, { parse_mode: "Markdown" });
  }

  if (!text.startsWith('/')) {
    const roomId = getRoomIdByChat(chatId);
    if (roomId) {
      const room = rooms[roomId];
      if (room.status === "in_game" && room.alive[userId]) {
        const p = players[userId];
        const pretty = 🎗 ${p.nickname} (${p.league}) : ${text};
        return bot.sendMessage(chatId, pretty);
      }
    }
  }
});

/* --- /start /play --- */

const handleStartOrPlay = guardCommand((msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const player = ensurePlayer(msg.from);

  if (!player.nickname) {
    awaitingName.add(userId);
    return bot.sendMessage(chatId, "🎮 خوش اومدی! یک اسم برای بازی بفرست.");
  }

  bot.sendMessage(chatId, 👋 سلام *${player.nickname}*!\nبرای ورود لابی: /join, {
    parse_mode: "Markdown"
  });
});

bot.onText(/\/start/, handleStartOrPlay);
bot.onText(/\/play/, handleStartOrPlay);

/* --- Help --- */

bot.onText(/\/help/, guardCommand((msg) => {
  const chatId = msg.chat.id;
  const txt = 
🕹 *Puffy Mafia – راهنما*

🎭 نقش‌ها: /roles  
🛒 فروشگاه: /shop  
👤 پروفایل: /profile  
👥 ورود لابی: /join  

🧿 جادوها:
/evileye — چشم‌زخم  
/vanish — نامرئی روز  

💬 چت داخل بازی:
فقط بنویس؛ ربات با اسم و لیگت نمایش می‌دهد.
;
  bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}));/* --- Roles list --- */

bot.onText(/\/roles/, guardCommand((msg) => {
  const chatId = msg.chat.id;
  let txt = "🎭 *نقش‌های فعلی بازی:*\n\n";
  Object.values(ROLES).forEach(r => {
    txt += ${r.name}\n🕯 تیم: ${r.team}\n📜 ${r.desc}\n\n;
  });
  bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}));

/* --- Shop (دو جادو) --- */

bot.onText(/\/shop/, guardCommand((msg) => {
  const chatId = msg.chat.id;
  let txt = "🛒 *فروشگاه جادوها:*\n\n";
  SPELLS.forEach(s => {
    txt += ${s.name}\n💰 قیمت: ${s.price} سکه\n📜 ${s.desc}\n\n;
  });
  txt += "برای استفاده:\n🧿 /evileye\n🌫 /vanish";
  bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}));

/* --- Profile --- */

bot.onText(/\/profile/, guardCommand((msg) => {
  const chatId = msg.chat.id;
  const p = ensurePlayer(msg.from);
  updateLeague(p.id);

  const txt = 
👤 *پروفایل شما:*

🧸 اسم: *${p.nickname || "ثبت نشده"}*
💰 سکه‌ها: *${p.coins}*
⚡ انرژی لیگ: *${p.energy}*

🏅 روزانه: *${p.dailyPoints}*
🏆 هفتگی: *${p.weeklyPoints}*
🌟 کل: *${p.totalPoints}*

🎖 لیگ: *${p.league}*
;
  bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
}));

/* --- Join Lobby --- */

bot.onText(/\/join/, guardCommand((msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const p = ensurePlayer(msg.from);

  if (!p.nickname) {
    awaitingName.add(userId);
    return bot.sendMessage(chatId, "❗ اول یک اسم انتخاب کن.");
  }

  const roomId = "room_" + chatId;
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: [],
      status: "waiting",
      phase: null,
      timer: null,
      phaseEndsAt: null,
      chatId,
      alive: {},
      roles: {},
      votes: {},
      finalVotes: {},
      defenseTarget: null,
      nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null },
      lastEvents: [],
      gamePoints: {},
      effects: { nightShield: {}, hideFromVote: {} }
    };
  }

  const room = rooms[roomId];

  if (room.status !== "waiting") {
    return bot.sendMessage(chatId, "⏳ بازی در حال اجراست.");
  }

  if (!room.players.includes(userId)) {
    room.players.push(userId);
    playerRoom[userId] = roomId;
    room.alive[userId] = true;
  }

  let listTxt = room.players.map((pid, i) => ${i + 1}. ${players[pid].nickname}).join("\n");

  bot.sendMessage(chatId, 👥 بازیکنان لابی:\n${listTxt});

  if (room.players.length >= MIN_PLAYERS) {
    autoStartGame(roomId);
  }
}));

/* --- Lobby Chat --- */

bot.onText(/\/lobby (.+)/, guardCommand((msg, match) => {
  const userId = msg.from.id.toString();
  const roomId = playerRoom[userId];
  const chatId = msg.chat.id;

  if (!roomId || rooms[roomId].status !== "waiting") {
    return bot.sendMessage(chatId, "❗ شما در لابی نیستید.");
  }

  const p = players[userId];
  bot.sendMessage(chatId, 🎗 ${p.nickname} (لابی): ${match[1]});
}));

/* --- Assign Roles --- */

function assignRolesForRoom(room) {
  const count = room.players.length;

  const scenario6 = [
    ROLE_KEYS.PINK_WOLF,
    ROLE_KEYS.SHADOW_KING,
    ROLE_KEYS.BANDAGE_ANGEL,
    ROLE_KEYS.RED_EYE,
    ROLE_KEYS.BRUTAL_BUNNY,
    ROLE_KEYS.CHAOS_JESTER
  ];

  const scenario12 = [
    ROLE_KEYS.SHADOW_KING, ROLE_KEYS.PINK_WOLF, ROLE_KEYS.PINK_WOLF, ROLE_KEYS.STRONG_MAFIA,
    ROLE_KEYS.BANDAGE_ANGEL, ROLE_KEYS.RED_EYE, ROLE_KEYS.MIST_GUARD, ROLE_KEYS.BRUTAL_BUNNY,
    ROLE_KEYS.BRUTAL_BUNNY, ROLE_KEYS.SEER, ROLE_KEYS.CHAOS_JESTER, ROLE_KEYS.DRAGON_SOLO
  ];

  let pool = [];
  if (count === 6) pool = scenario6.slice();
  else if (count === 12) pool = scenario12.slice();
  else if (count < 12) pool = scenario6.slice(0, count);
  else pool = scenario12.concat(Array(count - 12).fill(ROLE_KEYS.BRUTAL_BUNNY));

  room.gamePoints = {};

  room.players.forEach((pid, i) => {
    room.roles[pid] = pool[i];
    room.alive[pid] = true;
    room.gamePoints[pid] = 0;

    const r = ROLES[room.roles[pid]];
    bot.sendMessage(pid, 🎭 نقش شما:\n${r.name}\n🕯 تیم: ${r.team}\n📜 ${r.desc});
  });
}

/* --- Auto Start Game --- */

function autoStartGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.status = "in_game";
  room.votes = {};
  room.finalVotes = {};
  room.defenseTarget = null;
  room.nightActions = { mafiaTarget: null, doctorTarget: null, detectiveTarget: null };
  room.lastEvents = [];
  room.gamePoints = {};
  room.effects.nightShield = {};
  room.effects.hideFromVote = {};

  assignRolesForRoom(room);

  bot.sendMessage(room.chatId, "🎮 بازی شروع شد! فاز روز صحبت.");
  startPhase(roomId, "DAY_TALK", PHASE_CONFIG.DAY_TALK, "☀ ۴۵ ثانیه برای صحبت.");
}

/* --- Start Phase --- */

function startPhase(roomId, phaseName, durationSec, announceText) {
  const room = rooms[roomId];
  if (!room) return;

  clearRoomTimer(room);

  room.phase = phaseName;
  room.phaseEndsAt = Date.now() + durationSec * 1000;

  bot.sendMessage(room.chatId, announceText);

  if (phaseName === "NIGHT") sendNightPanels(roomId);
  if (phaseName === "DAY_TALK") room.effects.hideFromVote = {};

  room.timer = setInterval(() => {
    if (Date.now() >= room.phaseEndsAt) {
      clearRoomTimer(room);
      handlePhaseEnd(roomId, phaseName);
    }
  }, 1000);
}

/* --- Handle Phase End --- */

function handlePhaseEnd(roomId, phaseName) {
  const room = rooms[roomId];
  if (!room || room.status !== "in_game") return;

  switch (phaseName) {
    case "DAY_TALK":
      room.votes = {};
      bot.sendMessage(room.chatId, "🗳 رأی‌گیری شروع شد.");
      sendVotingPanel(roomId);
      startPhase(roomId, "VOTING", PHASE_CONFIG.VOTING, "۴۰ ثانیه رأی‌گیری.");
      break;

    case "VOTING":
      resolveVoting(roomId);
      break;

    case "DEFENSE":
      bot.sendMessage(room.chatId, "⚖ رأی نهایی شروع شد.");
      sendFinalVotePanel(roomId);
      startPhase(roomId, "FINAL_VOTE", PHASE_CONFIG.FINAL_VOTE, "۱۵ ثانیه رأی نهایی.");
      break;

    case "FINAL_VOTE":
      resolveFinalVote(roomId);
      break;

    case "NIGHT":
      resolveNight(roomId);
      break;
  }
}

/* --- Voting Panel --- */

function sendVotingPanel(roomId) {
  const room = rooms[roomId];
  const alive = room.alive;
  const hide = room.effects.hideFromVote;

  let text = "🗳 انتخاب بازیکن برای دفاع:\n\n";
  const buttons = [];
  let row = [];

  room.players.forEach(pid => {
    if (!alive[pid]) return;
    if (hide[pid]) return;
    const name = players[pid].nickname;
    text += • ${name}\n;
    row.push({ text: name, callback_data: VOTE_MAIN:${roomId}:${pid} });
    if (row.length === 2) {
      buttons.push(row);
      row = [];
    }
  });

  if (row.length) buttons.push(row);

  bot.sendMessage(room.chatId, text, {
    reply_markup: { inline_keyboard: buttons }
  });
}

/* --- Final Vote Panel --- */

function sendFinalVotePanel(roomId) {
  const room = rooms[roomId];
  const targetId = room.defenseTarget;
  if (!targetId) return;

  const name = players[targetId].nickname;

  bot.sendMessage(room.chatId, ⚖ رأی نهایی برای *${name}*, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔴 گناهکار", callback_data: VOTE_FINAL:GUILTY:${roomId}:${targetId} },
          { text: "🟢 بی‌گناه", callback_data: VOTE_FINAL:INNOCENT:${roomId}:${targetId} }
        ]
      ]
    }
  });
}

/* --- Resolve Voting --- */

function resolveVoting(roomId) {
  const room = rooms[roomId];
  const alive = room.alive;
  const votes = room.votes;

  const tally = {};

  for (const voter in votes) {
    const target = votes[voter].targetId;
    if (!alive[target]) continue;
    tally[target] = (tally[target] || 0) + 1;
  }

  let best = null;
  let max = 0;

  for (const t in tally) {
    if (tally[t] > max) {
      max = tally[t];
      best = t;
    }
  }

  if (!best) {
    bot.sendMessage(room.chatId, "🔄 رأی مشخصی نبود. شب شروع شد.");
    startPhase(roomId, "NIGHT", PHASE_CONFIG.NIGHT, "🌙 ۴۰ ثانیه شب.");
    return;
  }

  room.defenseTarget = best;
  const name = players[best].nickname;

  bot.sendMessage(room.chatId, 🛡 *${name}* برای دفاع می‌آید., { parse_mode: "Markdown" });

  startPhase(roomId, "DEFENSE", PHASE_CONFIG.DEFENSE, "۱۵ ثانیه دفاع.");
}

/* --- Resolve Final Vote --- */

function resolveFinalVote(roomId) {
  const room = rooms[roomId];
  const alive = room.alive;
  const votes = room.finalVotes;
  const targetId = room.defenseTarget;

  let guilty = 0, innocent = 0;

  for (const voter in votes) {
    if (!alive[voter]) continue;
    if (votes[voter] === "GUILTY") guilty++;
    else innocent++;
  }

  const name = players[targetId].nickname;
  const roleKey = room.roles[targetId];
  const roleObj = ROLES[roleKey];

  if (guilty > innocent && guilty > 0) {
    room.alive[targetId] = false;
    bot.sendMessage(room.chatId, ⚰️ *${name}* اعدام شد.\nنقش: ${roleObj.name}, { parse_mode: "Markdown" });

    if (roleKey === ROLE_KEYS.CHAOS_JESTER) {
      endGame(roomId, "🤡 دلقک با اعدامش برنده شد!");
      return;
    }

    for (const voter in votes) {
      if (votes[voter] === "GUILTY") {
        room.gamePoints[voter] = (room.gamePoints[voter] || 0) + 1;
      }
    }

    if (checkWinConditions(roomId)) return;

  } else {
    bot.sendMessage(room.chatId, 🙏 *${name}* اعدام نشد., { parse_mode: "Markdown" });
  }

  room.votes = {};
  room.finalVotes = {};
  room.defenseTarget = null;

  startPhase(roomId, "NIGHT", PHASE_CONFIG.NIGHT, "🌙 ۴۰ ثانیه شب.");
}

/* --- Night Panels --- */

function sendNightPanels(roomId) {
  const room = rooms[roomId];
  const alive = room.alive;
  const roles = room.roles;

  room.players.forEach(uid => {
    if (!alive[uid]) return;

    const role = roles[uid];

    if (ROLES[role].team === "مافیا") {
      sendNightTargetPanel(uid, roomId, "KILL");
    }
    if (role === ROLE_KEYS.BANDAGE_ANGEL) {
      sendNightTargetPanel(uid, roomId, "HEAL");
    }
    if (role === ROLE_KEYS.RED_EYE) {
      sendNightTargetPanel(uid, roomId, "INSPECT");
    }
  });
}

function sendNightTargetPanel(actorId, roomId, actionType) {
  const room = rooms[roomId];
  const alive = room.alive;

  let title = "";
  if (actionType === "KILL") title = "🎯 انتخاب هدف مافیا";
  if (actionType === "HEAL") title = "💉 انتخاب هدف نجات";
  if (actionType === "INSPECT") title = "🔍 انتخاب هدف استعلام";

  let text = ${title}\n\nیک بازیکن را انتخاب کن:;
  const buttons = [];
  let row = [];

  room.players.forEach(pid => {
    if (!alive[pid]) return;
    const name = players[pid].nickname;
    row.push({
      text: name,
      callback_data: NIGHT:${actionType}:${roomId}:${actorId}:${pid}
    });
    if (row.length === 2) {
      buttons.push(row);
      row = [];
    }
  });

  if (row.length) buttons.push(row);

  bot.sendMessage(actorId, text, {
    reply_markup: { inline_keyboard: buttons }
  });
}/* --- Resolve Night --- */

function resolveNight(roomId) {
  const room = rooms[roomId];
  const alive = room.alive;
  const roles = room.roles;
  const shield = room.effects.nightShield;
  const { mafiaTarget, doctorTarget } = room.nightActions;

  let killed = null;

  if (mafiaTarget && alive[mafiaTarget]) {
    if (shield[mafiaTarget]) {
      room.lastEvents.push(`🧿 ${players[mafiaTarget].nickname} چشم‌زخم داشت و از دید مافیا پنهان شد.`);
      shield[mafiaTarget] = false;
    } else {
      const saved = doctorTarget === mafiaTarget;
      if (saved) {
        room.lastEvents.push(`💊 ${players[mafiaTarget].nickname} توسط دکتر نجات یافت.`);
        for (const uid in roles) {
          if (alive[uid] && roles[uid] === ROLE_KEYS.BANDAGE_ANGEL) {
            room.gamePoints[uid] = (room.gamePoints[uid] || 0) + 2;
          }
        }
      } else {
        alive[mafiaTarget] = false;
        killed = mafiaTarget;
        room.lastEvents.push(`💀 ${players[mafiaTarget].nickname} در شب کشته شد.`);
        for (const uid in roles) {
          if (alive[uid] && ROLES[roles[uid]].team === "مافیا") {
            room.gamePoints[uid] = (room.gamePoints[uid] || 0) + 1;
          }
        }
      }
    }
  } else {
    room.lastEvents.push("😶 امشب حمله‌ای انجام نشد.");
  }

  room.nightActions = { mafiaTarget: null, doctorTarget: null, detectiveTarget: null };

  let summary = "🌅 نتایج شب:\n\n";
  room.lastEvents.forEach(e => summary += e + "\n");
  room.lastEvents = [];

  bot.sendMessage(room.chatId, summary);

  if (killed) {
    const roleKey = roles[killed];
    const r = ROLES[roleKey];
    bot.sendMessage(room.chatId, `🪦 نقش بازیکن کشته‌شده:\n${r.name} (${r.team})`);
  }

  if (checkWinConditions(roomId)) return;

  room.votes = {};
  room.finalVotes = {};
  room.defenseTarget = null;

  startPhase(roomId, "DAY_TALK", PHASE_CONFIG.DAY_TALK, "☀ روز جدید شروع شد. ۴۵ ثانیه برای صحبت.");
}

/* --- Check Win Conditions --- */

function checkWinConditions(roomId) {
  const room = rooms[roomId];
  const alive = room.alive;
  const roles = room.roles;

  let mafia = 0, town = 0, independents = [];

  for (const uid in alive) {
    if (!alive[uid]) continue;
    const roleKey = roles[uid];
    const team = ROLES[roleKey].team;

    if (team === "مافیا") mafia++;
    else if (team === "شهر") town++;
    else independents.push({ uid, roleKey });
  }

  if (mafia === 0 && town > 0) {
    for (const uid in alive) {
      if (ROLES[roles[uid]].team === "شهر") {
        room.gamePoints[uid] = (room.gamePoints[uid] || 0) + 2;
      }
    }
    endGame(roomId, "🎉 شهر برنده شد!");
    return true;
  }

  if (mafia >= town && mafia > 0) {
    for (const uid in alive) {
      if (ROLES[roles[uid]].team === "مافیا") {
        room.gamePoints[uid] = (room.gamePoints[uid] || 0) + 2;
      }
    }
    endGame(roomId, "🩸 مافیا پیروز شد!");
    return true;
  }

  if (independents.length === 1 && mafia === 0 && town === 0) {
    const solo = independents[0];
    if (solo.roleKey === ROLE_KEYS.DRAGON_SOLO) {
      room.gamePoints[solo.uid] = (room.gamePoints[solo.uid] || 0) + 3;
      endGame(roomId, `🐉 اژدهای تنها همه را نابود کرد!`);
      return true;
    }
  }

  return false;
}

/* --- End Game --- */

function endGame(roomId, reason) {
  const room = rooms[roomId];
  if (!room) return;

  clearRoomTimer(room);

  let mvpId = null;
  let best = -999;

  for (const uid in room.gamePoints) {
    if (room.gamePoints[uid] > best) {
      best = room.gamePoints[uid];
      mvpId = uid;
    }
  }

  let mvpText = "";
  if (mvpId) {
    const p = players[mvpId];
    mvpText = `\n\n🏅 MVP: *${p.nickname}* با امتیاز *${best}*`;
    p.totalPoints += best;
    p.coins += 10;
    updateLeague(mvpId);
  }

  room.players.forEach(uid => {
    const p = players[uid];
    const gp = room.gamePoints[uid] || 0;
    p.totalPoints += gp;
    p.dailyPoints += gp;
    p.weeklyPoints += gp;
    updateLeague(uid);
  });

  bot.sendMessage(room.chatId, `🏁 ${reason}${mvpText}\n\nبرای دور جدید /join بزنید.`, {
    parse_mode: "Markdown"
  });

  room.status = "waiting";
  room.phase = null;
  room.phaseEndsAt = null;
  room.votes = {};
  room.finalVotes = {};
  room.defenseTarget = null;
  room.nightActions = { mafiaTarget: null, doctorTarget: null, detectiveTarget: null };
  room.lastEvents = [];
  room.gamePoints = {};
  room.effects.nightShield = {};
  room.effects.hideFromVote = {};

  room.players.forEach(pid => {
    delete playerRoom[pid];
    room.alive[pid] = false;
  });

  room.players = [];
}

/* --- Spells: Evil Eye & Vanish --- */

const SPELL_COST = 4;

bot.onText(/\/evileye/, guardCommand((msg) => {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const p = ensurePlayer(msg.from);
  const roomId = getRoomIdByChat(chatId);

  if (!roomId || rooms[roomId].status !== "in_game") {
    return bot.sendMessage(chatId, "❗ این جادو فقط داخل بازی قابل استفاده است.");
  }

  if (p.coins < SPELL_COST) {
    return bot.sendMessage(chatId, "❌ سکه کافی نداری.");
  }

  rooms[roomId].effects.nightShield[userId] = true;
  p.coins -= SPELL_COST;

  bot.sendMessage(chatId, "🧿 چشم‌زخم فعال شد. یک شب از دید مافیا پنهان هستی.");
}));

bot.onText(/\/vanish/, guardCommand((msg) => {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const p = ensurePlayer(msg.from);
  const roomId = getRoomIdByChat(chatId);

  if (!roomId || rooms[roomId].status !== "in_game") {
    return bot.sendMessage(chatId, "❗ این جادو فقط داخل بازی قابل استفاده است.");
  }

  const room = rooms[roomId];

  if (room.phase !== "DAY_TALK" && room.phase !== "VOTING") {
    return bot.sendMessage(chatId, "❗ این جادو فقط در روز قابل استفاده است.");
  }

  if (p.coins < SPELL_COST) {
    return bot.sendMessage(chatId, "❌ سکه کافی نداری.");
  }

  room.effects.hideFromVote[userId] = true;
  p.coins -= SPELL_COST;

  bot.sendMessage(chatId, "🌫 امروز در پنل رأی دیده نمی‌شوی.");
});

/* --- Autofill Test Rooms (OWNER only) --- */

bot.onText(/\/autofill6/, guardCommand((msg) => {
  const chatId = msg.chat.id;
  if (msg.from.id.toString() !== OWNER_ID.toString()) return;

  const roomId = "test_room_6_" + chatId;

  rooms[roomId] = {
    players: [],
    status: "in_game",
    phase: null,
    timer: null,
    phaseEndsAt: null,
    chatId,
    alive: {},
    roles: {},
    votes: {},
    finalVotes: {},
    defenseTarget: null,
    nightActions: { mafiaTarget: null, doctorTarget: null, detectiveTarget: null },
    lastEvents: [],
    gamePoints: {},
    effects: { nightShield: {}, hideFromVote: {} }
  };

  const fakeNames = ["راموس","کاپیتان","بچه‌مردم","گرگ‌سیاه","پوفی","سایه‌خاکستری"];
  const fakeRoles = [
    ROLE_KEYS.PINK_WOLF,
    ROLE_KEYS.SHADOW_KING,
    ROLE_KEYS.BANDAGE_ANGEL,
    ROLE_KEYS.RED_EYE,
    ROLE_KEYS.BRUTAL_BUNNY,
    ROLE_KEYS.CHAOS_JESTER
  ];

  fakeNames.forEach((name, i) => {
    const fid = `fake6_${i}_${chatId}`;
    players[fid] = {
      id: fid,
      nickname: name,
      coins: 0,
      dailyPoints: 0,
      weeklyPoints: 0,
      totalPoints: 0,
      league: "تست",
      energy: 0
    };
    rooms[roomId].players.push(fid);
    rooms[roomId].alive[fid] = true;
    rooms[roomId].roles[fid] = fakeRoles[i];
    rooms[roomId].gamePoints[fid] = 0;
  });

  bot.sendMessage(chatId, "🧪 اتاق تست ۶ نفره ساخته شد.");
  startPhase(roomId, "DAY_TALK", PHASE_CONFIG.DAY_TALK, "☀ شروع روز.");
}));

/* --- Close Room (OWNER only) --- */

bot.onText(/\/close (.+)/, guardCommand((msg, match) => {
  if (msg.from.id.toString() !== OWNER_ID.toString()) return;

  const roomId = match[1];
  if (!rooms[roomId]) {
    return bot.sendMessage(msg.chat.id, "❌ اتاقی با این نام وجود ندارد.");
  }

  endGame(roomId, "👑 بازی توسط مالک بسته شد.");
}));

/* --- Transfer Coins --- */

const MIN_TRANSFER = 30;

bot.onText(/\/pay (\d+)/, guardCommand((msg, match) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id.toString();
  const amount = parseInt(match[1]);

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "❗ روی پیام فرد ریپلای کن و /pay مقدار را بزن.");
  }

  const toId = msg.reply_to_message.from.id.toString();

  if (fromId === toId) {
    return bot.sendMessage(chatId, "❗ نمی‌توانی به خودت سکه بدهی.");
  }

  if (amount < MIN_TRANSFER) {
    return bot.sendMessage(chatId, `❗ حداقل انتقال ${MIN_TRANSFER} سکه است.`);
  }

  const fromPlayer = ensurePlayer(msg.from);
  const toPlayer = ensurePlayer(msg.reply_to_message.from);

  if (fromPlayer.coins < amount) {
    return bot.sendMessage(chatId, "❌ سکه کافی نداری.");
  }

  pendingTransfers[fromId] = { toId, amount, chatId };

  bot.sendMessage(chatId, `⚠️ آیا مطمئنی می‌خوای ${amount} سکه انتقال بدی؟`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ بله", callback_data: `CONFIRM_PAY:${fromId}` },
          { text: "❌ نه", callback_data: `CANCEL_PAY:${fromId}` }
        ]
      ]
    }
  });
}));

/* --- Report System --- */

bot.onText(/\/report/, guardCommand((msg) => {
  if (!msg.reply_to_message) {
    return bot.sendMessage(msg.chat.id, "❗ روی پیام فرد ریپلای کن.");
  }

  const reporterId = msg.from.id.toString();
  const reportedId = msg.reply_to_message.from.id.toString();
  const chatId = msg.chat.id;
  const messageId = msg.reply_to_message.message_id;

  bot.sendMessage(chatId, "⚠️ گزارش ثبت شود؟", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📨 ثبت گزارش", callback_data: `REPORT_CONFIRM:${reporterId}:${reportedId}:${chatId}:${messageId}` }
        ]
      ]
    }
  });
}));

/* --- Callback Query Handler --- */

bot.on('callback_query', (query) => {
  const data = query.data;
  const fromId = query.from.id.toString();

  /* --- Confirm Pay --- */
  if (data.startsWith("CONFIRM_PAY:")) {
    const ownerId = data.split(":")[1];
    if (fromId !== ownerId) return bot.answerCallbackQuery(query.id, { text: "این برای شما نیست." });

    const pending = pendingTransfers[fromId];
    if (!pending) return bot.answerCallbackQuery(query.id, { text: "انتقالی ثبت نشده." });

    const { toId, amount, chatId } = pending;
    const fromPlayer = players[fromId];
    const toPlayer = players[toId];

    if (!fromPlayer || !toPlayer || fromPlayer.coins < amount) {
      delete pendingTransfers[fromId];
      return bot.answerCallbackQuery(query.id, { text: "انتقال نامعتبر شد." });
    }

    fromPlayer.coins -= amount;
    toPlayer.coins += amount;

    fromPlayer.totalPoints += 1;
    toPlayer.totalPoints += 2;
    updateLeague(fromId);
    updateLeague(toId);

    delete pendingTransfers[fromId];

    bot.answerCallbackQuery(query.id, { text: "انتقال انجام شد." });
    bot.sendMessage(chatId, `💰 انتقال ${amount} سکه انجام شد.`);
    return;
  }

  /* --- Cancel Pay --- */
  if (data.startsWith("CANCEL_PAY:")) {
    const ownerId = data.split(":")[1];
    if (fromId !== ownerId) return;
    delete pendingTransfers[fromId];
    bot.answerCallbackQuery(query.id, { text: "لغو شد." });
    return;
  }

  /* --- Report Confirm --- */
  if (data.startsWith("REPORT_CONFIRM:")) {
    const parts = data.split(":");
    const reporterId = parts[1];
    const reportedId = parts[2];
    const chatId = parts[3];
    const messageId = parts[4];

    reports.push({
      reporterId,
      reportedId,
      chatId,
      messageId,
      time: Date.now()
    });

    bot.answerCallbackQuery(query.id, { text: "گزارش ثبت شد." });
    bot.sendMessage(OWNER_ID, `📨 گزارش جدید:\nReporter: ${reporterId}\nTarget: ${reportedId}`);
    return;
  }

  /* --- Voting --- */
  if (data.startsWith("VOTE_MAIN:")) {
    const parts = data.split(":");
    const roomId = parts[1];
    const targetId = parts[2];
    const room = rooms[roomId];

    if (!room || room.phase !== "VOTING") {
      return bot.answerCallbackQuery(query.id, { text: "الان فاز رأی‌گیری نیست." });
    }

    room.votes[fromId] = { targetId };
    bot.answerCallbackQuery(query.id, { text: "🗳 رأی ثبت شد." });
    return;
  }

  if (data.startsWith("VOTE_FINAL:")) {
    const parts = data.split(":");
    const choice = parts[1];
    const roomId = parts[2];
    const targetId = parts[3];
    const room = rooms[roomId];

    if (!room || room.phase !== "FINAL_VOTE") {
      return bot.answerCallbackQuery(query.id, { text: "الان فاز رأی نهایی نیست." });
    }

    room.finalVotes[fromId] = choice;
    bot.answerCallbackQuery(query.id, { text: "⚖ رأی نهایی ثبت شد." });
    return;
  }

  /* --- Night Actions --- */
  if (data.startsWith("NIGHT:")) {
    const parts = data.split(":");
    const actionType = parts[1];
    const roomId = parts[2];
    const actorId = parts[3];
    const targetId = parts[4];
    const room = rooms[roomId];

    if (!room || room.phase !== "NIGHT") {
      return bot.answerCallbackQuery(query.id, { text: "الان شب نیست." });
    }

    if (fromId !== actorId) {
      return bot.answerCallbackQuery(query.id, { text: "این پنل برای شما نیست." });
    }

    if (!room.alive[targetId]) {
      return bot.answerCallbackQuery(query.id, { text: "هدف زنده نیست." });
    }

    if (actionType === "KILL") {
      room.nightActions.mafiaTarget = targetId;
      bot.answerCallbackQuery(query.id, { text: "🎯 هدف قتل ثبت شد." });
    }

    if (actionType === "HEAL") {
      room.nightActions.doctorTarget = targetId;
      bot.answerCallbackQuery(query.id, { text: "💉 هدف نجات ثبت شد." });
    }

    if (actionType === "INSPECT") {
      room.nightActions.detectiveTarget = targetId;
      const roleKey = room.roles[targetId];
      let team = ROLES[roleKey].team;
      if (roleKey === ROLE_KEYS.SHADOW_KING) team = "شهر";
      bot.answerCallbackQuery(query.id, { text: "🔍 استعلام ثبت شد." });
      bot.sendMessage(actorId, `🔍 نتیجه استعلام: ${players[targetId].

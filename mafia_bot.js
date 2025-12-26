const TelegramBot = require('node-telegram-bot-api');

// ================= تنظیمات =================

// توکن ربات از Environment Variable
const TOKEN = process.env.TOKEN;

// کانال برای جوین اجباری (بدون @)
const FORCE_CHANNEL = process.env.FORCE_CHANNEL || 'Puffy_Landmafia';

// محدودیت‌ها
const MIN_PLAYERS = 6;
const MAX_PLAYERS = 6;

// زمان‌ها (فقط نمایشی)
const DAY_VOTE_SECONDS = 45;
const COURT_DEFENSE_SECONDS = 15;
const COURT_REVOTE_SECONDS = 15;

// راه‌اندازی ربات
const bot = new TelegramBot(TOKEN, { polling: true });

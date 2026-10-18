import { WordToken } from '../types';

// Rich dictionary mapping speech keywords and concepts to animated expressive emojis (Submagic / Opus Clip Style)
export const EMOJI_MAP: Record<string, string> = {
  // Money & Wealth
  money: '💸',
  dollar: '💵',
  dollars: '💵',
  cash: '💰',
  rich: '🤑',
  wealth: '💰',
  profit: '📈',
  revenue: '💸',
  million: '💎',
  millions: '💎',
  billion: '👑',
  billions: '👑',
  cost: '🏷️',
  price: '🏷️',
  expensive: '💎',
  pay: '💳',

  // Virality & Growth
  viral: '🚀',
  growth: '📈',
  grow: '🌱',
  views: '👀',
  scale: '🚀',
  boost: '⚡',
  unlock: '🔓',
  secret: '🤫',
  reach: '🎯',
  success: '🏆',
  win: '🥇',
  winner: '👑',

  // Energy & Emotion
  fire: '🔥',
  lit: '🔥',
  hot: '🔥',
  insane: '🤯',
  crazy: '🤪',
  wow: '😲',
  shocking: '⚡',
  danger: '⚠️',
  warning: '⚠️',
  alert: '🚨',
  stop: '🛑',
  quit: '🛑',
  never: '🙅',

  // Mindset & Tech
  brain: '🧠',
  mind: '💡',
  idea: '💡',
  think: '🤔',
  learn: '📚',
  book: '📖',
  study: '📝',
  ai: '🤖',
  robot: '🤖',
  tech: '💻',
  software: '🖥️',
  code: '💻',
  coding: '💻',
  future: '🔮',

  // Time & Action
  time: '⏳',
  hour: '⏰',
  hours: '⏰',
  minutes: '⏱️',
  fast: '⚡',
  speed: '🏎️',
  wait: '⏳',
  day: '☀️',
  night: '🌙',
  today: '📅',

  // Heart & Social
  love: '❤️',
  heart: '💖',
  dream: '✨',
  passion: '🔥',
  people: '👥',
  watch: '👀',
  look: '👀',
  see: '👁️',
  video: '🎬',
  audio: '🎧',
  music: '🎵',
  sound: '🔊',
  talk: '🗣️',
  speak: '🎙️',
  share: '📲',
  subscribe: '🔔',
  like: '👍',

  // Русский / Russian (keys are lowercase, "ё" is written as "е")
  деньги: '💸', доллар: '💵', доллары: '💵', рубль: '💰', рубли: '💰', рублей: '💰', богатый: '🤑', богатство: '💰',
  прибыль: '📈', доход: '💸', миллион: '💎', миллионы: '💎', миллионов: '💎', миллиард: '👑', миллиарды: '👑',
  цена: '🏷️', стоимость: '🏷️', дорого: '💎', платить: '💳', оплата: '💳',
  вирусный: '🚀', рост: '📈', расти: '🌱', просмотры: '👀', масштаб: '🚀', секрет: '🤫', секреты: '🤫',
  успех: '🏆', победа: '🥇', победитель: '👑',
  огонь: '🔥', жара: '🔥', страсть: '🔥', безумие: '🤯', безумно: '🤯', безумный: '🤯', невероятно: '🤯', вау: '😲',
  шок: '⚡', шокирующий: '⚡', опасность: '⚠️', опасно: '⚠️', внимание: '⚠️', осторожно: '⚠️', тревога: '🚨',
  стоп: '🛑', бросить: '🛑', никогда: '🙅',
  мозг: '🧠', мысль: '💡', идея: '💡', думать: '🤔', учиться: '📚', учить: '📚', книга: '📖', изучать: '📝',
  робот: '🤖', нейросеть: '🤖', технологии: '💻', программа: '🖥️', код: '💻', будущее: '🔮',
  время: '⏳', час: '⏰', часы: '⏰', часов: '⏰', минута: '⏱️', минуты: '⏱️', быстро: '⚡', скорость: '🏎️',
  ждать: '⏳', день: '☀️', ночь: '🌙', сегодня: '📅',
  любовь: '❤️', люблю: '❤️', сердце: '💖', мечта: '✨', люди: '👥', смотри: '👀', смотрите: '👀', смотреть: '👀',
  видео: '🎬', звук: '🔊', музыка: '🎵', говорить: '🗣️', говорю: '🗣️', подписка: '🔔', подписывайся: '🔔',
  подпишись: '🔔', лайк: '👍', делиться: '📲'
};

/**
 * Normalizes a word and returns a matching emoji, or null if none found.
 */
export function getEmojiForWord(rawWord: string): string | null {
  if (!rawWord) return null;
  const clean = rawWord.toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]/g, '');
  if (EMOJI_MAP[clean]) {
    return EMOJI_MAP[clean];
  }
  // Try singular form if ends with 's'
  if (clean.endsWith('s') && clean.length > 3) {
    const singular = clean.slice(0, -1);
    if (EMOJI_MAP[singular]) {
      return EMOJI_MAP[singular];
    }
  }
  return null;
}

/**
 * Finds the first matching emoji from an array of WordTokens in the current active block.
 */
export function getEmojiForWords(words: WordToken[]): string | null {
  if (!words || words.length === 0) return null;
  for (const w of words) {
    const emoji = getEmojiForWord(w.word);
    if (emoji) return emoji;
  }
  return null;
}

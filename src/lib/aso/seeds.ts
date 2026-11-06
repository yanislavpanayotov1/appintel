/**
 * Starting keywords per country, spread over the categories where indie apps
 * earn. Autocomplete expansion grows each into the terms people actually type.
 * Replace or extend them with `npm run keywords -- --seeds "…"` or on /keywords.
 */
const EN = [
  'habit tracker', 'budget', 'meditation', 'sleep', 'calorie counter', 'workout', 'fasting', 'step counter',
  'photo editor', 'video editor', 'ai photo', 'collage', 'scanner', 'pdf', 'notes', 'to do list', 'calendar',
  'language learning', 'flashcards', 'math solver', 'ai chat', 'translator', 'qr code', 'vpn', 'cleaner',
  'wallpaper', 'widget', 'ringtone', 'fonts', 'keyboard', 'plant identifier', 'bird identifier', 'astrology',
  'dating', 'baby tracker', 'period tracker', 'pet', 'recipes', 'golf', 'fishing', 'running', 'yoga',
  'puzzle game', 'word game', 'solitaire', 'sudoku', 'invoice', 'expense tracker', 'stock market',
];

export const DEFAULT_SEEDS: Record<string, string[]> = {
  us: EN,
  gb: EN,
  ca: EN,
  au: EN,
  de: ['gewohnheiten', 'budget', 'meditation', 'schlaf', 'kalorienzähler', 'fitness', 'fasten', 'foto bearbeiten', 'scanner', 'notizen', 'vokabeln', 'rechner', 'übersetzer', 'rätsel'],
  fr: ['habitudes', 'budget', 'méditation', 'sommeil', 'calories', 'musculation', 'jeûne', 'retouche photo', 'scanner', 'notes', 'apprendre anglais', 'traducteur', 'mots croisés'],
  jp: ['習慣', '家計簿', '瞑想', '睡眠', 'カロリー', '筋トレ', '写真加工', 'スキャナー', 'メモ', '英語', '翻訳', 'パズル'],
};

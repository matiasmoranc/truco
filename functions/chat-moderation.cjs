'use strict';
const BLOCKED_TERMS = [
  'boludo', 'boluda', 'pelotudo', 'pelotuda', 'imbecil', 'idiota', 'estupido', 'estupida',
  'tarado', 'tarada', 'forro', 'forra', 'hdp', 'hijo de puta', 'hija de puta',
  'la concha de tu madre', 'concha de tu madre', 'puta madre', 'puto', 'puta', 'mierda',
  'cagon', 'cagona', 'cornudo', 'cornuda', 'mogolico', 'mogolica',
  'fuck', 'fucking', 'motherfucker', 'bitch', 'asshole', 'shit',
  'filho da puta', 'filha da puta', 'arrombado', 'otario', 'otaria'
];
const THREAT_PATTERNS = [
  /\bte voy a matar\b/, /\bte voy a encontrar\b/, /\bte voy a pegar\b/,
  /\bte voy a romper\b/, /\bse donde vivis\b/, /\bsei onde voce mora\b/
];
function normalizeChatText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-UY')
    .replace(/[0]/g, 'o').replace(/[1]/g, 'i').replace(/[3]/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function blockedChatReason(value) {
  const text = normalizeChatText(value);
  if (!text) return null;
  if (THREAT_PATTERNS.some(pattern => pattern.test(text))) return 'threat';
  const tokens = new Set(text.split(' '));
  for (const term of BLOCKED_TERMS) {
    if (term.includes(' ')) {
      if (` ${text} `.includes(` ${term} `)) return 'offensive';
    } else if (tokens.has(term)) return 'offensive';
  }
  return null;
}
module.exports = { normalizeChatText, blockedChatReason };

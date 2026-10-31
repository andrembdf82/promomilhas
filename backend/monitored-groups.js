import { readFileSync } from 'node:fs';

export const groupsFile = new URL('./grupos-monitorados.txt', import.meta.url);

function normalizeName(name) {
  return name.normalize('NFKC')
    .replace(/\s*#\s*(?=\d)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function loadMonitoredGroups(file = groupsFile) {
  try {
    return [...new Set(readFileSync(file, 'utf8').split(/\r?\n/u)
      .map(line => line.trim()).filter(Boolean))];
  } catch (error) {
    throw new Error('Não foi possível ler grupos-monitorados.txt. Confira o arquivo antes de iniciar o bot.', { cause: error });
  }
}

export function createGroupMatcher(names) {
  const patterns = names.map(normalizeName).filter(Boolean).map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    // Preserve substring matching, without confusing numeric group suffixes.
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}${/\d$/u.test(name) ? '(?!\\d)' : ''}`, 'u');
  });
  return chat => chat?.isGroup === true && typeof chat.name === 'string'
    && patterns.some(pattern => pattern.test(normalizeName(chat.name)));
}

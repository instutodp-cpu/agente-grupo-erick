function normalizeText(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toDateOnly(date, timeZone = 'America/Recife') {
  const safeTimeZone = timeZone || 'America/Recife';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseBrazilianDate(text) {
  const match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resolveDailyRevenueDate(question, now = new Date(), timeZone = 'America/Recife') {
  const text = normalizeText(question);
  const explicitDate = parseBrazilianDate(text);
  if (explicitDate) return { date: explicitDate, dateLabel: explicitDate, reason: 'explicit_date' };

  if (text.includes('hoje')) {
    const date = toDateOnly(now, timeZone);
    return { date, dateLabel: date, reason: 'today' };
  }

  if (text.includes('ontem')) {
    const date = addDays(toDateOnly(now, timeZone), -1);
    return { date, dateLabel: date, reason: 'yesterday' };
  }

  return null;
}

function resolveCapability(question, options = {}) {
  const text = normalizeText(question);
  const asksRevenue = text.includes('faturamento') || text.includes('receita') || text.includes('vendas de hoje');
  const asksDaily = text.includes('diario') || text.includes('diaria') || text.includes('hoje') || text.includes('ontem') || /\b\d{1,2}\/\d{1,2}\/20\d{2}\b/.test(text);
  const timeZone = options.timeZone || 'America/Recife';
  const dateMatch = resolveDailyRevenueDate(question, options.now || new Date(), timeZone);

  if (asksRevenue && asksDaily && dateMatch) {
    return {
      matched: true,
      matchType: 'clear',
      capabilityId: 'finance.daily_revenue',
      params: {
        date: dateMatch.date,
        dateLabel: dateMatch.dateLabel,
        dateReason: dateMatch.reason,
        timeZone
      }
    };
  }

  return { matched: false, reason: 'no_clear_capability_match' };
}

module.exports = {
  resolveCapability,
  resolveDailyRevenueDate
};

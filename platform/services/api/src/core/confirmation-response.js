'use strict';

const APPROVED_RESPONSES = new Set([
  'sim',
  'confirmar',
  'confirma',
  'pode executar',
  'aprovado',
  'ok',
  'yes'
]);

const REJECTED_RESPONSES = new Set([
  'nao',
  'cancelar',
  'cancela',
  'rejeitar',
  'rejeitado',
  'nao executar',
  'no'
]);

const DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

function normalizeResponse(message) {
  return message
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function classifyConfirmationResponse(message) {
  if (typeof message !== 'string') return 'unknown';

  const normalized = normalizeResponse(message);
  if (APPROVED_RESPONSES.has(normalized)) return 'approved';
  if (REJECTED_RESPONSES.has(normalized)) return 'rejected';
  return 'unknown';
}

module.exports = { classifyConfirmationResponse };

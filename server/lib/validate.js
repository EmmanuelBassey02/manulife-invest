'use strict';
const { HttpError } = require('./util');

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

/**
 * Validate `input` against `spec` and return a clean object.
 * spec field: { type: 'string'|'text'|'email'|'number'|'int'|'bool'|'enum'|'date'|'array'|'object',
 *               required, min, max, values, label, nullable }
 */
function check(input, spec) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const errors = {};
  for (const [key, rule] of Object.entries(spec)) {
    const label = rule.label || key.replace(/_/g, ' ');
    let v = src[key];
    if (typeof v === 'string' && rule.type !== 'text') v = v.trim();
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (rule.required) errors[key] = `Enter ${label}.`;
      else if (key in src) out[key] = rule.type === 'bool' ? false : null;
      continue;
    }
    switch (rule.type || 'string') {
      case 'string':
      case 'text': {
        v = String(v);
        const max = rule.max || (rule.type === 'text' ? 20000 : 255);
        if (rule.min && v.length < rule.min) errors[key] = `${cap(label)} must be at least ${rule.min} characters.`;
        else if (v.length > max) errors[key] = `${cap(label)} must be ${max} characters or fewer.`;
        else if (rule.pattern && !rule.pattern.test(v)) errors[key] = rule.message || `${cap(label)} is not valid.`;
        else out[key] = v;
        break;
      }
      case 'email':
        v = String(v).toLowerCase();
        if (v.length > 254 || !EMAIL_RE.test(v)) errors[key] = 'Enter a valid email address.';
        else out[key] = v;
        break;
      case 'number':
      case 'int': {
        const n = Number(v);
        if (!Number.isFinite(n) || (rule.type === 'int' && !Number.isInteger(n))) errors[key] = `${cap(label)} must be a number.`;
        else if (rule.min != null && n < rule.min) errors[key] = `${cap(label)} must be at least ${rule.min}.`;
        else if (rule.max != null && n > rule.max) errors[key] = `${cap(label)} must be at most ${rule.max}.`;
        else out[key] = n;
        break;
      }
      case 'bool':
        out[key] = v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
        break;
      case 'enum':
        if (!rule.values.includes(v)) errors[key] = `Choose a valid ${label}.`;
        else out[key] = v;
        break;
      case 'date': {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) errors[key] = `Enter a valid ${label}.`;
        else out[key] = d.toISOString();
        break;
      }
      case 'array':
        if (!Array.isArray(v)) errors[key] = `${cap(label)} must be a list.`;
        else out[key] = v.slice(0, rule.max || 200);
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v)) errors[key] = `${cap(label)} is not valid.`;
        else out[key] = v;
        break;
      default:
        out[key] = v;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Check the highlighted fields.', errors);
  return out;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 128) return 'Use 128 characters or fewer.';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Use a mix of letters and numbers.';
  return null;
}

module.exports = { check, passwordProblem, EMAIL_RE };

'use strict';

// These are provider-reported measurements from one completed HTTP JSON body.
// They do not authenticate its origin, identify a server log task or measure UI time.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const duration = value => typeof value === 'number' && Number.isFinite(value) &&
  value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const label = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 256 && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const sum = (a, b) => count(a) && count(b) && Number.isSafeInteger(a + b);

function referenceCost(body) {
  if (!object(body) || body.object !== 'chat.completion' ||
      !label(body.id) || !label(body.model) || !label(body.system_fingerprint)) return null;
  const u = body.usage, t = body.timings;
  if (!object(u) || !object(t) || !object(u.prompt_tokens_details)) return null;
  const cached = u.prompt_tokens_details.cached_tokens;
  const values = [u.prompt_tokens, u.completion_tokens, u.total_tokens,
    cached, t.cache_n, t.prompt_n, t.predicted_n];
  if (!values.every(count) || !sum(u.prompt_tokens, u.completion_tokens) ||
      !sum(cached, t.prompt_n) ||
      u.total_tokens !== u.prompt_tokens + u.completion_tokens ||
      t.cache_n !== cached || t.prompt_n + cached !== u.prompt_tokens ||
      t.predicted_n !== u.completion_tokens ||
      !duration(t.prompt_ms) || !duration(t.predicted_ms) ||
      !duration(t.prompt_ms + t.predicted_ms)) return null;
  const result = {
    completionId: body.id, model: body.model, systemFingerprint: body.system_fingerprint,
    promptTokens: u.prompt_tokens, promptEvaluatedTokens: t.prompt_n,
    promptCachedTokens: cached, completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens, promptMs: t.prompt_ms,
    generationMs: t.predicted_ms, evaluationMs: t.prompt_ms + t.predicted_ms
  };
  if (t.draft_n !== undefined || t.draft_n_accepted !== undefined) {
    if (!count(t.draft_n) || !count(t.draft_n_accepted) ||
        t.draft_n_accepted > t.draft_n) return null;
    result.draftTokens = t.draft_n;
    result.acceptedDraftTokens = t.draft_n_accepted;
  }
  return result;
}

function ollamaCost(body) {
  if (!object(body) || body.done !== true || !label(body.model) ||
      !label(body.created_at)) return null;
  const counts = [body.prompt_eval_count, body.prompt_eval_cached_count, body.eval_count];
  const times = [body.total_duration, body.load_duration,
    body.prompt_eval_duration, body.eval_duration];
  // Ollama reports integral nanoseconds; do not round unsafe integers into a cost.
  if (!counts.every(count) || !times.every(count) ||
      body.prompt_eval_cached_count > body.prompt_eval_count ||
      !sum(body.prompt_eval_count, body.eval_count)) return null;
  const phases = body.load_duration + body.prompt_eval_duration + body.eval_duration;
  if (!Number.isSafeInteger(phases) || phases > body.total_duration) return null;
  const result = {
    model: body.model, createdAt: body.created_at,
    promptTokens: body.prompt_eval_count,
    promptEvaluatedTokens: body.prompt_eval_count - body.prompt_eval_cached_count,
    promptCachedTokens: body.prompt_eval_cached_count,
    completionTokens: body.eval_count,
    totalTokens: body.prompt_eval_count + body.eval_count,
    promptMs: body.prompt_eval_duration / 1e6,
    generationMs: body.eval_duration / 1e6,
    evaluationMs: (body.prompt_eval_duration + body.eval_duration) / 1e6,
    loadMs: body.load_duration / 1e6,
    totalMs: body.total_duration / 1e6
  };
  if (body.done_reason !== undefined) {
    if (!label(body.done_reason)) return null;
    result.doneReason = body.done_reason;
  }
  return result;
}

function readBriefCost(provider, response) {
  const kind = provider === 'reference' || provider === 'ollama' ? provider : 'unknown';
  const unavailable = {state: 'unavailable', provider: kind};
  try {
    const cost = kind === 'reference' ? referenceCost(response) :
      kind === 'ollama' ? ollamaCost(response) : null;
    return cost ? {state: 'observed', provider: kind, ...cost} : unavailable;
  } catch {
    // Cost is optional: malformed metadata must never reject a valid answer.
    return unavailable;
  }
}

module.exports = {readBriefCost};

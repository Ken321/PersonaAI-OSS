import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import OpenAI from 'openai';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

import { getWorkspace, initWorkspaceStore, updateWorkspace } from './workspaceStore.js';
import {
  FEEDBACK_SYSTEM_PROMPT,
  FEEDBACK_USER_PROMPT,
  INSIGHT_GENERATION_PROMPT,
  MEDIA_FIT_WITH_CONTEXT,
  MEDIA_FIT_WITHOUT_CONTEXT,
  PERSONA_GENERATION_SYSTEM_PROMPT,
  ROLE_INSTRUCTIONS,
  SOURCE_TEXT_ANALYZE_SYSTEM_PROMPT,
} from './promptTemplates.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const distDir = path.resolve(process.cwd(), 'dist');
const DEFAULT_MODEL = 'gpt-5-mini';
const CHAT_MODEL = 'gpt-4o-mini';

app.use(express.json({ limit: '4mb' }));

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function createError(status, detail) {
  const error = new Error(detail);
  error.status = status;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function countStructuredAttributes(value) {
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const item of Object.values(current)) {
      if (!item) continue;
      if (Array.isArray(item)) {
        count += item.filter(Boolean).length;
      } else if (typeof item === 'object') {
        stack.push(item);
      } else {
        count += 1;
      }
    }
  }
  return count;
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {}

  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return fallback;
}

function buildOpenAIClient(req) {
  const apiKey = req.header('X-OpenAI-Api-Key');
  if (!apiKey) {
    throw createError(
      400,
      'OpenAI APIキーが設定されていません。アプリの「設定」タブでAPIキーを登録してください。',
    );
  }
  return new OpenAI({ apiKey });
}

function normalizeProjectSettings(input = {}) {
  return {
    assigned_persona_ids: Array.isArray(input.assigned_persona_ids) ? input.assigned_persona_ids : [],
    segment_settings: input.segment_settings || null,
    article_feedback_state: input.article_feedback_state || null,
    active_persona_id: input.active_persona_id || null,
    media_info: input.media_info || null,
  };
}

function serializePersona(persona) {
  return {
    id: persona.id,
    country: persona.country || null,
    age: persona.age,
    gender: persona.gender,
    city: persona.city,
    prefecture: persona.prefecture,
    occupation: persona.occupation,
    interests: persona.interests,
    region_type: persona.region_type,
    narrative: persona.narrative,
    structured_attributes: persona.structured_attributes || null,
    attribute_count: persona.attribute_count || 0,
    name: persona.name || null,
    display_name: persona.display_name || null,
    one_line_summary: persona.one_line_summary || null,
    info_style: persona.info_style || null,
    ad_attitude: persona.ad_attitude || null,
    generated_by: persona.generated_by || DEFAULT_MODEL,
    generation_cost_usd: persona.generation_cost_usd || null,
    created_at: persona.created_at,
    updated_at: persona.updated_at,
  };
}

function serializePersonaListItem(persona) {
  const item = serializePersona(persona);
  delete item.structured_attributes;
  delete item.attribute_count;
  delete item.generated_by;
  delete item.generation_cost_usd;
  delete item.updated_at;
  return item;
}

function serializeChatPersona(persona) {
  if (!persona) return null;
  return {
    id: persona.id,
    name: persona.name || null,
    display_name: persona.display_name || null,
    age: persona.age,
    gender: persona.gender,
    occupation: persona.occupation,
    narrative: persona.narrative,
    one_line_summary: persona.one_line_summary || null,
  };
}

function serializeChatSessionSummary(session, persona) {
  const lastMessage = session.messages.at(-1) || null;
  return {
    id: session.id,
    persona_id: session.persona_id,
    title: session.title,
    preview: lastMessage?.content || null,
    message_count: session.messages.length,
    last_message_at: lastMessage?.created_at || null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    persona: serializeChatPersona(persona),
  };
}

function serializeChatSession(session, persona) {
  return {
    ...serializeChatSessionSummary(session, persona),
    messages: session.messages.map((message) => ({
      id: message.id,
      sender_type: message.sender_type,
      content: message.content,
      created_at: message.created_at,
    })),
  };
}

function serializeSimulation(simulation) {
  return {
    id: simulation.id,
    article_id: simulation.article_id || null,
    article_category: simulation.article_category || null,
    persona_count: simulation.persona_count,
    completed_feedback_count: simulation.completed_feedback_count || 0,
    status: simulation.status,
    created_at: simulation.created_at,
    completed_at: simulation.completed_at || null,
  };
}

function serializeFeedback(feedback) {
  return {
    id: feedback.id,
    simulation_id: feedback.simulation_id,
    persona_id: feedback.persona_id,
    honest_reaction: feedback.honest_reaction || null,
    what_worked: feedback.what_worked || null,
    what_failed: feedback.what_failed || null,
    media_fit: feedback.media_fit || null,
    title_feedback: feedback.title_feedback || null,
    rewrite_suggestion: feedback.rewrite_suggestion || null,
    score_relevance: feedback.score_relevance ?? null,
    score_credibility: feedback.score_credibility ?? null,
    score_engagement: feedback.score_engagement ?? null,
    score_purchase_intent: feedback.score_purchase_intent ?? null,
    generated_by: feedback.generated_by || null,
    created_at: feedback.created_at,
  };
}

function serializeSummary(summary) {
  return {
    id: summary.id,
    simulation_id: summary.simulation_id,
    overall_scores: summary.overall_scores || null,
    scores_by_role: summary.scores_by_role || null,
    scores_by_age_group: summary.scores_by_age_group || null,
    scores_by_region: summary.scores_by_region || null,
    key_insights: summary.key_insights || null,
    improvement_suggestions: summary.improvement_suggestions || null,
    created_at: summary.created_at,
  };
}

function sampleAge(body) {
  if (Number.isInteger(body.age)) return body.age;
  if (Number.isInteger(body.age_min) && Number.isInteger(body.age_max) && body.age_min <= body.age_max) {
    return body.age_min + Math.floor(Math.random() * (body.age_max - body.age_min + 1));
  }
  const ageRange = body.age_range || '';
  if (ageRange === '18-24') return 18 + Math.floor(Math.random() * 7);
  if (ageRange === '25-34') return 25 + Math.floor(Math.random() * 10);
  if (ageRange === '35-44') return 35 + Math.floor(Math.random() * 10);
  if (ageRange === '45+') return 45 + Math.floor(Math.random() * 25);
  return 20 + Math.floor(Math.random() * 35);
}

async function createJsonCompletion(client, model, messages) {
  const response = await client.chat.completions.create({
    model: model || DEFAULT_MODEL,
    messages,
    response_format: { type: 'json_object' },
  });
  return safeJsonParse(response.choices[0]?.message?.content || '{}', {});
}

async function analyzeSourceText(client, model, sourceText) {
  if (!sourceText || !sourceText.trim()) {
    return {
      age_min: null,
      age_max: null,
      gender: null,
      region_type: null,
      prefectures: [],
      occupations: [],
      extra_segments: [],
    };
  }

  const prompt = `以下のテキストを分析し、想定読者のセグメント情報をJSONで返してください。\n\n【テキスト】\n${sourceText}`;
  const data = await createJsonCompletion(client, model, [
    { role: 'system', content: SOURCE_TEXT_ANALYZE_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ]);

  return {
    age_min: Number.isInteger(data.age_min) ? data.age_min : null,
    age_max: Number.isInteger(data.age_max) ? data.age_max : null,
    gender: typeof data.gender === 'string' ? data.gender : null,
    region_type: typeof data.region_type === 'string' ? data.region_type : null,
    prefectures: Array.isArray(data.prefectures) ? data.prefectures.filter(Boolean) : [],
    occupations: Array.isArray(data.occupations) ? data.occupations.filter(Boolean) : [],
    extra_segments: Array.isArray(data.extra_segments)
      ? data.extra_segments.filter((segment) => segment?.name && segment?.value)
      : [],
  };
}

function mergeGenerationHints(body, analyzed) {
  return {
    age: Number.isInteger(body.age) ? body.age : null,
    age_min: Number.isInteger(body.age_min) ? body.age_min : analyzed.age_min,
    age_max: Number.isInteger(body.age_max) ? body.age_max : analyzed.age_max,
    age_range: body.age_range || null,
    gender: body.gender || analyzed.gender || null,
    region_type: body.region_type || analyzed.region_type || null,
    prefectures: Array.isArray(body.prefectures) && body.prefectures.length > 0
      ? body.prefectures
      : analyzed.prefectures,
    occupations: Array.isArray(body.occupations) && body.occupations.length > 0
      ? body.occupations
      : analyzed.occupations,
    extra_segments: Array.isArray(body.extra_segments) && body.extra_segments.length > 0
      ? body.extra_segments
      : analyzed.extra_segments,
    source_text: body.source_text || '',
    attribute_richness: Number.isInteger(body.attribute_richness) ? body.attribute_richness : 200,
  };
}

function buildPersonaPrompt(hints, index, existingNames) {
  const chosenAge = sampleAge(hints);
  const preferredPrefecture = hints.prefectures?.[index % Math.max(hints.prefectures.length || 1, 1)] || null;
  const preferredOccupation = hints.occupations?.[index % Math.max(hints.occupations.length || 1, 1)] || null;

  return `以下の条件を満たす、日本在住の実在感のある人物ペルソナを1人だけ生成してください。

【制約】
- 返答は必ずJSONオブジェクトのみ
- 名前は他の候補と重複させない
- 日本語で自然な表現を使う
- narrative は一人称で4〜6文程度
- structured_attributes は入れ子オブジェクトで、人物の理解に役立つ情報を十分に含める

【優先条件】
- 想定年齢: ${chosenAge}
- 性別: ${hints.gender || '指定なし'}
- 地域タイプ: ${hints.region_type || '指定なし'}
- 優先都道府県: ${preferredPrefecture || '指定なし'}
- 優先職業: ${preferredOccupation || '指定なし'}
- 補助セグメント: ${JSON.stringify(hints.extra_segments || [], null, 2)}

【参考テキスト】
${hints.source_text || 'なし'}

【既に使用済みの名前】
${existingNames.length > 0 ? existingNames.join('、') : 'なし'}

【出力スキーマ】
{
  "name": "フルネーム",
  "display_name": "表示名",
  "age": 30,
  "gender": "女性",
  "city": "渋谷区",
  "prefecture": "東京都",
  "country": "日本",
  "occupation": "マーケター",
  "occupation_category": "会社員",
  "interests": "関心ごとを読点区切り",
  "region_type": "metro | regional | rural",
  "info_style": "sns | news_app | traditional_media | word_of_mouth",
  "ad_attitude": "positive | neutral | skeptical",
  "disposable_income": "high | medium | low",
  "sns_activity": "high | medium | low",
  "one_line_summary": "1文の要約",
  "narrative": "一人称の紹介文",
  "structured_attributes": {}
}`;
}

function sanitizePersonaPayload(payload, fallback = {}) {
  const gender = typeof payload.gender === 'string' ? payload.gender : fallback.gender || '女性';
  const age = Number.isInteger(payload.age) ? payload.age : fallback.age || 30;
  const prefecture = typeof payload.prefecture === 'string' ? payload.prefecture : fallback.prefecture || '東京都';
  const city = typeof payload.city === 'string' ? payload.city : fallback.city || prefecture;
  const occupation = typeof payload.occupation === 'string' ? payload.occupation : fallback.occupation || '会社員';
  const structuredAttributes = payload.structured_attributes && typeof payload.structured_attributes === 'object'
    ? payload.structured_attributes
    : {
        Demographics: {
          Age: { 'Specific Age': String(age) },
          Gender: { 'Gender Identity': gender },
          Location: { Prefecture: prefecture, City: city },
        },
        Work: { Occupation: occupation },
      };
  const name = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim()
    : fallback.name || `${prefecture}${occupation}${age}`;

  return {
    id: fallback.id || crypto.randomUUID(),
    country: typeof payload.country === 'string' ? payload.country : '日本',
    age,
    gender,
    city,
    prefecture,
    occupation,
    interests: typeof payload.interests === 'string' ? payload.interests : 'SNS、ニュース、日常の買い物',
    region_type: typeof payload.region_type === 'string' ? payload.region_type : fallback.region_type || 'metro',
    narrative: typeof payload.narrative === 'string' ? payload.narrative : `${name}として日々の暮らしや価値観を語る人物です。`,
    structured_attributes: structuredAttributes,
    attribute_count: countStructuredAttributes(structuredAttributes),
    name,
    display_name: typeof payload.display_name === 'string' ? payload.display_name : `${name}（${age}歳・${occupation}）`,
    one_line_summary: typeof payload.one_line_summary === 'string' ? payload.one_line_summary : `${occupation}としての視点を持つ${age}歳の${gender}`,
    occupation_category: typeof payload.occupation_category === 'string' ? payload.occupation_category : fallback.occupation_category || '会社員',
    info_style: typeof payload.info_style === 'string' ? payload.info_style : fallback.info_style || 'news_app',
    ad_attitude: typeof payload.ad_attitude === 'string' ? payload.ad_attitude : fallback.ad_attitude || 'neutral',
    disposable_income: typeof payload.disposable_income === 'string' ? payload.disposable_income : fallback.disposable_income || 'medium',
    sns_activity: typeof payload.sns_activity === 'string' ? payload.sns_activity : fallback.sns_activity || 'medium',
    is_default: false,
    is_active: true,
    generated_by: fallback.generated_by || DEFAULT_MODEL,
    generation_cost_usd: null,
    created_at: fallback.created_at || nowIso(),
    updated_at: nowIso(),
  };
}

async function generatePersona(client, model, hints, index, existingNames, fallback = {}) {
  const payload = await createJsonCompletion(client, model, [
    { role: 'system', content: PERSONA_GENERATION_SYSTEM_PROMPT },
    { role: 'user', content: buildPersonaPrompt(hints, index, existingNames) },
  ]);
  return sanitizePersonaPayload(payload, fallback);
}

async function generateFeedback(client, model, persona, articleContent, mediaDescription) {
  const roleInstruction = ROLE_INSTRUCTIONS[persona.ad_attitude] || '';
  const systemPrompt = FEEDBACK_SYSTEM_PROMPT
    .replace('{narrative}', persona.narrative)
    .replace('{role_instruction}', roleInstruction);

  const mediaSection = mediaDescription
    ? `\n【このメディアについて】\n${mediaDescription}\n`
    : '\n';
  const userPrompt = FEEDBACK_USER_PROMPT
    .replace('{media_section}', mediaSection)
    .replace('{media_fit_instruction}', mediaDescription ? MEDIA_FIT_WITH_CONTEXT : MEDIA_FIT_WITHOUT_CONTEXT)
    .replace('{article_content}', articleContent);

  const payload = await createJsonCompletion(client, model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  return {
    id: crypto.randomUUID(),
    simulation_id: '',
    persona_id: persona.id,
    honest_reaction: payload.honest_reaction || '',
    what_worked: payload.what_worked || '特になし',
    what_failed: payload.what_failed || '特になし',
    media_fit: payload.media_fit || '',
    title_feedback: payload.title_feedback || '',
    rewrite_suggestion: payload.rewrite_suggestion || '',
    score_relevance: Number(payload.scores?.relevance) || 3,
    score_credibility: Number(payload.scores?.credibility) || 3,
    score_engagement: Number(payload.scores?.engagement) || 3,
    score_purchase_intent: Number(payload.scores?.purchase_intent) || 3,
    generated_by: model || DEFAULT_MODEL,
    created_at: nowIso(),
  };
}

function avg(values) {
  const numbers = values.filter((value) => typeof value === 'number' && !Number.isNaN(value));
  if (numbers.length === 0) return null;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100;
}

function aggregateSimulation(feedbacks, personasById) {
  const overallScores = {
    relevance: avg(feedbacks.map((item) => item.score_relevance)),
    credibility: avg(feedbacks.map((item) => item.score_credibility)),
    engagement: avg(feedbacks.map((item) => item.score_engagement)),
    purchase_intent: avg(feedbacks.map((item) => item.score_purchase_intent)),
  };

  const byRole = {};
  const byRegion = {};
  const byAgeGroup = {};

  const pushBucket = (target, key, feedback) => {
    if (!target[key]) {
      target[key] = {
        relevance: [],
        credibility: [],
        engagement: [],
        purchase_intent: [],
      };
    }
    target[key].relevance.push(feedback.score_relevance);
    target[key].credibility.push(feedback.score_credibility);
    target[key].engagement.push(feedback.score_engagement);
    target[key].purchase_intent.push(feedback.score_purchase_intent);
  };

  for (const feedback of feedbacks) {
    const persona = personasById.get(feedback.persona_id);
    if (!persona) continue;
    pushBucket(byRole, persona.ad_attitude || 'neutral', feedback);
    pushBucket(byRegion, persona.region_type || 'metro', feedback);
    const ageGroup = persona.age < 25 ? '18-24' : persona.age < 35 ? '25-34' : persona.age < 45 ? '35-44' : '45+';
    pushBucket(byAgeGroup, ageGroup, feedback);
  }

  const finalizeBuckets = (buckets) =>
    Object.fromEntries(
      Object.entries(buckets).map(([key, value]) => [
        key,
        {
          relevance: avg(value.relevance),
          credibility: avg(value.credibility),
          engagement: avg(value.engagement),
          purchase_intent: avg(value.purchase_intent),
        },
      ]),
    );

  return {
    overallScores,
    scoresByRole: finalizeBuckets(byRole),
    scoresByRegion: finalizeBuckets(byRegion),
    scoresByAgeGroup: finalizeBuckets(byAgeGroup),
  };
}

async function generateSummary(client, model, feedbacks, personasById, simulationId) {
  const aggregates = aggregateSimulation(feedbacks, personasById);
  const aggregatedFeedbacksJson = JSON.stringify(
    feedbacks.map((feedback) => {
      const persona = personasById.get(feedback.persona_id);
      return {
        persona_summary: persona
          ? `${persona.age}歳/${persona.gender}/${persona.region_type}/${persona.ad_attitude || 'neutral'}`
          : feedback.persona_id,
        honest_reaction: feedback.honest_reaction,
        what_worked: feedback.what_worked,
        media_fit: feedback.media_fit,
        title_feedback: feedback.title_feedback,
        rewrite_suggestion: feedback.rewrite_suggestion,
        scores: {
          relevance: feedback.score_relevance,
          credibility: feedback.score_credibility,
          engagement: feedback.score_engagement,
          purchase_intent: feedback.score_purchase_intent,
        },
      };
    }),
    null,
    2,
  );

  const payload = await createJsonCompletion(client, model, [
    {
      role: 'user',
      content: INSIGHT_GENERATION_PROMPT
        .replace('{persona_count}', String(feedbacks.length))
        .replace('{aggregated_feedbacks_json}', aggregatedFeedbacksJson),
    },
  ]);

  return {
    id: crypto.randomUUID(),
    simulation_id: simulationId,
    overall_scores: aggregates.overallScores,
    scores_by_role: aggregates.scoresByRole,
    scores_by_age_group: aggregates.scoresByAgeGroup,
    scores_by_region: aggregates.scoresByRegion,
    key_insights: Array.isArray(payload.key_insights) ? payload.key_insights : [],
    improvement_suggestions: Array.isArray(payload.improvement_suggestions) ? payload.improvement_suggestions : [],
    created_at: nowIso(),
  };
}

function selectSimulationPersonas(workspace, request) {
  const explicitIds = Array.isArray(request.selected_persona_ids) ? request.selected_persona_ids.filter(Boolean) : [];
  if (explicitIds.length > 0) {
    const selected = explicitIds
      .map((id) => workspace.personas.find((persona) => persona.id === id))
      .filter(Boolean);
    if (selected.length === 0) {
      throw createError(400, 'No target personas selected.');
    }
    return selected;
  }

  const assignedIds = workspace.projectSettings.assigned_persona_ids || [];
  const assigned = assignedIds
    .map((id) => workspace.personas.find((persona) => persona.id === id))
    .filter(Boolean);
  if (assigned.length > 0) {
    return assigned.slice(0, request.persona_count || assigned.length);
  }

  return workspace.personas.slice(0, request.persona_count || 20);
}

async function processSimulation(simulationId, apiKey, body) {
  const client = new OpenAI({ apiKey });
  const model = body.model || DEFAULT_MODEL;

  const workspace = await getWorkspace();
  const simulation = workspace.simulations.find((item) => item.id === simulationId);
  if (!simulation) return;

  for (const personaId of simulation.target_persona_ids) {
    const freshWorkspace = await getWorkspace();
    const freshSimulation = freshWorkspace.simulations.find((item) => item.id === simulationId);
    if (!freshSimulation || freshSimulation.status !== 'running') return;

    const persona = freshWorkspace.personas.find((item) => item.id === personaId);
    if (!persona) continue;

    try {
      const feedback = await generateFeedback(
        client,
        model,
        persona,
        body.article_content,
        body.media_description || '',
      );
      feedback.simulation_id = simulationId;

      await updateWorkspace((draft) => {
        const target = draft.simulations.find((item) => item.id === simulationId);
        if (!target) return;
        target.feedbacks.push(feedback);
        target.completed_feedback_count += 1;
        target.updated_at = nowIso();
      });
    } catch (error) {
      console.error(`Simulation feedback failed for ${personaId}`, error);
    }
  }

  const completedWorkspace = await getWorkspace();
  const completedSimulation = completedWorkspace.simulations.find((item) => item.id === simulationId);
  if (!completedSimulation) return;

  if (completedSimulation.feedbacks.length === 0) {
    await updateWorkspace((draft) => {
      const target = draft.simulations.find((item) => item.id === simulationId);
      if (!target) return;
      target.status = 'failed';
      target.updated_at = nowIso();
    });
    return;
  }

  try {
    const personasById = new Map(completedWorkspace.personas.map((persona) => [persona.id, persona]));
    const summary = await generateSummary(client, model, completedSimulation.feedbacks, personasById, simulationId);
    await updateWorkspace((draft) => {
      const target = draft.simulations.find((item) => item.id === simulationId);
      if (!target) return;
      target.summary = summary;
      target.status = 'completed';
      target.completed_at = nowIso();
      target.updated_at = nowIso();
    });
  } catch (error) {
    console.error('Simulation summary failed', error);
    await updateWorkspace((draft) => {
      const target = draft.simulations.find((item) => item.id === simulationId);
      if (!target) return;
      target.status = 'failed';
      target.updated_at = nowIso();
    });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/project-settings/', asyncHandler(async (_req, res) => {
  const workspace = await getWorkspace();
  res.json(normalizeProjectSettings(workspace.projectSettings));
}));

app.put('/api/project-settings/', asyncHandler(async (req, res) => {
  const settings = await updateWorkspace((draft) => {
    draft.projectSettings = normalizeProjectSettings({
      ...draft.projectSettings,
      ...req.body,
    });
    return draft.projectSettings;
  });
  res.json(settings);
}));

app.get('/api/persona-pool/stats', asyncHandler(async (_req, res) => {
  const workspace = await getWorkspace();
  const byRegion = {};
  const byInfoStyle = {};
  const byAdAttitude = {};
  for (const persona of workspace.personas) {
    byRegion[persona.region_type] = (byRegion[persona.region_type] || 0) + 1;
    byInfoStyle[persona.info_style || 'unknown'] = (byInfoStyle[persona.info_style || 'unknown'] || 0) + 1;
    byAdAttitude[persona.ad_attitude || 'unknown'] = (byAdAttitude[persona.ad_attitude || 'unknown'] || 0) + 1;
  }
  res.json({
    total: workspace.personas.length,
    by_region_type: byRegion,
    by_info_style: byInfoStyle,
    by_ad_attitude: byAdAttitude,
  });
}));

app.get('/api/persona-pool/', asyncHandler(async (req, res) => {
  const workspace = await getWorkspace();
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const personas = workspace.personas
    .filter((persona) => !req.query.region_type || persona.region_type === req.query.region_type)
    .filter((persona) => !req.query.info_style || persona.info_style === req.query.info_style)
    .filter((persona) => !req.query.ad_attitude || persona.ad_attitude === req.query.ad_attitude)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(offset, offset + limit)
    .map(serializePersonaListItem);
  res.json(personas);
}));

app.get('/api/persona-pool/:personaId', asyncHandler(async (req, res) => {
  const workspace = await getWorkspace();
  const persona = workspace.personas.find((item) => item.id === req.params.personaId);
  if (!persona) {
    throw createError(404, 'Persona not found');
  }
  res.json(serializePersona(persona));
}));

app.delete('/api/persona-pool/:personaId', asyncHandler(async (req, res) => {
  let deleted = false;
  await updateWorkspace((draft) => {
    const before = draft.personas.length;
    draft.personas = draft.personas.filter((persona) => persona.id !== req.params.personaId || persona.is_default);
    deleted = draft.personas.length !== before;
    if (deleted) {
      draft.projectSettings.assigned_persona_ids = draft.projectSettings.assigned_persona_ids.filter(
        (id) => id !== req.params.personaId,
      );
    }
  });
  if (!deleted) {
    throw createError(404, 'Persona not found');
  }
  res.status(204).end();
}));

app.post('/api/persona-pool/regenerate/:personaId', asyncHandler(async (req, res) => {
  const client = buildOpenAIClient(req);
  const workspace = await getWorkspace();
  const existing = workspace.personas.find((persona) => persona.id === req.params.personaId);
  if (!existing) {
    throw createError(404, 'Persona not found');
  }

  const regenerated = await generatePersona(
    client,
    req.body?.model || DEFAULT_MODEL,
    {
      age: existing.age,
      gender: existing.gender,
      region_type: existing.region_type,
      prefectures: [existing.prefecture],
      occupations: [existing.occupation],
      extra_segments: [],
      source_text: '',
      attribute_richness: existing.attribute_count || 120,
    },
    0,
    workspace.personas.filter((persona) => persona.id !== existing.id).map((persona) => persona.name).filter(Boolean),
    {
      ...existing,
      created_at: existing.created_at,
      id: existing.id,
      name: existing.name,
      display_name: existing.display_name,
    },
  );

  const saved = await updateWorkspace((draft) => {
    const index = draft.personas.findIndex((persona) => persona.id === existing.id);
    draft.personas[index] = { ...regenerated, id: existing.id, created_at: existing.created_at };
    return draft.personas[index];
  });

  res.json(serializePersona(saved));
}));

app.post('/api/persona-pool/generate-stream', asyncHandler(async (req, res) => {
  const client = buildOpenAIClient(req);
  const model = req.body?.model || DEFAULT_MODEL;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const analyzed = req.body?.source_text
      ? await analyzeSourceText(client, model, req.body.source_text)
      : {
          age_min: null,
          age_max: null,
          gender: null,
          region_type: null,
          prefectures: [],
          occupations: [],
          extra_segments: [],
        };

    const hints = mergeGenerationHints(req.body || {}, analyzed);
    const totalCount = Math.max(Number(req.body?.count) || 1, 1);
    const existingWorkspace = await getWorkspace();
    const usedNames = existingWorkspace.personas.map((persona) => persona.name).filter(Boolean);

    if (req.body?.source_text) {
      sendEvent({
        persona_index: 1,
        total_count: totalCount,
        step: 'analyzing_source',
        step_detail: 'ソーステキストを解析中...',
        attribute_count: 0,
        attribute_richness: hints.attribute_richness,
      });
    }

    for (let index = 0; index < totalCount; index += 1) {
      sendEvent({
        persona_index: index + 1,
        total_count: totalCount,
        step: 'generating_persona',
        step_detail: 'ペルソナを生成中...',
        attribute_count: 0,
        attribute_richness: hints.attribute_richness,
      });

      const persona = await generatePersona(client, model, hints, index, usedNames);
      usedNames.push(persona.name);
      const savedPersona = await updateWorkspace((draft) => {
        draft.personas.unshift(persona);
        if (!draft.projectSettings.assigned_persona_ids.includes(persona.id)) {
          draft.projectSettings.assigned_persona_ids.push(persona.id);
        }
        return persona;
      });

      sendEvent({
        persona_index: index + 1,
        total_count: totalCount,
        step: 'completed',
        step_detail: '生成完了',
        persona: {
          id: savedPersona.id,
          display_name: savedPersona.display_name,
          age: savedPersona.age,
          gender: savedPersona.gender,
          occupation_category: savedPersona.occupation_category,
          one_line_summary: savedPersona.one_line_summary,
        },
      });
    }

    sendEvent({ done: true });
    res.end();
  } catch (error) {
    sendEvent({ error: error.message || 'Persona generation failed' });
    res.end();
  }
}));

app.get('/api/persona/chats', asyncHandler(async (_req, res) => {
  const workspace = await getWorkspace();
  const personasById = new Map(workspace.personas.map((persona) => [persona.id, persona]));
  const sessions = workspace.chatSessions
    .slice()
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    .filter((session) => personasById.has(session.persona_id))
    .map((session) => serializeChatSessionSummary(session, personasById.get(session.persona_id)))
    .filter((session) => session.persona);
  res.json(sessions);
}));

app.post('/api/persona/chats', asyncHandler(async (req, res) => {
  const workspace = await getWorkspace();
  const persona = workspace.personas.find((item) => item.id === req.body?.persona_id);
  if (!persona) {
    throw createError(404, 'Persona not found.');
  }

  const session = {
    id: crypto.randomUUID(),
    persona_id: persona.id,
    title: (req.body?.title || '').trim() || '新しいチャット',
    created_at: nowIso(),
    updated_at: nowIso(),
    messages: [],
  };

  await updateWorkspace((draft) => {
    draft.chatSessions.unshift(session);
  });

  res.status(201).json(serializeChatSession(session, persona));
}));

app.get('/api/persona/chats/:chatId', asyncHandler(async (req, res) => {
  const workspace = await getWorkspace();
  const session = workspace.chatSessions.find((item) => item.id === req.params.chatId);
  if (!session) {
    throw createError(404, 'Chat session not found.');
  }
  const persona = workspace.personas.find((item) => item.id === session.persona_id);
  if (!persona) {
    throw createError(404, 'Persona not found.');
  }
  res.json(serializeChatSession(session, persona));
}));

app.post('/api/persona/chats/:chatId/stream', asyncHandler(async (req, res) => {
  const client = buildOpenAIClient(req);
  const messageText = String(req.body?.message || '').trim();
  if (!messageText) {
    throw createError(400, 'Message is required.');
  }

  const workspace = await getWorkspace();
  const session = workspace.chatSessions.find((item) => item.id === req.params.chatId);
  if (!session) {
    throw createError(404, 'Chat session not found.');
  }
  const persona = workspace.personas.find((item) => item.id === session.persona_id);
  if (!persona) {
    throw createError(404, 'Persona not found.');
  }

  const userMessage = {
    id: crypto.randomUUID(),
    sender_type: 'user',
    content: messageText,
    created_at: nowIso(),
  };

  const updatedSession = await updateWorkspace((draft) => {
    const target = draft.chatSessions.find((item) => item.id === req.params.chatId);
    target.messages.push(userMessage);
    if (target.title === '新しいチャット') {
      target.title = messageText.slice(0, 40) || '新しいチャット';
    }
    target.updated_at = nowIso();
    return clone(target);
  });

  const messages = [
    {
      role: 'system',
      content:
        `あなたは ${persona.name || persona.display_name || `${persona.age}歳・${persona.gender}`} というペルソナです。\n` +
        `背景: ${persona.narrative}\n` +
        'ユーザーの質問に対して、このペルソナの視点から日本語で率直に答えてください。',
    },
    ...updatedSession.messages.map((message) => ({
      role: message.sender_type === 'persona' ? 'assistant' : 'user',
      content: message.content,
    })),
  ];

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let accumulated = '';
  const stream = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content || '';
    if (!text) continue;
    accumulated += text;
    const lines = text.split('\n');
    for (const line of lines) {
      res.write(`data: ${line}\n\n`);
    }
  }

  if (accumulated.trim()) {
    await updateWorkspace((draft) => {
      const target = draft.chatSessions.find((item) => item.id === req.params.chatId);
      target.messages.push({
        id: crypto.randomUUID(),
        sender_type: 'persona',
        content: accumulated,
        created_at: nowIso(),
      });
      target.updated_at = nowIso();
    });
  }

  res.write('data: [DONE]\n\n');
  res.end();
}));

app.post('/api/simulations/', asyncHandler(async (req, res) => {
  const apiKey = req.header('X-OpenAI-Api-Key');
  if (!apiKey) {
    throw createError(
      400,
      'OpenAI APIキーが設定されていません。アプリの「設定」タブでAPIキーを登録してください。',
    );
  }

  const workspace = await getWorkspace();
  const personas = selectSimulationPersonas(workspace, req.body || {});
  const simulation = {
    id: crypto.randomUUID(),
    article_id: req.body?.article_id || null,
    article_category: req.body?.article_category || null,
    article_content: req.body?.article_content || '',
    persona_count: personas.length,
    completed_feedback_count: 0,
    status: 'running',
    created_at: nowIso(),
    completed_at: null,
    updated_at: nowIso(),
    target_persona_ids: personas.map((persona) => persona.id),
    media_description: req.body?.media_description || '',
    model: req.body?.model || DEFAULT_MODEL,
    feedbacks: [],
    summary: null,
  };

  await updateWorkspace((draft) => {
    draft.simulations.unshift(simulation);
  });

  processSimulation(simulation.id, apiKey, {
    article_content: simulation.article_content,
    media_description: simulation.media_description,
    model: simulation.model,
  }).catch((error) => {
    console.error('Background simulation failed', error);
  });

  res.json(serializeSimulation(simulation));
}));

app.get('/api/simulations/:simulationId', asyncHandler(async (req, res) => {
  const workspace = await getWorkspace();
  const simulation = workspace.simulations.find((item) => item.id === req.params.simulationId);
  if (!simulation) {
    throw createError(404, 'Simulation not found');
  }
  res.json(serializeSimulation(simulation));
}));

app.get('/api/simulations/:simulationId/feedbacks', asyncHandler(async (req, res) => {
  const workspace = await getWorkspace();
  const simulation = workspace.simulations.find((item) => item.id === req.params.simulationId);
  if (!simulation) {
    throw createError(404, 'Simulation not found');
  }
  res.json(simulation.feedbacks.map(serializeFeedback));
}));

app.get('/api/simulations/:simulationId/summary', asyncHandler(async (req, res) => {
  const workspace = await getWorkspace();
  const simulation = workspace.simulations.find((item) => item.id === req.params.simulationId);
  if (!simulation) {
    throw createError(404, 'Simulation not found');
  }
  if (!simulation.summary) {
    throw createError(404, 'Summary not yet available');
  }
  res.json(serializeSummary(simulation.summary));
}));

app.post('/api/scrape/', asyncHandler(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//.test(url)) {
    throw createError(422, 'URLを正しく入力してください。');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createError(502, `URLの取得に失敗しました（HTTP ${response.status}）。`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const content = article?.textContent?.trim();
    const title = article?.title?.trim() || dom.window.document.title || '';

    if (!content) {
      throw createError(
        422,
        '記事本文を抽出できませんでした。このサイトはスクレイピングをブロックしているか、本文が少ない可能性があります。',
      );
    }

    res.json({
      title,
      content: title ? `# ${title}\n\n${content}` : content,
      url,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw createError(504, 'URLの取得がタイムアウトしました。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}));

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    detail: error.message || 'Unexpected server error',
  });
});

await initWorkspaceStore();

app.listen(port, host, () => {
  console.log(`PersonaAI OSS server listening on http://${host}:${port}`);
});

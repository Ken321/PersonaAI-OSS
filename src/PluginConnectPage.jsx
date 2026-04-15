import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  LogOut,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
  Users
} from 'lucide-react';
import { translateTaxonomyLabel } from './taxonomyLabelsJa';
import { API_BASE, authHeaders, getOpenAIKey } from './utils/api';

const API_KEY_MISSING_ERROR = 'OpenAI APIキーが設定されていません。「設定」タブでAPIキーを登録してください。';

async function scrapeUrl(url) {
  const res = await fetch(`${API_BASE}/api/scrape/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `スクレイピングに失敗しました（HTTP ${res.status}）`);
  }
  return res.json(); // { title, content, url }
}

async function runSimulation({ articleContent, personaCount = 20, selectedPersonaIds = [], mediaDescription = '', model = '' }) {
  const res = await fetch(`${API_BASE}/api/simulations/`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      article_content: articleContent,
      persona_count: personaCount,
      selected_persona_ids: selectedPersonaIds,
      media_description: mediaDescription || undefined,
      model: model || undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `シミュレーションの開始に失敗しました（HTTP ${res.status}）`);
  }
  return res.json();
}

async function fetchSimulation(simulationId) {
  const res = await fetch(`${API_BASE}/api/simulations/${simulationId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`simulation fetch failed: ${res.status}`);
  return res.json();
}

async function fetchSimulationFeedbacks(simulationId) {
  const res = await fetch(`${API_BASE}/api/simulations/${simulationId}/feedbacks`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`feedbacks fetch failed: ${res.status}`);
  return res.json();
}

async function fetchSimulationSummary(simulationId) {
  const res = await fetch(`${API_BASE}/api/simulations/${simulationId}/summary`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchPersonaChatSessions() {
  const res = await fetch(`${API_BASE}/api/persona/chats`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`chat sessions fetch failed: ${res.status}`);
  return res.json();
}

async function fetchPersonaChatSession(chatId) {
  const res = await fetch(`${API_BASE}/api/persona/chats/${chatId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`chat session fetch failed: ${res.status}`);
  return res.json();
}

async function createPersonaChatSession(personaId) {
  const res = await fetch(`${API_BASE}/api/persona/chats`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ persona_id: personaId }),
  });
  if (!res.ok) throw new Error(`chat session create failed: ${res.status}`);
  return res.json();
}

async function fetchPersonasByIds(personaIds) {
  const results = await Promise.all(
    personaIds.map((id) =>
      fetch(`${API_BASE}/api/persona-pool/${id}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null))
    )
  );
  const map = {};
  results.forEach((p) => { if (p) map[p.id] = p; });
  return map;
}

function mapApiFeedbackToLocal(apiFeedback, persona = null) {
  const rawScores = [
    apiFeedback.score_relevance,
    apiFeedback.score_credibility,
    apiFeedback.score_engagement,
    apiFeedback.score_purchase_intent,
  ].filter((v) => v != null);
  const avgScore = rawScores.length > 0 ? rawScores.reduce((s, v) => s + v, 0) / rawScores.length : 3;
  const score = Math.round(avgScore * 20);
  const riskLevel = score < 50 ? 'high' : score < 72 ? 'medium' : 'low';

  const reaction = apiFeedback.honest_reaction || '';

  const toLines = (text) => text ? text.split(/\n+/).map((l) => l.trim()).filter(Boolean) : [];

  return {
    id: apiFeedback.id,
    personaId: apiFeedback.persona_id,
    persona,
    score,
    riskLevel,
    summary: reaction.split(/。|\n/)[0] || '',
    positives: toLines(apiFeedback.what_worked),
    negatives: toLines(apiFeedback.what_failed),
    mediaFit: toLines(apiFeedback.media_fit),
    titleFeedback: toLines(apiFeedback.title_feedback),
    actionItems: toLines(apiFeedback.rewrite_suggestion),
    honestReaction: reaction,
    createdAt: apiFeedback.created_at || new Date().toISOString(),
  };
}

function dbPersonaToDisplay(p) {
  return {
    id: p.id,
    name: p.display_name || `${p.age}歳・${p.gender}`,
    age: p.age,
    occupation: p.occupation,
    gender: p.gender,
    adAttitude: p.ad_attitude,
    infoStyle: p.info_style,
  };
}

function normalizeTaxonomyValue(value) {
  if (value == null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeTaxonomyValue(item))
      .filter(Boolean);
    return items.length > 0 ? items.join('、') : null;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, entryValue]) => {
        const normalized = normalizeTaxonomyValue(entryValue);
        return normalized ? `${translateTaxonomyLabel(key)}: ${normalized}` : null;
      })
      .filter(Boolean);
    return entries.length > 0 ? entries.join(' / ') : null;
  }

  return String(value);
}

function hasStructuredProfileContent(value) {
  if (value == null) return false;

  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value !== 'object') return true;

  if (Array.isArray(value)) {
    return value.some((item) => hasStructuredProfileContent(item));
  }

  return Object.values(value).some((item) => hasStructuredProfileContent(item));
}

function getStructuredProfileEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, entryValue]) => hasStructuredProfileContent(entryValue));
}

function formatStructuredProfileValue(value) {
  if (value == null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value !== 'object') return String(value);

  if (Array.isArray(value)) {
    const formattedItems = value
      .map((item) => {
        if (item && typeof item === 'object') return null;
        return formatStructuredProfileValue(item);
      })
      .filter(Boolean);
    return formattedItems.length > 0 ? formattedItems.join('、') : null;
  }

  return null;
}

const NAV_ITEMS = [
  { id: 'articleFeedback', label: '記事のフィードバック', icon: FileText },
  { id: 'persona', label: 'チャット', icon: Users },
  { id: 'settings', label: '設定', icon: Settings },
];
const DEFAULT_SECTION_ID = 'articleFeedback';
const SECTION_QUERY_PARAM = 'menu';
const NAV_ITEM_IDS = new Set(NAV_ITEMS.map((item) => item.id));

const PERSONAS_PER_PAGE = 24;
const PAGE_WINDOW_SIZE = 7;

const BUTTON_BASE = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_PRIMARY_CLASS = `${BUTTON_BASE} gap-1.5 bg-primary px-3 py-2 text-primary-foreground hover:opacity-90`;
const BUTTON_SECONDARY_CLASS = `${BUTTON_BASE} gap-1.5 border border-border bg-muted px-3 py-2 text-foreground hover:bg-accent`;
const BUTTON_TERTIARY_CLASS = `${BUTTON_BASE} gap-1.5 border border-border bg-card px-3 py-2 text-foreground hover:bg-accent`;
const SELECT_CLASS = 'w-full appearance-none rounded-md border border-border bg-muted px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const TEXT_INPUT_CLASS = 'w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none';

const AGE_OPTIONS = ['指定なし', '18-24', '25-34', '35-44', '45+'];
const GENDER_OPTIONS = ['指定なし', '女性', '男性', 'ノンバイナリー'];
const LOCATION_OPTIONS = [
  { value: '指定なし', label: '指定なし' },
  { value: 'metro', label: '首都圏・大都市圏' },
  { value: 'regional', label: '地方都市' },
  { value: 'rural', label: '郊外・地方' },
];
const PREFECTURE_OPTIONS = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県',
  '沖縄県',
];
const DEFAULT_SEGMENT_SETTINGS = {
  age: '指定なし',
  gender: '指定なし',
  location: '指定なし',
};
const DEFAULT_GEN_FORM = {
  age_min: '',
  age_max: '',
  gender: '',
  region_type: '',
  prefectures: [],
  occupations: [],
  segments: [],
  count: 1,
  attribute_richness: 200,
};

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--popover-foreground)',
  fontSize: '12px'
};

function StructuredProfileNode({ label, value, path = 'root', depth = 0 }) {
  if (!hasStructuredProfileContent(value)) return null;

  const formattedValue = formatStructuredProfileValue(value);
  const childEntries = Array.isArray(value)
    ? value
        .map((item, index) => [String(index + 1), item])
        .filter(([, entryValue]) => hasStructuredProfileContent(entryValue))
    : getStructuredProfileEntries(value);

  if (formattedValue) {
    return (
      <div className="space-y-1">
        {label ? <p className="text-[10px] text-muted-foreground">{translateTaxonomyLabel(label)}</p> : null}
        <p className="text-xs leading-relaxed text-foreground">{formattedValue}</p>
      </div>
    );
  }

  if (childEntries.length === 0) return null;

  return (
    <div className={`space-y-3 ${depth > 0 ? 'border-l border-border/70 pl-3' : ''}`}>
      {label ? (
        <p className={depth === 0 ? 'text-[11px] font-medium text-secondary-foreground' : 'text-[10px] font-medium text-muted-foreground'}>
          {translateTaxonomyLabel(label)}
        </p>
      ) : null}
      <div className="space-y-3">
        {childEntries.map(([childLabel, childValue]) => (
          <StructuredProfileNode
            key={`${path}.${childLabel}`}
            label={childLabel}
            value={childValue}
            path={`${path}.${childLabel}`}
            depth={depth + 1}
          />
        ))}
      </div>
    </div>
  );
}

function StructuredProfilePanel({ profile }) {
  if (!hasStructuredProfileContent(profile)) {
    return (
      <div className="rounded-md border border-border bg-muted px-3 py-4 text-xs text-muted-foreground">
        属性データがありません。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {getStructuredProfileEntries(profile).map(([label, value]) => (
        <div key={label} className="rounded-md border border-border bg-muted p-3">
          <StructuredProfileNode label={label} value={value} path={label} />
        </div>
      ))}
    </div>
  );
}

const ARTICLE_FEEDBACK_VIEWS = {
  LIST: 'list',
  CREATE: 'create',
  RESULTS: 'results',
  DETAIL: 'detail'
};
const ARTICLE_INPUT_MODES = {
  URL: 'url',
  CONTENT: 'content'
};
const ARTICLE_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function createEmptyArticleForm() {
  return {
    title: '',
    body: '',
    url: ''
  };
}

function createLocalArticleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `article-${crypto.randomUUID()}`;
  }
  return `article-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePersonaSnapshot(persona) {
  if (!persona || typeof persona !== 'object') return null;
  return {
    id: persona.id || null,
    name: persona.name || persona.display_name || '不明なペルソナ',
    display_name: persona.display_name || persona.name || '不明なペルソナ',
    age: persona.age ?? null,
    occupation: persona.occupation || '',
    gender: persona.gender || '',
    adAttitude: persona.adAttitude || persona.ad_attitude || '',
    infoStyle: persona.infoStyle || persona.info_style || '',
    narrative: persona.narrative || '',
    one_line_summary: persona.one_line_summary || '',
  };
}

function normalizePersonaSnapshots(personas) {
  if (!Array.isArray(personas)) return [];
  return personas.map(normalizePersonaSnapshot).filter(Boolean);
}

function normalizeFeedback(feedback) {
  if (!feedback || typeof feedback !== 'object') return null;
  return {
    id: feedback.id || `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    personaId: feedback.personaId || feedback.persona_id || null,
    persona: normalizePersonaSnapshot(feedback.persona),
    score: typeof feedback.score === 'number' ? feedback.score : null,
    riskLevel: feedback.riskLevel || 'low',
    summary: feedback.summary || '',
    positives: Array.isArray(feedback.positives) ? feedback.positives.filter(Boolean) : [],
    negatives: Array.isArray(feedback.negatives) ? feedback.negatives.filter(Boolean) : [],
    mediaFit: Array.isArray(feedback.mediaFit) ? feedback.mediaFit.filter(Boolean) : [],
    titleFeedback: Array.isArray(feedback.titleFeedback) ? feedback.titleFeedback.filter(Boolean) : [],
    actionItems: Array.isArray(feedback.actionItems) ? feedback.actionItems.filter(Boolean) : [],
    honestReaction: feedback.honestReaction || '',
    createdAt: feedback.createdAt || new Date().toISOString(),
  };
}

function formatChatTimeLabel(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function formatChatSessionDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createEmptyChatMessages() {
  return [
    {
      id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderType: 'system',
      personaId: null,
      text: '新しいチャットです。会話は送信後に保存され、あとから再開できます。',
      timestamp: formatChatTimeLabel(),
    }
  ];
}

function normalizeChatMessage(message, personaId) {
  if (!message || typeof message !== 'object') return null;
  const senderType = message.sender_type === 'persona' ? 'persona' : message.sender_type;
  return {
    id: message.id || `chat-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderType,
    personaId: senderType === 'persona' ? personaId : null,
    text: message.content || '',
    timestamp: formatChatTimeLabel(message.created_at),
    createdAt: message.created_at || null,
  };
}

function normalizeChatSession(session) {
  if (!session || typeof session !== 'object') return null;
  const persona = normalizePersonaSnapshot(session.persona);
  const personaId = session.persona_id || persona?.id || null;
  const messages = Array.isArray(session.messages)
    ? session.messages.map((message) => normalizeChatMessage(message, personaId)).filter(Boolean)
    : [];
  return {
    id: session.id || null,
    personaId,
    title: session.title || '新しいチャット',
    preview: session.preview || '',
    messageCount: typeof session.message_count === 'number' ? session.message_count : messages.length,
    lastMessageAt: session.last_message_at || null,
    createdAt: session.created_at || null,
    updatedAt: session.updated_at || null,
    persona,
    messages,
  };
}

function normalizeArticleRun(article) {
  if (!article || typeof article !== 'object' || !article.id) return null;
  const feedbacks = Array.isArray(article.feedbacks)
    ? article.feedbacks.map(normalizeFeedback).filter(Boolean)
    : [];
  const targetPersonas = normalizePersonaSnapshots(article.targetPersonas);
  const fallbackTargetPersona = normalizePersonaSnapshot(article.targetPersona);
  if (targetPersonas.length === 0 && fallbackTargetPersona) {
    targetPersonas.push(fallbackTargetPersona);
  }
  const targetPersonaIds = Array.isArray(article.targetPersonaIds)
    ? article.targetPersonaIds.filter(Boolean)
    : article.targetPersonaId
      ? [article.targetPersonaId]
      : targetPersonas.map((persona) => persona.id).filter(Boolean);
  const personaCount = typeof article.personaCount === 'number'
    ? article.personaCount
    : targetPersonaIds.length || targetPersonas.length || feedbacks.length;
  return {
    id: article.id,
    inputMode: article.inputMode || ARTICLE_INPUT_MODES.URL,
    title: article.title || '',
    body: article.body || '',
    url: article.url || '',
    status: article.status || 'completed',
    personaCount,
    completedCount: typeof article.completedCount === 'number' ? article.completedCount : feedbacks.length,
    feedbacks,
    averageScore: typeof article.averageScore === 'number' ? article.averageScore : null,
    createdAt: article.createdAt || new Date().toISOString(),
    updatedAt: article.updatedAt || article.createdAt || new Date().toISOString(),
    simulationId: article.simulationId || null,
    targetPersonaIds,
    targetPersonas,
  };
}

function getArticleTargetLabel(article) {
  if (!article) return '-';
  const count = article.targetPersonaIds?.length || article.targetPersonas?.length || article.personaCount || 0;
  return count > 0 ? `${count}名` : '-';
}

function normalizeSectionId(value) {
  return NAV_ITEM_IDS.has(value) ? value : DEFAULT_SECTION_ID;
}

function getSectionFromUrl() {
  if (typeof window === 'undefined') return DEFAULT_SECTION_ID;
  const params = new URLSearchParams(window.location.search);
  return normalizeSectionId(params.get(SECTION_QUERY_PARAM));
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getArticleDisplayTitle(article) {
  const title = article.title?.trim();
  const url = article.url?.trim();
  if (title) return title;
  if (url) return url;
  return '無題の記事';
}

function getArticleInputModeLabel(mode) {
  return mode === ARTICLE_INPUT_MODES.URL ? 'URL入力' : 'タイトル+本文';
}


function getArticleRunStatusMeta(status) {
  if (status === 'running') {
    return {
      label: '実行中',
      badgeClass: 'bg-blue-100 text-blue-700'
    };
  }
  if (status === 'failed') {
    return {
      label: '失敗',
      badgeClass: 'bg-red-100 text-red-700'
    };
  }
  if (status === 'cancelled') {
    return {
      label: 'キャンセル',
      badgeClass: 'bg-gray-100 text-gray-600'
    };
  }
  return {
    label: '完了',
    badgeClass: 'bg-emerald-100 text-emerald-700'
  };
}

function isLikelyHttpUrl(value) {
  if (!value) return false;
  return /^https?:\/\/\S+$/i.test(value);
}


function inAgeRange(age, bucket) {
  if (bucket === '指定なし') return true;
  if (bucket === '18-24') return age >= 18 && age <= 24;
  if (bucket === '25-34') return age >= 25 && age <= 34;
  if (bucket === '35-44') return age >= 35 && age <= 44;
  if (bucket === '45+') return age >= 45;
  return true;
}

const FEMALE_HAIR = [
  'variant02','variant08','variant10','variant23','variant24','variant28',
  'variant36','variant37','variant39','variant41','variant45','variant46',
  'variant47','variant48','variant57','variant59',
];
const MALE_HAIR = [
  'variant01','variant03','variant04','variant05','variant06','variant07',
  'variant09','variant11','variant12','variant13','variant15','variant16','variant17',
  'variant18','variant19','variant21','variant22','variant25','variant26','variant27',
  'variant30','variant31','variant32','variant33','variant34','variant35','variant38',
  'variant40','variant42','variant44','variant49','variant50','variant52','variant53',
  'variant54','variant55','variant56','variant58','variant60',
];
const GESTURES = [
  'hand','handPhone','ok','okLongArm','point','pointLongArm',
  'waveLongArm','waveLongArms','waveOkLongArms','wavePointLongArms',
];

// Pre-defined avatar shuffle URLs for persona generation animation
const _DB = 'https://api.dicebear.com/7.x/notionists/svg?backgroundColor=transparent';
const SHUFFLE_AVATAR_URLS = [
  `${_DB}&seed=sa&hair=variant23&gesture=waveLongArms`,
  `${_DB}&seed=sb&hair=variant08&beardProbability=90&beard=variant02&glass=variant02&gesture=point`,
  `${_DB}&seed=sc&hair=variant45&gesture=handPhone`,
  `${_DB}&seed=sd&hair=variant03&beardProbability=0&gesture=ok`,
  `${_DB}&seed=se&hair=variant29&gesture=hand`,
  `${_DB}&seed=sf&hair=variant58&beardProbability=85&beard=variant03&glass=variant01&hairColor=bdbdbd`,
  `${_DB}&seed=sg&hair=variant27&gesture=waveLongArm`,
  `${_DB}&seed=sh&hair=variant36&gesture=pointLongArm`,
  `${_DB}&seed=si&hair=variant22&beardProbability=75&beard=variant01&gesture=waveOkLongArms`,
  `${_DB}&seed=sj&hair=variant47&gesture=okLongArm`,
  `${_DB}&seed=sk&hair=variant15&beardProbability=0&glass=variant03`,
  `${_DB}&seed=sl&hair=variant43&gesture=wavePointLongArms`,
  `${_DB}&seed=sm&hair=variant34&beardProbability=95&beard=variant04&gesture=waveLongArms`,
  `${_DB}&seed=sn&hair=variant51&gesture=hand`,
  `${_DB}&seed=so&hair=variant21&beardProbability=30&gesture=pointLongArm`,
  `${_DB}&seed=sp&hair=variant59&gesture=waveOkLongArms`,
];

function idHash(id) {
  return parseInt(id.replace(/-/g, '').slice(0, 8), 16);
}

function getDiceBearUrl(persona) {
  const { id, gender, age } = persona;
  const p = new URLSearchParams({ seed: id, backgroundColor: 'transparent' });
  const hash = idHash(id);

  const isFemale = gender === '女性';

  // Hair: pick one value deterministically from the gender-appropriate list
  const hairList = isFemale ? FEMALE_HAIR : MALE_HAIR;
  p.set('hair', hairList[hash % hairList.length]);

  // Beard probability: 0 for female, increases with age for male
  const beardProb = isFemale ? 0
    : age < 25 ? 0
    : age < 30 ? 15
    : age < 40 ? 35
    : age < 50 ? 55
    : age < 60 ? 70
    : 85;
  p.set('beardProbability', beardProb);

  // Hair color by age
  if (age >= 65) {
    p.set('hairColor', 'f1f1f1,e0e0e0');
  } else if (age >= 55) {
    p.set('hairColor', 'bdbdbd,9e9e9e');
  } else if (age >= 45) {
    p.set('hairColor', '4a4a4a,3d3d3d');
  } else if (age >= 30) {
    p.set('hairColor', '1a1a1a,2d1b0e');
  } else {
    p.set('hairColor', '1a1a1a,2d1b0e,4a3728');
  }

  // Glasses for older personas
  if (age >= 55) {
    p.set('glass', 'variant01,variant02,variant03');
  }

  // Gesture: ~2/3 of personas get one, deterministic from id
  if (hash % 3 !== 0) {
    p.set('gesture', GESTURES[hash % GESTURES.length]);
  }

  return `https://api.dicebear.com/7.x/notionists/svg?${p.toString()}`;
}

function Avatar({ persona, size = 'h-9 w-9' }) {
  return (
    <div className={`${size} overflow-hidden rounded-full border border-border bg-muted`}>
      <img
        src={getDiceBearUrl(persona)}
        alt={`${persona.name}のアバター`}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    </div>
  );
}

function EmptyState({ title, description, onOpenSettings }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-xl rounded-xl border border-border bg-card p-8 text-center">
        <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <button
          type="button"
          onClick={onOpenSettings}
          className={BUTTON_PRIMARY_CLASS}
        >
          設定でペルソナを選択
        </button>
      </div>
    </div>
  );
}

function getPersonaChatLabel(persona) {
  if (!persona) return 'Persona';
  const ageGender = [persona.age ? `${persona.age}歳` : null, persona.gender || null].filter(Boolean).join('・');
  return `${persona.display_name || persona.name}${ageGender ? `（${ageGender}）` : ''}`;
}

function getSelectedPersonaLabel(persona) {
  if (!persona) return '不明なペルソナ';
  const baseName = (persona.display_name && persona.name && persona.display_name !== persona.name)
    ? `${persona.display_name} / ${persona.name}`
    : (persona.display_name || persona.name || '不明なペルソナ');
  const ageGender = [persona.age ? `${persona.age}歳` : null, persona.gender || null].filter(Boolean).join('・');
  return `${baseName}${ageGender ? `（${ageGender}）` : ''}`;
}

function normalizeSegmentSettings(settings) {
  const locationValue = settings?.location ?? settings?.region_type ?? '指定なし';
  const validLocation = LOCATION_OPTIONS.some((option) => option.value === locationValue)
    ? locationValue
    : '指定なし';
  return {
    age: AGE_OPTIONS.includes(settings?.age) ? settings.age : '指定なし',
    gender: GENDER_OPTIONS.includes(settings?.gender) ? settings.gender : '指定なし',
    location: validLocation,
  };
}

function normalizeTagValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function appendUniqueTags(existing, incoming) {
  const seen = new Set(existing.map((item) => item.toLowerCase()));
  const next = [...existing];
  incoming.forEach((item) => {
    const normalized = normalizeTagValue(item);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(normalized);
  });
  return next;
}

function splitTagInput(raw) {
  const normalized = String(raw || '').replace(/、/g, ',');
  const hasTrailingSeparator = /[,\n]\s*$/.test(normalized);
  const parts = normalized
    .split(/[,\n]+/)
    .map((part) => normalizeTagValue(part))
    .filter(Boolean);

  if (!hasTrailingSeparator && parts.length > 0) {
    return {
      complete: parts.slice(0, -1),
      pending: parts[parts.length - 1],
    };
  }

  return { complete: parts, pending: '' };
}

function PersonaSwitcher({ personas, selectedId, onChange, inputId = 'persona-switcher', disabled = false }) {
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-xs text-muted-foreground">
        新規チャットの相談相手
      </label>
      <SelectField
        id={inputId}
        value={selectedId || ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {personas.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {getPersonaChatLabel(persona)}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function SelectField({ className = '', containerClassName = '', children, ...props }) {
  return (
    <div className={`relative ${containerClassName}`.trim()}>
      <select
        {...props}
        className={`${SELECT_CLASS} ${className}`.trim()}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export default function PluginConnectPage({ onLogout }) {
  const [activeSection, setActiveSection] = useState(() => getSectionFromUrl());

  const [personaPool, setPersonaPool] = useState([]);
  const [personaPoolLoading, setPersonaPoolLoading] = useState(true);

  const [mediaInfo, setMediaInfo] = useState({ title: '', overview: '' });
  const [savedSnackbar, setSavedSnackbar] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('openai_model') || 'gpt-5-mini');
  const [segmentSettings, setSegmentSettings] = useState(DEFAULT_SEGMENT_SETTINGS);
  const [catalogPage, setCatalogPage] = useState(1);

  const [assignedPersonaIds, setAssignedPersonaIds] = useState([]);
  const [activePersonaId, setActivePersonaId] = useState(null);
  const [previewPersonaId, setPreviewPersonaId] = useState(null);

  const [chatSessions, setChatSessions] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [chatMessages, setChatMessages] = useState(() => createEmptyChatMessages());
  const [chatInput, setChatInput] = useState('');
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [isChatSessionsLoading, setIsChatSessionsLoading] = useState(true);
  const [isChatDetailLoading, setIsChatDetailLoading] = useState(false);
  const [isMobileChatLibraryOpen, setIsMobileChatLibraryOpen] = useState(false);

  const [advancedProfilesByPersonaId, setAdvancedProfilesByPersonaId] = useState({});
  const [loadingAdvancedProfileByPersonaId, setLoadingAdvancedProfileByPersonaId] = useState({});
  const [articleFeedbackView, setArticleFeedbackView] = useState(ARTICLE_FEEDBACK_VIEWS.LIST);
  const [articleInputMode, setArticleInputMode] = useState(ARTICLE_INPUT_MODES.URL);
  const [articleForm, setArticleForm] = useState(() => createEmptyArticleForm());
  const [articleFormError, setArticleFormError] = useState('');
  const [articleSearchQuery, setArticleSearchQuery] = useState('');
  const [articleTablePage, setArticleTablePage] = useState(1);
  const [articleTablePageSize, setArticleTablePageSize] = useState(10);
  const [articleRuns, setArticleRuns] = useState([]);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState(null);
  const [dbPersonaById, setDbPersonaById] = useState({});
  const [simulationSummaryById, setSimulationSummaryById] = useState({});

  const messageIdRef = useRef(2);
  const messageEndRef = useRef(null);
  const timeoutIdsRef = useRef([]);
  const pendingAdvancedProfileRef = useRef({});
  const isChatInputComposingRef = useRef(false);
  const projectSettingsLoadedRef = useRef(false);
  const savedMediaInfoRef = useRef({ title: '', overview: '' });

  // Persona generation modal state
  const [showPersonaGenerateModal, setShowPersonaGenerateModal] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [genTab, setGenTab] = useState('easy'); // 'easy' | 'segment'
  const [genEasyText, setGenEasyText] = useState('');
  const [genForm, setGenForm] = useState(() => ({ ...DEFAULT_GEN_FORM }));
  const [genFormError, setGenFormError] = useState('');
  const [occupationInput, setOccupationInput] = useState('');
  const [segmentDraft, setSegmentDraft] = useState({ name: '', value: '' });
  const [showSegmentForm, setShowSegmentForm] = useState(false);
  const [genProgress, setGenProgress] = useState(null); // null | { personaIndex, totalCount, step, stepDetail }
  const [genResults, setGenResults] = useState([]); // completed persona summaries
  const [genRunning, setGenRunning] = useState(false);
  const [avatarTick, setAvatarTick] = useState(0);
  const genAbortRef = useRef(null);

  // Cycle avatar tick every second during generation
  useEffect(() => {
    if (!genRunning) return;
    const timer = setInterval(() => setAvatarTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [genRunning]);

  // Load project settings, persona pool, and chat sessions in parallel on mount
  useEffect(() => {
    // Project settings
    fetch(`${API_BASE}/api/project-settings/`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.assigned_persona_ids?.length > 0) {
          setAssignedPersonaIds(data.assigned_persona_ids);
        }
        if (data.active_persona_id) {
          setActivePersonaId(data.active_persona_id);
        }
        if (data.media_info) {
          setMediaInfo(data.media_info);
          savedMediaInfoRef.current = data.media_info;
        }
        if (data.segment_settings) {
          setSegmentSettings(normalizeSegmentSettings(data.segment_settings));
        }
        if (Array.isArray(data.article_feedback_state?.article_runs)) {
          setArticleRuns(data.article_feedback_state.article_runs.map(normalizeArticleRun).filter(Boolean));
        }
        projectSettingsLoadedRef.current = true;
      })
      .catch(() => { projectSettingsLoadedRef.current = true; });

    // Persona pool
    fetch(`${API_BASE}/api/persona-pool/?limit=200`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        const pool = Array.isArray(data) ? data : [];
        setPersonaPool(pool);
        setPersonaPoolLoading(false);
        if (pool.length === 0 && !localStorage.getItem('personaai_onboarding_done')) {
          setIsOnboarding(true);
          setGenForm((prev) => ({ ...prev, count: 5 }));
          setShowPersonaGenerateModal(true);
        }
      })
      .catch(() => { setPersonaPool([]); setPersonaPoolLoading(false); });

    // Chat sessions
    loadChatSessions().catch(() => {});
  }, []);

  // Save assignedPersonaIds to DB whenever it changes (after initial load)
  useEffect(() => {
    if (!projectSettingsLoadedRef.current) return;
    fetch(`${API_BASE}/api/project-settings/`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ assigned_persona_ids: assignedPersonaIds }),
    }).catch(() => {});
  }, [assignedPersonaIds]);

  // Save mediaInfo to DB whenever it changes (after initial load) — debounced
  useEffect(() => {
    if (!projectSettingsLoadedRef.current) return;
    if (
      mediaInfo.title === savedMediaInfoRef.current.title &&
      mediaInfo.overview === savedMediaInfoRef.current.overview
    ) return;
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/project-settings/`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ media_info: mediaInfo }),
      })
        .then((res) => {
          if (res.ok) {
            savedMediaInfoRef.current = mediaInfo;
            setSavedSnackbar(true);
            setTimeout(() => setSavedSnackbar(false), 3000);
          }
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [mediaInfo]);

  // Save segmentSettings to DB whenever it changes (after initial load)
  useEffect(() => {
    if (!projectSettingsLoadedRef.current) return;
    fetch(`${API_BASE}/api/project-settings/`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ segment_settings: segmentSettings }),
    }).catch(() => {});
  }, [segmentSettings]);

  useEffect(() => {
    if (!projectSettingsLoadedRef.current) return;
    fetch(`${API_BASE}/api/project-settings/`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        article_feedback_state: {
          article_runs: articleRuns,
        },
      }),
    }).catch(() => {});
  }, [articleRuns]);

  useEffect(() => {
    if (!projectSettingsLoadedRef.current) return;
    fetch(`${API_BASE}/api/project-settings/`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ active_persona_id: activePersonaId }),
    }).catch(() => {});
  }, [activePersonaId]);

  const refreshPersonaPool = () => {
    fetch(`${API_BASE}/api/persona-pool/?limit=200`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => setPersonaPool(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const mergePersonasIntoCache = (personas) => {
    const normalized = normalizePersonaSnapshots(personas);
    if (normalized.length === 0) return;
    setDbPersonaById((prev) => {
      const next = { ...prev };
      normalized.forEach((persona) => {
        if (!persona.id) return;
        next[persona.id] = { ...(next[persona.id] || {}), ...persona };
      });
      return next;
    });
  };

  const upsertChatSession = (session) => {
    if (!session?.id) return;
    setChatSessions((prev) => {
      const next = [session, ...prev.filter((item) => item.id !== session.id)];
      return next.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    });
  };

  const loadChatSessions = async () => {
    setIsChatSessionsLoading(true);
    try {
      const data = await fetchPersonaChatSessions();
      const sessions = Array.isArray(data) ? data.map(normalizeChatSession).filter(Boolean) : [];
      setChatSessions(sessions);
      mergePersonasIntoCache(sessions.map((session) => session.persona).filter(Boolean));
    } catch {
      setChatSessions([]);
    } finally {
      setIsChatSessionsLoading(false);
    }
  };

  const handleOpenChatSession = async (chatId) => {
    if (!chatId || isChatStreaming) return;
    setSelectedChatId(chatId);
    setIsMobileChatLibraryOpen(false);
    setIsChatDetailLoading(true);
    try {
      const data = await fetchPersonaChatSession(chatId);
      const session = normalizeChatSession(data);
      if (!session) return;
      upsertChatSession(session);
      mergePersonasIntoCache(session.persona ? [session.persona] : []);
      setChatMessages(session.messages.length > 0 ? session.messages : createEmptyChatMessages());
      if (session.personaId && assignedPersonas.some((persona) => persona.id === session.personaId)) {
        setActivePersonaId(session.personaId);
      }
    } catch {
      setChatMessages([
        {
          id: `chat-error-${Date.now()}`,
          senderType: 'system',
          personaId: null,
          text: 'チャットの読み込みに失敗しました。',
          timestamp: formatChatTimeLabel(),
        }
      ]);
    } finally {
      setIsChatDetailLoading(false);
    }
  };

  const handleStartNewChat = () => {
    if (isChatStreaming) return;
    setSelectedChatId(null);
    setIsMobileChatLibraryOpen(false);
    setChatMessages(createEmptyChatMessages());
    setChatInput('');
    setIsChatDetailLoading(false);
  };


  const handleOpenPersonaGenerate = () => {
    // If generation is already running, just re-open the modal to show progress
    if (genRunning) {
      setShowPersonaGenerateModal(true);
      return;
    }
    setIsOnboarding(false);
    setGenTab('easy');
    setGenEasyText(mediaInfo.overview || '');
    setGenForm({ ...DEFAULT_GEN_FORM });
    setGenFormError('');
    setOccupationInput('');
    setSegmentDraft({ name: '', value: '' });
    setShowSegmentForm(false);
    setGenProgress(null);
    setGenResults([]);
    setGenRunning(false);
    setShowPersonaGenerateModal(true);
  };

  const handleClosePersonaGenerate = () => {
    setShowPersonaGenerateModal(false);
    if (isOnboarding) {
      localStorage.setItem('personaai_onboarding_done', '1');
      setIsOnboarding(false);
    }
    if (!genRunning && genResults.length > 0) {
      refreshPersonaPool();
    }
  };

  const handleCancelGenerate = () => {
    if (genAbortRef.current) {
      genAbortRef.current.abort();
      genAbortRef.current = null;
    }
    setGenRunning(false);
    setGenProgress(null);
    setGenResults([]);
    refreshPersonaPool();
  };

  const handleStartGenerate = async () => {
    // Easy mode: validate source text
    if (genTab === 'easy' && !genEasyText.trim()) {
      setGenFormError('記事タイトル・本文またはメディア概要を入力してください。');
      return;
    }

    const ageMin = genForm.age_min === '' ? null : Number(genForm.age_min);
    const ageMax = genForm.age_max === '' ? null : Number(genForm.age_max);
    if (
      genTab === 'segment' &&
      (
        (ageMin != null && Number.isNaN(ageMin)) ||
        (ageMax != null && Number.isNaN(ageMax)) ||
        (ageMin != null && ageMax != null && ageMin > ageMax)
      )
    ) {
      setGenFormError('年齢の最小値と最大値を正しく入力してください。');
      return;
    }

    const pendingOccupation = normalizeTagValue(occupationInput);
    const occupations = pendingOccupation
      ? appendUniqueTags(genForm.occupations, [pendingOccupation])
      : genForm.occupations;

    if (!getOpenAIKey()) {
      setGenFormError(API_KEY_MISSING_ERROR);
      return;
    }

    setGenFormError('');
    setGenRunning(true);
    setGenProgress({ personaIndex: 1, totalCount: genForm.count, step: 'starting', stepDetail: genTab === 'easy' ? 'テキストを解析中...' : '準備中...', attributeCount: 0, attributeRichness: Number(genForm.attribute_richness) || 200 });
    setGenResults([]);

    const body = {
      count: Number(genForm.count) || 1,
      attribute_richness: Number(genForm.attribute_richness) || 200,
    };

    if (genTab === 'easy') {
      body.source_text = genEasyText.trim();
    } else {
      if (ageMin != null) body.age_min = ageMin;
      if (ageMax != null) body.age_max = ageMax;
      if (genForm.gender) body.gender = genForm.gender;
      if (genForm.region_type) body.region_type = genForm.region_type;
      if (genForm.prefectures.length > 0) body.prefectures = genForm.prefectures;
      if (occupations.length > 0) body.occupations = occupations;
      if (genForm.segments.length > 0) body.extra_segments = genForm.segments;
    }

    try {
      if (occupations !== genForm.occupations || pendingOccupation) {
        setGenForm((prev) => ({ ...prev, occupations }));
        setOccupationInput('');
      }
      genAbortRef.current = new AbortController();
      const res = await fetch(`${API_BASE}/api/persona-pool/generate-stream`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: genAbortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `ペルソナ生成に失敗しました（HTTP ${res.status}）`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.done) {
              setGenProgress(null);
            } else if (event.step === 'completed') {
              setGenResults((prev) => [...prev, event.persona]);
              setAssignedPersonaIds((prev) =>
                prev.includes(event.persona.id) ? prev : [...prev, event.persona.id]
              );
              setGenProgress(null);
            } else {
              setGenProgress({
                personaIndex: event.persona_index,
                totalCount: event.total_count,
                step: event.step,
                stepDetail: event.step_detail,
                attributeCount: event.attribute_count ?? 0,
                attributeRichness: event.attribute_richness ?? (Number(genForm.attribute_richness) || 200),
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Generation error:', err);
        setGenFormError(err.message || 'ペルソナ生成に失敗しました。');
      }
    } finally {
      genAbortRef.current = null;
      setGenRunning(false);
    }
  };

  const toggleGenPrefecture = (prefecture) => {
    setGenForm((prev) => ({
      ...prev,
      prefectures: prev.prefectures.includes(prefecture)
        ? prev.prefectures.filter((item) => item !== prefecture)
        : [...prev.prefectures, prefecture],
    }));
  };

  const commitOccupationInput = (rawValue = occupationInput, finalizePending = false) => {
    const parsed = splitTagInput(rawValue);
    const nextPending = finalizePending ? '' : parsed.pending;
    const tagsToAdd = finalizePending && parsed.pending
      ? [...parsed.complete, parsed.pending]
      : parsed.complete;

    if (tagsToAdd.length > 0) {
      setGenForm((prev) => ({
        ...prev,
        occupations: appendUniqueTags(prev.occupations, tagsToAdd),
      }));
    }
    setOccupationInput(nextPending);
  };

  const removeOccupationTag = (target) => {
    setGenForm((prev) => ({
      ...prev,
      occupations: prev.occupations.filter((occupation) => occupation !== target),
    }));
  };

  const filteredPersonas = useMemo(() => {
    return personaPool.filter((persona) => {
      const ageOk = inAgeRange(persona.age, segmentSettings.age);
      const genderOk = segmentSettings.gender === '指定なし' || persona.gender === segmentSettings.gender;
      const locationOk = segmentSettings.location === '指定なし' || persona.region_type === segmentSettings.location;
      return ageOk && genderOk && locationOk;
    });
  }, [personaPool, segmentSettings]);

  const personaById = useMemo(() => {
    return Object.fromEntries(personaPool.map((persona) => [persona.id, persona]));
  }, [personaPool]);

  const assignedPersonas = useMemo(() => {
    return assignedPersonaIds
      .map((personaId) => personaById[personaId])
      .filter(Boolean);
  }, [assignedPersonaIds, personaById]);

  const selectedChatSummary = useMemo(() => {
    if (!selectedChatId) return null;
    return chatSessions.find((chat) => chat.id === selectedChatId) || null;
  }, [chatSessions, selectedChatId]);

  const visibleArticleRuns = useMemo(() => {
    const normalizedQuery = articleSearchQuery.trim().toLowerCase();
    const sorted = [...articleRuns].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
    if (!normalizedQuery) return sorted;

    return sorted.filter((article) => {
      const title = getArticleDisplayTitle(article).toLowerCase();
      const url = (article.url || '').toLowerCase();
      return title.includes(normalizedQuery) || url.includes(normalizedQuery);
    });
  }, [articleRuns, articleSearchQuery]);
  const articleTableTotalPages = Math.max(1, Math.ceil(visibleArticleRuns.length / articleTablePageSize));
  const paginatedArticleRuns = useMemo(() => {
    const start = (articleTablePage - 1) * articleTablePageSize;
    return visibleArticleRuns.slice(start, start + articleTablePageSize);
  }, [visibleArticleRuns, articleTablePage, articleTablePageSize]);
  const articleTableRangeStart = visibleArticleRuns.length === 0
    ? 0
    : (articleTablePage - 1) * articleTablePageSize + 1;
  const articleTableRangeEnd = Math.min(articleTablePage * articleTablePageSize, visibleArticleRuns.length);

  const selectedArticle = useMemo(() => {
    if (!selectedArticleId) return null;
    return articleRuns.find((article) => article.id === selectedArticleId) || null;
  }, [articleRuns, selectedArticleId]);

  const sortedSelectedFeedbacks = useMemo(() => {
    if (!selectedArticle) return [];

    const riskOrder = { high: 0, medium: 1, low: 2 };
    return [...selectedArticle.feedbacks].sort((left, right) => {
      const leftRisk = riskOrder[left.riskLevel] ?? 99;
      const rightRisk = riskOrder[right.riskLevel] ?? 99;
      if (leftRisk !== rightRisk) return leftRisk - rightRisk;
      return left.score - right.score;
    });
  }, [selectedArticle]);

  const selectedFeedback = useMemo(() => {
    if (!selectedArticle || !selectedFeedbackId) return null;
    return selectedArticle.feedbacks.find((feedback) => feedback.id === selectedFeedbackId) || null;
  }, [selectedArticle, selectedFeedbackId]);

  const selectedFeedbackPersona = useMemo(() => {
    if (!selectedFeedback) return null;
    return (
      selectedFeedback.persona ||
      dbPersonaById[selectedFeedback.personaId] ||
      personaById[selectedFeedback.personaId] ||
      null
    );
  }, [selectedFeedback, personaById, dbPersonaById]);

  const activePersona = useMemo(() => {
    if (!activePersonaId) return null;
    return assignedPersonas.find((persona) => persona.id === activePersonaId) || null;
  }, [activePersonaId, assignedPersonas]);

  const currentChatPersona = useMemo(() => {
    if (selectedChatSummary?.personaId) {
      return (
        personaById[selectedChatSummary.personaId] ||
        dbPersonaById[selectedChatSummary.personaId] ||
        selectedChatSummary.persona ||
        null
      );
    }
    return activePersona || null;
  }, [selectedChatSummary, activePersona, personaById, dbPersonaById]);

  const previewPersona = useMemo(() => {
    if (!previewPersonaId) return null;
    return personaById[previewPersonaId] || null;
  }, [previewPersonaId, personaById]);

  const totalCatalogPages = Math.max(1, Math.ceil(filteredPersonas.length / PERSONAS_PER_PAGE));

  const paginatedPersonas = useMemo(() => {
    const start = (catalogPage - 1) * PERSONAS_PER_PAGE;
    return filteredPersonas.slice(start, start + PERSONAS_PER_PAGE);
  }, [catalogPage, filteredPersonas]);

  const visiblePageNumbers = useMemo(() => {
    const half = Math.floor(PAGE_WINDOW_SIZE / 2);
    const start = Math.max(1, Math.min(catalogPage - half, totalCatalogPages - PAGE_WINDOW_SIZE + 1));
    const end = Math.min(totalCatalogPages, start + PAGE_WINDOW_SIZE - 1);
    return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
  }, [catalogPage, totalCatalogPages]);


  useEffect(() => {
    if (assignedPersonas.length === 0) {
      setActivePersonaId(null);
      return;
    }

    if (!activePersonaId || !assignedPersonas.some((persona) => persona.id === activePersonaId)) {
      setActivePersonaId(assignedPersonas[0].id);
    }
  }, [assignedPersonas, activePersonaId]);

  useEffect(() => {
    setCatalogPage(1);
  }, [segmentSettings]);

  useEffect(() => {
    if (catalogPage > totalCatalogPages) {
      setCatalogPage(totalCatalogPages);
    }
  }, [catalogPage, totalCatalogPages]);

  useEffect(() => {
    setArticleTablePage(1);
  }, [articleSearchQuery, articleTablePageSize]);

  useEffect(() => {
    if (articleTablePage > articleTableTotalPages) {
      setArticleTablePage(articleTableTotalPages);
    }
  }, [articleTablePage, articleTableTotalPages]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  useEffect(() => {
    if (!previewPersonaId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPreviewPersonaId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewPersonaId]);

  useEffect(() => {
    if (!currentChatPersona?.id) return;
    requestAdvancedPersonaProfile(currentChatPersona.id);
  }, [currentChatPersona?.id]);

  useEffect(() => {
    if (!selectedArticleId) return;
    if (articleRuns.some((article) => article.id === selectedArticleId)) return;
    setSelectedArticleId(null);
    setSelectedFeedbackId(null);
    setArticleFeedbackView(ARTICLE_FEEDBACK_VIEWS.LIST);
  }, [articleRuns, selectedArticleId]);

  useEffect(() => {
    if (!selectedArticle || !selectedFeedbackId) return;
    if (selectedArticle.feedbacks.some((feedback) => feedback.id === selectedFeedbackId)) return;
    setSelectedFeedbackId(null);
    if (articleFeedbackView === ARTICLE_FEEDBACK_VIEWS.DETAIL) {
      setArticleFeedbackView(ARTICLE_FEEDBACK_VIEWS.RESULTS);
    }
  }, [selectedArticle, selectedFeedbackId, articleFeedbackView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextSection = normalizeSectionId(activeSection);
    const url = new URL(window.location.href);
    url.searchParams.set(SECTION_QUERY_PARAM, nextSection);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeSection]);

  const appendMessage = (senderType, text, personaId = null) => {
    setChatMessages((prev) => [
      ...prev,
      {
        id: messageIdRef.current++,
        senderType,
        personaId,
        text,
        timestamp: formatChatTimeLabel(),
      }
    ]);
  };

  const requestAdvancedPersonaProfile = (personaId) => {
    if (advancedProfilesByPersonaId[personaId] !== undefined) return;
    if (pendingAdvancedProfileRef.current[personaId]) return;

    pendingAdvancedProfileRef.current[personaId] = true;
    setLoadingAdvancedProfileByPersonaId((prev) => ({ ...prev, [personaId]: true }));

    fetch(`${API_BASE}/api/persona-pool/${personaId}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setAdvancedProfilesByPersonaId((prev) => ({
          ...prev,
          [personaId]: data?.structured_attributes || null,
        }));
      })
      .catch(() => {
        setAdvancedProfilesByPersonaId((prev) => ({ ...prev, [personaId]: null }));
      })
      .finally(() => {
        delete pendingAdvancedProfileRef.current[personaId];
        setLoadingAdvancedProfileByPersonaId((prev) => {
          const next = { ...prev };
          delete next[personaId];
          return next;
        });
      });
  };

  const resolveAdvancedProfile = (personaId) => {
    return advancedProfilesByPersonaId[personaId] ?? null;
  };

  const openPreviewPersona = (personaId) => {
    setPreviewPersonaId(personaId);
    requestAdvancedPersonaProfile(personaId);
  };

  const togglePersonaAssignment = (personaId) => {
    const persona = personaById[personaId];
    if (!persona) return;

    setAssignedPersonaIds((prev) => {
      const exists = prev.includes(personaId);
      if (exists) {
        appendMessage('system', `${persona.name}さんをプロジェクトから外しました。`);
        return prev.filter((id) => id !== personaId);
      }
      appendMessage('system', `${persona.name}さんをプロジェクトに追加しました。`);
      requestAdvancedPersonaProfile(personaId);
      return [...prev, personaId];
    });
  };

  const handleSendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || isChatStreaming) return;

    if (!getOpenAIKey()) {
      appendMessage('system', API_KEY_MISSING_ERROR);
      return;
    }

    const responder = currentChatPersona || assignedPersonas[Math.floor(Math.random() * assignedPersonas.length)];
    if (!responder?.id) {
      appendMessage('system', '先に「設定」でペルソナを選択してください。');
      return;
    }

    setChatInput('');

    let chatId = selectedChatId;
    if (!chatId) {
      try {
        const created = normalizeChatSession(await createPersonaChatSession(responder.id));
        if (created) {
          upsertChatSession(created);
          mergePersonasIntoCache(created.persona ? [created.persona] : []);
          setSelectedChatId(created.id);
          chatId = created.id;
        }
      } catch {
        appendMessage('system', 'チャットの作成に失敗しました。');
        return;
      }
    }

    appendMessage('user', trimmed);

    const streamId = messageIdRef.current++;
    setChatMessages((prev) => [
      ...prev,
      {
        id: streamId,
        senderType: 'persona',
        personaId: responder.id,
        text: '',
        timestamp: formatChatTimeLabel(),
      },
    ]);

    setIsChatStreaming(true);
    try {
      const response = await fetch(`${API_BASE}/api/persona/chats/${chatId}/stream`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: trimmed,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat stream request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const text = line.slice(6);
          if (text === '[DONE]') break;
          accumulated += text;
          setChatMessages((prev) =>
            prev.map((m) => (m.id === streamId ? { ...m, text: accumulated } : m))
          );
        }
      }
      await loadChatSessions();
    } catch {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === streamId ? { ...m, text: 'エラーが発生しました。', senderType: 'system' } : m
        )
      );
    } finally {
      setIsChatStreaming(false);
    }
  };

  const openArticleList = () => {
    setArticleFeedbackView(ARTICLE_FEEDBACK_VIEWS.LIST);
    setSelectedFeedbackId(null);
  };

  const openArticleCreate = () => {
    setArticleInputMode(ARTICLE_INPUT_MODES.URL);
    setArticleForm(createEmptyArticleForm());
    setArticleFormError('');
    setSelectedArticleId(null);
    setSelectedFeedbackId(null);
    setArticleFeedbackView(ARTICLE_FEEDBACK_VIEWS.CREATE);
  };

  const openArticleResults = (articleId) => {
    setSelectedArticleId(articleId);
    setSelectedFeedbackId(null);
    setArticleFeedbackView(ARTICLE_FEEDBACK_VIEWS.RESULTS);
  };

  const openArticleDetail = (articleId, feedbackId) => {
    setSelectedArticleId(articleId);
    setSelectedFeedbackId(feedbackId);
    setArticleFeedbackView(ARTICLE_FEEDBACK_VIEWS.DETAIL);
  };

  const handleDeleteArticle = (articleId) => {
    setArticleRuns((prev) => prev.filter((article) => article.id !== articleId));
  };

  const handleCancelArticle = (articleId) => {
    setArticleRuns((prev) =>
      prev.map((article) =>
        article.id !== articleId || article.status !== 'running' ? article : {
          ...article,
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        }
      )
    );
  };

  const handleCreateAndRunFeedback = () => {
    const title = articleForm.title.trim();
    const body = articleForm.body.trim();
    const url = articleForm.url.trim();
    const isUrlMode = articleInputMode === ARTICLE_INPUT_MODES.URL;
    const targetPersonas = assignedPersonas.map(normalizePersonaSnapshot).filter(Boolean);
    const targetPersonaIds = targetPersonas.map((persona) => persona.id).filter(Boolean);

    if (targetPersonaIds.length === 0) {
      setArticleFormError('設定で対象ペルソナを選択してください。');
      return;
    }

    if (isUrlMode) {
      if (!url) {
        setArticleFormError('URLを入力してください。');
        return;
      }
      if (!isLikelyHttpUrl(url)) {
        setArticleFormError('URLは http:// または https:// から始まる形式で入力してください。');
        return;
      }
    } else if (!title || !body) {
      setArticleFormError('タイトルと本文を入力してください。');
      return;
    }

    if (!getOpenAIKey()) {
      setArticleFormError(API_KEY_MISSING_ERROR);
      return;
    }

    setArticleFormError('');

    const now = new Date().toISOString();
    const articleId = createLocalArticleId();
    const nextArticle = {
      id: articleId,
      inputMode: articleInputMode,
      title: isUrlMode ? '' : title,
      body: isUrlMode ? '' : body,
      url: isUrlMode ? url : '',
      status: 'running',
      personaCount: targetPersonaIds.length,
      completedCount: 0,
      feedbacks: [],
      averageScore: null,
      createdAt: now,
      updatedAt: now,
      targetPersonaIds,
      targetPersonas,
    };

    setArticleRuns((prev) => [nextArticle, ...prev]);
    setSelectedArticleId(articleId);
    setSelectedFeedbackId(null);
    setArticleFeedbackView(ARTICLE_FEEDBACK_VIEWS.RESULTS);
    setArticleForm(createEmptyArticleForm());

    (async () => {
      try {
        let articleContent;
        let useMediaDescription = mediaInfo.overview || '';
        if (isUrlMode) {
          // URLから記事本文をスクレイピング
          const scraped = await scrapeUrl(url);
          articleContent = scraped.content;
          // タイトルが取れた場合は記事エントリに反映
          if (scraped.title) {
            setArticleRuns((prev) =>
              prev.map((a) => a.id !== articleId ? a : { ...a, title: scraped.title })
            );
          }
          // URLモードでもメディア概要がある場合は渡す（スクレイプからdescriptionは取れないため）
        } else {
          articleContent = `# ${title}\n\n${body}`;
        }

        const simulation = await runSimulation({
          articleContent,
          personaCount: targetPersonaIds.length,
          selectedPersonaIds: targetPersonaIds,
          mediaDescription: useMediaDescription,
          model: selectedModel,
        });

        // ポーリングで進捗を監視（1秒ごと）
        await new Promise((resolve, reject) => {
          const timer = setInterval(async () => {
            try {
              // キャンセルされていたら中断
              setArticleRuns((prev) => {
                const article = prev.find((a) => a.id === articleId);
                if (article?.status === 'cancelled') {
                  clearInterval(timer);
                  reject(new Error('cancelled'));
                }
                return prev;
              });

              const latest = await fetchSimulation(simulation.id);
              setArticleRuns((prev) =>
                prev.map((a) =>
                  a.id !== articleId || a.status === 'cancelled' ? a : {
                    ...a,
                    completedCount: latest.completed_feedback_count,
                  }
                )
              );

              if (latest.status === 'completed' || latest.status === 'failed') {
                clearInterval(timer);
                resolve();
              }
            } catch (err) {
              clearInterval(timer);
              reject(err);
            }
          }, 1000);
        });

        const apiFeedbacks = await fetchSimulationFeedbacks(simulation.id);

        const personaIds = [...new Set(apiFeedbacks.map((f) => f.persona_id))];
        const personaMap = await fetchPersonasByIds(personaIds);
        const displayMap = {};
        Object.entries(personaMap).forEach(([id, p]) => {
          displayMap[id] = dbPersonaToDisplay(p);
        });
        setDbPersonaById((prev) => ({ ...prev, ...displayMap }));

        const feedbacks = apiFeedbacks.map((feedback) =>
          mapApiFeedbackToLocal(
            feedback,
            displayMap[feedback.persona_id] || targetPersonas.find((persona) => persona.id === feedback.persona_id) || null
          )
        );
        const averageScore = feedbacks.length > 0
          ? Math.round(feedbacks.reduce((s, f) => s + f.score, 0) / feedbacks.length)
          : null;

        setArticleRuns((prev) =>
          prev.map((article) =>
            article.id !== articleId || article.status === 'cancelled' ? article : {
              ...article,
              feedbacks,
              completedCount: feedbacks.length,
              averageScore,
              status: 'completed',
              simulationId: simulation.id,
              updatedAt: new Date().toISOString(),
            }
          )
        );

        const summary = await fetchSimulationSummary(simulation.id);
        if (summary) {
          setSimulationSummaryById((prev) => ({ ...prev, [simulation.id]: summary }));
        }
      } catch (err) {
        console.error('Simulation error:', err);
        setArticleRuns((prev) =>
          prev.map((article) =>
            article.id !== articleId || article.status === 'cancelled' ? article : {
              ...article,
              status: 'failed',
              updatedAt: new Date().toISOString(),
            }
          )
        );
      }
    })();
  };

  const activeAdvancedProfile = currentChatPersona ? resolveAdvancedProfile(currentChatPersona.id) : null;
  const activeAdvancedProfileLoading = currentChatPersona ? Boolean(loadingAdvancedProfileByPersonaId[currentChatPersona.id]) : false;
  const previewAdvancedProfile = previewPersona ? resolveAdvancedProfile(previewPersona.id) : null;
  const previewAdvancedProfileLoading = previewPersona ? Boolean(loadingAdvancedProfileByPersonaId[previewPersona.id]) : false;
  const activePersonaInterests = normalizeTaxonomyValue(currentChatPersona?.interests);
  const previewPersonaInterests = normalizeTaxonomyValue(previewPersona?.interests);
  const activeHasStructuredProfile = hasStructuredProfileContent(activeAdvancedProfile);
  const previewHasStructuredProfile = hasStructuredProfileContent(previewAdvancedProfile);

  const renderSettings = () => {
    const outOfFilterCount = assignedPersonas.filter((persona) => !filteredPersonas.some((item) => item.id === persona.id)).length;
    const visibleStart = filteredPersonas.length === 0 ? 0 : (catalogPage - 1) * PERSONAS_PER_PAGE + 1;
    const visibleEnd = Math.min(catalogPage * PERSONAS_PER_PAGE, filteredPersonas.length);

    return (
      <section className="h-full overflow-y-auto p-4 lg:p-5">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">設定</h2>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">OpenAI APIキー</h3>

            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-..."
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('openai_api_key', apiKeyInput);
                  setApiKeySaved(true);
                  setTimeout(() => setApiKeySaved(false), 2000);
                }}
                className={BUTTON_PRIMARY_CLASS}
              >
                {apiKeySaved ? '保存済み ✓' : '保存'}
              </button>
              {apiKeyInput && (
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('openai_api_key');
                    setApiKeyInput('');
                  }}
                  className={BUTTON_SECONDARY_CLASS}
                >
                  削除
                </button>
              )}
            </div>
            {!localStorage.getItem('openai_api_key') && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ APIキーが未設定です。AI機能を使用するには設定してください。
              </p>
            )}
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">使用モデル</label>
              <div className="relative inline-block">
              <select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  localStorage.setItem('openai_model', e.target.value);
                }}
                className="appearance-none rounded-lg border border-border bg-background pl-3 pr-8 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="gpt-5-mini">gpt-5-mini（デフォルト）</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-5">gpt-5</option>
                <option value="gpt-5.1">gpt-5.1</option>
                <option value="gpt-5.2">gpt-5.2</option>
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
              </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">メディア情報</h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="media-title" className="mb-1 block text-xs text-muted-foreground">タイトル</label>
                <input
                  id="media-title"
                  type="text"
                  value={mediaInfo.title}
                  onChange={(e) => setMediaInfo((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="メディア名を入力"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor="media-overview" className="mb-1 block text-xs text-muted-foreground">メディア概要</label>
                <textarea
                  id="media-overview"
                  value={mediaInfo.overview}
                  onChange={(e) => setMediaInfo((prev) => ({ ...prev, overview: e.target.value }))}
                  placeholder="メディアの概要を入力"
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">セグメント設定</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="segment-age" className="mb-1 block text-xs text-muted-foreground">年齢</label>
                <SelectField
                  id="segment-age"
                  value={segmentSettings.age}
                  onChange={(event) => setSegmentSettings((prev) => ({ ...prev, age: event.target.value }))}
                >
                  {AGE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </SelectField>
              </div>
              <div>
                <label htmlFor="segment-gender" className="mb-1 block text-xs text-muted-foreground">性別</label>
                <SelectField
                  id="segment-gender"
                  value={segmentSettings.gender}
                  onChange={(event) => setSegmentSettings((prev) => ({ ...prev, gender: event.target.value }))}
                >
                  {GENDER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </SelectField>
              </div>
              <div>
                <label htmlFor="segment-location" className="mb-1 block text-xs text-muted-foreground">居住地</label>
                <SelectField
                  id="segment-location"
                  value={segmentSettings.location}
                  onChange={(event) => setSegmentSettings((prev) => ({ ...prev, location: event.target.value }))}
                >
                  {LOCATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectField>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">候補ペルソナ選択</h2>
                <p className="text-xs text-muted-foreground">
                  全{personaPool.length.toLocaleString()}名中、該当セグメント: {filteredPersonas.length.toLocaleString()}名
                </p>
              </div>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={handleOpenPersonaGenerate}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  <Plus size={13} />
                  ペルソナ新規作成
                </button>
              </div>
            </div>

            <div className="mb-4 rounded-lg border border-border bg-secondary p-3">
              <p className="mb-2 text-xs font-medium text-secondary-foreground">選択済みペルソナ（上部固定表示）</p>
              {assignedPersonas.length === 0 ? (
                <p className="text-xs text-secondary-foreground">まだ選択されていません。下の一覧から追加してください。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {assignedPersonas.map((persona) => (
                    <button
                      key={`selected-${persona.id}`}
                      type="button"
                      onClick={() => togglePersonaAssignment(persona.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-transparent bg-primary px-2.5 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Avatar persona={persona} size="h-6 w-6" />
                      <span>{getSelectedPersonaLabel(persona)}</span>
                      <span className="text-primary-foreground">×</span>
                    </button>
                  ))}
                </div>
              )}
              {genRunning && !showPersonaGenerateModal && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {genProgress ? (
                    <>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>ペルソナ {genProgress.personaIndex} / {genProgress.totalCount} を生成中</span>
                        <Loader2 size={12} className="animate-spin" />
                      </div>
                      <p className="text-xs font-medium text-foreground">{genProgress.stepDetail}</p>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{
                            width: `${Math.round(
                              (((genProgress.personaIndex - 1) * genProgress.attributeRichness + genProgress.attributeCount) /
                                (genProgress.totalCount * genProgress.attributeRichness)) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 size={12} className="animate-spin" />
                      <span>生成中...</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleCancelGenerate}
                    className="inline-flex rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                  >
                    生成をキャンセル
                  </button>
                </div>
              )}
            </div>

            {outOfFilterCount > 0 && (
              <div className="mb-4 rounded-md border border-border bg-accent px-3 py-2 text-xs text-accent-foreground">
                現在のセグメント外に選択済みペルソナが {outOfFilterCount} 名います。
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {paginatedPersonas.map((persona) => {
                const assigned = assignedPersonaIds.includes(persona.id);
                return (
                  <article
                    key={persona.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openPreviewPersona(persona.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openPreviewPersona(persona.id);
                      }
                    }}
                    className="cursor-pointer rounded-lg border border-border bg-muted p-4 transition-colors hover:border-border"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <Avatar persona={persona} size="h-11 w-11" />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {persona.name || persona.display_name || `${persona.age}歳・${persona.gender}`}
                          <span className="ml-1 font-normal text-muted-foreground">({persona.age}歳・{persona.gender})</span>
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {persona.one_line_summary || persona.occupation}
                        </p>
                      </div>
                    </div>

                    <p className="mb-3 text-xs leading-relaxed text-muted-foreground line-clamp-3">{persona.personal_values}</p>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        togglePersonaAssignment(persona.id);
                      }}
                      className={`w-full rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        assigned
                          ? 'bg-primary text-primary-foreground hover:opacity-90'
                          : 'border border-border bg-secondary text-secondary-foreground hover:bg-accent'
                      }`}
                    >
                      {assigned ? '選択中（クリックで解除）' : 'プロジェクトに追加'}
                    </button>
                  </article>
                );
              })}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              表示: {visibleStart.toLocaleString()}-{visibleEnd.toLocaleString()} / {filteredPersonas.length.toLocaleString()}件
            </p>

            {totalCatalogPages > 1 && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setCatalogPage((prev) => Math.max(1, prev - 1))}
                  disabled={catalogPage === 1}
                  className={BUTTON_SECONDARY_CLASS}
                >
                  前へ
                </button>

                {visiblePageNumbers.map((pageNumber) => (
                  <button
                    key={`page-${pageNumber}`}
                    type="button"
                    onClick={() => setCatalogPage(pageNumber)}
                    className={`inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      pageNumber === catalogPage
                        ? 'border-border bg-secondary text-secondary-foreground'
                        : 'border-border bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {pageNumber}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setCatalogPage((prev) => Math.min(totalCatalogPages, prev + 1))}
                  disabled={catalogPage === totalCatalogPages}
                  className={BUTTON_SECONDARY_CLASS}
                >
                  次へ
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderPersona = () => {
    if (assignedPersonas.length === 0) {
      return (
        <section className="h-full p-4 lg:p-5">
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">ペルソナ</h2>
            </div>

            <div className="min-h-0 flex-1">
              <EmptyState
                title="ペルソナが未設定です"
                description="まず「設定」でセグメントを決め、プロジェクトにペルソナを追加してください。"
                onOpenSettings={() => setActiveSection('settings')}
              />
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="h-full p-4 lg:p-5">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">ペルソナ</h2>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 xl:grid-cols-[1fr_340px] xl:grid-rows-none">
            <div className="order-2 flex h-full min-h-0 flex-col rounded-xl border border-border bg-card xl:order-1">
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-start justify-end gap-3">
                  <div className="text-right">
                    <p className="text-xs font-medium text-foreground">
                      {selectedChatSummary ? selectedChatSummary.title : '新規チャット'}
                    </p>
                    {currentChatPersona ? (
                      <p className="text-[11px] text-muted-foreground">{getPersonaChatLabel(currentChatPersona)}</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {isChatDetailLoading ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    チャットを読み込んでいます...
                  </div>
                ) : (
                  <>
                    {chatMessages.map((message) => {
                      if (message.senderType === 'system') {
                        return (
                          <p key={message.id} className="text-center text-[11px] text-muted-foreground">
                            {message.text}
                          </p>
                        );
                      }

                      if (message.senderType === 'user') {
                        return (
                          <div key={message.id} className="flex justify-end">
                            <div className="max-w-[85%]">
                              <div className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                                <p>{message.text}</p>
                              </div>
                              <p className="mt-1 text-right text-[10px] text-muted-foreground">{message.timestamp}</p>
                            </div>
                          </div>
                        );
                      }

                      const persona =
                        (message.personaId ? dbPersonaById[message.personaId] : null) ||
                        (message.personaId ? personaById[message.personaId] : null) ||
                        currentChatPersona;
                      return (
                        <div key={message.id} className="flex items-start gap-2">
                          {persona ? <Avatar persona={persona} size="h-7 w-7" /> : null}
                          <div className="max-w-[88%]">
                            <p className="mb-1 text-[11px] text-muted-foreground">
                              {getPersonaChatLabel(persona)}
                            </p>
                            <div className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground">
                              <p>{message.text}</p>
                            </div>
                            <p className="mt-1 text-[10px] text-muted-foreground">{message.timestamp}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messageEndRef} />
                  </>
                )}
              </div>

              <div className="border-t border-border px-4 py-3">
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-2">
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onCompositionStart={() => {
                      isChatInputComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      isChatInputComposingRef.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        const nativeEvent = event.nativeEvent;
                        const isComposing =
                          nativeEvent.isComposing || nativeEvent.keyCode === 229 || isChatInputComposingRef.current;
                        if (isComposing) return;
                        event.preventDefault();
                        handleSendChat();
                      }
                    }}
                    rows={1}
                    disabled={isChatDetailLoading}
                    placeholder="例：最近おもしろかったネット記事やニュースは何？"
                    className="min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={handleSendChat}
                    disabled={!chatInput.trim() || isChatStreaming || isChatDetailLoading}
                    aria-label="送信"
                    className="inline-flex items-center justify-center self-center rounded-md bg-primary p-2 text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </div>

            <aside className="order-1 min-h-0 xl:order-2">
              <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
              <div className="rounded-lg border border-border bg-card p-4">
                <PersonaSwitcher
                  personas={assignedPersonas}
                  selectedId={activePersonaId}
                  onChange={setActivePersonaId}
                  inputId="persona-switcher-sidebar"
                  disabled={isChatStreaming}
                />
              </div>

              {currentChatPersona && (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <Avatar persona={currentChatPersona} size="h-10 w-10" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{getPersonaChatLabel(currentChatPersona)}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {currentChatPersona.one_line_summary || currentChatPersona.occupation}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    {activePersonaInterests ? (
                      <p className="mb-3 text-sm leading-relaxed text-foreground">{activePersonaInterests}</p>
                    ) : null}
                    <div className="mt-4">
                      {activeAdvancedProfileLoading ? (
                        <div className="flex min-h-[120px] items-center justify-center gap-2 rounded-md border border-border bg-muted p-3">
                          <Loader2 size={14} className="animate-spin text-secondary-foreground" />
                          <p className="text-xs text-muted-foreground">属性データを読み込んでいます...</p>
                        </div>
                      ) : activeHasStructuredProfile ? (
                        <StructuredProfilePanel profile={activeAdvancedProfile} />
                      ) : (
                        <div className="rounded-md border border-border bg-muted px-3 py-4 text-xs text-muted-foreground">
                          属性データがありません。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border bg-card p-4">
                <button
                  type="button"
                  onClick={() => setIsMobileChatLibraryOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 text-left xl:hidden"
                >
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedChatSummary ? selectedChatSummary.title : '新規チャットを開始'}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`text-muted-foreground transition-transform ${isMobileChatLibraryOpen ? 'rotate-90' : ''}`}
                  />
                </button>

                <div className={`${isMobileChatLibraryOpen ? 'mt-3 block' : 'hidden'} xl:mt-0 xl:block`}>
                  <div className="flex items-center justify-between gap-3">
                    {isChatSessionsLoading ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : null}
                  </div>
                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    disabled={isChatStreaming}
                    className={`mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                      selectedChatId === null
                        ? 'border-border bg-secondary text-secondary-foreground'
                        : 'border-border bg-muted text-foreground hover:border-ring'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <Plus size={14} />
                    新規チャット
                  </button>
                  <div className="mt-3 space-y-2">
                    {chatSessions.length === 0 && !isChatSessionsLoading ? (
                      <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                        保存済みチャットはまだありません。
                      </div>
                    ) : null}
                    {chatSessions.map((chat) => {
                      const persona = chat.persona || dbPersonaById[chat.personaId] || null;
                      return (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => handleOpenChatSession(chat.id)}
                          disabled={isChatStreaming}
                          className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                            selectedChatId === chat.id
                              ? 'border-border bg-secondary'
                              : 'border-border bg-muted hover:border-ring'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <div className="flex items-start gap-2">
                            {persona ? <Avatar persona={persona} size="h-8 w-8" /> : null}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-medium text-foreground">{chat.title}</p>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {formatChatSessionDateLabel(chat.lastMessageAt || chat.updatedAt)}
                                </span>
                              </div>
                              {persona ? (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">{getPersonaChatLabel(persona)}</p>
                              ) : null}
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {chat.preview || '会話を続けるにはこのチャットを開いてください。'}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    );
  };

  const renderArticleFeedback = () => {
    if (assignedPersonas.length === 0) {
      return (
        <EmptyState
          title="ペルソナが未設定です"
          description="記事フィードバックは、設定でプロジェクトに追加したペルソナを対象に実行します。"
          onOpenSettings={() => setActiveSection('settings')}
        />
      );
    }

    if (articleFeedbackView === ARTICLE_FEEDBACK_VIEWS.CREATE) {
      return (
        <section className="h-full overflow-y-auto p-4 lg:p-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={openArticleList}
                className={BUTTON_TERTIARY_CLASS}
              >
                <ChevronLeft size={14} />
                一覧に戻る
              </button>
              <p className="text-xs text-muted-foreground">対象ペルソナ: 設定で選択した {assignedPersonas.length}名</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-base font-semibold text-foreground">記事入力</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                設定で選択したペルソナ全員を対象にフィードバックを取得します。
              </p>

              <div className="mt-5 space-y-4">
                <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                  対象: {assignedPersonas.length}名
                </div>

                <fieldset>
                  <legend className="mb-2 block text-xs text-muted-foreground">入力方式</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name="article-input-mode"
                        checked={articleInputMode === ARTICLE_INPUT_MODES.URL}
                        onChange={() => {
                          setArticleInputMode(ARTICLE_INPUT_MODES.URL);
                          setArticleFormError('');
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                      URL
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name="article-input-mode"
                        checked={articleInputMode === ARTICLE_INPUT_MODES.CONTENT}
                        onChange={() => {
                          setArticleInputMode(ARTICLE_INPUT_MODES.CONTENT);
                          setArticleFormError('');
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                      タイトル+本文
                    </label>
                  </div>
                </fieldset>

                {articleInputMode === ARTICLE_INPUT_MODES.URL ? (
                  <div>
                    <label htmlFor="article-url" className="mb-1 block text-xs text-muted-foreground">
                      記事URL（これだけで実行できます）
                    </label>
                    <input
                      id="article-url"
                      type="url"
                      value={articleForm.url}
                      onChange={(event) =>
                        setArticleForm((prev) => ({ ...prev, url: event.target.value }))
                      }
                      placeholder="https://example.com/article"
                      className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label htmlFor="article-title" className="mb-1 block text-xs text-muted-foreground">
                        タイトル
                      </label>
                      <input
                        id="article-title"
                        type="text"
                        value={articleForm.title}
                        onChange={(event) =>
                          setArticleForm((prev) => ({ ...prev, title: event.target.value }))
                        }
                        placeholder="例: オンボーディング改善で離脱率を下げる方法"
                        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="article-body" className="mb-1 block text-xs text-muted-foreground">
                        本文
                      </label>
                      <textarea
                        id="article-body"
                        value={articleForm.body}
                        onChange={(event) =>
                          setArticleForm((prev) => ({ ...prev, body: event.target.value }))
                        }
                        rows={9}
                        placeholder="本文を貼り付けてください"
                        className="w-full resize-y rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                      />
                    </div>
                  </>
                )}
              </div>

              {articleFormError && (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {articleFormError}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={openArticleList}
                  className={BUTTON_SECONDARY_CLASS}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleCreateAndRunFeedback}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  <Sparkles size={14} />
                  フィードバック実行
                </button>
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (articleFeedbackView === ARTICLE_FEEDBACK_VIEWS.RESULTS) {
      if (!selectedArticle) {
        return (
          <section className="h-full overflow-y-auto p-4 lg:p-5">
            <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
              <div>
                <p className="text-sm text-muted-foreground">表示できる記事がありません。</p>
                <button
                  type="button"
                  onClick={openArticleList}
                  className={`mt-3 ${BUTTON_SECONDARY_CLASS}`}
                >
                  一覧に戻る
                </button>
              </div>
            </div>
          </section>
        );
      }

      const statusMeta = getArticleRunStatusMeta(selectedArticle.status);
      return (
        <section className="h-full overflow-y-auto p-4 lg:p-5">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={openArticleList}
                className={BUTTON_TERTIARY_CLASS}
              >
                <ChevronLeft size={14} />
                記事一覧へ
              </button>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">{getArticleDisplayTitle(selectedArticle)}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedArticle.url || '本文入力で作成'}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusMeta.badgeClass}`}>
                  {statusMeta.label}
                </span>
              </div>

              <div className="mt-4 flex items-start gap-4">
                {(() => {
                  const personas = selectedArticle.targetPersonas?.length > 0
                    ? selectedArticle.targetPersonas
                    : selectedArticle.feedbacks.map((f) => f.persona).filter(Boolean);
                  if (personas.length === 0) return null;
                  const isRunning = selectedArticle.status === 'running';
                  const waveCount = personas.length;
                  return (
                    <div className="flex-shrink-0">
                      <p className="text-xs text-muted-foreground">対象ペルソナ</p>
                      <div className="mt-2 flex items-end" style={{ paddingBottom: isRunning ? 8 : 0 }}>
                        {personas.map((persona, i) => (
                          <div
                            key={persona.id || i}
                            title={persona.name || persona.display_name}
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: '50%',
                              overflow: 'hidden',
                              border: '2px solid white',
                              marginLeft: i === 0 ? 0 : -10,
                              flexShrink: 0,
                              position: 'relative',
                              zIndex: personas.length - i,
                              background: '#f3f4f6',
                              ...(isRunning ? {
                                animation: `persona-wave 1.2s ease-in-out infinite`,
                                animationDelay: `${(i / waveCount) * 1.2}s`,
                              } : {}),
                            }}
                          >
                            <img
                              src={getDiceBearUrl(persona)}
                              alt={persona.name || persona.display_name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              loading="lazy"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-3 gap-6 text-xs text-muted-foreground">
                  <div>
                    <p>実行時刻</p>
                    <p className="mt-1 text-sm text-foreground">{formatDateTime(selectedArticle.createdAt)}</p>
                  </div>
                  <div>
                    <p>完了件数</p>
                    <p className="mt-1 text-sm text-foreground">
                      {selectedArticle.completedCount}/{selectedArticle.personaCount}
                    </p>
                  </div>
                  <div>
                    <p>平均スコア</p>
                    <p className="mt-1 text-sm text-foreground">
                      {selectedArticle.averageScore ?? '-'}
                    </p>
                  </div>
                </div>
              </div>

              {selectedArticle.status === 'running' && (
                <div className="mt-4">
                  <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="absolute h-full bg-primary transition-all duration-500"
                      style={{
                        width: selectedArticle.personaCount > 0
                          ? `${Math.min((selectedArticle.completedCount / selectedArticle.personaCount) * 100, 95)}%`
                          : '0%',
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      ペルソナが記事を閲覧中… ({selectedArticle.completedCount}/{selectedArticle.personaCount})
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCancelArticle(selectedArticle.id)}
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">フィードバック結果一覧</h3>
                <p className="text-xs text-muted-foreground">{sortedSelectedFeedbacks.length}件</p>
              </div>

              {sortedSelectedFeedbacks.length === 0 ? (
                <div className="flex min-h-[140px] items-center justify-center gap-2 rounded-md border border-border bg-muted p-3">
                  {selectedArticle.status === 'failed' ? (
                    <p className="text-xs text-red-500">シミュレーションに失敗しました。再度お試しください。</p>
                  ) : selectedArticle.status === 'cancelled' ? (
                    <p className="text-xs text-muted-foreground">キャンセルされました。</p>
                  ) : (
                    <>
                      <Loader2 size={14} className="animate-spin text-secondary-foreground" />
                      <p className="text-xs text-muted-foreground">選択済みペルソナのフィードバックを生成中です...</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedSelectedFeedbacks.map((feedback) => {
                    const persona =
                      feedback.persona ||
                      dbPersonaById[feedback.personaId] ||
                      personaById[feedback.personaId];
                    return (
                      <button
                        key={feedback.id}
                        type="button"
                        onClick={() => openArticleDetail(selectedArticle.id, feedback.id)}
                        className="w-full rounded-md border border-border bg-muted px-3 py-3 text-left transition-colors hover:bg-accent"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2">
                            {persona ? <Avatar persona={persona} size="h-8 w-8" /> : null}
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {persona
                                  ? `${persona.name}（${[persona.age ? `${persona.age}歳` : null, persona.gender].filter(Boolean).join('・')}）`
                                  : '不明なペルソナ'}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">{feedback.summary}</p>
                            </div>
                          </div>
                          <p className="shrink-0 text-sm font-semibold text-foreground">{feedback.score}点</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      );
    }

    if (articleFeedbackView === ARTICLE_FEEDBACK_VIEWS.DETAIL) {
      if (!selectedArticle || !selectedFeedback) {
        return (
          <section className="h-full overflow-y-auto p-4 lg:p-5">
            <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
              <div>
                <p className="text-sm text-muted-foreground">表示できる詳細がありません。</p>
                <button
                  type="button"
                  onClick={openArticleList}
                  className={`mt-3 ${BUTTON_SECONDARY_CLASS}`}
                >
                  一覧に戻る
                </button>
              </div>
            </div>
          </section>
        );
      }

      return (
        <section className="h-full overflow-y-auto p-4 lg:p-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => openArticleResults(selectedArticle.id)}
                className={BUTTON_TERTIARY_CLASS}
              >
                <ChevronLeft size={14} />
                結果一覧に戻る
              </button>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">対象記事</p>
              <h2 className="mt-1 text-base font-semibold text-foreground">{getArticleDisplayTitle(selectedArticle)}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{selectedArticle.url || '本文入力で作成'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                入力方式: {getArticleInputModeLabel(selectedArticle.inputMode)}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  {selectedFeedbackPersona ? <Avatar persona={selectedFeedbackPersona} size="h-10 w-10" /> : null}
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {selectedFeedbackPersona
                        ? `${selectedFeedbackPersona.name}（${[selectedFeedbackPersona.age ? `${selectedFeedbackPersona.age}歳` : null, selectedFeedbackPersona.gender].filter(Boolean).join('・')}）`
                        : '不明なペルソナ'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedFeedbackPersona
                        ? selectedFeedbackPersona.occupation
                        : ''}
                    </p>
                  </div>
                </div>
                <p className="shrink-0 text-xl font-semibold text-foreground">{selectedFeedback.score}点</p>
              </div>
              <p className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                {selectedFeedback.summary}
              </p>
            </div>

            {selectedFeedback.honestReaction && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">率直な感想</h3>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                  {selectedFeedback.honestReaction}
                </p>
              </div>
            )}

            {selectedFeedback.titleFeedback.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">タイトルへの指摘</h3>
                <ul className="mt-2 space-y-2 text-xs leading-relaxed text-foreground">
                  {selectedFeedback.titleFeedback.map((item) => (
                    <li key={`title-${item}`}>- {item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">良かった点</h3>
                <ul className="mt-2 space-y-2 text-xs leading-relaxed text-foreground">
                  {selectedFeedback.positives.map((item) => (
                    <li key={`good-${item}`}>- {item}</li>
                  ))}
                </ul>
              </div>

              {selectedFeedback.negatives?.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <h3 className="text-sm font-semibold text-destructive">引っかかった点</h3>
                  <ul className="mt-2 space-y-2 text-xs leading-relaxed text-foreground">
                    {selectedFeedback.negatives.map((item) => (
                      <li key={`bad-${item}`}>- {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">メディアとの相性</h3>
                <ul className="mt-2 space-y-2 text-xs leading-relaxed text-foreground">
                  {selectedFeedback.mediaFit.map((item) => (
                    <li key={`media-${item}`}>- {item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">こう変えると刺さる</h3>
                <ul className="mt-2 space-y-2 text-xs leading-relaxed text-foreground">
                  {selectedFeedback.actionItems.map((item) => (
                    <li key={`action-${item}`}>- {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="h-full overflow-y-auto p-4 lg:p-5">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-foreground">フィードバック</h2>
              <p className="text-xs text-muted-foreground">
                新規作成から記事を入力し、設定で選択したペルソナ全員のフィードバックを実行します。
              </p>
            </div>
            <button
              type="button"
              onClick={openArticleCreate}
              className={BUTTON_PRIMARY_CLASS}
            >
              <Plus size={14} />
              新規作成
            </button>
          </div>

          <div>
            <label htmlFor="article-search" className="mb-1 block text-xs text-muted-foreground">
              記事検索
            </label>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="article-search"
                value={articleSearchQuery}
                onChange={(event) => setArticleSearchQuery(event.target.value)}
                placeholder="タイトルまたはURLで検索"
                className="w-full rounded-md border border-border bg-muted py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              />
            </div>
          </div>

          {visibleArticleRuns.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
              <div>
                <FileText size={38} className="mx-auto text-primary" />
                <h3 className="mt-3 text-base font-semibold text-foreground">フィードバックがまだありません</h3>
                <p className="mt-1 text-sm text-muted-foreground">「新規作成」から最初のフィードバックを実行してください。</p>
                <button
                  type="button"
                  onClick={openArticleCreate}
                  className={`mt-4 ${BUTTON_PRIMARY_CLASS}`}
                >
                  <Plus size={14} />
                  新規作成
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <thead className="bg-muted">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="w-[42%] max-w-0 px-3 py-2 font-medium">タイトル</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">方式</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">対象</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">平均点</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">実施日時</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">ステータス</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginatedArticleRuns.map((article) => {
                      const isCompleted = article.status === 'completed';
                      const isFailed = article.status === 'failed';
                      const isCancelled = article.status === 'cancelled';
                      const statusLabel = isCompleted
                        ? '完了'
                        : isFailed
                          ? '失敗'
                          : isCancelled
                            ? 'キャンセル'
                            : `${article.completedCount}/${article.personaCount}`;
                      const statusClass = isCompleted
                        ? 'bg-emerald-100 text-emerald-700'
                        : isFailed
                          ? 'bg-red-100 text-red-700'
                          : isCancelled
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-blue-100 text-blue-700';
                      return (
                        <tr
                          key={article.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openArticleResults(article.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openArticleResults(article.id);
                            }
                          }}
                          className="cursor-pointer align-top transition-colors hover:bg-accent/60"
                        >
                          <td className="max-w-0 w-[42%] px-3 py-3">
                            <p className="truncate text-sm font-semibold text-foreground">{getArticleDisplayTitle(article)}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-foreground">{getArticleInputModeLabel(article.inputMode)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-foreground">{getArticleTargetLabel(article)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-foreground">{article.averageScore ?? '-'}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-foreground">{formatDateTime(article.createdAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              type="button"
                              aria-label="記事を削除"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteArticle(article.id);
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted text-foreground transition-colors hover:bg-accent"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="article-page-size" className="text-xs text-muted-foreground">
                    一度に表示
                  </label>
                  <SelectField
                    id="article-page-size"
                    value={articleTablePageSize}
                    onChange={(event) => setArticleTablePageSize(Number(event.target.value))}
                    containerClassName="w-20"
                    className="py-1.5 pr-8 text-xs"
                  >
                    {ARTICLE_TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={`page-size-${size}`} value={size}>
                        {size}
                      </option>
                    ))}
                  </SelectField>
                  <p className="text-xs text-muted-foreground">
                    {articleTableRangeStart}-{articleTableRangeEnd} / {visibleArticleRuns.length}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="最初のページ"
                    onClick={() => setArticleTablePage(1)}
                    disabled={articleTablePage === 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronsLeft size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="前のページ"
                    onClick={() => setArticleTablePage((prev) => Math.max(1, prev - 1))}
                    disabled={articleTablePage === 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="px-2 text-xs text-muted-foreground">
                    {articleTablePage} / {articleTableTotalPages}
                  </span>
                  <button
                    type="button"
                    aria-label="次のページ"
                    onClick={() => setArticleTablePage((prev) => Math.min(articleTableTotalPages, prev + 1))}
                    disabled={articleTablePage === articleTableTotalPages}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="最後のページ"
                    onClick={() => setArticleTablePage(articleTableTotalPages)}
                    disabled={articleTablePage === articleTableTotalPages}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronsRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  };

  const renderMainSection = () => {
    if (activeSection === 'articleFeedback') return renderArticleFeedback();
    if (activeSection === 'settings') return renderSettings();
    return renderPersona();
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="flex h-full flex-col md:flex-row">
        <aside className="flex h-full w-full shrink-0 flex-col border-b border-border bg-card md:w-64 md:border-b-0 md:border-r">
          <nav className="flex-1 grid grid-cols-2 gap-2 p-3 md:grid-cols-1 md:content-start">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-border bg-secondary text-secondary-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
            <p>選択中ペルソナ: {assignedPersonas.length}名</p>
            <p className="mt-1">現在セクション: {NAV_ITEMS.find((item) => item.id === activeSection)?.label}</p>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut size={13} />
                ログアウト
              </button>
            )}
          </div>
        </aside>

        <main className="min-h-0 flex-1 bg-background">{renderMainSection()}</main>
      </div>

      {previewPersona && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewPersonaId(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
              <div className="flex items-start gap-3">
                <Avatar persona={previewPersona} size="h-12 w-12" />
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {previewPersona.name || previewPersona.display_name}
                    <span className="ml-1 font-normal text-muted-foreground text-sm">({previewPersona.age}歳・{previewPersona.gender})</span>
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {previewPersona.one_line_summary || previewPersona.occupation}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPersonaId(null)}
                aria-label="閉じる"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            <div className="persona-popup-scrollbar min-h-0 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
              <div className="rounded-lg border border-border bg-muted p-4">
                <p className="mb-2 text-xs text-muted-foreground">ナラティブ</p>
                <p className="text-sm leading-relaxed text-foreground">{previewPersona.narrative}</p>
              </div>

              {previewPersonaInterests ? (
                <div className="rounded-lg border border-border bg-muted p-4">
                  <p className="text-sm leading-relaxed text-foreground">{previewPersonaInterests}</p>
                </div>
              ) : null}

              <div className="rounded-lg border border-border bg-muted p-4">
                {previewAdvancedProfileLoading ? (
                  <div className="flex min-h-[120px] items-center justify-center gap-2 rounded-md border border-border bg-muted p-3">
                    <Loader2 size={14} className="animate-spin text-secondary-foreground" />
                    <p className="text-xs text-muted-foreground">属性データを読み込んでいます...</p>
                  </div>
                ) : previewHasStructuredProfile ? (
                  <StructuredProfilePanel profile={previewAdvancedProfile} />
                ) : (
                  <div className="rounded-md border border-border bg-muted px-3 py-4 text-xs text-muted-foreground">
                    属性データがありません。
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {showPersonaGenerateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={handleClosePersonaGenerate}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {isOnboarding ? 'メディアルへようこそ！' : 'ペルソナ新規作成'}
                </h2>
                {!isOnboarding && (
                  <p className="text-xs text-muted-foreground mt-0.5">詳細な属性をもつ仮想読者を生成します</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleClosePersonaGenerate}
                aria-label="閉じる"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-4 space-y-4">
              {/* Onboarding explanation */}
              {isOnboarding && (
                <div className="rounded-lg border border-border bg-secondary p-4 text-sm leading-relaxed text-secondary-foreground space-y-2">
                  <p>まずは、あなたの記事を読む「仮想読者」を作りましょう。</p>
                  <p>ペルソナ（仮想読者）は、記事を公開する前に「この記事がどんな人にどう響くか」をシミュレーションするために使います。</p>
                  <p>属性を設定するほどターゲットに近い読者が生成されます。何も設定しなければ、多様な読者がランダムに生成されます。</p>
                  <p className="font-medium text-foreground">まずは5人ほど生成してみましょう！</p>
                </div>
              )}

              {/* Form — hidden while running or results shown */}
              {!genRunning && genResults.length === 0 && (
                <>
                  {/* 生成人数 */}
                  <div className="flex items-center gap-3">
                    <label className="shrink-0 text-xs text-muted-foreground">生成人数（1〜50）</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={genForm.count}
                      onChange={(e) => setGenForm((p) => ({ ...p, count: Math.max(1, Math.min(50, Number(e.target.value))) }))}
                      className={`${TEXT_INPUT_CLASS} w-16`}
                    />
                  </div>

                  {/* Tab selector */}
                  <div className="flex rounded-lg border border-border bg-muted p-1 gap-1">
                    <button
                      type="button"
                      onClick={() => { setGenTab('easy'); setGenFormError(''); }}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        genTab === 'easy'
                          ? 'bg-card text-foreground shadow-sm border border-border'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      かんたん設定
                    </button>
                    <button
                      type="button"
                      onClick={() => { setGenTab('segment'); setGenFormError(''); }}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        genTab === 'segment'
                          ? 'bg-card text-foreground shadow-sm border border-border'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      セグメント選択
                    </button>
                  </div>

                  {/* Tab content */}
                  {genTab === 'easy' ? (
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        記事タイトル・本文またはメディア概要
                      </label>
                      <textarea
                        value={genEasyText}
                        onChange={(e) => setGenEasyText(e.target.value)}
                        placeholder={"例）\n記事タイトル：「30代会社員が副業で月5万円を稼ぐ方法」\n\n本文：副業解禁の流れが加速する中、時間の制約がある会社員でも取り組みやすい副業の選び方と、実際に収益を上げるためのステップを解説します。…"}
                        rows={8}
                        className={`${TEXT_INPUT_CLASS} resize-none leading-relaxed`}
                      />
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        入力されたテキストをAIが解析し、想定読者のセグメントを自動で判断してペルソナを生成します。
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">年齢（任意）</label>
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                            <input
                              type="number"
                              min={15}
                              max={80}
                              value={genForm.age_min}
                              onChange={(e) => setGenForm((p) => ({ ...p, age_min: e.target.value }))}
                              placeholder="最小"
                              className={TEXT_INPUT_CLASS}
                            />
                            <span className="text-xs text-muted-foreground">〜</span>
                            <input
                              type="number"
                              min={15}
                              max={80}
                              value={genForm.age_max}
                              onChange={(e) => setGenForm((p) => ({ ...p, age_max: e.target.value }))}
                              placeholder="最大"
                              className={TEXT_INPUT_CLASS}
                            />
                          </div>
                        </div>
                        <div className="w-fit">
                          <label className="mb-1 block text-xs text-muted-foreground">性別（任意）</label>
                          <SelectField
                            value={genForm.gender}
                            onChange={(e) => setGenForm((p) => ({ ...p, gender: e.target.value }))}
                            containerClassName="w-28"
                          >
                            <option value="">未選択</option>
                            <option value="男性">男性</option>
                            <option value="女性">女性</option>
                            <option value="その他">その他</option>
                          </SelectField>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">居住地域（任意）</label>
                          <SelectField
                            value={genForm.region_type}
                            onChange={(e) => setGenForm((p) => ({ ...p, region_type: e.target.value }))}
                          >
                            <option value="">未選択</option>
                            <option value="metro">大都市圏</option>
                            <option value="regional">地方都市</option>
                            <option value="rural">郊外・地方</option>
                          </SelectField>
                        </div>
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-muted-foreground">都道府県（複数選択可）</label>
                          <div className="rounded-md border border-border bg-muted p-3">
                            <div className="mb-3 flex flex-wrap gap-2">
                              {genForm.prefectures.length > 0 ? genForm.prefectures.map((prefecture) => (
                                <button
                                  key={prefecture}
                                  type="button"
                                  onClick={() => toggleGenPrefecture(prefecture)}
                                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground"
                                >
                                  {prefecture}
                                  <X size={12} />
                                </button>
                              )) : (
                                <p className="text-xs text-muted-foreground">未選択。下の一覧から複数選べます。</p>
                              )}
                            </div>
                            <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                              {PREFECTURE_OPTIONS.map((prefecture) => {
                                const checked = genForm.prefectures.includes(prefecture);
                                return (
                                  <label
                                    key={prefecture}
                                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                                      checked
                                        ? 'border-primary bg-card text-foreground'
                                        : 'border-border bg-card text-muted-foreground'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleGenPrefecture(prefecture)}
                                      className="h-3.5 w-3.5 accent-primary"
                                    />
                                    <span>{prefecture}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-muted-foreground">職業（カンマ区切りで追加）</label>
                          <div className="rounded-md border border-border bg-muted p-3">
                            <div className="mb-3 flex min-h-7 flex-wrap gap-2">
                              {genForm.occupations.map((occupation) => (
                                <button
                                  key={occupation}
                                  type="button"
                                  onClick={() => removeOccupationTag(occupation)}
                                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground"
                                >
                                  {occupation}
                                  <X size={12} />
                                </button>
                              ))}
                              {genForm.occupations.length === 0 && !occupationInput && (
                                <p className="text-xs text-muted-foreground">例: Webデザイナー, 看護師, 会社員</p>
                              )}
                            </div>
                            <input
                              type="text"
                              value={occupationInput}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                setOccupationInput(nextValue);
                                if (/[,\n、]/.test(nextValue)) {
                                  commitOccupationInput(nextValue);
                                }
                              }}
                              onBlur={() => commitOccupationInput(occupationInput, true)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ',') {
                                  e.preventDefault();
                                  commitOccupationInput(occupationInput, true);
                                } else if (e.key === 'Backspace' && !occupationInput && genForm.occupations.length > 0) {
                                  removeOccupationTag(genForm.occupations[genForm.occupations.length - 1]);
                                }
                              }}
                              placeholder="入力して Enter またはカンマで追加"
                              className={TEXT_INPUT_CLASS}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Custom segments */}
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <label className="text-xs text-muted-foreground">カスタムセグメント（任意）</label>
                          {!showSegmentForm && (
                            <button
                              type="button"
                              onClick={() => setShowSegmentForm(true)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
                            >
                              <Plus size={12} />
                              セグメント追加
                            </button>
                          )}
                        </div>

                        {genForm.segments.length > 0 && (
                          <div className="mb-2 space-y-1">
                            {genForm.segments.map((seg, idx) => (
                              <div key={idx} className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs">
                                <span className="font-medium text-foreground">{seg.name}</span>
                                <span className="text-muted-foreground">:</span>
                                <span className="flex-1 text-foreground">{seg.value}</span>
                                <button
                                  type="button"
                                  onClick={() => setGenForm((p) => ({ ...p, segments: p.segments.filter((_, i) => i !== idx) }))}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {showSegmentForm && (
                          <div className="rounded-md border border-border bg-muted p-3 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="mb-1 block text-xs text-muted-foreground">セグメント名 *</label>
                                <input
                                  type="text"
                                  value={segmentDraft.name}
                                  onChange={(e) => setSegmentDraft((p) => ({ ...p, name: e.target.value }))}
                                  placeholder="例: 読書頻度"
                                  className={TEXT_INPUT_CLASS}
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs text-muted-foreground">値 *</label>
                                <input
                                  type="text"
                                  value={segmentDraft.value}
                                  onChange={(e) => setSegmentDraft((p) => ({ ...p, value: e.target.value }))}
                                  placeholder="例: 月に5冊以上"
                                  className={TEXT_INPUT_CLASS}
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const name = segmentDraft.name.trim();
                                  const value = segmentDraft.value.trim();
                                  if (!name || !value) return;
                                  setGenForm((p) => ({ ...p, segments: [...p.segments, { name, value }] }));
                                  setSegmentDraft({ name: '', value: '' });
                                  setShowSegmentForm(false);
                                }}
                                disabled={!segmentDraft.name.trim() || !segmentDraft.value.trim()}
                                className={`flex-1 ${BUTTON_PRIMARY_CLASS} disabled:opacity-40`}
                              >
                                追加
                              </button>
                              <button
                                type="button"
                                onClick={() => { setShowSegmentForm(false); setSegmentDraft({ name: '', value: '' }); }}
                                className="flex-1 rounded-md border border-border px-3 py-2 text-xs text-foreground hover:bg-accent"
                              >
                                キャンセル
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {genFormError && (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {genFormError}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleStartGenerate}
                    className={`w-full ${BUTTON_PRIMARY_CLASS}`}
                  >
                    <Sparkles size={14} className="mr-1.5 inline-block" />
                    生成する
                  </button>
                </>
              )}

              {/* Progress */}
              {genRunning && (
                <div className="space-y-3">
                  {/* Face reveal strip */}
                  {(() => {
                    const totalSlots = genProgress?.totalCount ?? genForm.count ?? 0;
                    if (totalSlots === 0) return null;
                    const completedCount = genResults.length;
                    const activeIndex = genProgress ? genProgress.personaIndex - 1 : -1;
                    return (
                      <div className="flex flex-wrap justify-center gap-3 pt-1 pb-2">
                        {Array.from({ length: totalSlots }, (_, i) => {
                          const isCompleted = i < completedCount;
                          const isActive = i === activeIndex;
                          const persona = genResults[i];
                          if (isCompleted) {
                            return (
                              <div
                                key={`done-${persona.id}`}
                                className="h-16 w-16 overflow-hidden rounded-full border-2 border-primary/50 bg-muted animate-pop-in"
                              >
                                <img
                                  src={getDiceBearUrl(persona)}
                                  alt={persona.display_name}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            );
                          }
                          if (isActive) {
                            return (
                              <div key={`active-${i}`} className="h-16 w-16 overflow-hidden rounded-full border-2 border-primary/30 bg-muted flex-shrink-0">
                                <img
                                  key={avatarTick}
                                  src={SHUFFLE_AVATAR_URLS[avatarTick % SHUFFLE_AVATAR_URLS.length]}
                                  alt="生成中"
                                  className="h-full w-full object-cover animate-avatar-cycle"
                                />
                              </div>
                            );
                          }
                          return (
                            <div
                              key={`pending-${i}`}
                              className="h-16 w-16 rounded-full bg-muted border border-border animate-pulse"
                            />
                          );
                        })}
                      </div>
                    );
                  })()}
                  {genProgress && (
                    <div className="rounded-lg border border-border bg-muted p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>ペルソナ {genProgress.personaIndex} / {genProgress.totalCount} を生成中</span>
                        <Loader2 size={13} className="animate-spin" />
                      </div>
                      <p className="text-sm font-medium text-foreground">{genProgress.stepDetail}</p>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{
                            width: `${Math.round(
                              (((genProgress.personaIndex - 1) * genProgress.attributeRichness + genProgress.attributeCount) /
                                (genProgress.totalCount * genProgress.attributeRichness)) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {genResults.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border bg-muted px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">{p.display_name}（{p.age}歳・{p.gender}）</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.occupation_category}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground mt-1">{p.one_line_summary}</p>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleCancelGenerate}
                    className="inline-flex rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                  >
                    生成をキャンセル
                  </button>
                </div>
              )}

              {/* Results summary */}
              {!genRunning && genResults.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">{genResults.length}名のペルソナが生成されました</p>
                  {genResults.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border bg-muted px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">{p.display_name}（{p.age}歳・{p.gender}）</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.occupation_category}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground mt-1">{p.one_line_summary}</p>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setGenTab('easy');
                        setGenEasyText('');
                        setGenForm({ ...DEFAULT_GEN_FORM });
                        setGenFormError('');
                        setOccupationInput('');
                        setGenResults([]);
                        refreshPersonaPool();
                      }}
                      className={`flex-1 ${BUTTON_SECONDARY_CLASS}`}
                    >
                      さらに生成する
                    </button>
                    <button
                      type="button"
                      onClick={handleClosePersonaGenerate}
                      className={`flex-1 ${BUTTON_PRIMARY_CLASS}`}
                    >
                      完了
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 保存スナックバー */}
      {savedSnackbar && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-foreground px-4 py-2.5 text-sm text-background shadow-lg">
          保存されました
        </div>
      )}
    </div>
  );
}

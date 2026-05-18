/**
 * ЕНТ Репетитор — клиентское приложение.
 * Работает в браузере без сервера.
 */

// ─── Константы ───────────────────────────────────────────────────────
const MODELS = {
  haiku: { id: 'claude-haiku-4-5-20251001', name: 'Haiku — быстро и дёшево', cost: '~$0.01 за тему' },
  sonnet: { id: 'claude-sonnet-4-6', name: 'Sonnet — баланс качества и цены', cost: '~$0.03 за тему' },
  opus: { id: 'claude-opus-4-7', name: 'Opus — максимальное качество', cost: '~$0.13 за тему' },
};
const DEFAULT_MODEL = 'haiku';

const SUBJECTS = {
  biology: { data: window.SUBJECT_BIOLOGY, title: 'Биология', icon: '🧬', color: '#00ff66' },
  geography: { data: window.SUBJECT_GEOGRAPHY, title: 'География', icon: '🌍', color: '#5ac8ff' },
};

// Стоимость моделей за миллион токенов (для подсчёта расхода)
const MODEL_PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-7': { input: 15.00, output: 75.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
};
// TTS: цена за миллион символов
const TTS_PRICING = { 'tts-1': 15.00, 'tts-1-hd': 30.00 };

const OPENAI_CHAT_MODEL = 'gpt-4o-mini'; // дёшево и хватает для ЕНТ
const OPENAI_TTS_MODEL = 'tts-1';
const OPENAI_TTS_VOICE = 'nova'; // 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

const STORAGE_KEY_API = 'ent_api_key';
const STORAGE_KEY_OPENAI = 'ent_openai_key';
const STORAGE_KEY_MODEL = 'ent_model';
const STORAGE_KEY_CACHE_PREFIX = 'ent_cache_';
const STORAGE_KEY_STATS = 'ent_usage_stats';

// ─── Состояние ───────────────────────────────────────────────────────
let chatHistory = [];

function getApiKey() {
  // Сначала смотрим в config.local.js (если файл есть)
  if (window.ANTHROPIC_API_KEY) return String(window.ANTHROPIC_API_KEY).trim();
  return (localStorage.getItem(STORAGE_KEY_API) || '').trim();
}
function setApiKey(key) { localStorage.setItem(STORAGE_KEY_API, key.trim()); }
function hasApiKey() { return !!getApiKey(); }

function getOpenAIKey() {
  if (window.OPENAI_API_KEY) return String(window.OPENAI_API_KEY).trim();
  return (localStorage.getItem(STORAGE_KEY_OPENAI) || '').trim();
}
function setOpenAIKey(key) { localStorage.setItem(STORAGE_KEY_OPENAI, key.trim()); }

function getModelKey() { return localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL; }
function setModelKey(k) { localStorage.setItem(STORAGE_KEY_MODEL, k); }
function getModel() { return MODELS[getModelKey()] || MODELS[DEFAULT_MODEL]; }

// ─── Учёт расходов ───────────────────────────────────────────────────
function getStats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_STATS) || '{}') || {};
  } catch { return {}; }
}
function recordUsage({ model, inputTokens, outputTokens }) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return;
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;
  const stats = getStats();
  stats.totalCost = (stats.totalCost || 0) + cost;
  stats.totalRequests = (stats.totalRequests || 0) + 1;
  stats.totalInputTokens = (stats.totalInputTokens || 0) + inputTokens;
  stats.totalOutputTokens = (stats.totalOutputTokens || 0) + outputTokens;
  stats.byModel = stats.byModel || {};
  stats.byModel[model] = stats.byModel[model] || { requests: 0, cost: 0 };
  stats.byModel[model].requests++;
  stats.byModel[model].cost += cost;
  localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
}
function resetStats() {
  localStorage.removeItem(STORAGE_KEY_STATS);
}

function getCached(subjectId, topicId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_CACHE_PREFIX}${subjectId}_${topicId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setCached(subjectId, topicId, content) {
  try {
    localStorage.setItem(`${STORAGE_KEY_CACHE_PREFIX}${subjectId}_${topicId}`, JSON.stringify(content));
  } catch (e) {
    console.warn('Кэш переполнен, чистим:', e);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_KEY_CACHE_PREFIX)) localStorage.removeItem(key);
    }
    try { localStorage.setItem(`${STORAGE_KEY_CACHE_PREFIX}${subjectId}_${topicId}`, JSON.stringify(content)); } catch {}
  }
}

// ─── Утилиты ─────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function findTopic(subjectId, topicId) {
  const data = SUBJECTS[subjectId]?.data;
  if (!data) return null;
  for (const section of data.sections) {
    for (const topic of section.topics) {
      if (topic.id === topicId) return { section, topic };
    }
  }
  return null;
}

// Плоский список всех тем предмета (для навигации пред/след)
function flatTopics(subjectId) {
  const data = SUBJECTS[subjectId]?.data;
  if (!data) return [];
  const out = [];
  for (const section of data.sections) {
    for (const topic of section.topics) {
      out.push({ ...topic, sectionTitle: section.title });
    }
  }
  return out;
}

function getPrevNextTopic(subjectId, topicId) {
  const list = flatTopics(subjectId);
  const idx = list.findIndex(t => t.id === topicId);
  if (idx === -1) return { prev: null, next: null, index: 0, total: list.length };
  return {
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx < list.length - 1 ? list[idx + 1] : null,
    index: idx + 1,
    total: list.length,
  };
}

// ─── Anthropic API ────────────────────────────────────────────────────
async function callClaude({ system, messages, maxTokens = 2000 }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API-ключ не введён. Нажми ⚙ в правом верхнем углу.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: getModel().id,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text).error?.message || detail; } catch {}
    throw new Error(`Ошибка API (${response.status}): ${detail}`);
  }
  const data = await response.json();
  // Записываем расход
  if (data.usage) {
    recordUsage({
      model: getModel().id,
      inputTokens: data.usage.input_tokens || 0,
      outputTokens: data.usage.output_tokens || 0,
    });
  }
  return data.content?.[0]?.text || '';
}

// ─── OpenAI API (GPT и TTS) ─────────────────────────────────────────
async function callOpenAI({ messages, model = OPENAI_CHAT_MODEL, maxTokens = 1500, jsonMode = false }) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('OpenAI ключ не настроен. Открой ⚙ и вставь его, или впиши в config.local.js.');

  const body = { model, messages, max_tokens: maxTokens };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text).error?.message || detail; } catch {}
    throw new Error(`OpenAI (${r.status}): ${detail}`);
  }
  const data = await r.json();
  if (data.usage) {
    recordUsage({
      model,
      inputTokens: data.usage.prompt_tokens || 0,
      outputTokens: data.usage.completion_tokens || 0,
    });
  }
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenAITTS(text) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('OpenAI ключ не настроен.');
  const trimmed = text.slice(0, 4000); // лимит OpenAI TTS

  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: trimmed,
      response_format: 'mp3',
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI TTS (${r.status}): ${t.slice(0, 200)}`);
  }
  // Учёт TTS: $15 за 1M символов
  const pricing = TTS_PRICING[OPENAI_TTS_MODEL] || 15;
  const cost = (trimmed.length / 1e6) * pricing;
  const stats = getStats();
  stats.totalCost = (stats.totalCost || 0) + cost;
  stats.totalRequests = (stats.totalRequests || 0) + 1;
  stats.ttsChars = (stats.ttsChars || 0) + trimmed.length;
  stats.byModel = stats.byModel || {};
  stats.byModel[OPENAI_TTS_MODEL] = stats.byModel[OPENAI_TTS_MODEL] || { requests: 0, cost: 0 };
  stats.byModel[OPENAI_TTS_MODEL].requests++;
  stats.byModel[OPENAI_TTS_MODEL].cost += cost;
  localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));

  const blob = await r.blob();
  return URL.createObjectURL(blob);
}

// ─── Wikipedia API ──────────────────────────────────────────────────
const WIKI_API = 'https://ru.wikipedia.org/w/api.php';

async function wikiFetch(params) {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('origin', '*');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  return r.json();
}

async function wikiGetImageInfo(filename) {
  try {
    const r = await wikiFetch({
      action: 'query', titles: `File:${filename}`,
      prop: 'imageinfo', iiprop: 'url|size|mime', format: 'json',
    });
    for (const p of Object.values(r.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (ii?.url) return ii;
    }
  } catch {}
  return null;
}

// Запрещённые подстроки в названии — мусорные изображения
const BAD_IMG_PARTS = [
  'commons-logo', 'wiki', 'edit-icon', 'ambox', 'question_book', 'red_pencil',
  'gnome', 'crystal_clear', 'open_book', 'nuvola', 'gtk-', 'symbol_', 'icon_',
  'flag_of_', 'coat_of_arms', 'p_', 'disambig', 'merge', 'globe', 'red_x'
];

async function wikiSearchImages(query, limit = 4) {
  try {
    const search = await wikiFetch({
      action: 'query', list: 'search', srsearch: query,
      format: 'json', srlimit: '3',
    });
    const hits = search.query?.search || [];
    if (!hits.length) return [];

    const images = [];
    const seenUrls = new Set();

    // Пробуем 1-2 страницы и берём с них главное изображение + ещё пару
    for (const hit of hits.slice(0, 2)) {
      if (images.length >= limit) break;
      const pageTitle = hit.title;

      const page = await wikiFetch({
        action: 'query', prop: 'pageimages|images',
        piprop: 'original', imlimit: String(limit + 12),
        titles: pageTitle, format: 'json',
      });

      for (const p of Object.values(page.query?.pages || {})) {
        // Главная картинка статьи (обычно самая релевантная)
        if (p.original?.source && !seenUrls.has(p.original.source)) {
          if (p.original.width >= 200 && p.original.height >= 150) {
            seenUrls.add(p.original.source);
            images.push({ url: p.original.source, caption: pageTitle });
          }
        }
        // Дополнительные изображения с страницы
        for (const img of p.images || []) {
          if (images.length >= limit) break;
          const name = img.title || '';
          if (!/\.(jpe?g|png|gif)$/i.test(name)) continue; // SVG часто иконки — пропускаем
          const lower = name.toLowerCase();
          if (BAD_IMG_PARTS.some(s => lower.includes(s))) continue;
          if (name.length < 10) continue; // слишком короткое имя — обычно служебное
          const clean = name.replace(/^Файл:/, '').replace(/^File:/, '');
          const info = await wikiGetImageInfo(clean);
          if (!info) continue;
          if (seenUrls.has(info.url)) continue;
          // Отсекаем слишком мелкие изображения (иконки)
          if (info.width && info.height && (info.width < 200 || info.height < 150)) continue;
          seenUrls.add(info.url);
          images.push({ url: info.url, caption: clean.replace(/\.[^.]+$/, '').replace(/_/g, ' ') });
        }
      }
    }
    return images.slice(0, limit);
  } catch (e) {
    console.error('[wiki]', e);
    return [];
  }
}

// Попытка восстановить обрезанный JSON: обрезаем до последней закрытой структуры
function tryFixTruncatedJson(text) {
  // Стратегия: попробовать разные точки обрезки, чтобы получить валидный JSON
  // 1) ищем последнюю запятую внутри массива/объекта и обрезаем там
  // 2) добавляем недостающие закрывающие скобки

  // Сначала: найти позицию последней успешной структуры
  // Пробуем обрезать с конца до запятой/скобки и закрыть все открытые скобки
  const opens = { '{': '}', '[': ']' };
  const closes = { '}': '{', ']': '[' };

  for (let cutAt = text.length; cutAt > 100; cutAt--) {
    const ch = text[cutAt - 1];
    // обрезаем после "},"  "]," или после } или ]
    if (ch !== ',' && ch !== '}' && ch !== ']') continue;
    let candidate = text.slice(0, cutAt);
    if (candidate.endsWith(',')) candidate = candidate.slice(0, -1);

    // Подсчитаем открытые скобки в candidate (с учётом строк)
    const stack = [];
    let inStr = false, escaped = false;
    for (const c of candidate) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        if (stack[stack.length - 1] === closes[c]) stack.pop();
        else return null;
      }
    }
    if (inStr) continue; // обрезано внутри строки — пробуем другую точку

    // Закрываем оставшиеся открытые скобки
    let closing = '';
    while (stack.length) closing += opens[stack.pop()];

    try {
      return JSON.parse(candidate + closing);
    } catch {}
  }
  return null;
}

// ─── Генерация материала темы ────────────────────────────────────────
async function generateTopicContent(subjectId, topicTitle, sectionTitle) {
  const subjectName = SUBJECTS[subjectId].title;

  const systemPrompt =
    'Ты — опытный преподаватель для подготовки к ЕНТ Казахстана. ' +
    'Объясняешь чётко, плотно, без воды. Каждое предложение содержит факт или объяснение. ' +
    'Уровень — старшеклассник. Только то, что нужно для ЕНТ (но максимально полно). ' +
    'Отвечаешь строго в JSON, без markdown-обёртки.';

  const userPrompt = `Тема: «${topicTitle}» (раздел: ${sectionTitle}, предмет: ${subjectName}).

Сгенерируй учебный материал для ЕНТ в JSON. Будь конкретен и плотен, без воды.

{
  "summary": "Суть темы в 2-3 предложениях",
  "key_terms": [{"term": "термин", "definition": "краткое определение"}],
  "blocks": [
    {"heading": "Подраздел", "content": "Объяснение фактами. Списки через '-' с новой строки. Включай числа, классификации, примеры.", "image_query": "запрос для Википедии"}
  ],
  "facts_to_remember": ["Факт с цифрой/датой/процессом"],
  "ent_questions": [{"question": "Вопрос ЕНТ", "answer": "Ответ"}],
  "quiz": [
    {"question": "Вопрос", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "Почему этот ответ"}
  ]
}

ТРЕБОВАНИЯ (СТРОГО):
- blocks: РОВНО 6 подразделов. content каждого = 80-150 слов, маркированные списки приветствуются.
- key_terms: 8 терминов
- facts_to_remember: 10 фактов (одним предложением, конкретно)
- ent_questions: 4 вопроса
- quiz: РОВНО 6 тестов. correct = индекс 0-3. explanation = 1-2 предложения.
- image_query: 1-3 слова на русском
- Отвечай ТОЛЬКО валидным JSON, без \`\`\` и без комментариев.
- НЕ обрывайся посередине — лучше короче но полностью.`;

  let text = await callClaude({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 8000,
  });
  text = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // Попробуем починить обрезанный JSON
    const fixed = tryFixTruncatedJson(text);
    if (fixed) {
      data = fixed;
      console.warn('JSON был обрезан, удалось восстановить частично');
    } else {
      throw new Error(`Ответ ИИ испорчен (${e.message}). Попробуй нажать «Обновить» ещё раз.`);
    }
  }

  if (data.blocks) {
    await Promise.all(data.blocks.map(async (block) => {
      // Делаем запрос точнее: добавляем контекст темы если запрос короткий
      let q = block.image_query || block.heading || '';
      if (q.length < 15 && !q.toLowerCase().includes(topicTitle.toLowerCase().split(' ')[0])) {
        q = `${q} ${topicTitle}`;
      }
      const imgs = await wikiSearchImages(q, 1);
      block.image = imgs[0] || null;
    }));
  }
  data.images = await wikiSearchImages(topicTitle, 4);
  return data;
}

// ─── Роутинг ─────────────────────────────────────────────────────────
function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);
  if (parts.length === 0) return { view: 'home' };
  if (parts[0] === 'exam' && parts.length === 2) return { view: 'exam', subjectId: parts[1] };
  if (parts[0] === 'subject' && parts.length === 2) return { view: 'subject', subjectId: parts[1] };
  if (parts[0] === 'subject' && parts[2] === 'topic' && parts.length === 4) {
    return { view: 'topic', subjectId: parts[1], topicId: parts[3] };
  }
  return { view: 'home' };
}

function navigate() {
  const route = parseRoute();
  window.scrollTo(0, 0);
  if (route.view === 'home') return renderHome();
  if (route.view === 'subject') return renderSubject(route.subjectId);
  if (route.view === 'topic') return renderTopic(route.subjectId, route.topicId);
  if (route.view === 'exam') return renderExam(route.subjectId);
  renderHome();
}

// ─── Рендер ──────────────────────────────────────────────────────────
const $app = document.getElementById('app');

function renderHome() {
  const cards = Object.entries(SUBJECTS).map(([id, s]) => {
    const nTopics = s.data.sections.reduce((sum, sec) => sum + sec.topics.length, 0);
    return `
      <a href="#/subject/${id}" class="subject-card" style="--accent: ${s.color};">
        <div class="subject-icon">${s.icon}</div>
        <h2><span class="prompt-sign">&gt;</span> ${esc(s.title)}</h2>
        <p>${esc(s.data.description)}</p>
        <div class="subject-meta">
          <span>[ ${s.data.sections.length} разделов ]</span>
          <span>[ ${nTopics} тем ]</span>
        </div>
        <div class="subject-cta">Начать →</div>
      </a>`;
  }).join('');

  const apiWarn = hasApiKey() ? '' : `
    <div class="alert alert-warning">
      <strong>API-ключ не введён.</strong>
      Нажми <b>⚙</b> в правом верхнем углу и вставь свой ключ от
      <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a>.
      Без него генерация материалов и чат работать не будут.
    </div>`;

  $app.innerHTML = `
    ${apiWarn}
    <section class="hero">
      <div class="terminal-line"><span class="prompt">user@ent:~$</span> <span class="cmd">prepare --exam=ЕНТ --subject=all</span></div>
      <h1>Подготовка к ЕНТ <span class="cursor">_</span></h1>
      <p class="hero-subtitle">
        Структурированные конспекты, картинки и тесты для закрепления.
        Личный ИИ-преподаватель ответит на любой вопрос. Выбери предмет и начни.
      </p>
    </section>
    <section class="subjects-grid">${cards}</section>
    <section class="info-block">
      <h3>// Как пользоваться</h3>
      <ol>
        <li>Нажми <b>⚙</b> и вставь свой ключ от Anthropic (один раз).</li>
        <li>Выбери предмет — биология или география.</li>
        <li>Открой тему — ИИ соберёт конспект с картинками, ключевыми фактами и тестом.</li>
        <li>Если что-то непонятно — напиши вопрос в чате справа от темы.</li>
        <li>В конце темы пройди тест — он проверит, что ты запомнил.</li>
        <li>Все материалы сохраняются в браузере — открытие занимает мгновение.</li>
      </ol>
    </section>`;
}

function renderSubject(subjectId) {
  const s = SUBJECTS[subjectId];
  if (!s) return renderHome();

  const sections = s.data.sections.map((section, idx) => {
    const topics = section.topics.map(t => `
      <li>
        <a href="#/subject/${subjectId}/topic/${esc(t.id)}" style="--accent: ${s.color};">
          <span class="topic-bullet">›</span>${esc(t.title)}
        </a>
      </li>`).join('');
    return `
      <details class="section" open>
        <summary>
          <span class="section-title">[${String(idx + 1).padStart(2, '0')}] ${esc(section.title)}</span>
          <span class="section-count">${section.topics.length} тем</span>
        </summary>
        <ul class="topics-list">${topics}</ul>
      </details>`;
  }).join('');

  $app.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/">/</a><span>›</span><span>${esc(s.title)}</span>
    </div>
    <header class="subject-header" style="--accent: ${s.color};">
      <div class="subject-header-icon">${s.icon}</div>
      <div class="subject-header-text">
        <h1><span class="prompt-sign">&gt;</span> ${esc(s.title)}</h1>
        <p>${esc(s.data.description)}</p>
      </div>
      <a href="#/exam/${subjectId}" class="btn-exam" title="Случайный тест из 20 вопросов через GPT-4o">📝 Пробный экзамен</a>
    </header>
    <div class="sections-list">${sections}</div>`;
}

function renderTopic(subjectId, topicId) {
  const s = SUBJECTS[subjectId];
  const found = findTopic(subjectId, topicId);
  if (!s || !found) return renderHome();

  // Сохраним для рендера навигации
  window.__currentSubject = subjectId;
  window.__currentTopic = topicId;

  chatHistory = [];
  const nav = getPrevNextTopic(subjectId, topicId);

  $app.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/">/</a><span>›</span>
      <a href="#/subject/${subjectId}">${esc(s.title)}</a><span>›</span>
      <span>${esc(found.topic.title)}</span>
      <span class="breadcrumb-progress">[${nav.index}/${nav.total}]</span>
    </div>
    <div class="topic-layout">
      <article class="topic-content">
        <header class="topic-header" style="--accent: ${s.color};">
          <div class="topic-section-label">${s.icon} ${esc(s.title)} · ${esc(found.section.title)}</div>
          <h1>${esc(found.topic.title)}</h1>
          <button class="btn-refresh" id="btn-refresh" title="Перегенерировать материал заново">↻ Обновить</button>
        </header>
        <div id="content-area">
          <div class="loader">
            <div class="spinner"></div>
            <p>Генерация материала… (15-30 секунд при первом открытии)</p>
          </div>
        </div>
      </article>
      <aside class="chat-panel" id="chat-panel">
        <div class="chat-header">
          <h3>// Спроси что не понял</h3>
          <p>ИИ знает контекст этой темы и объяснит проще.</p>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="chat-msg chat-msg-ai">
            Привет! Я твой репетитор по теме «${esc(found.topic.title)}». Спрашивай что угодно — объясню простыми словами.
          </div>
        </div>
        <form class="chat-form" id="chat-form">
          <textarea id="chat-input" placeholder="Например: объясни проще, что такое митоз" rows="2" required></textarea>
          <button type="submit" id="chat-send">Спросить</button>
        </form>
      </aside>
    </div>`;

  document.getElementById('btn-refresh').addEventListener('click', () => loadTopic(subjectId, topicId, found, true));
  setupChat(subjectId, topicId);
  loadTopic(subjectId, topicId, found, false);
}

async function loadTopic(subjectId, topicId, found, refresh) {
  const contentArea = document.getElementById('content-area');

  if (!refresh) {
    const cached = getCached(subjectId, topicId);
    if (cached) return renderTopicContent(cached, true);
  }

  if (!hasApiKey()) {
    contentArea.innerHTML = `
      <div class="alert alert-warning">
        <strong>API-ключ не введён.</strong> Нажми <b>⚙</b> в шапке и вставь ключ от Anthropic.
      </div>`;
    return;
  }

  contentArea.innerHTML = `
    <div class="loader">
      <div class="spinner"></div>
      <p>${refresh ? 'Перегенерируем материал…' : 'Генерация материала… (15-30 секунд)'}</p>
    </div>`;

  try {
    const content = await generateTopicContent(subjectId, found.topic.title, found.section.title);
    setCached(subjectId, topicId, content);
    renderTopicContent(content, false);
  } catch (e) {
    contentArea.innerHTML = `<div class="alert alert-error"><strong>Ошибка:</strong> ${esc(e.message)}</div>`;
  }
}

function renderTopicContent(data, fromCache = false) {
  const contentArea = document.getElementById('content-area');
  const parts = [];

  if (fromCache) {
    parts.push(`<div class="cache-badge">⚡ Загружено из памяти браузера</div>`);
  }

  if (data.summary) parts.push(`<div class="summary-card">${esc(data.summary)}</div>`);

  if (data.images?.length) {
    parts.push('<div class="images-gallery">');
    for (const img of data.images) {
      if (!img?.url) continue;
      parts.push(`
        <figure>
          <img src="${esc(img.url)}" alt="${esc(img.caption || '')}" loading="lazy" onerror="this.closest('figure').style.display='none'">
          <figcaption>${esc(img.caption || '')}</figcaption>
        </figure>`);
    }
    parts.push('</div>');
  }

  if (data.blocks?.length) {
    data.blocks.forEach((block, blockIdx) => {
      parts.push(`<section class="content-block" data-block-idx="${blockIdx}">`);
      if (block.heading) {
        parts.push(`
          <div class="block-header">
            <h2>${esc(block.heading)}</h2>
            <div class="block-controls">
              <button class="block-btn btn-tts" data-action="tts" data-idx="${blockIdx}" title="Озвучить блок">▶ Слушать</button>
              <button class="block-btn btn-explain" data-action="explain" data-idx="${blockIdx}" title="Объяснить иначе через GPT-4o">↺ Объясни иначе</button>
            </div>
          </div>`);
      }
      if (block.content) parts.push(`<div class="block-body">${formatBody(block.content)}</div>`);
      parts.push(`<div class="block-extra" data-extra-idx="${blockIdx}"></div>`);
      if (block.image?.url) {
        parts.push(`
          <figure class="block-image">
            <img src="${esc(block.image.url)}" alt="${esc(block.image.caption || '')}" loading="lazy" onerror="this.closest('figure').style.display='none'">
            <figcaption>${esc(block.image.caption || '')}</figcaption>
          </figure>`);
      }
      parts.push('</section>');
    });
  }

  if (data.key_terms?.length) {
    parts.push('<div class="key-terms"><h3>// Ключевые термины</h3>');
    for (const t of data.key_terms) {
      parts.push(`<div class="term-item"><span class="term-name">${esc(t.term)}</span> — ${esc(t.definition)}</div>`);
    }
    parts.push('</div>');
  }

  if (data.facts_to_remember?.length) {
    parts.push('<div class="facts-list"><h3>// Запомни</h3><ul>');
    for (const f of data.facts_to_remember) parts.push(`<li>${esc(f)}</li>`);
    parts.push('</ul></div>');
  }

  if (data.ent_questions?.length) {
    parts.push('<div class="ent-questions"><h3>// Типовые вопросы ЕНТ</h3>');
    for (const q of data.ent_questions) {
      parts.push(`
        <div class="ent-question">
          <div class="ent-question-q">${esc(q.question)}</div>
          <div class="ent-question-a">${esc(q.answer)}</div>
        </div>`);
    }
    parts.push('</div>');
  }

  if (data.quiz?.length) {
    parts.push(renderQuiz(data.quiz));
  }

  // Навигация пред/след тема
  if (window.__currentSubject && window.__currentTopic) {
    parts.push(renderTopicNav(window.__currentSubject, window.__currentTopic));
  }

  contentArea.innerHTML = parts.join('\n');
  window.__currentBlocks = data.blocks || [];
  attachImageZoom();
  attachQuizHandlers();
  attachBlockButtons();
}

// ─── Mock-экзамен ───────────────────────────────────────────────────
const STORAGE_KEY_EXAM_PREFIX = 'ent_exam_';
function getCachedExam(subjectId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_EXAM_PREFIX}${subjectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setCachedExam(subjectId, exam) {
  try { localStorage.setItem(`${STORAGE_KEY_EXAM_PREFIX}${subjectId}`, JSON.stringify(exam)); } catch {}
}

async function generateExam(subjectId) {
  const s = SUBJECTS[subjectId];
  const allTopics = s.data.sections.flatMap(sec =>
    sec.topics.map(t => `${sec.title} → ${t.title}`)
  );
  const sample = allTopics.length > 25 ? shuffleArr(allTopics).slice(0, 25) : allTopics;

  const userPrompt = `Составь пробный экзамен ЕНТ Казахстана по предмету "${s.title}" из 20 вопросов разной сложности.
Покрой темы (выбери разнообразно): ${sample.join('; ')}.

Формат — строго JSON:
{
  "questions": [
    {"q": "Вопрос", "o": ["A", "B", "C", "D"], "c": 0, "e": "Объяснение", "t": "Название темы"}
  ]
}

Требования:
- 20 вопросов
- "c" — индекс правильного варианта (0-3)
- "e" — короткое объяснение (1-2 предложения)
- "t" — тема, к которой относится вопрос
- Вопросы уровня реального ЕНТ — конкретные факты, классификации, причины
- Отвечай ТОЛЬКО валидным JSON, без \`\`\` и комментариев.`;

  const text = await callOpenAI({
    messages: [
      { role: 'system', content: 'Ты — составитель экзаменационных тестов ЕНТ Казахстана. Создаёшь вопросы школьного уровня.' },
      { role: 'user', content: userPrompt },
    ],
    model: OPENAI_CHAT_MODEL,
    maxTokens: 4000,
    jsonMode: true,
  });

  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error(`Не удалось разобрать экзамен: ${e.message}`); }
  return parsed.questions || [];
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function renderExam(subjectId) {
  const s = SUBJECTS[subjectId];
  if (!s) return renderHome();

  $app.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/">/</a><span>›</span>
      <a href="#/subject/${subjectId}">${esc(s.title)}</a><span>›</span>
      <span>Пробный экзамен</span>
    </div>
    <div class="exam-container">
      <header class="exam-header">
        <h1>📝 Пробный экзамен · ${esc(s.title)}</h1>
        <p>20 вопросов из разных разделов. Можешь нажать «Новый экзамен» — GPT-4o сгенерирует другой набор.</p>
        <div class="exam-actions">
          <button id="exam-new" class="btn-primary">↻ Новый экзамен</button>
          <button id="exam-cached" class="btn-secondary">Показать предыдущий</button>
        </div>
      </header>
      <div id="exam-body">
        <div class="loader">
          <div class="spinner"></div>
          <p>Генерация экзамена через GPT-4o… (20-40 секунд)</p>
        </div>
      </div>
    </div>`;

  const examBody = document.getElementById('exam-body');

  async function load(forceNew) {
    if (!forceNew) {
      const cached = getCachedExam(subjectId);
      if (cached?.length) {
        showExam(cached, true);
        return;
      }
    }
    if (!getOpenAIKey()) {
      examBody.innerHTML = `<div class="alert alert-warning"><strong>OpenAI ключ не настроен.</strong> Открой ⚙ и вставь его.</div>`;
      return;
    }
    examBody.innerHTML = `<div class="loader"><div class="spinner"></div><p>Генерация экзамена через GPT-4o… (20-40 секунд)</p></div>`;
    try {
      const questions = await generateExam(subjectId);
      if (!questions.length) throw new Error('Не получено вопросов');
      setCachedExam(subjectId, questions);
      showExam(questions, false);
    } catch (e) {
      examBody.innerHTML = `<div class="alert alert-error"><strong>Ошибка:</strong> ${esc(e.message)}</div>`;
    }
  }

  function showExam(questions, fromCache) {
    const items = questions.map((q, i) => {
      const options = (q.o || []).map((opt, oi) => {
        const letter = String.fromCharCode(65 + oi);
        return `<button class="quiz-option" data-index="${oi}">
          <span class="quiz-letter">${letter}</span>
          <span class="quiz-text">${esc(opt)}</span>
        </button>`;
      }).join('');
      return `
        <div class="quiz-question" data-correct="${q.c}" data-index="${i}">
          <div class="quiz-q-header">
            <span class="quiz-num">${String(i + 1).padStart(2, '0')}</span>
            <div class="quiz-q-text">
              ${esc(q.q)}
              ${q.t ? `<div class="quiz-topic">// ${esc(q.t)}</div>` : ''}
            </div>
          </div>
          <div class="quiz-options">${options}</div>
          <div class="quiz-explanation hidden"><strong>Объяснение:</strong> ${esc(q.e || '')}</div>
        </div>`;
    }).join('');

    examBody.innerHTML = `
      ${fromCache ? '<div class="cache-badge">⚡ Из памяти браузера</div>' : ''}
      <div class="exam-progress">
        <div class="exam-progress-bar"><div class="exam-progress-fill" id="exam-fill"></div></div>
        <div class="exam-progress-text" id="exam-progress-text">Отвечено: 0/${questions.length} · Правильно: 0</div>
      </div>
      <div class="quiz exam-quiz">${items}</div>
      <div class="exam-summary hidden" id="exam-summary"></div>`;

    attachExamHandlers(questions);
  }

  function attachExamHandlers(questions) {
    const fillEl = document.getElementById('exam-fill');
    const textEl = document.getElementById('exam-progress-text');
    const summaryEl = document.getElementById('exam-summary');
    let answered = 0, correct = 0;
    const wrongTopics = {};

    document.querySelectorAll('.quiz-question').forEach((q, idx) => {
      const correctIdx = parseInt(q.dataset.correct, 10);
      const options = q.querySelectorAll('.quiz-option');
      const explanation = q.querySelector('.quiz-explanation');

      options.forEach(opt => {
        opt.addEventListener('click', () => {
          if (q.classList.contains('answered')) return;
          q.classList.add('answered');
          const chosen = parseInt(opt.dataset.index, 10);
          const isRight = chosen === correctIdx;

          options.forEach((o, i) => {
            o.disabled = true;
            if (i === correctIdx) o.classList.add('correct');
            if (i === chosen && !isRight) o.classList.add('wrong');
          });
          explanation.classList.remove('hidden');
          answered++;
          if (isRight) correct++;
          else {
            const topic = questions[idx].t || 'Без темы';
            wrongTopics[topic] = (wrongTopics[topic] || 0) + 1;
          }

          const pct = (answered / questions.length) * 100;
          fillEl.style.width = pct + '%';
          textEl.textContent = `Отвечено: ${answered}/${questions.length} · Правильно: ${correct}`;

          if (answered === questions.length) showSummary();
        });
      });
    });

    function showSummary() {
      const pct = Math.round((correct / questions.length) * 100);
      let grade = 'низкий';
      let color = 'red';
      if (pct >= 85) { grade = 'отлично'; color = 'green'; }
      else if (pct >= 70) { grade = 'хорошо'; color = 'green'; }
      else if (pct >= 50) { grade = 'удовлетворительно'; color = 'yellow'; }

      const weakList = Object.entries(wrongTopics)
        .sort(([,a],[,b]) => b - a)
        .slice(0, 5)
        .map(([t, n]) => `<li>${esc(t)} — ${n} ошибок</li>`).join('');

      summaryEl.classList.remove('hidden');
      summaryEl.innerHTML = `
        <h3>📊 Результат экзамена</h3>
        <div class="exam-score exam-score-${color}">
          <div class="exam-score-pct">${pct}%</div>
          <div class="exam-score-text">${correct} из ${questions.length} · ${grade}</div>
        </div>
        ${weakList ? `<div class="exam-weak"><strong>Темы с ошибками — повтори их:</strong><ul>${weakList}</ul></div>` : ''}
        <button class="btn-primary" onclick="location.hash='#/exam/${subjectId}';location.reload()">↻ Попробовать ещё</button>`;
      summaryEl.scrollIntoView({ behavior: 'smooth' });
    }
  }

  document.getElementById('exam-new').addEventListener('click', () => load(true));
  document.getElementById('exam-cached').addEventListener('click', () => {
    const cached = getCachedExam(subjectId);
    if (cached?.length) showExam(cached, true);
    else alert('Предыдущего экзамена ещё нет');
  });

  load(false);
}

// ─── Кнопки TTS и «Объясни иначе» ───────────────────────────────────
let currentAudio = null;
let currentAudioBtn = null;

function attachBlockButtons() {
  document.querySelectorAll('.block-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const idx = parseInt(btn.dataset.idx, 10);
      const block = window.__currentBlocks?.[idx];
      if (!block) return;

      if (action === 'tts') return handleTTS(btn, block);
      if (action === 'explain') return handleExplain(btn, idx, block);
    });
  });
}

async function handleTTS(btn, block) {
  if (!getOpenAIKey()) {
    alert('OpenAI ключ не настроен. Открой ⚙ и вставь его.');
    return;
  }

  // Если этот же блок играет — ставим на паузу/возобновляем
  if (currentAudioBtn === btn && currentAudio) {
    if (currentAudio.paused) { currentAudio.play(); btn.textContent = '⏸ Пауза'; }
    else { currentAudio.pause(); btn.textContent = '▶ Продолжить'; }
    return;
  }

  // Останавливаем предыдущее
  if (currentAudio) {
    currentAudio.pause();
    if (currentAudioBtn) currentAudioBtn.textContent = '▶ Слушать';
  }

  const text = `${block.heading || ''}. ${block.content || ''}`;
  btn.textContent = '⏳ Загрузка…';
  btn.disabled = true;

  try {
    const url = await callOpenAITTS(text);
    const audio = new Audio(url);
    currentAudio = audio;
    currentAudioBtn = btn;
    audio.onended = () => { btn.textContent = '▶ Слушать'; URL.revokeObjectURL(url); currentAudio = null; };
    audio.onerror = () => { btn.textContent = '✕ Ошибка'; currentAudio = null; };
    btn.textContent = '⏸ Пауза';
    btn.disabled = false;
    audio.play();
  } catch (e) {
    btn.textContent = '✕ ' + e.message.slice(0, 30);
    btn.disabled = false;
    setTimeout(() => { btn.textContent = '▶ Слушать'; }, 4000);
  }
}

async function handleExplain(btn, idx, block) {
  if (!getOpenAIKey()) {
    alert('OpenAI ключ не настроен. Открой ⚙ и вставь его.');
    return;
  }
  const extraEl = document.querySelector(`[data-extra-idx="${idx}"]`);
  if (!extraEl) return;

  // Если уже есть объяснение — сворачиваем
  if (extraEl.querySelector('.alt-explanation')) {
    extraEl.innerHTML = '';
    btn.textContent = '↺ Объясни иначе';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Думает…';
  extraEl.innerHTML = `<div class="alt-loading">GPT-4o готовит альтернативное объяснение…</div>`;

  try {
    const topicTitle = document.querySelector('.topic-header h1')?.textContent || '';
    const answer = await callOpenAI({
      messages: [
        { role: 'system', content: 'Ты — опытный школьный преподаватель. Объясняешь простым языком, через аналогии из повседневной жизни. Без воды.' },
        { role: 'user', content: `Тема ЕНТ: «${topicTitle}». Подраздел: «${block.heading}».\n\nОбъясни этот материал ДРУГИМ способом — проще, через аналогии и примеры из жизни:\n\n${block.content}` },
      ],
      model: OPENAI_CHAT_MODEL,
      maxTokens: 800,
    });
    extraEl.innerHTML = `
      <div class="alt-explanation">
        <div class="alt-header">💡 Альтернативное объяснение (GPT-4o)</div>
        <div class="alt-body">${formatBody(answer)}</div>
      </div>`;
    btn.textContent = '✕ Скрыть';
  } catch (e) {
    extraEl.innerHTML = `<div class="alt-error">Ошибка: ${esc(e.message)}</div>`;
    btn.textContent = '↺ Попробовать снова';
  } finally {
    btn.disabled = false;
  }
}

function renderTopicNav(subjectId, topicId) {
  const { prev, next, index, total } = getPrevNextTopic(subjectId, topicId);
  const prevHtml = prev ? `
    <a href="#/subject/${subjectId}/topic/${esc(prev.id)}" class="nav-arrow nav-prev">
      <span class="nav-arrow-label">← Предыдущая</span>
      <span class="nav-arrow-title">${esc(prev.title)}</span>
    </a>` : '<div></div>';
  const nextHtml = next ? `
    <a href="#/subject/${subjectId}/topic/${esc(next.id)}" class="nav-arrow nav-next">
      <span class="nav-arrow-label">Следующая →</span>
      <span class="nav-arrow-title">${esc(next.title)}</span>
    </a>` : '<div></div>';
  return `
    <nav class="topic-nav">
      <div class="topic-nav-progress">Тема ${index} из ${total}</div>
      <div class="topic-nav-buttons">
        ${prevHtml}
        <a href="#/subject/${subjectId}" class="nav-arrow nav-all">
          <span class="nav-arrow-label">⊞ Все темы</span>
        </a>
        ${nextHtml}
      </div>
    </nav>`;
}

function renderQuiz(quiz) {
  const items = quiz.map((q, i) => {
    const options = (q.options || []).map((opt, oi) => {
      const letter = String.fromCharCode(65 + oi); // A, B, C, D
      return `<button class="quiz-option" data-index="${oi}">
        <span class="quiz-letter">${letter}</span>
        <span class="quiz-text">${esc(opt)}</span>
      </button>`;
    }).join('');
    return `
      <div class="quiz-question" data-correct="${q.correct}" data-index="${i}">
        <div class="quiz-q-header">
          <span class="quiz-num">${String(i + 1).padStart(2, '0')}</span>
          <div class="quiz-q-text">${esc(q.question)}</div>
        </div>
        <div class="quiz-options">${options}</div>
        <div class="quiz-explanation hidden">
          <strong>Объяснение:</strong> ${esc(q.explanation || '')}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="quiz">
      <div class="quiz-header">
        <h3>// Тест для закрепления</h3>
        <div class="quiz-score" id="quiz-score">Отвечено: <span class="score-current">0</span>/<span class="score-total">${quiz.length}</span> · Правильно: <span class="score-correct">0</span></div>
      </div>
      ${items}
      <button class="quiz-reset" id="quiz-reset">↻ Пройти заново</button>
    </div>`;
}

function attachQuizHandlers() {
  const quiz = document.querySelector('.quiz');
  if (!quiz) return;

  const scoreCurrent = quiz.querySelector('.score-current');
  const scoreCorrect = quiz.querySelector('.score-correct');
  let answered = 0;
  let correct = 0;

  quiz.querySelectorAll('.quiz-question').forEach(q => {
    const correctIdx = parseInt(q.dataset.correct, 10);
    const options = q.querySelectorAll('.quiz-option');
    const explanation = q.querySelector('.quiz-explanation');

    options.forEach(opt => {
      opt.addEventListener('click', () => {
        if (q.classList.contains('answered')) return;
        q.classList.add('answered');
        const chosen = parseInt(opt.dataset.index, 10);
        const isRight = chosen === correctIdx;

        options.forEach((o, idx) => {
          o.disabled = true;
          if (idx === correctIdx) o.classList.add('correct');
          if (idx === chosen && !isRight) o.classList.add('wrong');
        });

        explanation.classList.remove('hidden');
        answered++;
        if (isRight) correct++;
        scoreCurrent.textContent = answered;
        scoreCorrect.textContent = correct;
      });
    });
  });

  const resetBtn = quiz.querySelector('#quiz-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      answered = 0;
      correct = 0;
      scoreCurrent.textContent = '0';
      scoreCorrect.textContent = '0';
      quiz.querySelectorAll('.quiz-question').forEach(q => {
        q.classList.remove('answered');
        q.querySelectorAll('.quiz-option').forEach(o => {
          o.disabled = false;
          o.classList.remove('correct', 'wrong');
        });
        q.querySelector('.quiz-explanation')?.classList.add('hidden');
      });
      quiz.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function formatBody(text) {
  const lines = text.split(/\n/);
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) { out.push('</ul>'); inList = false; }
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${esc(line.slice(2))}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function attachImageZoom() {
  document.querySelectorAll('#content-area img').forEach(img => {
    img.addEventListener('click', () => {
      const modal = document.createElement('div');
      modal.className = 'image-modal';
      modal.innerHTML = `<img src="${esc(img.src)}" alt="">`;
      modal.addEventListener('click', () => modal.remove());
      document.body.appendChild(modal);
    });
  });
}

// ─── Чат ─────────────────────────────────────────────────────────────
function setupChat(subjectId, topicId) {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');
  const sendBtn = document.getElementById('chat-send');

  function addMsg(role, text, extraClass = '') {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg-${role}${extraClass ? ' ' + extraClass : ''}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    if (!hasApiKey()) {
      addMsg('ai', 'Сначала вставь API-ключ — кнопка ⚙ в шапке.', 'chat-msg-error');
      return;
    }

    addMsg('user', question);
    chatHistory.push({ role: 'user', content: question });
    input.value = '';
    sendBtn.disabled = true;

    const loading = addMsg('ai', 'Думаю…', 'chat-msg-loading');

    try {
      const found = findTopic(subjectId, topicId);
      const ctx = found
        ? `Ученик изучает тему «${found.topic.title}» (раздел: ${found.section.title}, предмет: ${SUBJECTS[subjectId].title}). `
        : '';
      const system =
        'Ты — терпеливый репетитор по подготовке к ЕНТ Казахстана. ' + ctx +
        'Отвечай ясно, кратко, на уровне старшеклассника. ' +
        'Не углубляйся в университетский материал. ' +
        'Если вопрос не по теме предмета — мягко верни ученика к учёбе.';

      const answer = await callClaude({
        system,
        messages: chatHistory.slice(-10),
        maxTokens: 1500,
      });
      loading.remove();
      addMsg('ai', answer);
      chatHistory.push({ role: 'assistant', content: answer });
    } catch (e) {
      loading.remove();
      addMsg('ai', `Ошибка: ${e.message}`, 'chat-msg-error');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

// ─── Модалка настроек ────────────────────────────────────────────────
const settingsModal = document.getElementById('settings-modal');
const apiKeyInput = document.getElementById('api-key-input');
const openaiKeyInput = document.getElementById('openai-key-input');
const modelSelect = document.getElementById('model-select');
const statsBlock = document.getElementById('usage-stats');

function renderStats() {
  if (!statsBlock) return;
  const s = getStats();
  if (!s.totalRequests) {
    statsBlock.innerHTML = `<div class="stats-empty">// Пока нет запросов</div>`;
    return;
  }
  const byModel = Object.entries(s.byModel || {}).map(([id, m]) => {
    const shortName = id.includes('haiku') ? 'Haiku' : id.includes('sonnet') ? 'Sonnet' : id.includes('opus') ? 'Opus' : id;
    return `<div class="stat-row"><span>${shortName}</span><span>${m.requests} запр. · $${m.cost.toFixed(4)}</span></div>`;
  }).join('');
  statsBlock.innerHTML = `
    <div class="stat-row stat-total"><span>Всего потрачено</span><span class="stat-cost">$${s.totalCost.toFixed(4)}</span></div>
    <div class="stat-row"><span>Запросов</span><span>${s.totalRequests}</span></div>
    <div class="stat-row"><span>Токенов вход/выход</span><span>${(s.totalInputTokens||0).toLocaleString()} / ${(s.totalOutputTokens||0).toLocaleString()}</span></div>
    ${byModel}
    <button class="btn-reset-stats" id="btn-reset-stats">Сбросить статистику</button>`;
  document.getElementById('btn-reset-stats')?.addEventListener('click', () => {
    if (confirm('Точно сбросить статистику расходов?')) {
      resetStats();
      renderStats();
    }
  });
}

function openSettings() {
  apiKeyInput.value = getApiKey();
  if (openaiKeyInput) openaiKeyInput.value = getOpenAIKey();
  if (modelSelect) modelSelect.value = getModelKey();
  renderStats();
  settingsModal.classList.remove('hidden');
  apiKeyInput.focus();
}
function closeSettings() {
  settingsModal.classList.add('hidden');
}

document.getElementById('btn-settings').addEventListener('click', (e) => {
  e.preventDefault();
  openSettings();
});
document.getElementById('close-settings').addEventListener('click', closeSettings);
document.getElementById('save-key').addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key) setApiKey(key);
  if (openaiKeyInput) {
    const ok = openaiKeyInput.value.trim();
    if (ok) setOpenAIKey(ok);
  }
  if (modelSelect) setModelKey(modelSelect.value);
  closeSettings();
  navigate();
});
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

if (!hasApiKey()) {
  setTimeout(openSettings, 400);
}

window.addEventListener('hashchange', navigate);
navigate();

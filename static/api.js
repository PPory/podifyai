'use strict';

  const PLACEHOLDER_TITLES = new Set([
    '未命名标题',
    '未命名的标题',
    '无标题播客',
    'AI生成的播客',
    'AI生成的标题'
  ]);
  const GENERIC_SOURCE_TITLES = new Set(['外部链接', 'PDF文档', 'PDF 文件']);


  // ==================== 通用网络与选择器 ====================
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include'
    });
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('未登录，正在跳转到登录页');
      }
      if (res.status === 402) {
        const err = new Error('积分不足');
        err.paymentRequired = true;
        throw err;
      }
      if (res.status === 403) {
        throw new Error('权限不足');
      }
      let msg;
      try { msg = (await res.json()).error; } catch (_) { msg = await res.text(); }
      throw new Error(msg || `请求失败 (${res.status})`);
    }
    return res.json();
  }

  function summarizeTitleFallback(rawText) {
    const text = (rawText ?? '').toString().replace(/\r\n?/g, '\n');
    const lines = text
      .split('\n')
      .map(line => line.replace(/^\s*\[S\d+\]\s*/, '').trim())
      .filter(Boolean);

    for (const line of lines) {
      const cleaned = normalizeDraftTitle(
        line
          .replace(/^[【\[]?\s*标题[】\]]?\s*[:：-]?\s*/i, '')
          .replace(/\s+/g, ' ')
          .trim()
      );
      if (!cleaned) continue;
      return cleaned.length > 24 ? `${cleaned.slice(0, 24).trim()}...` : cleaned;
    }

    return undefined;
  }

  function pickTitleLike(obj) {
    const explicitTitle = normalizeDraftTitle(obj?.title) || normalizeDraftTitle(obj?.generatedTitle);
    if (explicitTitle) return explicitTitle;

    const sourceTitle = normalizeDraftTitle(obj?.source_title ?? obj?.sourceTitle);
    if (sourceTitle && !GENERIC_SOURCE_TITLES.has(sourceTitle)) {
      return sourceTitle;
    }

    const inputType = obj?.input_type ?? obj?.inputType;
    if (['text', 'manual'].includes(inputType)) {
      const originalTitle = summarizeTitleFallback(obj?.original_input);
      if (originalTitle) return originalTitle;
    }

    return summarizeTitleFallback(obj?.script_preview ?? obj?.script_full)
      || summarizeTitleFallback(obj?.original_input)
      || '新作品';
  }

  // 兼容：统一获取当前脚本、音色与草稿标题
  function getCurrentScriptText() {
    return (mainTextarea?.value || '').trim();
  }

  // 1) 归一化对话标签 —— 把各种 S1: / S1、 / [S1]: 等都改成标准 [S1]
  function normalizeDialogueTags(raw) {
    if (!raw) return '';
    return raw
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => {
        const t = line.trim();
        if (!t) return '';
        const m = t.match(/^\s*\[?\s*S\s*([12])\s*\]?\s*[:：、.．-]?\s*/i);
        if (m) return `[S${m[1]}]` + t.slice(m[0].length);
        return t;
      })
      .join('\n')
      // 防止模型把 [S1][S1] 连在一起这类异常
      .replace(/\[S([12])\]\s*\[S\1\]\s*/g, '[S$1] ');
  }

  // 2) 在 LLM 生成后写回文本区之前，做一次规范化
  async function onScriptGenerated(text, apiTitle = null) {
    // 使用新的规范化函数
    const { title, body } = normalizeScriptOutput(text, currentMode);
    
    // 优先使用真实标题，后端解析失败时回退到前端从脚本里提取的标题
    generatedTitle = normalizeDraftTitle(apiTitle) || normalizeDraftTitle(title) || '';
    
    // 更新文本区域
    mainTextarea.value = body;
    adjustTextareaHeight(mainTextarea);
    updatePodcastButtonState();
  }

  function getSelectedVoiceName() {
    // 兼容性函数：返回当前模式下的主要音色
    if (currentMode === 'single') {
      return selectedVoices.s1;
    } else {
      return selectedVoices.s1; // 对话模式下返回S1作为主要音色
    }
  }

  // 只把这个用于"预听单人音色"等简单场景
  // function getSelectedVoiceName() { ... }  // 保留给单人模式使用（不要再用于合成）

  function getSelectedVoicesForSynthesis() {
    if (currentMode === 'single') {
      return { s1Id: selectedVoiceIds.s1, s2Id: null };
    }
    return { s1Id: selectedVoiceIds.s1, s2Id: selectedVoiceIds.s2 };
  }

  function normalizeDraftTitle(rawTitle) {
    const title = (rawTitle || '').toString().trim();
    if (!title) return undefined;
    if (PLACEHOLDER_TITLES.has(title)) {
      return undefined;
    }
    return title;
  }

  function getCurrentDraftTitle() {
    return normalizeDraftTitle(generatedTitle);
  }

  function hasCreationDraft() {
    const textareaText = (mainTextarea?.value || '').trim();
    const bufferedContent = currentContent instanceof File
      ? true
      : (typeof currentContent === 'string' && currentContent.trim().length > 0);

    return Boolean(
      textareaText ||
      bufferedContent ||
      generatedScript ||
      generatedTitle ||
      window.originalInputContent ||
      window.originalInputType ||
      window.pdfFilename ||
      window.pdfPath
    );
  }

  function resetCreationDraft({
    confirmIfDirty = false,
    promptText = '是否清空当前内容开始新创作？',
    resetVoices = true,
    closePopovers = true
  } = {}) {
    if (confirmIfDirty && hasCreationDraft()) {
      const ok = window.confirm(promptText);
      if (!ok) return false;
    }

    generatedScript = '';
    generatedTitle = '';
    currentContent = '';
    window.originalInputContent = '';
    window.originalInputType = '';
    window.pdfFilename = null;
    window.pdfPath = null;

    if (mainTextarea) {
      mainTextarea.value = '';
      mainTextarea.placeholder = defaultMainTextareaPlaceholder;
      adjustTextareaHeight(mainTextarea);
    }

    if (pdfUploadInput) {
      pdfUploadInput.value = '';
    }

    if (resetVoices) {
      selectedVoices = { s1: null, s2: null };
      selectedVoiceIds = { s1: null, s2: null };
      if (typeof updateVoiceSelectionDisplay === 'function') {
        updateVoiceSelectionDisplay();
      } else if (voiceSelectText) {
        voiceSelectText.textContent = '音色选择';
      }
    }

    if (voiceList) {
      voiceList.querySelectorAll('.voice-item.selected').forEach((item) => {
        item.classList.remove('selected');
      });
    }

    if (closePopovers && typeof closeAllPopovers === 'function') {
      closeAllPopovers();
    }

    const page = document.querySelector('.page');
    if (page) {
      const audioContainers = page.querySelectorAll('div[style*="background: #f8f8f8"]');
      audioContainers.forEach((container) => {
        if (container.querySelector('h3')?.textContent === '生成的播客音频') {
          container.remove();
        }
      });
    }

    updatePodcastButtonState();
    return true;
  }

  // 工具函数：优先按 ID 获取详情容器，不依赖具体层级
  const getDetailEl = () => {
    const rail = document.querySelector('.content-rail');
    const el = document.getElementById('route-history-detail');

    if (!el) {
      console.error('❌ 详情页容器 #route-history-detail 不存在！请检查 index.html');
      return null;
    }

    // 容错：若浏览器解析后的层级不对，自动搬运回内容区
    if (rail && el.parentElement !== rail) {
      rail.appendChild(el);
    }

    return el;
  };
  const getHomeEl = () => document.getElementById('route-home');
  

  
  // 侧边栏
  const sidebar = document.querySelector('.lh-sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const composerAnchor = document.getElementById('composer');

  // 模式切换
  const rolesMode = document.getElementById('roles-mode');
  const singleMode = document.getElementById('single-mode');
  
  // 主输入区域
  const mainTextarea = document.getElementById('main-textarea');
  const defaultMainTextareaPlaceholder = mainTextarea?.getAttribute('placeholder') || '输入文字、上传文件或粘贴链接，我们帮你生成播客';
  const createScriptBtn = document.getElementById('create-script-btn');
  const synthesizePodcastBtn = document.getElementById('synthesize-podcast-btn');
  
  // 底部控制按钮
  const modelSelectBtn = document.getElementById('model-select-btn');

  const voiceSelectBtn = document.getElementById('voice-select-btn');
  const linkBtn = document.getElementById('link-btn');
  const uploadBtn = document.getElementById('upload-btn');
  
  // 弹窗元素
  const modelPopover = document.getElementById('model-popover');

  const voiceDropdown = document.getElementById('voice-dropdown');
  
  // 按钮文本元素
  const modelSelectText = document.getElementById('model-select-text');

  const voiceSelectText = document.getElementById('voice-select-text');
  
  // 音色列表
  const voiceList = document.querySelector('.voice-list');
  const addVoiceBtn = document.getElementById('add-voice-btn');
  
  // 模态框
  const linkModal = document.getElementById('link-modal');
  const addVoiceModal = document.getElementById('add-voice-modal');
  
  // 链接模态框元素
  const linkInput = document.getElementById('link-input');
  const confirmLinkBtn = document.getElementById('confirm-link-btn');
  const closeLinkModal = document.getElementById('close-link-modal');
  
  // 添加音色模态框元素
  const closeAddVoiceModal = document.getElementById('close-add-voice-modal');
  const modeHint = document.getElementById('mode-hint');
  const addVoiceNameInput = document.getElementById('add-voice-name-input');
  const addReferenceTextInput = document.getElementById('add-reference-text-input');
  const addReferenceAudioInput = document.getElementById('add-reference-audio-input');
  const fileNameDisplay = document.getElementById('file-name-display');
  const saveVoiceBtn = document.getElementById('save-voice-btn');
  

  
  // PDF上传输入
  const pdfUploadInput = document.getElementById('pdf-upload-input');
  
  // ==================== 全局状态 ====================
  
  let currentMode = 'role'; // 'role' 或 'single'
  let selectedVoices = { s1: null, s2: null }; // 双音色选择状态（存储ID）
  let selectedVoiceIds = { s1: null, s2: null }; // 双音色ID选择状态
  let selectedModel = 'gemini-2.5-flash'; // 继续传后端，UI不再暴露选择
  let selectedStyle = JSON.parse(localStorage.getItem('podify_style') || '{"role":"interview","single":"edu"}');
  // false=精简 true=详尽
  let lengthDetailed = localStorage.getItem('podify_length_detailed') === 'true';
  let voices = []; // 音色列表
  let currentContent = ''; // 当前输入内容
  let generatedScript = ''; // 生成的脚本
  let generatedTitle = '';
  let editingVoice = null; // 当前编辑的音色
  let currentlyPlayingAudio = null; // 当前正在播放的音频实例
  let playlist = [];                    // @deprecated 已统一使用 playerManager.playlist
  let currentPlaylistIndex = 0;        // @deprecated 已统一使用 playerManager.currentTrackIndex

  // ==================== 风格预设 ====================
  // 图标定义
  const ICONS = {
    mic: '<svg t="1757842200362" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2599" width="16" height="16"><path d="M205.6 690c-31.5 36.1-29.6 90.5 4.2 124.2 33.9 33.8 88.1 35.7 124.3 4.3l87.8-76.5L282 602.1 205.6 690z m582.6-454.2c-70.3-70.3-184.4-70.2-254.8 0.2-19.3 19.3-33 41.9-41.8 65.8l230.5 230.5c24-8.8 46.5-22.6 65.8-41.7 70.5-70.4 70.6-184.5 0.3-254.8z m-338.4 88c-18.6-18.7-47.6-20.2-64.4-3.4L255.2 450.6c-16.8 16.8-15.2 45.8 3.4 64.4L509 765.4c18.6 18.7 47.6 20.2 64.4 3.4l130.3-130.2c16.7-16.8 15.2-45.7-3.4-64.4L449.8 323.8z m-15.5 175.8c-12 12-31.5 12-43.4 0-12-12-12-31.5 0-43.4 12-12 31.5-12 43.4 0 12.2 12 12 31.4 0 43.4z m66.8 66.7c-12 12-31.5 12-43.4 0-12-12-12-31.5 0-43.4 12-12 31.5-12 43.4 0 12 11.9 12 31.4 0 43.4z m66.8 66.7c-12 12-31.5 12-43.4 0-12-12-12-31.5 0-43.5s31.5-12 43.4 0c12 12 12 31.6 0 43.5z m0 0" p-id="2600" fill="#515151"></path></svg>',
    msg: '<svg t="1757842423236" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6813" width="16" height="16"><path d="M890.150874 762.320593H822.215111l-41.351585 175.402666L568.195793 762.320593H429.372681l59.538015-63.813215 259.465482-0.479763s92.731733-11.768415 92.731733-78.334104l-0.603022-359.506489h49.645985c58.7264 0 106.336711 47.721244 106.336711 106.508326v284.072771c-0.000948 58.806044-47.611259 111.552474-106.336711 111.552474zM677.483141 638.962726H467.766993L255.099259 893.751941l-41.351585-254.790163-67.935763-1.681067C87.085511 637.280711 29.392593 603.046874 29.392593 544.24083v-319.544889c0-58.806044 57.692919-116.614637 116.419318-116.614637h531.67123c58.7264 0 101.289719 57.808593 101.289718 116.614637v319.544889c-0.000948 58.806044-42.563319 94.721896-101.289718 94.721896z" fill="#515151" p-id="6814"></path></svg>',
    bolt:'<svg t="1757842562970" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="15947" width="16" height="16"><path d="M395.765333 586.570667h-171.733333c-22.421333 0-37.888-22.442667-29.909333-43.381334L364.768 95.274667A32 32 0 0 1 394.666667 74.666667h287.957333c22.72 0 38.208 23.018667 29.632 44.064l-99.36 243.882666h187.050667c27.509333 0 42.186667 32.426667 24.042666 53.098667l-458.602666 522.56c-22.293333 25.408-63.626667 3.392-54.976-29.28l85.354666-322.421333z" fill="#515151" p-id="15948"></path></svg>',
    pen: '<svg t="1757842637230" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="22292" width="16" height="16"><path d="M631.994182 887.994182c4.421818 0 8.005818 3.584 8.005818 8.005818v32.023273c0 17.687273-14.289455 31.976727-32.023273 31.976727H416.069818a31.976727 31.976727 0 0 1-32.023273-32.023273v-31.976727c0-4.421818 3.584-8.005818 8.005819-8.005818h239.988363zM512 64a328.052364 328.052364 0 0 1 163.979636 612.072727v115.898182c0 17.687273-14.289455 32.023273-31.976727 32.023273H379.997091a31.976727 31.976727 0 0 1-31.976727-31.976727v-115.898182A328.052364 328.052364 0 0 1 512 64.046545z m128.930909 112.453818a19.176727 19.176727 0 0 0-26.158545 7.354182l-17.780364 31.790545a13.637818 13.637818 0 0 0 4.980364 18.385455c29.230545 18.245818 48.314182 38.772364 68.608 72.145455 7.912727 13.032727 16.197818 37.562182 24.762181 73.541818 2.327273 9.588364 11.496727 15.872 21.317819 14.522182l36.305454-5.02691a17.128727 17.128727 0 0 0 14.522182-19.642181c-7.028364-39.377455-18.850909-72.983273-35.700364-100.677819-17.035636-28.020364-46.545455-58.274909-88.482909-90.810181a19.223273 19.223273 0 0 0-2.420363-1.582546z" p-id="22293" fill="#515151"></path></svg>',
    book:'<svg t="1757842719861" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="25126" width="16" height="16"><path d="M401.1 327.1H281.6c-22 0-39.8 19.1-39.8 42.7 0 23.5 17.8 42.6 39.8 42.6h119.5c22 0 39.8-19.1 39.8-42.6 0-23.6-17.8-42.7-39.8-42.7z m4.2 170.7h-71.1c-9.4 0-18.5 4.5-25.1 12.5-6.7 8-10.4 18.8-10.4 30.1 0 23.6 15.9 42.7 35.6 42.7h71.1c19.7 0 35.6-19.1 35.6-42.7-0.1-23.5-16-42.6-35.7-42.6zM568.9 256c-23.6 0-42.7 19.1-42.7 42.7v398.2c0 23.6 19.1 42.7 42.7 42.7s42.7-19.1 42.7-42.7V298.7c0-23.6-19.1-42.7-42.7-42.7zM351.8 128c22.5 0 44.4 6.6 63.1 19.1l97.1 64.7 97.1-64.7c18.7-12.5 40.6-19.1 63.1-19.1h124.2c62.8 0 113.8 50.9 113.8 113.8v485.1c0 62.8-50.9 113.8-113.8 113.8H671.6c-22.1 0-43.7 6.5-62.1 18.8l-97.6 65-97.6-65c-18.4-12.3-40-18.8-62.1-18.8H227.6c-62.8 0-113.8-50.9-113.8-113.8V241.8c0-62.8 50.9-113.8 113.8-113.8h124.2z" p-id="25127" fill="#515151"></path></svg>',
    film:'<svg t="1757842845455" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="33525" width="16" height="16"><path d="M912 232v560c0 18.4-6.6 34-19.6 47-13 13-28.8 19.6-47 19.6H178.6c-18.4 0-34-6.6-47-19.6-13-13-19.6-28.8-19.6-47V232c0-18.4 6.5-34 19.6-47s28.8-19.6 47-19.6h666.8c18.4 0 34 6.6 47 19.6 13.1 12.9 19.6 28.5 19.6 47z m-640 66.5v-53.4c0-7.2-2.6-13.5-7.9-18.7-5.3-5.2-11.6-7.9-18.7-7.9H192c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9h53.4c7.2 0 13.5-2.6 18.7-7.9 5.2-5.2 7.9-11.3 7.9-18.7z m0 160.1v-53.4c0-7.2-2.6-13.5-7.9-18.7-5.3-5.2-11.6-7.9-18.7-7.9H192c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9h53.4c7.2 0 13.5-2.6 18.7-7.9s7.9-11.5 7.9-18.7z m0 160v-53.4c0-7.2-2.6-13.5-7.9-18.7-5.3-5.2-11.6-7.9-18.7-7.9H192c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9h53.4c7.2 0 13.5-2.6 18.7-7.9 5.2-5.2 7.9-11.5 7.9-18.7z m0 160v-53.4c0-7.2-2.6-13.5-7.9-18.7-5.2-5.2-11.6-7.9-18.7-7.9H192c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9h53.4c7.2 0 13.5-2.6 18.7-7.9s7.9-11.4 7.9-18.7z m586.6-480.1v-53.4c0-7.2-2.6-13.5-7.9-18.7s-11.6-7.9-18.7-7.9h-53.4c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9H832c7.2 0 13.5-2.6 18.7-7.9 5.3-5.2 7.9-11.3 7.9-18.7z m0 160.1v-53.4c0-7.2-2.6-13.5-7.9-18.7s-11.6-7.9-18.7-7.9h-53.4c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9H832c7.2 0 13.5-2.6 18.7-7.9s7.9-11.5 7.9-18.7z m0 160v-53.4c0-7.2-2.6-13.5-7.9-18.7s-11.6-7.9-18.7-7.9h-53.4c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9H832c7.2 0 13.5-2.6 18.7-7.9 5.3-5.2 7.9-11.5 7.9-18.7z m0 160v-53.4c0-7.2-2.6-13.5-7.9-18.7-5.2-5.2-11.6-7.9-18.7-7.9h-53.4c-7.2 0-13.5 2.6-18.7 7.9-5.2 5.2-7.9 11.6-7.9 18.7v53.4c0 7.2 2.6 13.5 7.9 18.7 5.2 5.2 11.5 7.9 18.7 7.9H832c7.2 0 13.5-2.6 18.7-7.9 5.3-5.3 7.9-11.4 7.9-18.7z" fill="#515151" p-id="33526"></path></svg>',
  };

  const STYLE_PRESETS = {
    role: {
      interview: {
        label: '嘉宾访谈',
        icon: ICONS.mic,
        patch: 'S1为主持人，S2为嘉宾。主持人负责建立话题、追问与总结；嘉宾回答结合经验与案例。结构：开场—背景—三轮深问—总结要点。避免口水化，回答要有洞见与细节。'
      },
      banter: {
        label: '双人漫谈',
        icon: ICONS.msg,
        patch: 'S1与S2为固定搭档，口吻自然轻松，允许适度幽默但不跑题。结构：抛话题—互补—小争辩—回归结论—个人小结。注意节奏与呼应感，强化陪伴感。'
      },
      debate: {
        label: '观点碰撞',
        icon: ICONS.bolt,
        patch: 'S1与S2分别持A/B立场：提出论点→举证→对方反驳→回应→共同收束。保持理性与证据导向，强调逻辑链，结尾留开放思考。'
      }
    },
    single: {
      monologue: {
        label: '观点独白',
        icon: ICONS.pen,
        patch: '第一人称、观点鲜明，有经历或方法论背书。结构：观点—为什么—案例/经历—方法/建议—金句总结。语言克制有力，避免空话。'
      },
      edu: {
        label: '知识科普',
        icon: ICONS.book,
        patch: '像老师一样讲清楚。结构：定义—为何重要—原理/框架—类比/例子—常见误区—要点回顾。术语简化、层次清晰，提供心智模型。'
      },
      narrative: {
        label: '故事讲述',
        icon: ICONS.film,
        patch: '以故事驱动。结构：开场悬念—人物动机—冲突升级—转折—结局—余味。细节适度、画面感强，可提示声场但不喧宾夺主。'
      }
    }
  };

  const LENGTH_PATCH = {
    concise: '在不损失核心信息的前提下强力压缩，合并同类项，删除重复铺垫，仅保留关键要点与必要例证，让信息密度最大化。',
    detailed: '尽量保留原始信息的上下文、细节与引用；需要时做适度延展解释，但避免重复与赘述。'
  };
  const playlistAudio = new Audio();   // @deprecated 已统一使用 playerManager.audio
  let currentCardPlayBtn = null;       // @deprecated 已统一使用 playerManager 状态管理
  let isSidebarCollapsed = false; // 侧边栏折叠状态
  
  // 全局播放器元素
  const globalPlayer = document.getElementById('global-player');
  
  // 新增全局状态变量
  let historyItems = [];                    // @deprecated 已统一使用 playerManager.playlist
  const filenameToPlayBtn = new Map();      // audio_filename -> 对应卡片的播放按钮
  const filenameToCard = new Map();         // audio_filename -> 对应卡片DOM
  let playerEls = {};                       // 底部全局播放器 DOM 引用集合
  // 为每张卡片的播放按钮关联独立的 Audio 实例
  const cardButtonToAudio = new WeakMap();
  let playlistPanel = null;
  
  // TODO: 后续迭代中完全移除 @deprecated 变量，统一使用 playerManager.playTrackAtIndex / viewIndices 渲染播放面板
  // 资料库筛选/排序状态
  let libraryFilterMode = 'all'; // all | role | single
  let librarySort = 'recent';    // recent | duration | plays
  
  // 音量控制相关DOM引用
  const volumeBtn = document.getElementById('player-volume-btn');
  const volumeWrap = document.getElementById('player-volume-wrap');
  const volumeSlider = document.getElementById('player-volume-slider');
    
  let playlistListContent; // Moved declaration to a higher scope
  
  // ==================== Player Manager ====================
  
  /**
   * 更新指定卡片的元数据（时长和播放次数）
   * @param {string} id - 卡片的唯一标识
   */

  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  };

  // 防抖函数，避免频繁切换
  let sidebarToggleTimeout = null;

  // ==================== 风格渲染函数 ====================
  function renderStylePopover() {
    if (!modelPopover) return;
    const listEl = modelPopover.querySelector('#style-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const presets = STYLE_PRESETS[currentMode];

    Object.entries(presets).forEach(([key, def]) => {
      const item = document.createElement('div');
      item.className = 'popover-item style-item';
      item.dataset.styleKey = key;
      item.innerHTML = `<span class="style-icon">${def.icon}</span><span class="style-label">${def.label}</span>`;
      if (selectedStyle[currentMode] === key) item.classList.add('is-active');
      listEl.appendChild(item);
    });

    const lenToggle = modelPopover.querySelector('#length-toggle');
    if (lenToggle) lenToggle.checked = lengthDetailed;
  }

  function updateStyleButtonText() {
    const key = selectedStyle[currentMode] || (currentMode === 'role' ? 'interview' : 'edu');
    const label = STYLE_PRESETS[currentMode][key].label;
    const lenTextWord = lengthDetailed ? '完整' : '精简';     // 之前我们已将"详尽"改为"完整"
    // 只显示 "风格｜精简/完整"
    modelSelectText.textContent = `${label}｜${lenTextWord}`;

    // 无障碍 & 悬浮提示仍保留"脚本风格"语义（不影响视觉）
    modelSelectBtn.setAttribute('aria-label', `脚本风格：${label}（${lenTextWord}）`);
    modelSelectBtn.setAttribute('title', `脚本风格：${label}｜${lenTextWord}`);
  }

  // ==================== 输出规范化函数 ====================
  function normalizeScriptOutput(raw, mode){
    let txt = (raw || "").replace(/\r\n?/g, "\n");

    // 1) 标题提取与清洗
    let title = "";
    const titleRe = /(?:^|\n) *[【\[]?标题[】\]]? *[:：]\s*(.+?)\n+/i;
    const m = txt.match(titleRe);
    if (m) { 
      title = m[1].replace(/^\-+|\-+$/g,"").trim(); 
      txt = txt.replace(titleRe, ""); 
    }
    // 兜底：首行若很短，也作标题
    if (!title) { 
      const first = txt.split("\n")[0]; 
      if (first && first.length <= 20) { 
        title = first.trim(); 
        txt = txt.split("\n").slice(1).join("\n"); 
      } 
    }
    // 去掉"---"之类分隔线
    txt = txt.replace(/^\s*[-–—]{3,}\s*$/gm, "");

    // 2) 舞台提示清除（保守，移除全行提示或行内纯提示）
    txt = txt
      .replace(/^\s*[（(].{0,12}?[)）]\s*$/gm, "")        // 提示独占一行
      .replace(/[（(][^)\n]{0,12}[)）]/g, "");            // 行内短提示

    // 3) 单人模式：强插 [S1] 标签保险
    if (mode === "single") {
      // ✅ 单人模式强插 [S1] 标签，确保与 references 中的 [S1] 对齐
      const trimmedTxt = txt.trim();
      if (trimmedTxt && !trimmedTxt.startsWith("[S1]")) {
        txt = "[S1]" + trimmedTxt;
      }
      // 压缩多余空行，保持单行格式
      txt = txt.split("\n").filter(line => line.trim()).join("\n");
    }
    // 4) 双人模式：归一 [S1]/[S2]
    else if (mode === "role") {
      txt = txt.replace(/^\s*S\s*1\s*[:：]\s*/gm, "[S1] ")
               .replace(/^\s*S\s*2\s*[:：]\s*/gm, "[S2] ")
               .replace(/^\s*\[(S1|S2)\]\s*/gm, (_,$1)=>`[${$1}] `);
      // 只保留以 [S1]/[S2] 开头的行，避免溢出段落
      txt = txt.split("\n").map(l => l.trim()).filter(l => !l || /^\[(S1|S2)\] /.test(l)).join("\n");
    }

    // 5) 空行压缩
    txt = txt.replace(/\n{3,}/g, "\n\n").trim();

    return { title: title || "未命名标题", body: txt };
  }
  let sidebarToggleCount = 0;
  let lastToggleTime = 0;
  
  // 性能监控函数
  const measureSidebarToggle = () => {
    const now = performance.now();
    sidebarToggleCount++;
    
    // 如果连续切换次数过多，给出警告
    if (sidebarToggleCount > 10 && (now - lastToggleTime) < 1000) {
      console.warn('⚠️ 侧边栏切换过于频繁，可能存在性能问题');
      sidebarToggleCount = 0;
    }
    
    lastToggleTime = now;
  };
  
  const setSidebarCollapsed = (collapsed) => {
    // 性能监控
    measureSidebarToggle();
    
    // 清除之前的定时器
    if (sidebarToggleTimeout) {
      clearTimeout(sidebarToggleTimeout);
    }
    
    // 防抖：延迟执行，避免频繁切换
    sidebarToggleTimeout = setTimeout(() => {
      isSidebarCollapsed = !!collapsed;
      if (sidebar) {
        // 性能优化：使用 requestAnimationFrame 确保在下一帧执行
        requestAnimationFrame(() => {
          sidebar.classList.toggle('is-collapsed', isSidebarCollapsed);
        });
      }
      storage.set('lh_sidebar_collapsed', isSidebarCollapsed);
    }, 50); // 50ms 防抖延迟
  };

  function formatMinutesAndSeconds(totalSeconds) {
    if (!totalSeconds || typeof totalSeconds !== 'number' || totalSeconds <= 0) {
      return '未知时长';
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes} 分钟 ${seconds} 秒`;
  }

  const adjustTextareaHeight = (element) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = (element.scrollHeight) + 'px';
  };

  const updateVolumeSliderFill = (slider) => {
    if (!slider) return;
    const value = parseFloat(slider.value);
    const min = parseFloat(slider.min || 0);
    const max = parseFloat(slider.max || 1);
    const percent = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--value-percent', `${percent}%`);
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  /**
   * 将秒数格式化为 "XmYs" 或 "Ys" 的字符串。
   * @param {number | null | undefined} totalSeconds - 总秒数.
   * @returns {string} 格式化后的时间字符串, 或 "未知".
   */
  const formatDuration = (totalSeconds) => {
    // 如果输入是无效的 (null, undefined, 0, 或者不是数字), 则返回 "未知"
    if (!totalSeconds || typeof totalSeconds !== 'number' || totalSeconds <= 0) {
      return '未知';
    }
    
    // 计算分钟数 (向下取整)
    const minutes = Math.floor(totalSeconds / 60);
    
    // 计算剩余的秒数 (四舍五入到整数)
    const seconds = Math.round(totalSeconds % 60);
    
                // 如果分钟数大于0, 则显示 "XmYs" 格式
            if (minutes > 0) {
              // 直接使用秒数，不进行补零
              const paddedSeconds = String(seconds);
              return `${minutes}m${paddedSeconds}s`;
            }
    
    // 如果总时长不足一分钟, 则只显示 "Ys" 格式
    return `${seconds}s`;
  };
  
  // 同步面板"模式态类"
  const syncVoiceDropdownMode = () => {
    if (!voiceDropdown) return;
    const isSingle = (currentMode === 'single');
    voiceDropdown.classList.toggle('single', isSingle);
    voiceDropdown.classList.toggle('role', !isSingle);
  };

  // 更新音色选择状态显示
  const updateVoiceSelectionDisplay = () => {
    const s1Slot = document.getElementById('voice-s1-slot');
    const s2Slot = document.getElementById('voice-s2-slot');
    const s1Name = document.getElementById('voice-s1-name');
    const s2Name = document.getElementById('voice-s2-name');
    const swapBtn = document.getElementById('voice-swap-btn');
    
    if (s1Slot && s2Slot && s1Name && s2Name) {
      // 更新S1显示
      if (selectedVoices.s1) {
        s1Name.textContent = selectedVoices.s1;
        s1Name.classList.remove('empty');
        s1Slot.classList.add('selected');
      } else {
        s1Name.textContent = 'S1未选择';
        s1Name.classList.add('empty');
        s1Slot.classList.remove('selected');
      }
      
      // 更新S2显示
      if (selectedVoices.s2) {
        s2Name.textContent = selectedVoices.s2;
        s2Name.classList.remove('empty');
        s2Slot.classList.add('selected');
      } else {
        s2Name.textContent = 'S2未选择';
        s2Name.classList.add('empty');
        s2Slot.classList.remove('selected');
      }
      
      // 根据模式显示/隐藏S2和交换按钮
      if (currentMode === 'single') {
        s2Slot.style.display = 'none';
        swapBtn.style.display = 'none';
      } else {
        s2Slot.style.display = 'flex';
        swapBtn.style.display = 'flex';
      }
    }
    
    // 同步模式态类
    syncVoiceDropdownMode();
    
    // 更新主按钮摘要
    if (voiceSelectText) {
      if (currentMode === 'single') {
        voiceSelectText.textContent = selectedVoices.s1 ? `音色：${selectedVoices.s1}` : '音色选择';
      } else {
        const s1 = selectedVoices.s1 || '未选';
        const s2 = selectedVoices.s2 || '未选';
        voiceSelectText.textContent = `S1:${s1} · S2:${s2}`;
      }
    }
  };

  // 更新播客按钮状态（恢复为控制 #synthesize-podcast-btn）
  const updatePodcastButtonState = () => {
    const hasContent = mainTextarea.value.trim().length > 0;
    // 根据模式检查音色选择
    const ok = currentMode === 'single'
      ? !!selectedVoices.s1
      : !!(selectedVoices.s1 && selectedVoices.s2);
    
    if (hasContent && ok) {
      if (synthesizePodcastBtn) {
        synthesizePodcastBtn.disabled = false;
        synthesizePodcastBtn.style.opacity = '1';
      }
    } else {
      if (synthesizePodcastBtn) {
        synthesizePodcastBtn.disabled = true;
        synthesizePodcastBtn.style.opacity = '0.7';
      }
    }
  };
  
  const showMessage = (message, type = 'success') => {
    // 创建消息元素
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.textContent = message;
    messageEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 3000;
      animation: slideIn 0.3s ease;
      ${type === 'success' ? 'background: #10b981;' : type === 'info' ? 'background: #3b82f6;' : 'background: #ef4444;'}
    `;
    
    document.body.appendChild(messageEl);
    
    // 3秒后自动移除
    setTimeout(() => {
      messageEl.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        if (messageEl.parentNode) {
          messageEl.parentNode.removeChild(messageEl);
        }
      }, 300);
    }, 3000);
  };
  
  const setBtnLoading = (btn, loadingText) => {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
    btn.style.opacity = '0.7';
  };
  
  const resetBtn = (btn) => {
    if (btn.dataset.originalText) {
      btn.textContent = btn.dataset.originalText;
    }
    btn.disabled = false;
    btn.style.opacity = '1';
  };

  // 旧版并列按钮（保留原有逻辑）
  
  const isURL = (str) => {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  };

  // 音量控制函数
  function setGlobalVolume(v) {
    const vol = Math.max(0, Math.min(1, Number(v)));
    if (!isNaN(vol)) {
      // 统一到全局播放器实例
      if (playerManager) {
        playerManager.setVolume(vol);
      } else {
        localStorage.setItem('podifyai_volume', String(vol));
      }
    }
  }

  // ==================== 全局播放器相关函数 ====================
  
  function initGlobalPlayer() {
    if (!globalPlayer) return;

    // 采集底部播放器控件（请确保 index.html 里存在这些类；若不存在，本函数会优雅降级）
    playerEls = {
      playlistBtn: globalPlayer.querySelector('.playlist-btn'),
      speedBtn: globalPlayer.querySelector('.speed-btn'),
      volumeSlider: globalPlayer.querySelector('.volume-slider'),
      playPauseBtn: globalPlayer.querySelector('.play-pause-btn'),
      prevBtn: globalPlayer.querySelector('.prev-btn'),
      nextBtn: globalPlayer.querySelector('.next-btn'),
      title: globalPlayer.querySelector('.player-title'),
      time: globalPlayer.querySelector('.player-time'),
      progressBar: globalPlayer.querySelector('.player-progress-bar'),
      playlistPanel: globalPlayer.querySelector('.playlist-panel'),
      playlistList: null
    };

    // 若没有 playlistPanel，则动态创建（便于适配当前 index.html）
    if (!playerEls.playlistPanel) {
      const panel = document.createElement('div');
      panel.className = 'playlist-panel hidden';
      panel.innerHTML = `<ul class="playlist-list"></ul>`;
      globalPlayer.appendChild(panel);
      playerEls.playlistPanel = panel;
    }
    playerEls.playlistList = playerEls.playlistPanel.querySelector('.playlist-list');

    // 事件绑定
    playerEls.playlistBtn?.addEventListener('click', () => {
      playerEls.playlistPanel.classList.toggle('hidden');
      if (!playerEls.playlistPanel.classList.contains('hidden')) renderPlaylistList();
    });

    // 倍速：循环 1 → 1.25 → 1.5 → 2 → 1
    const speeds = [1, 1.25, 1.5, 2];
    playerEls.speedBtn?.addEventListener('click', () => {
      const current = (playerManager?.audio?.playbackRate) || 1;
      const i = speeds.indexOf(current);
      const next = speeds[(i + 1) % speeds.length];
      if (playerManager?.audio) playerManager.audio.playbackRate = next;
      playerEls.speedBtn.textContent = `${next}x`;
    });

    // 音量：0~1（统一调用 playerManager.setVolume）
    playerEls.volumeSlider?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (!isNaN(v)) {
        playerManager?.setVolume(Math.min(1, Math.max(0, v)));
        updateVolumeSliderFill(e.target);
      }
    });

    playerEls.playPauseBtn?.addEventListener('click', () => {
      playerManager?.handlePlayPause();
    });

    playerEls.prevBtn?.addEventListener('click', () => {
      playerManager?.handlePrev();
    });

    playerEls.nextBtn?.addEventListener('click', () => {
      playerManager?.handleNext();
    });

    // 进度/时间（已由 playerManager.updateUI 接管，此处保留空实现以避免重复）
  }

  function fmtMMSS(s) {
    const m = Math.floor(s / 60);
    const ss = `${Math.floor(s % 60)}`.padStart(2, '0');
    return `${m}:${ss}`;
  }

  function renderPlaylistList() {
    if (!playerEls.playlistList) return;
    playerEls.playlistList.innerHTML = '';
    historyItems.forEach((it, idx) => {
      const li = document.createElement('li');
      li.textContent = it.script_preview || it.audio_filename;
      if (idx === currentPlaylistIndex) li.classList.add('active');
      li.addEventListener('click', () => {
        playerManager.playTrackAtIndex(idx);
        playerEls.playlistPanel.classList.add('hidden');
      });
      playerEls.playlistList.appendChild(li);
    });
  }

  function setCardPlayingState(filename, isPlaying) {
    const btn = filenameToPlayBtn.get(filename);
    const card = filenameToCard.get(filename);
    if (btn) {
      btn.classList.toggle('playing', !!isPlaying);
    }
    // 如需高亮整张卡片，也可在此添加 card.classList.toggle('playing', isPlaying)
  }

  // 同步播放状态函数
  function syncGlobalPlayUI(isPlaying) {
    // 更新"播放全部"按钮
    const playAllBtn = document.querySelector('.play-all-btn');
    if (playAllBtn) {
      playAllBtn.textContent = isPlaying ? '停止播放' : '播放全部';
    }
    
    // 更新底部播放器的播放/暂停按钮
    if (playerEls.playPauseBtn) {
      playerEls.playPauseBtn.classList.toggle('playing', isPlaying);
    }
  }

  
  
  // ============== 通用 Popover 管理（焦点与Esc/外点关闭/焦点陷阱） ==============
  let activePopoverState = null; // { trigger, popover, prevFocus, outsideHandler, keydownHandler }

  const getFocusable = (container) => {
    if (!container) return [];
    const selectors = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
      'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
    ];
    return Array.from(container.querySelectorAll(selectors.join(','))).filter(el => el.offsetParent !== null);
  };

  const closeActivePopover = () => {
    if (!activePopoverState) return;
    const { trigger, popover, outsideHandler, keydownHandler, prevFocus } = activePopoverState;
    popover.classList.add('hidden');
    document.removeEventListener('mousedown', outsideHandler, true);
    document.removeEventListener('keydown', keydownHandler, true);
    activePopoverState = null;
    // 归还焦点
    if (trigger && typeof trigger.focus === 'function') trigger.focus();
    // 恢复前焦点（可选）：若需要，将上行替换为 prevFocus.focus()
  };

  const openPopover = (trigger, popover, opts = {}) => {
    if (!trigger || !popover) return;
    // 若已打开其他，先关闭
    if (activePopoverState) closeActivePopover();
    const prevFocus = document.activeElement;
    popover.classList.remove('hidden');

    // 初始聚焦到第一个可聚焦项
    const firstTarget = (opts.initialFocusSelector && popover.querySelector(opts.initialFocusSelector)) || getFocusable(popover)[0] || popover;
    if (firstTarget && typeof firstTarget.focus === 'function') firstTarget.focus();

    // 外点与Esc/Tab陷阱
    const outsideHandler = (e) => {
      if (!popover.contains(e.target) && !trigger.contains(e.target)) {
        closeActivePopover();
      }
    };
    const keydownHandler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeActivePopover();
      } else if (e.key === 'Tab') {
        const focusables = getFocusable(popover);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const currentIndex = focusables.indexOf(document.activeElement);
        let nextIndex = currentIndex + (e.shiftKey ? -1 : 1);
        if (nextIndex < 0) nextIndex = focusables.length - 1;
        if (nextIndex >= focusables.length) nextIndex = 0;
        e.preventDefault();
        focusables[nextIndex].focus();
      }
    };
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keydownHandler, true);
    activePopoverState = { trigger, popover, prevFocus, outsideHandler, keydownHandler };
  };

  // 关闭所有弹窗（向后兼容）
  const closeAllPopovers = () => {
    closeActivePopover();
    modelPopover.classList.add('hidden');
  
    voiceDropdown.classList.add('hidden');
  };
  
  // 更新模式提示
  const updateModeHint = () => {
    const hintText = modeHint.querySelector('.hint-text');
    if (currentMode === 'role') {
      hintText.textContent = '请上传双人对话音频，参考文本需包含 [S1] [S2] 标签。';
    } else {
      hintText.textContent = '请上传单人旁白音频。';
    }
  };
  
  // ==================== 用户状态检查 ====================
  
  let userStatus = null; // 缓存用户状态
  
  const checkUserStatus = async () => {
    try {
      // 暂时禁用缓存，确保获取最新状态
      // if (userStatus) return userStatus; // 返回缓存状态
      
      const response = await fetch('/api/user/status', {
        method: 'GET',
        credentials: 'include'
      });
      
      if (response.ok) {
        userStatus = await response.json();
        return userStatus;
      } else {
        console.error('获取用户状态失败');
        return null;
      }
    } catch (error) {
      console.error('检查用户状态出错:', error);
      return null;
    }
  };

  // 显示升级付费模态框
  const showUpgradeModal = () => {
    // 创建或显示升级提示
    let upgradeModal = document.getElementById('upgrade-modal');
    if (!upgradeModal) {
      upgradeModal = document.createElement('div');
      upgradeModal.id = 'upgrade-modal';
      upgradeModal.className = 'modal';
      upgradeModal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>🔒 升级到付费版本</h3>
            <button class="close-btn" id="close-upgrade-modal">×</button>
          </div>
          <div class="modal-body">
            <div class="upgrade-content">
              <div class="upgrade-icon">💎</div>
              <p class="upgrade-message">添加个人音色需要升级到付费版本</p>
              <div class="upgrade-features">
                <div class="feature-item">
                  <span class="feature-icon">✅</span>
                  <span class="feature-text">无限制添加个人音色</span>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">✅</span>
                  <span class="feature-text">享受所有共享音色</span>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">✅</span>
                  <span class="feature-text">优先客服支持</span>
                </div>
              </div>
              <div class="upgrade-actions">
                <button class="btn-primary" id="upgrade-now-btn">立即升级</button>
                <button class="btn-secondary" id="upgrade-later-btn">稍后升级</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(upgradeModal);

      // 绑定事件
      document.getElementById('close-upgrade-modal').addEventListener('click', () => {
        upgradeModal.classList.add('hidden');
      });
      
      document.getElementById('upgrade-later-btn').addEventListener('click', () => {
        upgradeModal.classList.add('hidden');
      });
      
      document.getElementById('upgrade-now-btn').addEventListener('click', () => {
        // TODO: 集成支付系统
        showMessage('支付功能即将上线，敬请期待！', 'info');
        upgradeModal.classList.add('hidden');
      });

      // 点击外部关闭
      upgradeModal.addEventListener('click', (e) => {
        if (e.target === upgradeModal) {
          upgradeModal.classList.add('hidden');
        }
      });
    }
    
    upgradeModal.classList.remove('hidden');
  };

  // ==================== 积分系统 ====================
  
  // ---- Credits: state & helpers ----
  async function getUserStatus() {
    try {
      const r = await fetch('/api/user/status', { credentials: 'include' });
      return await r.json();
    } catch {
      return null;
    }
  }

  // 工具：从 /api/user/status 结果里抽取标准化套餐（容错）
  function extractPlanFromStatus(s) {
    if (!s) return 'free';
    const top = s.subscription_plan;
    const userPlan = s.user?.subscription_plan || s.user?.plan;
    const tier = s.subscription?.tier;
    const plan = (top || userPlan || tier || 'free');
    return (plan === 'creator') ? 'lite' : (['free','lite','pro'].includes(plan) ? plan : 'free');
  }

  // 工具：显示/隐藏订阅弹窗中的"管理订阅"行（设置页由 populateSubscriptionSection 单独控制）
  function toggleManageRows(shouldShow) {
    const modalManageRow = document.getElementById('manage-subscription-row');
    if (modalManageRow) {
      modalManageRow.style.display = shouldShow ? 'block' : 'none';
      modalManageRow.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    }
  }

  // 工具：只绑定一次"管理订阅"按钮点击事件 → 打开 Stripe Portal
  function wireManageButtonsOnce() {
    const bind = (id) => {
      const btn = document.getElementById(id);
      if (btn && !btn.dataset.bound) {
        btn.addEventListener('click', openBillingPortal); // 依赖你已有的 openBillingPortal()
        btn.dataset.bound = '1';
    }
    };
    bind('btn-manage-subscription');         // 订阅弹窗里的按钮（如果存在）
    bind('settings-btn-manage-subscription'); // 设置页里的按钮（本次新增）
  }

  // 打开 Stripe Customer Portal（管理/取消订阅）
  async function openBillingPortal() {
    const btn = document.getElementById('btn-manage-subscription');
    if (!btn) return;
    btn.disabled = true;
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 打开后返回设置面板的订阅页
          return_url: window.location.origin + '/#billing'
        })
      });

      if (!res.ok) {
        const msg = await res.text();
        alert(msg || '打开订阅管理失败');
        return;
      }
      const data = await res.json();
      // 与用户预期一致：在当前页直接跳转 Stripe Portal
      window.location.href = data.url;
    } catch (err) {
      alert('网络异常：' + (err?.message || err));
    } finally {
      btn.disabled = false;
    }
  }

  // 根据用户当前套餐（free / lite / pro）显示/隐藏"管理订阅"行；只绑定一次点击事件
  async function updateManageSubscriptionRow() {
    try {
      const r = await fetch('/api/user/status', { credentials: 'include' });
      if (!r.ok) return;
      const s = await r.json();

      const plan =
        s?.subscription?.tier ||
        s?.user?.subscription_plan ||
        s?.user?.plan ||
        (s?.user?.has_premium ? 'pro' : 'free');

      const hasSub = (plan === 'lite' || plan === 'creator' || plan === 'pro');

      // 只控制订阅弹窗中的管理订阅行，设置页由 populateSubscriptionSection 控制
      const modalManageRow = document.getElementById('manage-subscription-row');
      if (modalManageRow) {
        modalManageRow.style.display = hasSub ? 'block' : 'none';
      }

      const bindOnce = (id) => {
        const btn = document.getElementById(id);
        if (btn && !btn.dataset.bound) {
          btn.addEventListener('click', openBillingPortal);
          btn.dataset.bound = '1';
        }
      };
      bindOnce('btn-manage-subscription');
      // 设置页的按钮绑定在 populateSubscriptionSection 中处理
    } catch (e) {
      console.warn('updateManageSubscriptionRow failed', e);
    }
  }

  function updateCreditsBadge(val) {
    const badge = document.getElementById('credits-badge');
    const btn = document.getElementById('nav-credits');
    if (badge) badge.textContent = (val ?? 0);
    if (btn) btn.setAttribute('data-tooltip', `积分 ${val ?? 0}`);
  }

  async function refreshCreditsEverywhere() {
    const s = await getUserStatus();
    const credits = s?.user?.credits ?? 0;
    updateCreditsBadge(credits);
    const wallet = document.getElementById('wallet-credits');
    if (wallet) wallet.textContent = credits;
    
    const plan = extractPlanFromStatus(s);
    console.log('refreshCreditsEverywhere - 用户状态:', s);
    console.log('refreshCreditsEverywhere - 当前套餐:', plan);
    renderPlanUI(plan);
  }

  // 支付后短轮询同步函数
  async function startPostPaymentSync({ sessionId, initialPlan, initialCredits }) {
    // 最多轮询 30s，每 1.5s 一次，直到看到积分或订阅发生变化
    const deadline = Date.now() + 30000;
    let lastCredits = initialCredits;
    let lastPlan    = initialPlan;

    const applyUI = async () => {
      const s = await getUserStatus();
      const credits = s?.user?.credits ?? 0;
      const plan    =
        s?.user?.subscription_plan ||
        s?.subscription?.tier      ||
        s?.user?.plan              ||
        (s?.user?.has_premium ? 'pro' : 'free');

      // 刷新三处：侧边栏徽章、订阅面板里余额、设置页订阅区
      updateCreditsBadge(credits);
      const wallet = document.getElementById('wallet-credits');
      if (wallet) wallet.textContent = credits;
      if (typeof populateSubscriptionSection === 'function') {
        populateSubscriptionSection();  // 设置面板打开时用
      }
      await updateManageSubscriptionRow();  // ← 新增：同步管理订阅行

      return { credits, plan };
    };

    // 立即先跑一次
    let now = await applyUI();
    if (now.credits !== lastCredits || now.plan !== lastPlan) return;

    // 进入轮询，等待 webhook 入库
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      now = await applyUI();
      if (now.credits !== lastCredits || now.plan !== lastPlan) break;
    }
  }

  // Modal open/close
  function openBilling() {
    const modal = document.getElementById('billing-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('is-modal-open'); // 添加模态框打开状态类
    refreshCreditsEverywhere();
    updateManageSubscriptionRow();   // ← 新增：打开弹窗时刷新管理订阅行
    // 深链
    if (location.hash !== '#billing') history.replaceState(null, '', '#billing');
    
    // 若想在订阅弹窗打开时也同步设置面板里的余额
    if (typeof populateSubscriptionSection === 'function') {
      populateSubscriptionSection();
    }
  }
  
  function closeBilling() {
    const modal = document.getElementById('billing-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
    if (location.hash === '#billing') history.replaceState(null, '', location.pathname + location.search);
  }

  // 拉起支付
  async function startCheckout(plan) {
    try {
      // 若当前是 lite 且点击 pro，则直接改订阅（避免重复开新订阅）
      const status = await getUserStatus();
      const curPlan = extractPlanFromStatus(status);

      if (plan === 'pro' && curPlan === 'lite') {
        const r = await fetch('/api/billing/upgrade', { method: 'POST' });
        const data = await r.json().catch(()=>({}));
        if (r.ok && data.ok) {
          showMessage('已升级至专业版');
          await refreshCreditsEverywhere?.();   // 如你已有此函数
          renderPlanUI('pro');
          return;
        } else {
          // 升级接口失败，降级为原有 checkout 流程兜底
          console.warn('upgrade failed, fallback to checkout', data);
        }
      }

      // 走原有 checkout 创建会话
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ plan })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || '创建支付会话失败');
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      alert('创建支付会话失败：' + (err?.message || err));
    }
  }



  // 根据当前套餐渲染 UI（卡片状态 + 管理订阅行）
  function renderPlanUI(plan) {
    try {
      const isTopTier = (plan === 'pro'); // 最高档

      // 1) 卡片/按钮态
      document.querySelectorAll('.plan-card').forEach(card => {
        const p = card.getAttribute('data-plan');   // lite | pro
        const btn = card.querySelector('.plan-cta');
        if (!btn) return;

        // 当前方案 → 置灰"当前方案"
        if (p === plan) {
          btn.textContent = '当前方案';
          btn.disabled = true;
          btn.classList.remove('btn-dark');
          btn.classList.add('btn-secondary');
          return;
        }

        // 其它方案
        btn.disabled = false;
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-dark');

        // 顶档（pro）时不再出现"升级"到更高方案的文案 —— 直接禁用/隐藏 lite 卡片的 CTA
        if (isTopTier && p === 'lite') {
          // 方案一：彻底隐藏
          // btn.style.display = 'none';

          // 方案二：置灰说明（更友好）
          btn.textContent = '已是最高方案';
          btn.disabled = true;
          btn.classList.remove('btn-dark');
          btn.classList.add('btn-secondary');
        } else {
          btn.textContent = (p === 'lite') ? '升级至创作者' : '升级至专业版';
          // 绑定点击（若按钮本身就是你已有的 onclick，可省略）
          btn.onclick = () => startCheckout(p);
        }
      });

      // 2) "取消/管理订阅" 行：非 free 一律显示；free 但历史上有 customer 也允许（便于自助取消/管理）
      const showManage =
        (plan === 'lite' || plan === 'pro');

      toggleManageRows(showManage);
      if (showManage) wireManageButtonsOnce();
    } catch (e) {
      console.warn('renderPlanUI error:', e);
    }
  }

  // ==================== 初始化 ====================
  
  // 页面加载时获取音色列表

  // 当用户从 Stripe 页面切回页面时也刷新一次（兜底）
  window.addEventListener('focus', () => {
    refreshCreditsEverywhere();
    if (typeof populateSubscriptionSection === 'function') {
      populateSubscriptionSection();
    }
  });

  // ====== 支付回跳后的自动同步 ======
  // 检查支付回跳参数
  (function checkPaymentReturn() {
    const url = new URL(location.href);
    const paid = url.searchParams.get('paid');
    let sessionId = url.searchParams.get('session_id');
    
    // 清理 sessionId，移除可能的花括号
    if (sessionId) {
      sessionId = sessionId.replace(/[{}]/g, '');
    }
    
    if (paid === '1') {
      console.log('检测到支付回跳，开始同步...', { paid, sessionId });
      // 延迟执行，确保页面完全加载
      setTimeout(() => {
        if (typeof openBilling === 'function') {
          openBilling();
        }
        syncAfterPayment(sessionId);
      }, 500);
    }
  })();

  async function syncAfterPayment(sessionId) {
    console.log('开始支付后同步，sessionId:', sessionId);
    try {
      if (sessionId && sessionId !== 'CHECKOUT_SESSION_ID') {
        console.log('使用 sessionId 调用 verify 接口...');
        // 优先用后端 verify 兜底入账
        for (let i = 0; i < 6; i++) {
          console.log(`第 ${i + 1} 次尝试调用 verify 接口...`);
          const r = await fetch('/api/billing/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
          });
          const data = await r.json();
          console.log('verify 接口响应:', data);
          if (data && data.ok && data.paid) {
            console.log('支付确认成功，刷新 UI...');
            await refreshUserStatusUI(data.status); // 刷新全部 UI
            clearPaidParams();
            // 使用现有的消息提示函数
            if (typeof showMessage === 'function') {
              showMessage('积分已到账 ✅', 'success');
            }
            return;
          }
          console.log(`第 ${i + 1} 次尝试失败，等待 1.5 秒后重试...`);
          await delay(1500);
        }
        console.log('verify 接口 6 次尝试均失败，降级为轮询...');
      } else {
        console.log('sessionId 无效或为模板字符串，直接使用轮询...');
      }
      // 没有 session_id 或 verify 未能确认 → 退化为轮询 user/status
      console.log('开始轮询用户状态...');
      const before = await fetchUserStatus();
      console.log('轮询前的状态:', before);
      
      for (let i = 0; i < 8; i++) {
        console.log(`第 ${i + 1} 次轮询...`);
        const now = await fetchUserStatus();
        console.log('轮询后的状态:', now);
        
        // 检查是否有变化
        if (!before || 
            now.credits > before.credits || 
            now.subscription_plan !== before.subscription_plan) {
          console.log('检测到状态变化，刷新 UI...');
          await refreshUserStatusUI(now);
          clearPaidParams();
          if (typeof showMessage === 'function') {
            showMessage('积分已到账 ✅', 'success');
          }
          return;
        }
        
        console.log('状态无变化，等待 1.5 秒后重试...');
        await delay(1500);
      }
      
      // 最后兜底也刷新一次
      console.log('轮询完成，最后刷新一次...');
      const latest = await fetchUserStatus();
      await refreshUserStatusUI(latest);
    } catch (e) {
      console.error(e);
    }
  }

  function clearPaidParams() {
    const u = new URL(location.href);
    u.searchParams.delete('paid');
    u.searchParams.delete('session_id');
    history.replaceState(null, '', u);
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 拉取用户状态（积分 + 订阅）
  async function fetchUserStatus() {
    try {
      const res = await fetch('/api/user/status');
      const data = await res.json();
      console.log('fetchUserStatus 响应:', data);
      
      // 兼容你后端的字段名
      const credits = data?.user?.credits ?? data?.credits ?? 0;
      const plan = data?.user?.plan ?? data?.subscription_plan ?? 'free';
      
      console.log('解析后的状态:', { credits, subscription_plan: plan });
      return { credits, subscription_plan: plan };
    } catch (e) {
      console.error('fetchUserStatus 失败:', e);
      return { credits: 0, subscription_plan: 'free' };
    }
  }

  // 刷新 UI（侧边栏积分 + 设置面板订阅卡片）
  async function refreshUserStatusUI(status) {
    try {
      console.log('开始刷新 UI，状态:', status);
      const s = status || await fetchUserStatus();
      console.log('使用的状态数据:', s);
      
      // 侧边栏积分徽标
      const badge = document.querySelector('#credits-badge, .sidebar-points-badge');
      if (badge) {
        badge.textContent = s.credits;
        console.log('更新侧边栏积分:', s.credits);
      } else {
        console.log('未找到侧边栏积分徽标');
      }

      // 设置-订阅卡片
      const planPill = document.querySelector('#settings-plan-label');
      const creditLabel = document.querySelector('#settings-credit-balance');
      
      if (planPill) {
        const planText = s.subscription_plan === 'pro' ? '专业版' :
                        (s.subscription_plan === 'creator' ? '创作者' : '免费版');
        planPill.textContent = planText;
        console.log('更新订阅标签:', planText);
      } else {
        console.log('未找到订阅标签元素');
      }
      
      if (creditLabel) {
        creditLabel.textContent = s.credits;
        console.log('更新积分显示:', s.credits);
      } else {
        console.log('未找到积分显示元素');
      }

      // 调用现有的刷新函数
      if (typeof populateSubscriptionSection === 'function') {
        console.log('调用 populateSubscriptionSection');
        await populateSubscriptionSection();
      }
      if (typeof refreshCreditsDisplay === 'function') {
        console.log('调用 refreshCreditsDisplay');
        await refreshCreditsDisplay();
      }
      
      console.log('UI 刷新完成');
    } catch (e) {
      console.error('refreshUserStatusUI 失败:', e);
    }
  }

  // ==================== 历史详情页功能 ====================
  
  // 标题点击事件代理
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-history-id].history-title-link');
    if (t) {
      e.preventDefault();
      const id = t.dataset.historyId;
      // 切换到详情页
      navigateToHistoryDetail(id);
    }
  });

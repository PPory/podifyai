// PodifyAI 前端交互逻辑
(function () {
  'use strict';

  // ==================== 通用网络与选择器 ====================
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include'
    });
    if (!res.ok) {
      const msg = (await res.text()) || `HTTP ${res.status}`;
      throw new Error(`API ${url} failed: ${msg}`);
    }
    return res.json();
  }

  function pickTitleLike(obj) {
    const t = (obj?.title ?? obj?.generatedTitle ?? obj?.script_preview ?? '').toString().trim();
    return t || '新作品';
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
    
    // 优先使用API返回的标题，如果没有则使用从脚本中提取的标题
    generatedTitle = apiTitle || title;
    
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
  function getCurrentDraftTitle() {
    const t = (generatedTitle || '').toString().trim();
    return t || undefined;
  }

  // ==================== DOM 元素获取 ====================
  
  // 工具函数：只拿到正确层级的那一个
  const getDetailEl = () => {
    let el = document.querySelector('.content-rail > #route-history-detail');
    if (!el) {
      console.warn('🔍 .content-rail > #route-history-detail 未找到，尝试直接查找');
      el = document.getElementById('route-history-detail');
    }
    if (!el) {
      console.error('❌ 详情页容器 #route-history-detail 不存在！请检查 index.html');
    } else {
      // 新增的防御：若不是直系子节点，自动搬运
      const rail = document.querySelector('.content-rail');
      if (rail && el.parentElement !== rail) {
        console.warn('♻️ 详情容器不在 .content-rail 下，自动搬运到正确层级');
        rail.appendChild(el);
      }
      console.log('🎯 获取详情容器:', el);
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
  function updateCardMetaById(id) {
    const card = document.querySelector(`.history-card[data-id="${id}"]`);
    if (!card) return;
    
    const track = playerManager.playlist.find(t => t.id === id);
    if (!track) return;
    
    const durEl = card.querySelector('.meta-duration');
    const playsEl = card.querySelector('.meta-plays');
    
    if (durEl) durEl.textContent = formatDuration(track.duration);
    if (playsEl) playsEl.textContent = String(track.play_count ?? 0);
  }
  
  function updatePlaylistPanelState() {
    if (!playlistListContent || !playerManager) return;

    // 1. 移除旧的激活状态和播放指示器
    const oldActiveItem = playlistListContent.querySelector('.playlist-item.active');
    if (oldActiveItem) {
      oldActiveItem.classList.remove('active');
      const oldIndicator = oldActiveItem.querySelector('.playing-indicator');
      if (oldIndicator) {
        oldIndicator.remove();
      }
    }

    // 2. 为新的当前项添加激活状态和播放指示器
    const newActiveItem = playlistListContent.querySelector(`.playlist-item[data-index="${playerManager.currentTrackIndex}"]`);
    if (newActiveItem) {
      newActiveItem.classList.add('active');
      if (playerManager.isPlaying) {
        // 确保不重复添加
        if (!newActiveItem.querySelector('.playing-indicator')) {
          const indicator = document.createElement('div');
          indicator.className = 'playing-indicator';
          indicator.innerHTML = '<span></span><span></span><span></span>';
          newActiveItem.appendChild(indicator);
        }
      }
    }
  }

  function renderPlaylistPanel() {
    if (!playlistListContent || !playerManager || !playerManager.playlist) return;
    // 全量重建，确保新增/删除后同步
    playlistListContent.innerHTML = '';
    const indices = (playerManager.viewIndices && playerManager.viewIndices.length > 0)
      ? playerManager.viewIndices
      : playerManager.playlist.map((_, i) => i);
    indices.forEach((index) => {
      const track = playerManager.playlist[index];
      const li = document.createElement('li');
      li.className = 'playlist-item';
      li.dataset.index = index;

      const thumbnailUrl = track.thumbnail_filename
        ? `/static/card-thumbnail/${track.thumbnail_filename}`
        : '/static/card-thumbnail/1.jpg';
      const duration = formatDuration(track.duration);

      li.innerHTML = `
        <img src="${thumbnailUrl}" class="playlist-thumbnail" alt="封面图">
        <div class="playlist-track-info">
          <span class="playlist-title"></span>
          <span class="playlist-duration">${duration}</span>
        </div>
      `;
      // 安全赋值标题
      const titleEl = li.querySelector('.playlist-title');
      if (titleEl) titleEl.textContent = pickTitleLike(track);
      
      li.addEventListener('click', (e) => {
          e.stopPropagation();
          playerManager.playTrackAtIndex(index);
      });

      playlistListContent.appendChild(li);
    });
    // 状态同步
    updatePlaylistPanelState();
  }
  const playerManager = {
    audio: new Audio(),       // 唯一的 Audio 实例
    playlist: [],             // 存储从后端获取的完整 history 对象数组
    viewIndices: [],          // 当前视图（筛选/排序后）对应的原始索引数组
    currentTrackIndex: -1,    // 当前播放曲目的索引, -1代表无
    isPlaying: false,         // 当前是否正在播放
    isSeeking: false,         // 用户是否正在拖动进度条
    hasCountedPlayback: false, // 当前曲目是否已计为一次有效播放
    lastCountedTrackId: null,  // 最后计数的曲目ID，用于防止重复计数
    // 性能优化：UI 差异更新状态
    lastUI: { index: -1, playing: false },
    _rafScheduled: false,
    currentTimeEl: document.querySelector('#global-player .current-time'),
    totalTimeEl: document.querySelector('#global-player .total-time'),
    progressBarInnerEl: document.querySelector('#global-player .progress-bar-inner'),
    progressBarContainerEl: document.querySelector('#global-player .player-progress-bar'),
    volumeSliderEl: document.getElementById('volume-slider'),
    volumeIconEl: document.getElementById('volume-icon'),
    volume: 1.0,
    originalVolumeIconSVG: '',
    muteIconSVG: '<path transform="translate(51.2, 51.2) scale(0.8)" d="M854.064629 225.108758C864.969105 213.800413 864.641704 195.793363 853.333359 184.888887 842.025011 173.98441 824.017963 174.311811 813.113486 185.620157L107.524429 904.700143C96.619953 916.008491 96.947354 934.015539 108.255699 944.920016 119.564045 955.824492 137.571095 955.497091 148.475571 944.188746L854.064629 225.108758ZM399.82679 839.982009C407.183349 843.679215 430.123685 855.208363 445.240889 862.805333 523.605333 902.200889 523.605333 902.200889 549.717333 915.342222 615.623111 948.48 683.064889 907.150222 683.064889 833.393778L683.064889 552.874667 682.89505 552.874667 682.89505 552.874667C681.337978 538.62154 669.266116 527.559111 654.620444 527.559111 639.948242 527.559111 627.899344 538.62154 626.345478 552.874667L626.176 552.874667 626.176 562.972444 626.176 833.393778C626.176 833.393778 603.448889 878.677333 575.288889 864.512L423.495649 788.211479 423.479293 788.243265C423.376119 788.195868 423.272528 788.149015 423.168523 788.10271 408.824641 781.716403 392.011708 788.148739 385.613833 802.518605 379.6198 815.98142 384.940911 831.629477 397.476938 838.781315L397.468877 838.796982C397.468877 838.796982 397.586247 838.85597 397.810753 838.968801 398.463855 839.329874 399.136051 839.668096 399.826779 839.982003ZM183.096889 691.02916 183.096889 690.972444 144.128 690.972444C112.725333 690.972444 87.096889 665.315556 86.869333 633.856L85.333333 406.784C85.105778 375.210667 110.222222 349.639111 141.880889 349.639111L230.087111 349.639111 575.203556 176.156444C603.335111 161.991111 626.176 176.099556 626.176 207.616L626.176 224 626.345478 224 626.345478 224C627.899344 238.253128 639.948242 249.315556 654.620444 249.315556 669.266116 249.315556 681.337978 238.253128 682.89505 224L683.064889 224 683.064889 207.616C683.064889 133.774222 615.623111 92.16 549.632 125.326222L216.604444 292.750222 141.880889 292.750222C78.648889 292.750222 28.017778 344.035556 28.444444 407.153778L29.980444 634.225778C30.407111 696.945778 81.408 747.861333 144.128 747.861333L183.096889 747.889778 183.096889 747.861447C183.521215 747.880269 183.947948 747.889778 184.376889 747.889778 200.106667 747.889778 212.821333 735.146667 212.821333 719.445333 212.821333 703.715556 200.106667 691.000889 184.376889 691.000889 183.947948 691.000889 183.521215 691.010378 183.096889 691.02916L183.096889 691.02916Z" fill="#272636" p-id="8874"></path>',
    
    initVolume() {
      if (this.volumeIconEl) {
        this.originalVolumeIconSVG = this.volumeIconEl.innerHTML;
      }
      // 优先从设置中获取默认音量，否则从播放器音量历史记录获取
      const defaultVolume = localStorage.getItem('default-volume');
              const savedVolume = localStorage.getItem('podifyai_volume');
      
      let targetVolume = 1.0; // 默认音量
      if (defaultVolume !== null) {
        targetVolume = parseFloat(defaultVolume) / 100; // 设置中的音量是0-100，需要转换为0-1
      } else if (savedVolume !== null) {
        targetVolume = parseFloat(savedVolume);
      }
      
      this.setVolume(targetVolume);
      
      if (this.volumeSliderEl) {
        this.volumeSliderEl.value = this.volume;
        updateVolumeSliderFill(this.volumeSliderEl); // 在初始化时更新填充
        this.volumeSliderEl.addEventListener('input', (e) => this.setVolume(e.target.value));
      }
      if (this.volumeIconEl) {
        if (this.volume === 0) {
          this.volumeIconEl.innerHTML = this.muteIconSVG;
        } else {
          this.volumeIconEl.innerHTML = this.originalVolumeIconSVG;
        }
      }
    },

    loadPlaylist(items) {
      this.playlist = items;
    },

    playTrackAtIndex(index) {
      if (index === this.currentTrackIndex && this.isPlaying) {
        this.audio.pause();
        return;
      }
      
      const track = this.playlist[index];
      if (!track) {
        console.error(`Track at index ${index} not found.`);
        return;
      }
      
      // 重置计数状态，确保新曲目能正确计数
      this.hasCountedPlayback = false;
      this.lastCountedTrackId = null;

      this.currentTrackIndex = index;
      this.audio.src = `/history_audio/${track.audio_filename}`;
      
      // 自动 seek 到首音到达时间（留 50ms 保护余量）
      const that = this;
      const seekToOnset = () => {
        try {
          const onsetMs = Number(that.playlist[that.currentTrackIndex]?.speech_onset_ms || 0);
          if (onsetMs > 0 && !isNaN(onsetMs)) {
            const t = Math.max(0, onsetMs/1000 - 0.05); // 留 50ms 保护余量
            if (that.audio.currentTime < t) that.audio.currentTime = t;
          }
        } catch {}
      };
      this.audio.addEventListener('loadedmetadata', seekToOnset, { once: true });
      this.audio.addEventListener('play', seekToOnset, { once: true });
      
      this.audio.play();
      globalPlayer.classList.remove('hidden');
    },

    cueTrack(index) {
      this.currentTrackIndex = index;
      const track = this.playlist[index];
      if (track) {
        this.audio.src = `/history_audio/${track.audio_filename}`;
      }
      this.isPlaying = false;
      this.updateUI();
    },

    handlePlayPause() {
      if (this.currentTrackIndex === -1) {
        // 若尚未选择曲目，则默认播放第一首（若存在）
        if (this.playlist && this.playlist.length > 0) {
          this.playTrackAtIndex(0);
          return;
        }
        return;
      }
      if (this.isPlaying) {
        this.audio.pause();
      } else {
        this.audio.play();
      }
      this.isPlaying = !this.isPlaying;
      this.updateUI();
    },

    stopPlayback() {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.isPlaying = false;
      globalPlayer.classList.add('hidden');
      this.currentTrackIndex = -1;
      this.updateUI();
    },

    handleNext(forcePlay = false) {
      const wasPlaying = this.isPlaying;
      if (!this.playlist || this.playlist.length === 0) return;
      if (this.currentTrackIndex === -1) {
        this.playTrackAtIndex(0);
        return;
      }
      let nextIndex = this.currentTrackIndex + 1;
      if (nextIndex >= this.playlist.length) {
        nextIndex = 0; // 循环到第一首
      }
      if (wasPlaying || forcePlay) {
        this.playTrackAtIndex(nextIndex);
      } else {
        this.cueTrack(nextIndex);
      }
    },

    handlePrev() {
      const wasPlaying = this.isPlaying;
      if (!this.playlist || this.playlist.length === 0) return;
      if (this.currentTrackIndex === -1) {
        this.playTrackAtIndex(0);
        return;
      }
      let prevIndex = this.currentTrackIndex - 1;
      if (prevIndex < 0) {
        prevIndex = this.playlist.length - 1; // 循环到最后一首
      }
      if (wasPlaying) {
        this.playTrackAtIndex(prevIndex);
      } else {
        this.cueTrack(prevIndex);
      }
    },

    updateUI(seekPercentage = null) {
      const playPauseBtn = document.getElementById('gp-play-pause-btn');
      const playerTitle = document.getElementById('gp-title');
      const playerThumbnail = document.getElementById('gp-thumbnail');
      const playAllBtn = document.querySelector('.play-all-btn');

      const track = this.playlist[this.currentTrackIndex];
      if (track) {
        if (playerTitle) {
          playerTitle.textContent = pickTitleLike(track);
        }
        if (playerThumbnail) {
          if (track.thumbnail_filename) {
            playerThumbnail.src = `/static/card-thumbnail/${track.thumbnail_filename}`;
          } else {
            playerThumbnail.src = '/static/card-thumbnail/1.jpg'; // 默认备用图片
          }
        }
      }
      
      if (playPauseBtn) {
        playPauseBtn.classList.toggle('is-playing', this.isPlaying);
      }

      // 性能优化：只在状态变化时批量更新卡片按钮状态
      if (this.currentTrackIndex !== this.lastUI.index || this.isPlaying !== this.lastUI.playing) {
        document.querySelectorAll('.history-play-btn').forEach(btn => {
          const btnIndex = parseInt(btn.dataset.index, 10);
          btn.classList.toggle('playing', btnIndex === this.currentTrackIndex && this.isPlaying);
        });
        this.lastUI.index = this.currentTrackIndex;
        this.lastUI.playing = this.isPlaying;
      }

      if (playAllBtn) {
        playAllBtn.textContent = this.isPlaying ? '停止播放' : '播放全部';
      }

      if (this.audio.duration) {
        this.totalTimeEl.textContent = formatTime(this.audio.duration);
        let progressPercent = 0;
        if (seekPercentage !== null) {
          progressPercent = seekPercentage * 100;
        } else {
          progressPercent = (this.audio.currentTime / this.audio.duration) * 100;
        }
        this.progressBarInnerEl.style.width = `${progressPercent}%`;
      } else {
        this.progressBarInnerEl.textContent = '';
        this.progressBarInnerEl.style.width = '0%';
      }
      this.currentTimeEl.textContent = formatTime(this.audio.currentTime);
      
      // 更新播放列表面板状态（仅在面板打开时）
      if (playlistPanel && playlistPanel.classList.contains('visible')) {
        updatePlaylistPanelState();
      }
    },

    seek(percentage) {
      if (this.audio.duration) {
        this.audio.currentTime = this.audio.duration * percentage;
        this.updateUI(percentage);
      }
    },

    setVolume(volume) {
      const newVolume = Math.max(0, Math.min(1, parseFloat(volume)));
      if (!isNaN(newVolume)) {
        this.volume = newVolume;
        this.audio.volume = newVolume;
        localStorage.setItem('podifyai_volume', newVolume.toString());
        if (this.volumeSliderEl) {
          this.volumeSliderEl.value = newVolume;
          updateVolumeSliderFill(this.volumeSliderEl); // 在音量变化时更新填充
        }
        if (this.volumeIconEl) {
          if (newVolume === 0) {
            this.volumeIconEl.innerHTML = this.muteIconSVG;
          } else {
            this.volumeIconEl.innerHTML = this.originalVolumeIconSVG;
          }
        }
      }
    }
  };
  
  // ==================== 工具函数 ====================
  
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
  const loadVoices = async () => {
    try {
      const response = await fetch('/voices'); // 不再传递type参数，后端返回所有音色
      if (response.status === 401) { // 处理未登录的情况
        window.location.href = '/login';
        return;
      }
      if (response.ok) {
        const voicesData = await response.json();
        
        // 新格式支持全站共享和个人音色分组
        if (voicesData.global_voices && voicesData.personal_voices) {
          voices = {
            global: voicesData.global_voices,
            personal: voicesData.personal_voices
          };
        } else {
          // 向后兼容旧格式
          voices = {
            global: [],
            personal: Array.isArray(voicesData) ? voicesData : []
          };
        }
        updateVoiceDropdown();
        updateAddVoiceButton(); // 音色加载完成后更新按钮状态
      } else {
        console.error('获取音色列表失败');
        voices = { global: [], personal: [] };
        updateVoiceDropdown();
        updateAddVoiceButton();
      }
    } catch (error) {
      console.error('获取音色列表出错:', error);
      voices = { global: [], personal: [] };
      updateVoiceDropdown();
      updateAddVoiceButton();
    }
  };
  
  // 音频播放管理：确保同时只有一个音频在播放
  let currentPlayingAudio = null;
  let currentPlayingIcon = null;

  // 停止当前播放的音频
  const stopCurrentAudio = () => {
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio.currentTime = 0;
      currentPlayingAudio = null;
    }
    if (currentPlayingIcon) {
      currentPlayingIcon.classList.remove('playing', 'loading');
      currentPlayingIcon.setAttribute('data-tooltip', '点击试听');
      currentPlayingIcon = null;
    }
  };

  // 更新音色下拉菜单
  const updateVoiceDropdown = () => {
    voiceList.innerHTML = '';
    const editIconSVG = `<svg t="1755601246160" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="35781" width="24" height="24"><path d="M553.386667 299.946667l170.666666 170.666666 45.226667-45.226666-170.666667-170.666667z" fill="currentColor" p-id="35782"></path><path d="M701.738667 194.56L315.733333 580.693333l-38.4 165.973334 166.101334-38.229334 385.962666-386.133333-127.701333-127.701333z m22.613333-67.84l172.928 173.013333a32 32 0 0 1 0 45.226667l-415.018667 415.232a32 32 0 0 1-15.445333 8.533333l-224.981333 51.797334a32 32 0 0 1-38.357334-38.4l52.053334-224.768a32 32 0 0 1 8.533333-15.402667l415.018667-415.232a32 32 0 0 1 45.269333 0z" fill="currentColor" p-id="35783"></path><path d="M553.386667 299.946667l170.666666 170.666666 45.226667-45.226666-170.666667-170.666667-45.226666 45.226667z m45.226666-45.226667l170.666667 170.666667-45.226667 45.226666-170.666666-170.666666 45.226666-45.226667zM149.333333 885.333333a32 32 0 1 1 0-64h725.333334a32 32 0 1 1 0 64h-725.333334z" fill="currentColor" p-id="35784"></path></svg>`;
    const deleteIconSVG = `<svg t="1755600740561" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="33782" width="24" height="24"><path d="M161.186909 205.591273h170.170182V126.277818C331.357091 74.519273 373.294545 32.581818 425.053091 32.581818h208.616727c51.758545 0 93.742545 41.937455 93.742546 93.696v79.313455h200.564363a30.254545 30.254545 0 1 1 0 60.509091h-30.021818v629.154909a93.742545 93.742545 0 0 1-93.742545 93.696H254.882909a93.742545 93.742545 0 0 1-93.696-93.696V266.100364h-41.146182a30.254545 30.254545 0 1 1 0-60.509091h41.146182z m676.305455 60.509091H221.649455v629.154909c0 18.338909 14.894545 33.186909 33.186909 33.186909h549.329454c18.385455 0 33.233455-14.894545 33.233455-33.186909V266.100364zM391.819636 204.148364h275.037091V126.277818A33.233455 33.233455 0 0 0 633.669818 93.090909H425.053091a33.233455 33.233455 0 0 0-33.186909 33.186909v77.870546z" fill="currentColor" p-id="33783"></path></svg>`;

    // 渲染音色列表函数
    const renderVoiceGroup = (voicesArray, groupTitle, isGlobal = false, userStatus = null) => {
      if (voicesArray.length === 0) return;

      // 添加分组标题
              const groupHeader = document.createElement('div');
        groupHeader.className = 'voice-group-header';
        
        const isAdmin = userStatus?.user?.is_admin;
        let headerContent = `<span class="voice-group-title">${groupTitle}</span>`;
        
        
        groupHeader.innerHTML = headerContent;
        voiceList.appendChild(groupHeader);
        

      // 创建网格容器
      const voiceGrid = document.createElement('div');
      voiceGrid.className = 'voice-grid';
      // 管理员网格：加标记类，后续用 CSS 单独布局
      if (userStatus?.user?.is_admin) {
        voiceGrid.classList.add('admin-grid');
      }

      // 麦克风SVG图标
      const microphoneSVG = `<svg t="1756003195918" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7409" width="24" height="24"><path d="M797.1 495.9h-3.8v-62.4c0-155-126.8-281.8-281.8-281.8S229.7 278.5 229.7 433.5v62.4h-3.8c-89.8 0-163.3 73.5-163.3 163.3 0 89.8 73.5 163.3 163.3 163.3h3.8c22.1 0 40-17.9 40-40v-349c0-64.3 25.2-124.9 71.1-170.8 45.8-45.8 106.5-71.1 170.8-71.1 64.3 0 124.9 25.2 170.8 71.1 45.8 45.8 71.1 106.5 71.1 170.8v349.1c0 22.1 17.9 40 40 40h3.8c89.8 0 163.3-73.5 163.3-163.3-0.2-89.9-73.6-163.4-163.5-163.4zM229.7 778.8c0 2.1-1.7 3.8-3.8 3.8-32.8 0-63.7-12.9-87.1-36.3-23.4-23.4-36.3-54.3-36.3-87.1s12.9-63.7 36.3-87.1c23.4-23.4 54.3-36.3 87.1-36.3h3.8v243z m654.5-32.5c-23.4 23.4-54.3 36.3-87.1 36.3-2.1 0-3.8-1.7-3.8-3.8V535.9h3.8c32.8 0 63.7 12.9 87.1 36.3 23.4 23.4 36.3 54.3 36.3 87.1s-12.9 63.6-36.3 87z" fill="#d4237a" p-id="7410"></path><path d="M375.4 776.5c-11 0-20-9-20-20V552.4c0-11 9-20 20-20s20 9 20 20v204.1c0 11-9 20-20 20zM647.6 776.5c-11 0-20-9-20-20V552.4c0-11 9-20 20-20s20 9 20 20v204.1c0 11-9 20-20 20zM511.5 718.6c-11 0-20-9-20-20v-88.3c0-11 9-20 20-20s20 9 20 20v88.3c0 11-9 20-20 20z" fill="#d4237a" p-id="7411"></path></svg>`;

      voicesArray.forEach(voice => {
        const voiceItem = document.createElement('div');
        voiceItem.className = 'voice-item';
        voiceItem.dataset.voiceId = voice.id;
        voiceItem.dataset.voiceName = voice.name;
        voiceItem.dataset.isGlobal = isGlobal;

        // 检查是否为当前选中的音色
        if (selectedVoiceIds.s1 === voice.id.toString() || selectedVoiceIds.s2 === voice.id.toString()) {
          voiceItem.classList.add('selected');
        }

        const isAdmin = userStatus?.user?.is_admin;
        
        // 管理员显示编辑删除按钮，普通用户显示麦克风图标
        let content = '';
        if (isAdmin) {
          // 为管理员音色卡片添加特殊样式类
          voiceItem.classList.add('admin-voice');
          content = `
            <div class="voice-info">
              <div class="voice-icon">${microphoneSVG}</div>
              <span class="voice-name">${voice.name}</span>
            </div>
            <div class="voice-item-actions">
              <button class="voice-edit-btn" data-tooltip="编辑音色">${editIconSVG}</button>
              <button class="voice-delete-btn" data-tooltip="删除音色">${deleteIconSVG}</button>
            </div>
          `;
        } else {
          content = `
            <div class="voice-info">
              <div class="voice-icon">${microphoneSVG}</div>
              <span class="voice-name">${voice.name}</span>
            </div>
          `;
        }

        voiceItem.innerHTML = content;

        // 试听：点击左侧图标播放统一文案的预览
        const icon = voiceItem.querySelector('.voice-icon');
        if (icon) {
          icon.setAttribute('title', '点击试听该音色');
          icon.style.cursor = 'pointer';
          icon.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            // 如果点击的是当前正在播放的图标，则停止播放
            if (currentPlayingIcon === icon) {
              stopCurrentAudio();
              return;
            }
            
            try {
              // 直接使用新的预览路由，播放上传的音频文件
              const url = `/api/voices/${voice.id}/preview`;
              
              // 停止当前播放的音频
              stopCurrentAudio();
              
              // 显示加载状态
              icon.classList.add('loading');
              icon.setAttribute('data-tooltip', '加载中...');
              
              // 创建新的音频对象并播放
              const audio = new Audio(url);
              audio.preload = 'auto';
              
              // 设置音频属性以提高兼容性
              audio.crossOrigin = 'anonymous';  // 允许跨域
              
              // 添加音频格式检查
              audio.addEventListener('loadstart', () => {
                console.log('开始加载音频:', url);
              });
              
              audio.addEventListener('canplay', () => {
                console.log('音频可以播放:', url);
              });
              
              audio.addEventListener('loadedmetadata', () => {
                console.log('音频元数据加载完成:', {
                  duration: audio.duration,
                  readyState: audio.readyState
                });
              });
              
              // 设置音频事件监听器
              audio.addEventListener('canplaythrough', () => {
                // 音频可以播放时，清除加载状态
                if (currentPlayingIcon === icon) {
                  icon.classList.remove('loading');
                  icon.setAttribute('data-tooltip', '点击试听');
                }
              });
              
              audio.addEventListener('ended', () => {
                // 音频播放结束后，清除播放状态
                if (currentPlayingIcon === icon) {
                  currentPlayingIcon.classList.remove('playing');
                  currentPlayingIcon = null;
                  currentPlayingAudio = null;
                }
              });
              
              audio.addEventListener('error', (e) => {
                // 音频播放出错时，清除播放状态和加载状态
                if (currentPlayingIcon === icon) {
                  currentPlayingIcon.classList.remove('playing', 'loading');
                  currentPlayingIcon.setAttribute('data-tooltip', '点击试听');
                  currentPlayingIcon = null;
                  currentPlayingAudio = null;
                }
                
                // 提供更详细的错误信息和重试机制
                let errorMsg = '无法播放预览音频';
                let shouldRetry = false;
                
                if (e.target.error) {
                  const errorCode = e.target.error.code;
                  const errorMessage = e.target.error.message;
                  
                  if (errorCode === 4) {
                    errorMsg = '音频格式不支持，正在尝试其他方式...';
                    shouldRetry = true;
                  } else if (errorMessage && errorMessage.includes('DEMUXER_ERROR')) {
                    errorMsg = '音频解码失败，正在尝试重新加载...';
                    shouldRetry = true;
                  } else if (errorCode === 2) {
                    errorMsg = '网络错误，正在重试...';
                    shouldRetry = true;
                  } else {
                    errorMsg = `音频播放失败: ${errorMessage || '未知错误'}`;
                  }
                } else {
                  errorMsg = '无法播放预览音频，请检查音频文件格式';
                }
                
                console.error('音频播放错误:', e.target.error);
                
                // 如果应该重试，尝试重新加载
                if (shouldRetry && currentPlayingIcon === icon) {
                  // 在重试前先移除loading状态
                  currentPlayingIcon.classList.remove('loading');
                  currentPlayingIcon.setAttribute('data-tooltip', '点击试听');
                  
                  setTimeout(() => {
                    if (currentPlayingIcon === icon) {
                      console.log('尝试重新加载音频...');
                      // 重新添加loading状态
                      currentPlayingIcon.classList.add('loading');
                      currentPlayingIcon.setAttribute('data-tooltip', '加载中...');
                      
                      audio.load(); // 重新加载音频
                      audio.play().catch(err => {
                        console.error('重试播放失败:', err);
                        // 重试失败时移除loading状态
                        if (currentPlayingIcon === icon) {
                          currentPlayingIcon.classList.remove('loading');
                          currentPlayingIcon.setAttribute('data-tooltip', '点击试听');
                        }
                        showMessage('音频播放失败，请尝试其他音频文件', 'error');
                      });
                    }
                  }, 1000);
                } else {
                  showMessage(errorMsg, 'error');
                }
              });
              
              // 添加120ms软淡入兜底（即使后端偶发出"硬起"）
              audio.volume = 0;
              audio.addEventListener('playing', () => {
                let v = 0;
                const step = () => {
                  if (audio.paused) return;
                  v = Math.min(1, v + 0.1);
                  audio.volume = v;
                  if (v < 1) requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
              });
              
              // 开始播放
              await audio.play();
              
              // 更新播放状态
              currentPlayingAudio = audio;
              currentPlayingIcon = icon;
              icon.classList.add('playing');
              
            } catch (err) {
              if (err.name === 'NotAllowedError') {
                showMessage('浏览器阻止了自动播放，请再次点击图标开始试听', 'warning');
              } else {
                showMessage('无法播放预览音频', 'error');
              }
            }
          });
        }

        // 添加点击选择事件
        voiceItem.addEventListener('click', (e) => {
          // 防止点击编辑删除按钮或试听图标时触发音色选择
          if (e.target.closest('.voice-item-actions') || e.target.closest('.voice-icon')) return;
          
          const voiceName = voice.name;
          
          // 双音色选择逻辑
          const voiceId = voiceItem.dataset.voiceId;
          if (currentMode === 'single') {
            // 单人模式：直接选择S1
            selectedVoices.s1 = voiceName;
            selectedVoiceIds.s1 = voiceId;
            selectedVoices.s2 = null;
            selectedVoiceIds.s2 = null;
          } else {
            // 对话模式：智能选择S1或S2
            if (selectedVoiceIds.s1 === voiceId) {
              // 如果点击的是S1，取消选择
              selectedVoices.s1 = null;
              selectedVoiceIds.s1 = null;
            } else if (selectedVoiceIds.s2 === voiceId) {
              // 如果点击的是S2，取消选择
              selectedVoices.s2 = null;
              selectedVoiceIds.s2 = null;
            } else if (!selectedVoiceIds.s1) {
              // 如果S1为空，选择S1
              selectedVoices.s1 = voiceName;
              selectedVoiceIds.s1 = voiceId;
            } else if (!selectedVoiceIds.s2) {
              // 如果S2为空，选择S2
              selectedVoices.s2 = voiceName;
              selectedVoiceIds.s2 = voiceId;
            } else {
              // 如果S1和S2都已选择，替换S1
              selectedVoices.s1 = voiceName;
              selectedVoiceIds.s1 = voiceId;
            }
          }
          
          // 更新UI显示
          updateVoiceSelectionDisplay();

          // 就地切换选中态，避免整表重绘
          voiceList.querySelectorAll('.voice-item').forEach(el => {
            el.classList.toggle('selected', el.dataset.voiceId === String(voice.id));
          });

          updatePodcastButtonState();
          
          // 更新音色选择按钮文本
          if (currentMode === 'single') {
            voiceSelectText.textContent = selectedVoices.s1 || '音色选择';
          } else {
            const count = (selectedVoices.s1 ? 1 : 0) + (selectedVoices.s2 ? 1 : 0);
            voiceSelectText.textContent = count > 0 ? `已选择${count}个音色` : '音色选择';
          }
          
          voiceSelectBtn.classList.toggle('is-selected', selectedVoices.s1 !== null);
        });

        // 添加编辑和删除按钮的事件处理器（仅管理员）
        if (isAdmin) {
          const editBtn = voiceItem.querySelector('.voice-edit-btn');
          const deleteBtn = voiceItem.querySelector('.voice-delete-btn');
          
          if (editBtn) {
            editBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              editVoice(voice);
            });
          }
          
          if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              deleteVoice(voice.id, voice.name);
            });
          }
        }

        voiceGrid.appendChild(voiceItem);
      });

      voiceList.appendChild(voiceGrid);
    };

    // 渲染"添加新音色"卡片
    const renderAddVoiceCard = (userStatus) => {
      const addVoiceGrid = document.createElement('div');
      addVoiceGrid.className = 'voice-grid';

      const addVoiceCard = document.createElement('div');
      const isAdmin = userStatus?.user?.is_admin;
      const hasPremium = userStatus?.user?.has_premium;
      const enablePaidVoices = userStatus?.enable_paid_voices;
      
      // 判断是否应该锁定添加功能
      const isLocked = !isAdmin && !hasPremium && enablePaidVoices;
      
      addVoiceCard.className = isLocked ? 'add-voice-card locked' : 'add-voice-card';
      
      // 锁定图标SVG
      const lockIconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="m7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
      
      const iconToShow = isLocked ? lockIconSVG : '+';
      const textToShow = isLocked ? '升级解锁' : '添加新音色';
      
      addVoiceCard.innerHTML = `
        <div class="add-voice-icon">${iconToShow}</div>
        <div class="add-voice-text">${textToShow}</div>
      `;

      addVoiceCard.addEventListener('click', async () => {
        if (isLocked) {
          showUpgradeModal();
        } else {
          // 关闭音色下拉菜单并打开添加音色模态
          voiceDropdown.classList.add('hidden');
          const modal = document.getElementById('add-voice-modal');
          if (modal) {
            editingVoice = null;
            modal.querySelector('h3').textContent = '添加新音色';
            modal.classList.remove('hidden');
          }
        }
      });

      addVoiceGrid.appendChild(addVoiceCard);
      voiceList.appendChild(addVoiceGrid);
    };

      // 页面卸载时停止所有音频播放
  window.addEventListener('beforeunload', () => {
    stopCurrentAudio();
  });

  // 页面隐藏时暂停音频播放（避免后台播放）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && currentPlayingAudio) {
      currentPlayingAudio.pause();
    }
  });

  // 检查用户状态以决定显示逻辑
  checkUserStatus().then(userStatus => {
      // 所有用户都显示"音色库"标题
      if (voices.global && voices.global.length > 0) {
        renderVoiceGroup(voices.global, '音色库', true, userStatus);
      }

      // 只有普通用户（非管理员且非付费）才在音色选择区域显示"添加新音色"卡片
      const isAdmin = userStatus?.user?.is_admin;
      // 注意：面板宽度规则已移至CSS基础选择器，所有用户统一使用
      const hasPremium = userStatus?.user?.has_premium;
      const enablePaidVoices = userStatus?.enable_paid_voices;
      const isRegularUser = !isAdmin && !hasPremium && enablePaidVoices;
      
      if (isRegularUser) {
        // 普通用户显示锁定状态的添加卡片（但实际上我们会移除这个）
        // renderAddVoiceCard(userStatus);
      }
    }).catch(error => {
      console.error('获取用户状态失败:', error);
      // 默认显示所有音色
      if (voices.global && voices.global.length > 0) {
        renderVoiceGroup(voices.global, '音色库', true, null);
      }
    });

    // 检查是否需要显示付费提示
    const totalVoices = (voices.global?.length || 0) + (voices.personal?.length || 0);
    if (totalVoices === 0) {
      selectedVoices = { s1: null, s2: null };
      voiceSelectText.textContent = '无可用音色';
      updateVoiceSelectionDisplay();
    }

    updatePodcastButtonState();
  };

  // 使用事件委托处理音色列表中的所有按钮点击
  voiceList.addEventListener('click', (e) => {
    const target = e.target;
    const editBtn = target.closest('.voice-edit-btn');
    const deleteBtn = target.closest('.voice-delete-btn');
    const voiceItem = target.closest('.voice-item');

    if (!voiceItem) return;

    const voiceId = voiceItem.dataset.voiceId;
    const voiceName = voiceItem.dataset.voiceName;

    if (editBtn) {
      e.stopPropagation();
      // ... 编辑逻辑待实现 ...
      alert(`编辑功能待实现，您点击了音色: ${voiceName}`);
      return;
    }

    if (deleteBtn) {
      e.stopPropagation();
      deleteVoice(voiceId, voiceName); // 使用新的 deleteVoice 函数
      return;
    }

    // 卡片点击的分配逻辑
    if (voiceName) {
      if (currentMode === 'single') {
        // 单人模式：直接指派到 S1 并收起面板
        selectedVoices.s1 = voiceName;
        selectedVoiceIds.s1 = voiceId;
        selectedVoices.s2 = null;
        selectedVoiceIds.s2 = null;
        updateVoiceSelectionDisplay();
        updatePodcastButtonState();
        voiceDropdown?.classList.add('hidden'); // 选完即收起
      } else {
        // 对话模式：指派给"当前激活槽位"（默认 S1）
        const s2Slot = document.getElementById('voice-s2-slot');
        const active = s2Slot?.classList.contains('selected') ? 's2' : 's1';
        selectedVoices[active] = voiceName;
        selectedVoiceIds[active] = voiceId;
        updateVoiceSelectionDisplay();
        updatePodcastButtonState();
      }
    }
  });

  // ==================== 模式切换 ====================
  
  // 清空界面内容的函数
  const clearInterfaceContent = () => {
    // 清空主 textarea 的内容
    mainTextarea.value = '';
    adjustTextareaHeight(mainTextarea);
    // 清空音频播放器内容（查找并移除所有音频容器）
    const page = document.querySelector('.page');
    const audioContainers = page.querySelectorAll('div[style*="background: #f8f8f8"]');
    audioContainers.forEach(container => {
      if (container.querySelector('h3') && container.querySelector('h3').textContent === '生成的播客音频') {
        container.remove();
      }
    });
  };
  
  rolesMode?.addEventListener('click', () => {
    // 智能确认：存在未保存内容则提示
    if (mainTextarea && mainTextarea.value.trim().length > 0) {
      const ok = confirm('切换模式将会清空当前输入的内容，您确定要继续吗？');
      if (!ok) return;
    }
    currentMode = 'role';
    rolesMode.classList.add('active');
    singleMode.classList.remove('active');
    // 保存模式选择到本地存储
    storage.set('podifyai_mode', currentMode);
    // 清空界面内容
    clearInterfaceContent();
    // 重置音色选择状态
    selectedVoices = { s1: null, s2: null };
    selectedVoiceIds = { s1: null, s2: null };
    voiceSelectText.textContent = '音色选择';
    // 调用 updatePodcastButtonState() 以正确禁用播客按钮
    updatePodcastButtonState();
    updateVoiceSelectionDisplay();
    // 切换模式时重新加载对应类型的音色
    loadVoices();
    modelSelectBtn.classList.remove('is-selected');
    voiceSelectBtn.classList.remove('is-selected');
    // 更新风格按钮文案和渲染
    updateStyleButtonText();
    renderStylePopover();
  });
  
  singleMode?.addEventListener('click', () => {
    // 智能确认：存在未保存内容则提示
    if (mainTextarea && mainTextarea.value.trim().length > 0) {
      const ok = confirm('切换模式将会清空当前输入的内容，您确定要继续吗？');
      if (!ok) return;
    }
    currentMode = 'single';
    singleMode.classList.add('active');
    rolesMode.classList.remove('active');
    // 保存模式选择到本地存储
    storage.set('podifyai_mode', currentMode);
    // 清空界面内容
    clearInterfaceContent();
    // 重置音色选择状态
    selectedVoices = { s1: null, s2: null };
    selectedVoiceIds = { s1: null, s2: null };
    voiceSelectText.textContent = '音色选择';
    // 调用 updatePodcastButtonState() 以正确禁用播客按钮
    updatePodcastButtonState();
    updateVoiceSelectionDisplay();
    // 切换模式时重新加载对应类型的音色
    loadVoices();
    modelSelectBtn.classList.remove('is-selected');
    voiceSelectBtn.classList.remove('is-selected');
    // 更新风格按钮文案和渲染
    updateStyleButtonText();
    renderStylePopover();
  });
  
  // ==================== 槽位激活切换功能 ====================
  
  // 槽位激活切换（对话模式）
  const s1Slot = document.getElementById('voice-s1-slot');
  const s2Slot = document.getElementById('voice-s2-slot');

  s1Slot?.addEventListener('click', () => {
    s1Slot.classList.add('selected');
    s2Slot?.classList.remove('selected');
  });
  
  s2Slot?.addEventListener('click', () => {
    s2Slot.classList.add('selected');
    s1Slot?.classList.remove('selected');
  });
  
  // ==================== 弹窗控制 ====================
  
  // 模型选择弹窗
  modelSelectBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!modelPopover.classList.contains('hidden')) {
      closeActivePopover();
    } else {
      renderStylePopover();
      openPopover(modelSelectBtn, modelPopover, { initialFocusSelector: '.popover-item' });
    }
  });
  

  
  // 音色选择下拉
  voiceSelectBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!voiceDropdown.classList.contains('hidden')) {
      closeActivePopover();
    } else {
      openPopover(voiceSelectBtn, voiceDropdown, { initialFocusSelector: '.voice-list .voice-item, #add-voice-btn' });
    }
  });
  
  // 交换S1和S2按钮事件处理
  document.getElementById('voice-swap-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentMode === 'role' && selectedVoiceIds.s1 && selectedVoiceIds.s2) {
      // 交换S1和S2
      const tempVoice = selectedVoices.s1;
      const tempId = selectedVoiceIds.s1;
      selectedVoices.s1 = selectedVoices.s2;
      selectedVoiceIds.s1 = selectedVoiceIds.s2;
      selectedVoices.s2 = tempVoice;
      selectedVoiceIds.s2 = tempId;
      
      // 更新UI显示
      updateVoiceSelectionDisplay();

      // 就地切换选中态，避免整表重绘
      voiceList.querySelectorAll('.voice-item').forEach(el => {
        const voiceId = el.dataset.voiceId;
        el.classList.toggle('selected', selectedVoiceIds.s1 === voiceId || selectedVoiceIds.s2 === voiceId);
      });

      updatePodcastButtonState();
      
      showMessage('已交换S1和S2音色', 'success');
    }
  });
  
  // 注释：已改用mousedown捕获关闭，避免闪烁
  // document.addEventListener('click', () => {
  //   closeAllPopovers();
  // });
  
  // 阻止弹窗内部点击事件冒泡
  [modelPopover, voiceDropdown].forEach(popover => {
    popover?.addEventListener('mousedown', e => e.stopPropagation(), true); // 新增：捕获阶段
    popover?.addEventListener('click', e => e.stopPropagation());           // 保留：冒泡阶段
  });
  
  // ==================== 弹窗选项点击事件 ====================
  
  // 风格选择
  modelPopover?.addEventListener('click', (e) => {
    const item = e.target.closest('.popover-item');
    if (!item) return;

    const styleKey = item.dataset.styleKey;
    if (styleKey) {
      selectedStyle[currentMode] = styleKey;
      localStorage.setItem('podify_style', JSON.stringify(selectedStyle));
      updateStyleButtonText();
      modelSelectBtn.classList.add('is-selected');
      closeActivePopover();
    }
  });

  // 长度开关
  modelPopover?.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'length-toggle') {
      lengthDetailed = !!e.target.checked;
      localStorage.setItem('podify_length_detailed', String(lengthDetailed));
      updateStyleButtonText();
    }
  });
  

  
  // ==================== 模态框控制 ====================
  
  // 链接模态框
  linkBtn?.addEventListener('click', async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      console.error('读取剪贴板失败: ', err);
    }
    if (isURL(text)) {
      currentContent = text;
      showMessage('链接已成功读取并添加');
      return;
    }
    // 兜底：手动输入链接
    const manual = window.prompt('未能从剪贴板获取有效链接，请手动输入链接：');
    if (manual && isURL(manual.trim())) {
      currentContent = manual.trim();
      showMessage('链接已添加');
    } else if (manual !== null) {
      showMessage('请输入有效的URL格式', 'error');
    }
  });
  
  closeLinkModal?.addEventListener('click', () => {
    linkModal.classList.add('hidden');
    linkInput.value = '';
  });
  
  // 错误类型到提示文案的映射
  const errorHints = {
    ANTIBOT: "该网页启用了反爬或人机验证。建议：稍后重试、改用 AMP/移动端链接、或粘贴文章原文。",
    LOGIN_OR_PAYWALL: "该内容需要登录或付费订阅。建议：登录后复制正文再生成。",
    CONTENT_TOO_SHORT: "正文提取不完整。建议：改用原文复制、或尝试同主题的其他来源链接。",
    UNSUPPORTED_MIME: "链接非标准网页（如文件/媒体）。建议：上传文件或复制文本。",
    NETWORK_ERROR: "网络异常或目标站点无响应。建议：稍后重试或更换网络。",
  };

  confirmLinkBtn?.addEventListener('click', async () => {
    const url = (linkInput.value || '').trim();
    if (!isURL(url)) { 
      showMessage('请输入有效链接', 'error'); 
      return; 
    }

    setBtnLoading(confirmLinkBtn, '解析中…');
    try {
      const res = await fetch('/api/extract_from_url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      const data = await res.json();
      if (!data.ok) {
        const errType = data.error_type || 'UNKNOWN';
        const hint = errorHints[errType] || '解析失败，请检查链接或稍后再试';
        throw new Error(`${data.error || '解析失败'}：${hint}`);
      }

      // 把正文直接灌入文本框
      mainTextarea.value = data.text;
      adjustTextareaHeight(mainTextarea);
      updatePodcastButtonState();
      linkModal.classList.add('hidden');

      const site = new URL(data.resolved_url).hostname.replace(/^www\./, '');
      showMessage(`解析成功 · ${site} · ${data.word_count}字 ${data.strategy==='mirror'?'（镜像提取）':''}`, 'success');
    } catch (e) {
      showMessage(e.message || '解析失败，请稍后再试', 'error');
    } finally {
      resetBtn(confirmLinkBtn);
    }
  });
  
  // 添加音色模态框
  // 更新添加新音色按钮的显示状态
  const updateAddVoiceButton = async () => {
    const status = await checkUserStatus();
    const isAdmin = status?.user?.is_admin;
    const hasPremium = status?.user?.has_premium;
    const enablePaidVoices = status?.enable_paid_voices;
    const isLocked = !isAdmin && !hasPremium && enablePaidVoices;
    
    if (addVoiceBtn) {
      if (isLocked) {
        // 普通用户：显示锁定图标
        const lockIconSVG = `<svg t="1756005138579" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="9472" width="16" height="16"><path d="M847 959H177a50 50 0 0 1-50-50V456.2a50 50 0 0 1 50-50h83.99V315c0-138.071 111.929-250 250-250s250 111.929 250 250v91.2H847a50 50 0 0 1 50 50V909a50 50 0 0 1-50 50zM700.99 315c0-104.934-85.066-190-190-190s-190 85.066-190 190v91.2h380V315zM837 486a20 20 0 0 0-20-20H207a20 20 0 0 0-20 20v393a20 20 0 0 0 20 20h610a20 20 0 0 0 20-20V486zM512 767a30 30 0 0 1-30-30V628a30 30 0 0 1 60 0v109a30 30 0 0 1-30 30z" fill="#2c2c2c" p-id="9473"></path></svg>`;
        addVoiceBtn.innerHTML = `${lockIconSVG} 添加新音色`;
        addVoiceBtn.style.opacity = '0.6';
        addVoiceBtn.style.cursor = 'not-allowed';
      } else {
        // 管理员和付费用户：正常显示
        addVoiceBtn.innerHTML = '添加新音色';
        addVoiceBtn.style.opacity = '1';
        addVoiceBtn.style.cursor = 'pointer';
      }
    }
  };

  addVoiceBtn?.addEventListener('click', async () => {
    // 检查用户权限
    const status = await checkUserStatus();
    
    // 管理员不需要付费权限检查
    if (!status?.user?.is_admin && !status?.user?.has_premium && status?.enable_paid_voices) {
      // 显示付费升级提示
      showUpgradeModal();
      return;
    }
    
    editingVoice = null;
    const modal = document.getElementById('add-voice-modal');
    modal.querySelector('h3').textContent = '添加新音色';
    addVoiceNameInput.value = '';
    addReferenceTextInput.value = '';
    document.getElementById('add-voice-description-input').value = '';
    addReferenceAudioInput.value = '';
    fileNameDisplay.textContent = '';
    fileNameDisplay.classList.remove('show');
    
    // 关键改动：确保音频上传区在"添加"模式下始终可见
    const audioUploadArea = modal.querySelector('.audio-upload-area');
    const audioUploadLabel = modal.querySelector('label[for="add-reference-audio-input"]');
    if (audioUploadArea) audioUploadArea.style.display = 'block';
    if (audioUploadLabel) audioUploadLabel.style.display = 'block';

    // 确保在"添加"模式下，上传提示可见，文件名提示不可见
    const uploadHint = modal.querySelector('.audio-upload-hint');
    if (uploadHint) uploadHint.style.display = 'block';
    fileNameDisplay.classList.remove('show');

    saveVoiceBtn.textContent = '保存音色';
    updateModeHint();
    modal.classList.remove('hidden');
  });
  
  closeAddVoiceModal?.addEventListener('click', () => {
    addVoiceModal.classList.add('hidden');
    // 清空表单和编辑状态
    addVoiceNameInput.value = '';
    addReferenceTextInput.value = '';
    addReferenceAudioInput.value = '';
    fileNameDisplay.classList.remove('show');
    fileNameDisplay.textContent = '';
    editingVoice = null;
    
    // 确保关闭时重置上传提示的可见性
    const uploadHint = addVoiceModal.querySelector('.audio-upload-hint');
    if (uploadHint) uploadHint.style.display = 'block';

    saveVoiceBtn.textContent = '保存音色';
  });
  

  
  // 点击模态框外部关闭
  [linkModal, addVoiceModal].forEach(modal => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        // 如果是音色模态框，重置编辑状态
        if (modal === addVoiceModal) {
          editingVoice = null;
          saveVoiceBtn.textContent = '保存音色';
          // 清空表单
          addVoiceNameInput.value = '';
          addReferenceTextInput.value = '';
          addReferenceAudioInput.value = '';
          fileNameDisplay.classList.remove('show');
          fileNameDisplay.textContent = '';
        }
      }
    });
  });
  
  // ==================== 文件上传反馈 ====================
  
  addReferenceAudioInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    const uploadHint = document.querySelector('.audio-upload-hint');
    if (file) {
      fileNameDisplay.textContent = `已选择：${file.name}`;
      fileNameDisplay.classList.add('show');
      if (uploadHint) uploadHint.style.display = 'none'; // 选择文件后隐藏提示
    } else {
      fileNameDisplay.classList.remove('show');
      fileNameDisplay.textContent = '';
      if (uploadHint) uploadHint.style.display = 'block'; // 未选择文件则显示提示
    }
  });
  
  // ==================== PDF上传简化流程 ====================
  
  uploadBtn?.addEventListener('click', () => {
    pdfUploadInput.click();
  });
  
  pdfUploadInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        showMessage('请选择PDF文件', 'error');
        return;
      }
      
      const fileSize = (file.size / 1024 / 1024).toFixed(2);
      currentContent = file;
      mainTextarea.value = ''; // 不要塞提示文字到 value
      mainTextarea.placeholder = `已添加PDF文件：${file.name}（${fileSize} MB）`;
      showMessage(`PDF文件已添加: ${file.name}`);
    }
  });
  
  // ==================== 设置保存 ====================
  
  // 设置保存功能已移除，保留注释以便后续开发
  
  // ==================== 音色管理 ====================
  
  // 编辑音色
  const editVoice = (voice) => {
    if (!voice) return;

    editingVoice = voice;
    const modal = document.getElementById('add-voice-modal');
    modal.querySelector('h3').textContent = '编辑音色';
    addVoiceNameInput.value = voice.name;
    addReferenceTextInput.value = voice.text || '';
    document.getElementById('add-voice-description-input').value = voice.description || '';
    
    // 关键改动：确保音频上传区可见
    const audioUploadArea = modal.querySelector('.audio-upload-area');
    const audioUploadLabel = modal.querySelector('label[for="add-reference-audio-input"]');
    if (audioUploadArea) audioUploadArea.style.display = 'block';
    if (audioUploadLabel) audioUploadLabel.style.display = 'block';

    // 清空旧的文件选择并更新提示
    addReferenceAudioInput.value = '';
    fileNameDisplay.textContent = '如需更换，请上传新音频文件';
    fileNameDisplay.classList.add('show');
    
    saveVoiceBtn.textContent = '更新音色';
    modal.classList.remove('hidden');
  };
  
  // 删除音色
  const deleteVoice = async (voiceId, voiceName) => {
    if (!confirm(`您确定要删除音色 "${voiceName}" 吗？`)) {
      return;
    }
    
    try {
      const response = await fetch(`/voices/${voiceId}`, { // 使用新的API
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `删除音色失败（${response.status}）`);
      }
      
      showMessage('音色删除成功！');
      await loadVoices();
      
      if (selectedVoices.s1 === voiceName) {
        selectedVoices.s1 = null;
        selectedVoiceIds.s1 = null;
      }
      if (selectedVoices.s2 === voiceName) {
        selectedVoices.s2 = null;
        selectedVoiceIds.s2 = null;
      }
      if (selectedVoices.s1 === voiceName || selectedVoices.s2 === voiceName) {
        voiceSelectText.textContent = '音色选择';
        updatePodcastButtonState();
        updateVoiceSelectionDisplay();
      }
      
    } catch (error) {
      showMessage(error.message || '删除音色时发生错误', 'error');
      console.error(error);
    }
  };
  
  saveVoiceBtn?.addEventListener('click', async () => {
    try {
      const voiceName = addVoiceNameInput.value.trim();
      const referenceText = addReferenceTextInput.value.trim();
      const description = document.getElementById('add-voice-description-input')?.value.trim() || '';
      const audioFile = addReferenceAudioInput.files[0];

      if (!voiceName || !referenceText) {
        throw new Error('音色名称和参考文本不能为空');
      }

      const formData = new FormData();
      // 注意键名与后端 add_user_voice 函数中的 request.form.get() 保持一致
      formData.append('voiceName', voiceName);
      formData.append('referenceText', referenceText);
      formData.append('voiceDescription', description);
      formData.append('voiceType', 'single'); // 固定为single类型

      let url = '/voices'; // 统一使用 /voices 接口
      let method = 'POST';

      // 编辑模式的逻辑
      if (editingVoice) {
        // 编辑模式：使用PUT方法更新音色
        url = `/voices/${editingVoice.id}`;
        method = 'PUT';
        
        // 编辑模式下，音频文件是可选的
        if (audioFile) {
          formData.append('newReferenceAudio', audioFile);
        }
        
        // 设置编辑模式的表单数据
        formData.set('newName', voiceName);
        formData.set('newText', referenceText);
        formData.set('newDescription', description);
        
        // 移除不需要的字段
        formData.delete('voiceName');
        formData.delete('referenceText');
        formData.delete('voiceDescription');
        formData.delete('voiceType');
      } else {
        // 新增模式：需要音频文件
        if (!audioFile) {
          throw new Error('请选择参考音频文件');
        }
        formData.append('referenceAudio', audioFile);
      }
      
      setBtnLoading(saveVoiceBtn, '保存中...');

      const response = await fetch(url, {
        method: method,
        body: formData
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `操作失败 (${response.status})`);
      }
      
      const successMessage = editingVoice ? '音色更新成功！' : '音色保存成功！';
      showMessage(successMessage);
      addVoiceModal.classList.add('hidden');
      await loadVoices(); // 刷新列表
      
      // 重置编辑状态
      editingVoice = null;
      saveVoiceBtn.textContent = '保存音色';
      
    } catch (error) {
      showMessage(error.message || '操作失败', 'error');
      console.error(error);
    } finally {
      resetBtn(saveVoiceBtn);
    }
  });
  
  // Also handle the new secondary close button
  const closeAddVoiceModalSecondary = document.getElementById('close-add-voice-modal-secondary');
  closeAddVoiceModalSecondary?.addEventListener('click', () => {
      addVoiceModal.classList.add('hidden');
      // 重置编辑状态
      editingVoice = null;
      saveVoiceBtn.textContent = '保存音色';
      // 清空表单
      addVoiceNameInput.value = '';
      addReferenceTextInput.value = '';
      addReferenceAudioInput.value = '';
      fileNameDisplay.classList.remove('show');
      fileNameDisplay.textContent = '';
  });
  
  // ==================== 创作按钮逻辑 ====================
  
  createScriptBtn?.addEventListener('click', async () => {
    try {
      setBtnLoading(createScriptBtn, '生成脚本中...');
      
      // 生成脚本
      await generateScript();
      
      // 脚本生成成功后，更新播客按钮状态
      updatePodcastButtonState();
      
    } catch (error) {
      showMessage(error.message || '脚本生成过程中发生错误', 'error');
      console.error(error);
    } finally {
      resetBtn(createScriptBtn);
    }
  });
  
  // ==================== 播客按钮逻辑（恢复） ====================
  
  // 统一编排：生成并创建卡片
  async function composeAndCreatePodcast({ scriptText, voiceName, title, originalInput, inputType }) {
    // 前端兜底：单人提交前确保 [S1]
    let processedScript = scriptText;
    if (currentMode === 'single' && !/^\s*\[S1\]/.test(processedScript)) {
      processedScript = `[S1]${processedScript}`;
    }
    
    const payload = { 
      script: processedScript, 
      voiceName, 
      mode: currentMode,
      // 新增：传递原始输入信息
      originalInput: originalInput || scriptText,  // 如果没有原始输入，使用脚本内容
      inputType: inputType || 'manual'
    };
    
    // 兼容性字段：按模式补充兼容字段
    if (currentMode === 'single') {
      payload.voiceName = voiceName;              // 兼容后端老字段
    } else {
      // 对话模式两套字段都带上，防以后后端切换校验口径
      payload.s1_voice_name = selectedVoices.s1;
      payload.s2_voice_name = selectedVoices.s2;
    }
    
    // 新增：支持双音色选择
    if (currentMode === 'role' && selectedVoices.s1 && selectedVoices.s2) {
      payload.s1_voice_name = selectedVoices.s1;
      payload.s2_voice_name = selectedVoices.s2;
    }
    
    // 新增：传递来源信息
    if (inputType === 'url' && originalInput && isURL(originalInput)) {
      payload.sourceUrl = originalInput;  // 如果是URL类型，设置sourceUrl
      payload.sourceTitle = title || '外部链接';  // 设置来源标题
    } else if (inputType === 'pdf' && window.pdfFilename) {
      // 如果是PDF类型，设置PDF文件路径
      payload.sourceUrl = `/pdf_storage/${window.pdfFilename}`;  // PDF文件访问路径
      payload.sourceTitle = title || 'PDF文档';  // 设置来源标题
      console.log('📄 传递PDF文件信息:', { sourceUrl: payload.sourceUrl, sourceTitle: payload.sourceTitle });
    }
    
    if (title && title.trim()) {
      payload.title = title.trim();
    } else {
      payload.title = '未命名标题';  // 确保总是传递一个有效的标题
    }
    const historyData = await apiPost('/synthesize-audio', payload);
    
    // 用统一的接口拉取最新历史，避免字段/排序不一致导致的"看不见"
    await loadHistory();
    showMessage('音频合成成功！已添加到作品集。', 'success');
    
    // 合成成功后刷新积分显示
    await refreshCreditsDisplay();
    
    // 自动播放（如果开启）
    const autoPlayEnabled = localStorage.getItem('auto-play-enabled') === 'true';
    if (autoPlayEnabled) {
      // /history 默认按时间倒序返回，最新的一条就是索引 0
      playerManager.playTrackAtIndex(0);
    }
    
    return historyData;
  }

  // "粘贴文本→直接合成"点击
  synthesizePodcastBtn?.addEventListener('click', async () => {
    try {
      const { s1Id, s2Id } = getSelectedVoicesForSynthesis();
      let script = normalizeDialogueTags(getCurrentScriptText());
      
      // S1：单人文本强制加标签
      if (currentMode === 'single') {
        const trimmedScript = script.trim();
        if (!trimmedScript.startsWith('[S1]')) {
          script = `[S1]` + (trimmedScript.startsWith('\n') ? '' : ' ') + trimmedScript;
        }
      }
      
      const currentTitle = getCurrentDraftTitle?.();
      
      // 检查音色选择
      const hasValidVoices = currentMode === 'single'
        ? !!s1Id
        : !!(s1Id && s2Id);
        
      if (!script || !hasValidVoices) {
        const errorMsg = currentMode === 'single' 
          ? '错误：脚本内容和音色都必须选择。'
          : '错误：脚本内容和两个音色都必须选择。';
        showMessage(errorMsg, 'error');
        return;
      }
      
      setBtnLoading(synthesizePodcastBtn, '合成中…');
      
      // 获取原始输入内容（如果存在）
      const originalInput = window.originalInputContent || script;
      const inputType = window.originalInputType || 'manual';
      
      // 前端兜底：单人提交前确保 [S1]
      let processedScript = script;
      if (currentMode === 'single' && !/^\s*\[S1\]/.test(processedScript)) {
        processedScript = `[S1]${processedScript}`;
      }
      
      const body = {
        mode: currentMode,                // 'single' | 'role'
        script: processedScript,
        // 新的音色ID字段
        voice_id: s1Id,
        s1_voice_id: s1Id,
        s2_voice_id: s2Id,
        voices: { s1: selectedVoices.s1, s2: selectedVoices.s2 },  // 兼容格式
        title: currentTitle || '未命名标题',  // 确保总是传递一个有效的标题
        originalInput,
        inputType
      };
      
      // 兼容性字段：按模式补充兼容字段
      if (currentMode === 'single') {
        body.voiceName = selectedVoices.s1;                 // 兼容后端老字段
        body.s1 = selectedVoices.s1;                        // 直接传递s1
      } else {
        // 对话模式两套字段都带上，防以后后端切换校验口径
        body.s1_voice_name = selectedVoices.s1;
        body.s2_voice_name = selectedVoices.s2;
        body.s1 = selectedVoices.s1;
        body.s2 = selectedVoices.s2;
      }
      
      // 新增：传递来源信息
      if (inputType === 'url' && originalInput && isURL(originalInput)) {
        body.sourceUrl = originalInput;  // 如果是URL类型，设置sourceUrl
        body.sourceTitle = currentTitle || '外部链接';  // 设置来源标题
      } else if (inputType === 'pdf' && window.pdfFilename) {
        // 如果是PDF类型，设置PDF文件路径
        body.sourceUrl = `/pdf_storage/${window.pdfFilename}`;  // PDF文件访问路径
        body.sourceTitle = currentTitle || 'PDF文档';  // 设置来源标题
        console.log('📄 传递PDF文件信息:', { sourceUrl: body.sourceUrl, sourceTitle: body.sourceTitle });
      }
      
      const res = await apiPost('/synthesize-audio', body);
      
      // 用统一的接口拉取最新历史，避免字段/排序不一致导致的"看不见"
      await loadHistory();
      showMessage('合成完成');
      
      // 自动播放（如果开启）
      const autoPlayEnabled = localStorage.getItem('auto-play-enabled') === 'true';
      if (autoPlayEnabled) {
        // /history 默认按时间倒序返回，最新的一条就是索引 0
        playerManager.playTrackAtIndex(0);
      }
    } catch (err) {
      console.error('[PodifyAI] 合成失败：', err);
      showMessage(`合成失败：${err.message || err}`, 'error');
    } finally {
      resetBtn(synthesizePodcastBtn);
      generatedTitle = '';
    }
  });
  
  // 生成脚本
  const generateScript = async () => {
    let inputType = 'text';
    let content = '';

    // 1) 若上传了 PDF 文件，始终以文件为准，忽略 textarea 里的提示文字
    if (currentContent instanceof File && currentContent.type === 'application/pdf') {
      const base64 = await fileToBase64(currentContent);  // 这里返回纯 base64（无 data: 前缀）
      content = base64;
      inputType = 'pdf';
    } else {
      // 2) 退回到文本/URL
      // 先取 textarea，否则取 currentContent 字符串
      const maybeText = (mainTextarea.value || '').trim() ||
                        (typeof currentContent === 'string' ? currentContent.trim() : '');

      if (!maybeText) {
        throw new Error('请输入内容或上传文件');
      }

      // 若混入了 URL，就只取 URL
      const urlInText = (maybeText.match(/https?:\/\/\S+/) || [])[0];
      content = urlInText || maybeText;

      if (isURL(content)) {
        inputType = 'url';
      } else {
        // 粗判"像 PDF 的 base64（%PDF 的 base64 头是 JVBERi0）"
        if (/^JVBERi0/.test(content)) inputType = 'pdf'; else inputType = 'text';
      }
    }

    // 3) 记住原始输入（用于后续合成/展示来源）
    window.originalInputContent = content;
    window.originalInputType = inputType;
    // 新增：记住PDF文件信息
    if (inputType === 'pdf') {
      window.pdfFilename = null;  // 将在脚本生成成功后设置
      window.pdfPath = null;
    }

    const payload = { 
      inputType, 
      content, 
      mode: currentMode, 
      geminiModel: selectedModel, // 默认为 gemini-2.5-flash
      styleKey: selectedStyle[currentMode],
      lengthMode: lengthDetailed ? 'detailed' : 'concise'
    };

    if (inputType === 'url') showMessage('正在识别网页正文…', 'info');

    const resp = await fetch('/generate-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const hint = errorHints[err.error_type || 'UNKNOWN'] || '生成失败，请稍后再试';
      throw new Error(`${err.error || '生成脚本失败'}：${hint}`);
    }

    const data = await resp.json();
    generatedScript = data.script;
    generatedTitle  = data.title;
    
    // 新增：保存PDF文件信息（如果是PDF类型）
    if (inputType === 'pdf' && data.pdf_filename) {
      window.pdfFilename = data.pdf_filename;
      window.pdfPath = data.pdf_path;
      console.log('📄 PDF文件信息已保存:', { filename: data.pdf_filename, path: data.pdf_path });
    }
    
    // 在设置脚本内容后立即进行规范化（但保留API返回的标题）
    await onScriptGenerated(generatedScript, generatedTitle);
    showMessage(`脚本生成成功！标题: ${generatedTitle}`);
  };
  

  
  // 工具函数：文件转Base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };
  
  // ==================== 文本区域监听 ====================
  
  // 监听 textarea 内容变化，更新播客按钮状态
  mainTextarea?.addEventListener('input', () => {
    updatePodcastButtonState();
  });
  
  mainTextarea?.addEventListener('paste', (e) => {
    const paste = (e.clipboardData || window.clipboardData).getData('text');
    
    if (isURL(paste)) {
      e.preventDefault();
      currentContent = paste;
      showMessage('链接已成功粘贴并识别');
    }
  });
  
  // ==================== 历史记录功能 ====================
  
  // 卡片生成器
  const createHistoryCard = (item, index) => {
    console.log(`[诊断] 2. 正在创建卡片 (索引: ${index})，传入的数据(item):`, JSON.stringify(item, null, 2));
    const card = document.createElement('div');
    card.className = 'history-card';
    card.dataset.id = item.id;  // 添加 data-id 属性用于标识卡片
    
    // 动态生成说话人信息
    const modeText = item.mode.charAt(0).toUpperCase() + item.mode.slice(1);
    const speakerInfo = `${modeText}&${item.voice_name}`;

    // 格式化时间
    const timestamp = new Date(item.timestamp);
    const timeStr = timestamp.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    card.innerHTML = `
      <div class="history-thumbnail" style="${item.thumbnail_filename ? `background-image: url('/static/card-thumbnail/${item.thumbnail_filename}')` : 'background-color: #f0f0f0;'}">
      </div>

      <div class="history-content">
        <a href="#" class="history-title-link" data-history-id="${item.id}">
          ${escapeHtml(pickTitleLike(item))}
        </a>
      </div>

      <div class="history-footer">
        <div class="history-metadata">
          <div class="metadata-item" data-tooltip="播放次数">
            <svg t="1755527122634" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="11085" width="16" height="16"><path d="M310.613333 602.453333h-26.453333c-22.186667 0-40.106667 17.92-40.106667 40.96v216.746667c0 22.186667 17.92 40.96 40.106667 40.96h26.453333c22.186667 0 40.106667-17.92 40.106667-40.96V642.56c0-22.186667-17.92-40.106667-40.106667-40.106667z m582.826667-133.973333c0-5.973333-1.706667-12.8-4.266667-18.773333-27.306667-189.44-186.88-335.36-379.733333-335.36S157.013333 260.266667 129.706667 449.706667c-2.56 5.973333-4.266667 11.946667-4.266667 18.773333v270.506667c0 22.186667 17.92 40.96 40.106667 40.96s40.106667-17.92 40.106666-40.96V506.88h0.853334C206.506667 335.36 342.186667 196.266667 510.293333 196.266667c161.28 0 293.546667 128.853333 303.786667 292.693333v250.026667c0 22.186667 17.92 40.96 40.106667 40.96s40.106667-17.92 40.106666-40.96l-0.853333-270.506667zM733.866667 602.453333h-26.453334c-22.186667 0-40.106667 17.92-40.106666 40.96v216.746667c0 22.186667 17.92 40.96 40.106666 40.96H733.866667c22.186667 0 40.106667-17.92 40.106666-40.96V642.56c0-22.186667-17.92-40.106667-40.106666-40.106667z m0 0" p-id="11086" fill="#707070"></path></svg>
            <span class="meta-plays">${item.play_count || 0}</span>
          </div>
          <div class="metadata-item" data-tooltip="音频时长">
            <svg t="1755504984246" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7196" width="12" height="12"><path d="M479.507692 604.553846C444.967385 569.974154 354.461538 354.461538 354.461538 354.461538s215.552 90.505846 250.092308 125.046154a88.418462 88.418462 0 0 1-125.046154 125.00677z" fill="#5B5A5F" p-id="7197"></path><path d="M149.976615 149.976615c199.916308-199.955692 524.130462-199.955692 724.04677 0 199.955692 199.916308 199.955692 524.130462 0 724.04677-199.916308 199.955692-524.130462 199.955692-724.04677 0a510.227692 510.227692 0 0 1-149.661538-343.906462 39.384615 39.384615 0 1 1 78.729846-2.756923 431.497846 431.497846 0 0 0 126.621539 290.973538c169.196308 169.196308 443.470769 169.196308 612.667076 0 169.196308-169.196308 169.196308-443.470769 0-612.667076-169.196308-169.196308-443.470769-169.196308-612.667076 0a39.384615 39.384615 0 0 1-55.689847-55.689847z" fill="#5B5A5F" p-id="7198"></path></svg>
            <span class="meta-duration">${formatDuration(item.duration)}</span>
          </div>
        </div>
        <div class="history-controls">
          <button class="history-play-btn card-action-btn" data-index="${index}" data-tooltip="播放">
            <svg class="icon-play" t="1755527836252" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10073"><path d="M675.328 117.717333A425.429333 425.429333 0 0 0 512 85.333333C276.352 85.333333 85.333333 276.352 85.333333 512s191.018667 426.666667 426.666667 426.666667 426.666667-191.018667 426.666667-426.666667c0-56.746667-11.093333-112-32.384-163.328a21.333333 21.333333 0 0 0-39.402667 16.341333A382.762667 382.762667 0 0 1 896 512c0 212.074667-171.925333 384-384 384S128 724.074667 128 512 299.925333 128 512 128c51.114667 0 100.8 9.984 146.986667 29.12a21.333333 21.333333 0 0 0 16.341333-39.402667zM456.704 305.92C432.704 289.152 405.333333 303.082667 405.333333 331.797333v360.533334c0 28.586667 27.541333 42.538667 51.370667 25.856l252.352-176.768c21.76-15.253333 21.632-43.541333 0-58.709334l-252.373333-176.768z m-8.597333 366.72V351.466667l229.269333 160.597333-229.269333 160.597333z" fill="currentColor"></path></svg>
            <svg class="icon-pause" t="1755528011844" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="21097"><path d="M279.272727 384v256c0 53.527273 41.890909 95.418182 95.418182 95.418182s95.418182-41.890909 95.418182-95.418182v-256c0-53.527273-41.890909-95.418182-95.418182-95.418182S279.272727 330.472727 279.272727 384z m144.290909 0v256c0 27.927273-20.945455 48.872727-48.872727 48.872727s-48.872727-20.945455-48.872727-48.872727v-256c0-27.927273 20.945455-48.872727 48.872727-48.872727s48.872727 20.945455 48.872727 48.872727zM553.890909 384v256c0 53.527273 41.890909 95.418182 95.418182 95.418182s95.418182-41.890909 95.418182-95.418182v-256c0-53.527273-41.890909-95.418182-95.418182-95.418182s-95.418182 41.890909-95.418182 95.418182z m144.290909 0v256c0 27.927273-20.945455 48.872727-48.872727 48.872727s-48.872727-20.945455-48.872727-48.872727v-256c0-27.927273 20.945455-48.872727 48.872727-48.872727s48.872727 20.945455 48.872727 48.872727z" fill="currentColor"></path><path d="M923.927273 209.454545c-6.981818-9.309091-23.272727-11.636364-32.581818-4.654545-9.309091 6.981818-11.636364 23.272727-4.654546 32.581818C947.2 316.509091 977.454545 411.927273 977.454545 512c0 256-209.454545 465.454545-465.454545 465.454545S46.545455 768 46.545455 512 256 46.545455 512 46.545455c100.072727 0 195.490909 30.254545 274.618182 90.763636 9.309091 6.981818 25.6 4.654545 32.581818-4.654546s4.654545-25.6-4.654545-32.581818C726.109091 34.909091 621.381818 0 512 0 230.4 0 0 230.4 0 512s230.4 512 512 512 512-230.4 512-512c0-109.381818-34.909091-214.109091-100.072727-302.545455z" fill="currentColor"></path></svg>
          </button>
          <div class="history-menu">
            <button class="history-menu-btn card-action-btn" data-tooltip="更多操作">
              <svg t="1755528037548" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2609"><path d="M256 448a64 64 0 1 1 0 128 64 64 0 0 1 0-128z m256 0a64 64 0 1 1 0 128 64 64 0 0 1 0-128z m256 0a64 64 0 1 1 0 128 64 64 0 0 1 0-128z" fill="currentColor"></path></svg>
            </button>
            <div class="history-menu-dropdown">
              <button class="history-download-btn">
                <svg class="icon-media" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path></svg>
                <span>下载</span>
              </button>
              <button class="history-delete-btn" data-item-id="${item.id}">
                <svg class="icon-media" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
                <span>删除</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  
    // 标题赋值（避免注入，用 textContent）
    const titleEl = card.querySelector('.history-title-link');
    if (titleEl) titleEl.textContent = pickTitleLike(item);

    // 建立映射关系
    const playBtn = card.querySelector('.history-play-btn');
    playBtn.dataset.index = index;
    filenameToPlayBtn.set(item.audio_filename, playBtn);
    filenameToCard.set(item.audio_filename, card);
    
    playBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const index = parseInt(this.dataset.index, 10);
      playerManager.playTrackAtIndex(index);
    });

    // 添加菜单按钮事件
    const menuBtn = card.querySelector('.history-menu-btn');
    const menuDropdown = card.querySelector('.history-menu-dropdown');
    
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止事件冒泡
      
      const wasActive = menuDropdown.classList.contains('active');

      // Deactivate any other active card/menu
      const activeCard = document.querySelector('.history-card.menu-active');
      if (activeCard && activeCard !== card) {
          activeCard.classList.remove('menu-active');
          const activeDropdown = activeCard.querySelector('.history-menu-dropdown');
          if (activeDropdown) {
              activeDropdown.classList.remove('active');
          }
      }

      // Toggle current card/menu
      card.classList.toggle('menu-active', !wasActive);
      menuDropdown.classList.toggle('active', !wasActive);

      if (!wasActive) {
        // 边缘避让：如果溢出右侧或底部，反向
        const rect = menuDropdown.getBoundingClientRect();
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        menuDropdown.classList.remove('flip-x', 'flip-y');
        if (rect.right > viewportW) menuDropdown.classList.add('flip-x');
        if (rect.bottom > viewportH) menuDropdown.classList.add('flip-y');

        // 聚焦第一项，支持键盘Esc关闭
        const firstBtn = menuDropdown.querySelector('button');
        firstBtn?.focus();
        const onKeydown = (ke) => {
          if (ke.key === 'Escape') {
            ke.stopPropagation();
            menuDropdown.classList.remove('active');
            card.classList.remove('menu-active');
            menuBtn.focus();
            document.removeEventListener('keydown', onKeydown, true);
          }
        };
        document.addEventListener('keydown', onKeydown, true);
        // 滚动时关闭
        const onScroll = () => {
          menuDropdown.classList.remove('active');
          card.classList.remove('menu-active');
          document.removeEventListener('scroll', onScroll, true);
          document.removeEventListener('keydown', onKeydown, true);
        };
        document.addEventListener('scroll', onScroll, true);
      }
    });

    // 添加下载按钮事件
    const downloadBtn = card.querySelector('.history-download-btn');
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const audioSrc = `/history_audio/${item.audio_filename}`;
      const link = document.createElement('a');
      link.href = audioSrc;
      link.download = item.audio_filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      menuDropdown.classList.remove('active');
    });

    // 添加删除按钮事件
    const deleteBtn = card.querySelector('.history-delete-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      
      const itemId = deleteBtn.dataset.itemId;
      if (!itemId) return;
      
      if (!confirm('确定要删除这条历史记录吗？此操作不可撤销。')) {
        return;
      }
      
      try {
        const response = await fetch(`/history/${itemId}`, { method: 'DELETE' });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `删除失败 (${response.status})`);
        }
        showMessage('历史记录已删除');
        // 从状态移除并统一重渲染
        playerManager.playlist = playerManager.playlist.filter(track => track.id !== itemId);
        renderFromState();
      } catch (error) {
        showMessage(`删除失败: ${error.message}`, 'error');
        console.error('删除历史记录失败:', error);
      }
    });


    
    return card;
  };

  // 加载历史记录
  const loadHistory = async () => {
    try {
      const response = await fetch('/history', { cache: 'no-cache' });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) {
        throw new Error(`获取历史记录失败（${response.status}）`);
      }
      
      const history = await response.json();
      
      playerManager.loadPlaylist(history);
      renderFromState();
      
    } catch (error) {
      console.error('加载历史记录失败:', error);
      showMessage('加载历史记录失败', 'error');
    }
  };

  // 统一渲染（历史网格 + 播放列表面板）
  function renderFromState() {
    const grid = document.querySelector('.history-grid');
    if (grid) {
      grid.innerHTML = '';
      // 依据筛选与排序生成视图索引
      const indices = playerManager.playlist
        .map((_, i) => i)
        .filter(i => {
          if (libraryFilterMode === 'all') return true;
          const it = playerManager.playlist[i];
          return libraryFilterMode === 'role' ? it.mode === 'role' : it.mode === 'single';
        })
        .sort((a, b) => {
          const A = playerManager.playlist[a];
          const B = playerManager.playlist[b];
          if (librarySort === 'duration') {
            return (B.duration || 0) - (A.duration || 0);
          } else if (librarySort === 'plays') {
            return (B.play_count || 0) - (A.play_count || 0);
          }
          // recent 默认按 timestamp 倒序
          const ts = v => {
            const t = new Date(v).getTime();
            return Number.isFinite(t) ? t : 0; // 兜底：无时间就当最旧
          };
          return ts(B.timestamp) - ts(A.timestamp);
        });

      playerManager.viewIndices = indices;
      indices.forEach((i) => grid.appendChild(createHistoryCard(playerManager.playlist[i], i)));
    }
    if (typeof renderPlaylistPanel === 'function') renderPlaylistPanel(playerManager.playlist);
  }
  
  // ==================== 悬浮播放器滚动控制 ====================
  
  // 悬浮播放器滚动事件
  let stickyPlayerInitialPosition = 0;
  let stickyPlayerWrapper = null;
  
  window.addEventListener('scroll', function() {
    if (!stickyPlayerWrapper) {
      stickyPlayerWrapper = document.getElementById('sticky-player-wrapper');
      if (stickyPlayerWrapper && stickyPlayerWrapper.offsetTop > 0) {
        stickyPlayerInitialPosition = stickyPlayerWrapper.offsetTop;
      }
    }
    
    if (stickyPlayerWrapper && stickyPlayerWrapper.style.display !== 'none') {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      
      if (scrollTop > stickyPlayerInitialPosition) {
        stickyPlayerWrapper.classList.add('is-sticky');
      } else {
        stickyPlayerWrapper.classList.remove('is-sticky');
      }
    }
  }, { passive: true });
  
  // ==================== 页面初始化 ====================
  
  // 页面加载完成后执行
  document.addEventListener('DOMContentLoaded', () => {
    
    // 初始化风格按钮
    updateStyleButtonText();
    
    // --- 新增：用户状态检查与UI设置 ---
    async function checkLoginStatusAndSetupUI() {
      try {
        const response = await fetch('/api/user/status');
        if (!response.ok) {
          // 如果API请求失败（例如服务器关闭），直接跳转登录
          window.location.href = '/login';
          return;
        }
        
        const data = await response.json();

        if (data.isLoggedIn) {
          // --- 用户已登录 ---
          const userInfoSection = document.getElementById('user-info-section');
          const usernameDisplay = document.getElementById('username-display');
          const userAvatar = document.getElementById('user-avatar');
          const userProfileBtn = document.getElementById('user-profile-btn');
          const userDropdownMenu = document.getElementById('user-dropdown-menu');
          const accountSettingsBtn = document.getElementById('account-settings-btn');
          const dropdownLogoutBtn = document.getElementById('dropdown-logout-btn');

          if (userInfoSection && usernameDisplay && userAvatar && userProfileBtn && userDropdownMenu) {
            // 1. 显示用户信息
            usernameDisplay.textContent = data.user.username;
            
            // 设置用户头像 - 优先使用保存的头像，否则使用用户名首字母
            if (data.user.avatar_path) {
              userAvatar.style.backgroundImage = `url(${data.user.avatar_path})`;
              userAvatar.style.backgroundSize = 'cover';
              userAvatar.style.backgroundPosition = 'center';
              userAvatar.style.backgroundRepeat = 'no-repeat';
              userAvatar.textContent = '';
              userAvatar.style.color = 'transparent';
            } else {
              userAvatar.style.backgroundImage = '';
              userAvatar.style.backgroundSize = '';
              userAvatar.style.backgroundPosition = '';
              userAvatar.style.backgroundRepeat = '';
              userAvatar.style.color = '';
              userAvatar.textContent = data.user.username.charAt(0).toUpperCase();
            }
            
            userInfoSection.style.display = 'flex';

            // 2. 用户头像下拉菜单功能
            setupUserDropdown(userProfileBtn, userDropdownMenu, accountSettingsBtn, dropdownLogoutBtn);
          }
          
          // 3. 继续执行原有的应用初始化逻辑
          initializeApp();

        } else {
          // --- 用户未登录 ---
          window.location.href = '/login';
        }
      } catch (error) {
        console.error('检查登录状态时出错:', error);
        // 发生任何网络错误都跳转到登录页
        window.location.href = '/login';
      }
    }

    // --- 应用初始化函数 ---
    function initializeApp() {
      // Performance: "Warm up" the browser to prevent first-click jank.
      // This forces the browser to compute styles for the collapsed state
      // so the animation is smooth on the first user interaction.
      if (sidebar) {
        sidebar.classList.add('is-collapsed');
        sidebar.offsetHeight; // This is a trick to force a browser reflow
        sidebar.classList.remove('is-collapsed');
      }
      
      // 初始化侧边栏状态 - 先禁用动画，设置状态，再恢复动画
      if (sidebar) {
        // 1. 禁用动画
        sidebar.classList.add('no-anim');
        
        // 2. 性能检测和优化
        const detectPerformance = () => {
          // 检测设备性能
          const startTime = performance.now();
          let testCount = 0;
          
          // 简单的性能测试
          for (let i = 0; i < 1000000; i++) {
            testCount += Math.random();
          }
          
          const endTime = performance.now();
          const performanceTime = endTime - startTime;
          
          // 根据性能测试结果应用不同的优化级别
          if (performanceTime > 50) { // 低性能设备
            sidebar.classList.add('perf-low');
            console.log('🔧 检测到低性能设备，应用性能优化模式');
          } else if (performanceTime > 20) { // 中等性能设备
            console.log('⚡ 检测到中等性能设备，使用标准动画模式');
          } else { // 高性能设备
            console.log('🚀 检测到高性能设备，使用流畅动画模式');
          }
        };
        
        // 3. 读取本地存储状态并应用
        const collapsed = storage.get('lh_sidebar_collapsed', false);
        setSidebarCollapsed(collapsed);
        
        // 4. 执行性能检测
        detectPerformance();
        
        // 5. 下一帧再恢复动画（保证首帧静态）
        requestAnimationFrame(() => sidebar.classList.remove('no-anim'));
      }
      
      // 优化侧边栏切换按钮事件监听器
      sidebarToggle?.addEventListener('click', (e) => {
        // 防止事件冒泡
        e.preventDefault();
        e.stopPropagation();
        
        // 添加点击反馈
        if (sidebarToggle) {
          sidebarToggle.style.transform = 'scale(0.95)';
          setTimeout(() => {
            sidebarToggle.style.transform = '';
          }, 100);
        }
        
        // 调用切换函数
        setSidebarCollapsed(!isSidebarCollapsed);
      }, { passive: false });

      // 恢复模式选择状态
      const savedMode = storage.get('podifyai_mode', 'role'); // 默认是双人对话模式
      if (savedMode === 'single') {
        currentMode = 'single';
        singleMode?.classList.add('active');
        rolesMode?.classList.remove('active');
      } else {
        currentMode = 'role';
        rolesMode?.classList.add('active');
        singleMode?.classList.remove('active');
      }

      // ScrollSpy：根据视口中线命中高亮
      const navLinks = Array.from(document.querySelectorAll('.lh-sidebar .nav-item[href^="#"]'));
      const sections = navLinks
        .map(a => ({ a, el: document.querySelector(a.getAttribute('href')) }))
        .filter(x => x.el);
      
      let userClicked = false; // 用户是否手动点击了导航项
      let lastUserClick = 0; // 最后一次用户点击的时间戳
      
      const setActive = (a, isUserClick = false) => {
        const all = document.querySelectorAll('.lh-sidebar .nav-item');
        all.forEach(n => n.classList.remove('is-active'));
        if (a) {
          a.classList.add('is-active');
        }
        
        if (isUserClick) {
          userClicked = true;
          lastUserClick = Date.now();
          // 3秒后允许ScrollSpy重新接管
          setTimeout(() => {
            if (Date.now() - lastUserClick >= 3000) {
              userClicked = false;
            }
          }, 3000);
        }
      };
    
    const onScrollSpy = () => {
      // 如果用户刚点击过，不执行自动ScrollSpy
      if (userClicked) return;
      
      const scrollTop = window.scrollY;
      
      // 如果页面在顶部或接近顶部，激活主页
      if (scrollTop < 100) {
        const homeBtn = document.getElementById('sidebar-search');
        if (homeBtn) {
          setActive(homeBtn);
          return;
        }
      }
      
      const center = window.scrollY + window.innerHeight / 2;
      let best = null, bestDist = Infinity;
      sections.forEach(({ a, el }) => {
        const rect = el.getBoundingClientRect();
        const mid = rect.top + window.scrollY + rect.height / 2;
        const d = Math.abs(mid - center);
        if (d < bestDist) { best = a; bestDist = d; }
      });
      if (best) setActive(best);
    };
    window.addEventListener('scroll', () => { window.requestAnimationFrame(onScrollSpy); }, { passive: true });
    onScrollSpy();
    
    // 设置默认激活状态为主页
    setActive(document.getElementById('sidebar-search'), true);

    // 键盘快捷键: N 新建
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        // 新建：清空并聚焦输入框
        if (mainTextarea) {
          if (mainTextarea.value.trim()) {
            const ok = confirm('是否清空当前内容开始新建？');
            if (!ok) return;
          }
          mainTextarea.value = '';
          adjustTextareaHeight(mainTextarea);
          mainTextarea.focus();
        }
      }
    }, true);

    // 点击"设置"打开设置模态框
    document.getElementById('nav-settings')?.addEventListener('click', () => {
      const modal = document.getElementById('settings-modal');
      modal?.classList.remove('hidden');
      document.body.classList.add('is-modal-open'); // 添加模态框打开状态类
      // 设置设置为激活状态
      setActive(document.getElementById('nav-settings'), true);
      // 更新设置信息
      updateSettingsModal();
    });
    
    // 设置模态框关闭事件
    const closeSettingsModal = document.getElementById('close-settings-modal');
    const settingsModal = document.getElementById('settings-modal');
    
    closeSettingsModal?.addEventListener('click', () => {
      settingsModal?.classList.add('hidden');
      document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
    });

    // 点击模态框外部关闭
    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
        document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
      }
    });

    // ESC键关闭设置模态框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) {
        settingsModal.classList.add('hidden');
        document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
      }
    });

      // 保存设置按钮事件监听器
      const saveGeneralSettingsBtn = document.getElementById('save-general-settings');
      saveGeneralSettingsBtn?.addEventListener('click', saveGeneralSettings);

      // 主题模式实时预览
      const themeSelect = document.getElementById('theme-select');
      let systemThemeListener = null; // 保存系统主题监听器的引用
      
      themeSelect?.addEventListener('change', (e) => {
        const selectedTheme = e.target.value;
        applyThemeSettings(selectedTheme);
        
        // 管理系统主题监听器
        if (systemThemeListener) {
          window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', systemThemeListener);
          systemThemeListener = null;
        }
        
        if (selectedTheme === 'system' || selectedTheme === 'auto') { // 兼容旧值'auto'
          systemThemeListener = (e) => {
            if (document.documentElement.classList.contains('auto-theme')) {
              if (e.matches) {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }
            }
          };
          window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', systemThemeListener);
        }
      });

      // 侧边栏状态实时预览
      const sidebarSelect = document.getElementById('sidebar-select');
      let sidebarResizeListener = null; // 保存resize监听器的引用
      
      sidebarSelect?.addEventListener('change', (e) => {
        const selectedValue = e.target.value;
        applySidebarSettings(selectedValue);
        
        // 管理resize监听器
        if (sidebarResizeListener) {
          window.removeEventListener('resize', sidebarResizeListener);
          sidebarResizeListener = null;
        }
        
        if (selectedValue === 'auto') {
          sidebarResizeListener = () => applySidebarSettings('auto');
          window.addEventListener('resize', sidebarResizeListener);
        }
      });

      // 默认音量实时预览
      const defaultVolumeSlider = document.getElementById('default-volume');
      const volumeDisplay = document.getElementById('default-volume-value');
      defaultVolumeSlider?.addEventListener('input', (e) => {
        const volumeValue = String(e.target.value);
        if (volumeDisplay) volumeDisplay.textContent = volumeValue + '%';
        playerManager?.setVolume(parseFloat(volumeValue) / 100);
      });

    // 点击"主页"回滚到初始页面并聚焦主输入框
    const homeButton = document.getElementById('sidebar-search');
    if (homeButton) {
      // 移除可能存在的旧事件监听器
      const newHomeButton = homeButton.cloneNode(true);
      homeButton.parentNode.replaceChild(newHomeButton, homeButton);
      
      // 重新绑定事件
      newHomeButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('主页按钮被点击，开始回滚...');
        
        // 强制滚动到顶部的函数
        const forceScrollToTop = () => {
          try {
            // 方法1: 使用 window.scrollTo
            window.scrollTo({
              top: 0,
              behavior: 'smooth'
            });
            console.log('方法1: window.scrollTo 执行成功');
            
            // 方法2: 使用 document.documentElement.scrollTop
            setTimeout(() => {
              document.documentElement.scrollTop = 0;
              document.body.scrollTop = 0;
              console.log('方法2: scrollTop 设置成功');
            }, 100);
            
            // 方法3: 使用 scrollIntoView
            setTimeout(() => {
              const firstElement = document.body.firstElementChild;
              if (firstElement) {
                firstElement.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                });
                console.log('方法3: scrollIntoView 执行成功');
              }
            }, 200);
            
            // 方法4: 强制滚动（备用方案）
            setTimeout(() => {
              window.scrollTo(0, 0);
              console.log('方法4: 强制滚动执行成功');
            }, 300);
            
          } catch (error) {
            console.error('滚动执行出错:', error);
          }
        };
        
        // 执行滚动
        forceScrollToTop();
        
        // 2. 聚焦主输入框
        if (mainTextarea) {
          mainTextarea.focus();
          console.log('聚焦主输入框成功');
        }
        
        // 3. 设置主页为激活状态
        setActive(newHomeButton, true);
        console.log('设置激活状态成功');
        
        // 4. 清除URL中的hash（如果有的话）
        if (window.location.hash) {
          history.pushState(null, null, window.location.pathname);
          console.log('清除URL hash成功');
        }
        
        // 5. 验证滚动结果
        setTimeout(() => {
          const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
          console.log(`当前滚动位置: ${currentScrollTop}px`);
          if (currentScrollTop === 0) {
            console.log('✅ 滚动到顶部验证成功');
          } else {
            console.log(`⚠️ 滚动到顶部验证失败，当前位置: ${currentScrollTop}px`);
            // 再次尝试强制滚动
            window.scrollTo(0, 0);
          }
        }, 500);
        
        console.log('主页按钮点击事件处理完成');
      });
      
      console.log('主页按钮事件重新绑定成功');
    } else {
      console.error('找不到主页按钮元素');
    }
    
    // --- 资料库标题点击滚动 ---
    const libraryTitle = document.querySelector('.library-header h2');
    const historyLibrarySection = document.getElementById('history-library');

    if (libraryTitle && historyLibrarySection) {
      libraryTitle.addEventListener('click', () => {
        historyLibrarySection.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
              });
    });
    
    // 注入后的首屏拉回顶部
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

    // 为资料库导航项添加点击事件
    const libraryNavItem = document.querySelector('a[href="#history-library"]');
    if (libraryNavItem) {
      libraryNavItem.addEventListener('click', () => {
        setActive(libraryNavItem, true);
      });
    }

    // 为积分按钮添加点击事件
    document.getElementById('nav-credits')?.addEventListener('click', () => {
      setActive(document.getElementById('nav-credits'), true);
    });

    // 为帮助和反馈链接添加点击事件
    const helpNavItem = document.querySelector('a[href="#help"]');
    const feedbackNavItem = document.querySelector('a[href="#feedback"]');
    
    if (helpNavItem) {
      helpNavItem.addEventListener('click', () => {
        setActive(helpNavItem, true);
      });
    }
    
    if (feedbackNavItem) {
      feedbackNavItem.addEventListener('click', () => {
        setActive(feedbackNavItem, true);
      });
    }
    
    // 初始化音量（默认 1.0）
    playerManager.initVolume();
    
    // 加载并应用所有设置
    loadAndApplyAllSettings();
    
    // 初始化账户设置模态框
    initAccountSettingsModal();
    
    loadVoices();
    
    // 更新添加音色按钮状态
    updateAddVoiceButton();
    
    // 加载历史记录
    loadHistory();
    
    // 初始化播客按钮状态
    updatePodcastButtonState();

    // ==================== 积分系统事件绑定 ====================
    
    // Sidebar entry: open billing
    document.getElementById('nav-credits')?.addEventListener('click', (e) => {
      e.preventDefault();
      openBilling();
    });

    // Modal close
    document.getElementById('billing-close')?.addEventListener('click', closeBilling);

    // Hash deep-link
    window.addEventListener('hashchange', () => {
      if (location.hash === '#billing') openBilling();
      else closeBilling();
    });

    // Payment return (?paid=1)
    (function handlePaidReturn() {
      const q = new URLSearchParams(location.search);
      if (q.get('paid') === '1') {
        // 记录支付前的基线
        (async () => {
          const s = await getUserStatus();
          const initialCredits = s?.user?.credits ?? 0;
          const initialPlan =
            s?.user?.subscription_plan ||
            s?.subscription?.tier      ||
            s?.user?.plan              ||
            (s?.user?.has_premium ? 'pro' : 'free');

          openBilling(); // 打开订阅弹窗
          // 如果 success_url 携带了 session_id（上一步已确认），顺带传给轮询函数
          await startPostPaymentSync({
            sessionId: q.get('session_id') || null,
            initialPlan,
            initialCredits
          });

          // 清理URL参数
          q.delete('paid'); q.delete('session_id');
          const newUrl = location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash;
          history.replaceState(null, '', newUrl);
        })();
      }
    })();

    // 订阅卡片 CTA
    document.querySelectorAll('.plan-cta').forEach(btn => {
      btn.addEventListener('click', () => {
        const plan = btn.getAttribute('data-plan'); // 'lite' | 'pro'
        startCheckout(plan);
      });
    });

    // 管理订阅按钮
    document.getElementById('btn-manage-subscription')?.addEventListener('click', openBillingPortal);

    // 积分包（真实下单）
    document.getElementById('btn-recharge')?.addEventListener('click', async () => {
      // 简单选择：确认=>3000 积分包；取消=>1000 积分包
      const wantLarge = confirm('购买 3000 积分包？（点击"取消"购买 1000 积分包）');
      const plan = wantLarge ? 'pack3000' : 'pack1000';
      startCheckout(plan);
    });

    // INIT: show current credits on load
    refreshCreditsEverywhere();

    const moreOptionsBtn = document.querySelector('.more-options-btn');
    const moreOptionsMenu = document.querySelector('.more-options-menu');
    
    moreOptionsBtn?.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止事件冒泡
      moreOptionsMenu?.classList.toggle('hidden');
      // 当打开"更多"时，确保其他弹层是关闭的
      document.querySelector('.volume-popover')?.classList.remove('open');
    });

    // 为菜单内的按钮添加点击后关闭菜单的功能
    const downloadBtn = document.getElementById('gp-download-btn');
    const speedMenuContainer = document.getElementById('gp-speed-menu-container');
    playlistPanel = document.getElementById('playlist-panel');
    const closePlaylistPanelBtn = document.getElementById('close-playlist-panel');
    playlistListContent = document.getElementById('playlist-list-content');
    const playlistMenuContainer = document.getElementById('gp-playlist-menu-container');

    playlistMenuContainer?.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止事件冒泡到 document
      const panel = playlistMenuContainer.querySelector('#playlist-panel');
      if (panel) {
        const isVisible = panel.classList.contains('visible');
        // 先隐藏所有其他可能打开的面板
        document.querySelectorAll('.player-more-options .visible').forEach(p => p.classList.remove('visible'));
        // 渲染并切换当前面板
        if (!isVisible) {
          renderPlaylistPanel();
          panel.classList.add('visible');
        }
      }
    });
    closePlaylistPanelBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = e.target.closest('#playlist-panel');
      if (panel) panel.classList.remove('visible');
    });

    // 播放速度子菜单事件委托
    speedMenuContainer?.addEventListener('click', (e) => {
      const target = e.target.closest('.submenu-item');
      if (target && target.dataset.speed) {
        const newSpeed = parseFloat(target.dataset.speed);
        if (playerManager && playerManager.audio) {
            playerManager.audio.playbackRate = newSpeed;
            showMessage(`播放速度已切换至 ${newSpeed}x`);
        }
        moreOptionsMenu.classList.add('hidden');
      }
    });

    // 下载按钮
    downloadBtn?.addEventListener('click', () => {
      const currentTrack = playerManager.playlist[playerManager.currentTrackIndex];
      if (currentTrack && playerManager.audio.src) {
        const link = document.createElement('a');
        link.href = playerManager.audio.src;
        link.download = currentTrack.audio_filename || 'podifyai-audio.mp3';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        showMessage('当前没有可下载的音频', 'error');
      }
      moreOptionsMenu.classList.add('hidden');
    });

    // 点击外部关闭菜单
    document.addEventListener('click', (e) => {
      // 关闭全局播放器的"更多选项"菜单
      if (moreOptionsBtn && moreOptionsMenu && !moreOptionsBtn.contains(e.target) && !moreOptionsMenu.contains(e.target)) {
        moreOptionsMenu.classList.add('hidden');
      }
      
      // 关闭资料库卡片中已打开的"更多选项"菜单
      const activeCard = document.querySelector('.history-card.menu-active');
      if (activeCard && !activeCard.contains(e.target)) {
        activeCard.classList.remove('menu-active');
        const activeDropdown = activeCard.querySelector('.history-menu-dropdown');
        if (activeDropdown) {
          activeDropdown.classList.remove('active');
        }
      }

      const openPlaylistPanel = document.querySelector('#playlist-panel.visible');
      if (openPlaylistPanel && !openPlaylistPanel.closest('#gp-playlist-menu-container').contains(e.target)) {
          openPlaylistPanel.classList.remove('visible');
      }
    });
    
    // "播放全部"按钮事件（基于当前可见卡片构建播放视图）
    const playAllBtn = document.querySelector('.play-all-btn');
    // 资料库筛选/排序控件
    const filterChips = Array.from(document.querySelectorAll('.history-filters .chip-mode'));
    const sortSelect = document.getElementById('history-sort-select');

    // 绑定筛选按钮
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const mode = chip.dataset.mode;
        if (!mode) return;
        libraryFilterMode = mode; // all | role | single
        // 视觉状态
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        // 刷新视图
        renderFromState();
      });
    });

    // 绑定排序下拉
    sortSelect?.addEventListener('change', () => {
      const v = sortSelect.value;
      librarySort = v; // recent | duration | plays
      renderFromState();
    });
    playAllBtn?.addEventListener('click', () => {
      const historyGrid = document.querySelector('.history-grid');
      // 仅取可见卡片（避免折叠/隐藏的元素被计入）
      const visibleCards = Array.from(historyGrid?.querySelectorAll('.history-card') || [])
        .filter(card => card.offsetParent !== null);
      if (playerManager.isPlaying) {
        // 停止播放并关闭迷你队列
        playerManager.stopPlayback();
        const panel = document.getElementById('playlist-panel');
        panel?.classList.remove('visible');
        playAllBtn.textContent = '播放全部';
        return;
      }
      const indices = visibleCards.map(card => {
        const playBtn = card.querySelector('.history-play-btn');
        return playBtn ? parseInt(playBtn.dataset.index, 10) : -1;
      }).filter(i => Number.isInteger(i) && i >= 0);
      if (indices.length === 0) return;

      playerManager.playTrackAtIndex(indices[0]);
      // 将当前视图的顺序映射给全局播放器，以便面板展示筛选后的列表
      playerManager.viewIndices = indices;
      const panel = document.getElementById('playlist-panel');
      if (panel) {
        // 先清空以强制使用当前 viewIndices 重建
        const list = panel.querySelector('#playlist-list-content');
        if (list) list.innerHTML = '';
        renderPlaylistPanel();
        panel.classList.add('visible');
      }
      playAllBtn.textContent = '停止播放';
    });

    // "浏览全部"链接事件
    const browseAllLink = document.querySelector('.browse-all-link');
    browseAllLink?.addEventListener('click', function(e) {
        e.preventDefault();
        const historyGrid = document.querySelector('.history-grid');
        historyGrid.classList.toggle('collapsed');
        this.classList.toggle('expanded');
    });

    // 为 playerManager.audio 添加事件
    playerManager.audio.addEventListener('ended', () => {
      playerManager.handleNext(true);
    });
    playerManager.audio.addEventListener('play', () => {
      playerManager.isPlaying = true;
      playerManager.updateUI();
    });
    playerManager.audio.addEventListener('pause', () => {
      playerManager.isPlaying = false;
      playerManager.updateUI();
    });
    playerManager.audio.addEventListener('timeupdate', () => {
      if (!playerManager.isSeeking) {
        // 1. 先做"有效播放计数"（重要逻辑，必须优先执行）
        const track = playerManager.playlist[playerManager.currentTrackIndex];
        if (track && !playerManager.hasCountedPlayback && playerManager.audio.duration > 0 && (playerManager.audio.currentTime / playerManager.audio.duration >= 0.8)) {
          playerManager.hasCountedPlayback = true; // 设置标记，防止重复计数
          playerManager.lastCountedTrackId = track.id; // 记录最后计数的曲目ID
          
          // 强转为数字，避免 '0' + 1 变 '01' 或 undefined + 1 变 NaN
          track.play_count = (parseInt(track.play_count, 10) || 0) + 1;
          
          // 异步通知后端更新
          fetch(`/history/play/${track.id}`, { method: 'POST' });
          
          // 立即更新对应卡片的播放次数显示
          updateCardMetaById(track.id);
        }
        
        // 2. 再做 rAF 节流的 updateUI()（性能优化，不阻塞计数逻辑）
        if (!playerManager._rafScheduled) {
          playerManager._rafScheduled = true;
          requestAnimationFrame(() => { 
            playerManager.updateUI(); 
            playerManager._rafScheduled = false; 
          });
        }
        // 注意：这里没有 return，确保计数逻辑始终有机会运行
      }
    });
    playerManager.audio.addEventListener('loadedmetadata', () => {
      const track = playerManager.playlist[playerManager.currentTrackIndex];
      if (track && playerManager.audio.duration) {
        // 检查前端数据中的时长是否未知或不正确
        if (!track.duration || track.duration <= 0) {
          // 1. 在前端数据中更新时长
          track.duration = playerManager.audio.duration;
          
          // 2. 异步通知后端永久保存这个新发现的时长
          fetch(`/history/update_duration/${track.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration: playerManager.audio.duration })
          });
        }
        
        // 3. 立即更新对应卡片的时长显示
        updateCardMetaById(track.id);
      }
      // 无论如何都刷新一次UI，以确保显示正确的时间格式和时长
      playerManager.updateUI();
    });
    
    // 音量控制事件绑定
    const volumeBtn = document.getElementById('player-volume-btn');
    const volumePopover = document.getElementById('volume-popover');
    if (volumeBtn && volumePopover) {
      volumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        volumePopover.classList.toggle('open');
      });
    }

    // 点击页面其他位置时收起音量面板
    document.addEventListener('click', (e) => {
      const volumeControl = document.querySelector('.volume-control-wrapper');
      if (volumeControl && !volumeControl.contains(e.target)) {
        volumePopover?.classList.remove('open');
      }
    });
    
    // 绑定全局播放器的按钮（如已有 class 就直接选；没有则按 ID 选）
    const gpPlayBtn = document.querySelector('#global-player .play-pause-btn');
    const gpPrevBtn = document.querySelector('#global-player .prev-btn');
    const gpNextBtn = document.querySelector('#global-player .next-btn');
    const volPopup  = document.getElementById('volume-popup');
    const volSlider = document.getElementById('volume-slider');

    gpPlayBtn?.addEventListener('click', () => {
      playerManager.handlePlayPause();
    });
    gpPrevBtn?.addEventListener('click', () => {
      playerManager.handlePrev();
    });
    gpNextBtn?.addEventListener('click', () => {
      playerManager.handleNext();
    });
    playerManager.progressBarContainerEl.addEventListener('mousedown', function(e) {
      playerManager.isSeeking = true;
      const rect = this.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = clickX / rect.width;
      playerManager.seek(percentage);
    });
    window.addEventListener('mousemove', function(e) {
      if (playerManager.isSeeking) {
        const rect = playerManager.progressBarContainerEl.getBoundingClientRect();
        let percentage = (e.clientX - rect.left) / rect.width;
        percentage = Math.max(0, Math.min(1, percentage)); // 保证在0-1之间
        playerManager.seek(percentage);
      }
    });
    window.addEventListener('mouseup', function() {
      if (playerManager.isSeeking) {
        playerManager.isSeeking = false;
      }
    });
    volSlider?.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      playerManager?.setVolume(Number.isFinite(v) ? v : 1);
      updateVolumeSliderFill(e.target);
    });
    document.addEventListener('click', () => volPopup?.classList.add('hidden'));
    
    // 初始化textarea自适应高度
    if (mainTextarea) {
      // 设置初始高度
      mainTextarea.style.height = 'auto';
      mainTextarea.style.height = (mainTextarea.scrollHeight) + 'px';
      
      // 添加input事件监听器，实现自适应高度
      mainTextarea.addEventListener('input', function() {
        adjustTextareaHeight(this);
        // 保留滚动位置修正的代码
        const scrollPosition = window.scrollY;
        window.scrollTo(0, scrollPosition);
      });
    }
    
      // 添加CSS动画
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    // 性能优化：全局菜单关闭委托（替代每卡一个监听器）
    document.addEventListener('click', (e) => {
      const openCard = document.querySelector('.history-card.menu-active');
      if (openCard && !openCard.contains(e.target)) {
        openCard.classList.remove('menu-active');
        openCard.querySelector('.history-menu-dropdown')?.classList.remove('active');
      }
    }, { passive: true });

    // ===== Library: 展开/收起 =====
    (function () {
      const toggle = document.querySelector('.browse-all-link');
      const grid = document.getElementById('history-grid');
      if (!toggle || !grid) return;

      // 如果卡片数量 > 8，默认折叠
      if (grid.children.length > 8 && !grid.classList.contains('collapsed')) {
        grid.classList.add('collapsed');
      }
      // 初始化箭头/文案
      const setUi = () => {
        const isCollapsed = grid.classList.contains('collapsed');
        toggle.classList.toggle('expanded', !isCollapsed);
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
        // 更新文案
        const isExpanded = toggle.classList.contains('expanded');
        if (isExpanded) {
          toggle.innerHTML = `
            <svg t="1755656421967" class="icon icon-arrow-right" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5050" width="16" height="16"><path d="M461.726 767.572c14.172 14.172 33.496 27.055 51.533 23.19 18.036 3.22 35.429-10.95 49.6-23.19l438.029-439.961c22.546-22.546 22.546-58.619 0-81.164-22.546-22.546-58.619-22.546-81.164 0L511.97 665.15 102.93 246.447c-22.546-22.546-58.619-22.546-81.164 0-22.546 22.545-22.546 58.618 0 81.164l439.961 439.961z" fill="#000000" p-id="5051"></path></svg>
            收起
          `;
        } else {
          toggle.innerHTML = `
            <svg t="1755656390445" class="icon icon-arrow-down" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4896" width="16" height="16"><path d="M257.216 164.832A48 48 0 0 1 314.88 88.224l3.936 2.944 448 374.4a48 48 0 0 1 4.736 69.12l-3.392 3.36-437.024 393.6a48 48 0 0 1-67.744-67.84l3.488-3.488 395.936-356.544L257.216 164.832z" fill="#3C3C3C" p-id="4897"></path></svg>
            浏览全部 >
          `;
        }
      };
      setUi();

      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        grid.classList.toggle('collapsed'); // 触发 nth-child 规则
        setUi();
      });
    })();

    // ===== 帮助 / 反馈 =====
    (function () {
      const helpBtn = document.querySelector('a[href="#help"]');
      const feedbackBtn = document.querySelector('a[href="#feedback"]');
      const helpModal = document.getElementById('help-modal');
      const feedbackModal = document.getElementById('feedback-modal');
      const closeBtns = document.querySelectorAll('[data-close-modal]');

      const open = (el) => {
        if (el) {
          el.classList.remove('hidden');
          document.body.classList.add('is-modal-open'); // 添加模态框打开状态类
        }
      };
      const close = (el) => {
        if (el) {
          el.classList.add('hidden');
          document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
        }
      };

      helpBtn?.addEventListener('click', (e) => { e.preventDefault(); open(helpModal); });
      feedbackBtn?.addEventListener('click', (e) => { e.preventDefault(); open(feedbackModal); });
      closeBtns.forEach(btn => btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-close-modal');
        const m = document.getElementById(id);
        close(m);
      }));

      // 点击遮罩关闭
      [helpModal, feedbackModal].forEach(m => m?.addEventListener('click', (e) => {
        if (e.target === m) {
          m.classList.add('hidden');
          document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
        }
      }));

      // ESC 关闭
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (helpModal && !helpModal.classList.contains('hidden')) {
            close(helpModal);
          } else if (feedbackModal && !feedbackModal.classList.contains('hidden')) {
            close(feedbackModal);
          }
        }
      });

      // 反馈提交（优先尝试接口，失败则回退到邮件客户端）
      const form = document.getElementById('feedback-form');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const payload = { message: data.message?.trim(), email: data.email?.trim() || '' };
        if (!payload.message) return alert('请填写反馈内容');

        try {
          const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error('bad status');
          alert('已收到你的反馈，感谢！');
          form.reset();
          close(feedbackModal);
        } catch (err) {
          const mailto = `mailto:support@podify.ai?subject=${encodeURIComponent('PodifyAI 用户反馈')}` +
                         `&body=${encodeURIComponent(payload.message + (payload.email ? `\n\n联系方式：${payload.email}` : ''))}`;
          window.location.href = mailto;
          close(feedbackModal);
        }
      });
    })();

    // --- 启动流程 ---
    checkLoginStatusAndSetupUI();

  });

  // ==================== 用户头像下拉菜单功能 ====================
  
  // 设置用户头像下拉菜单
  function setupUserDropdown(userProfileBtn, userDropdownMenu, accountSettingsBtn, dropdownLogoutBtn) {
    if (!userProfileBtn || !userDropdownMenu) return;
    
    // 切换下拉菜单显示/隐藏
    function toggleDropdown() {
      const isHidden = userDropdownMenu.classList.contains('hidden');
      if (isHidden) {
        userDropdownMenu.classList.remove('hidden');
        userProfileBtn.classList.add('active');
            } else {
        userDropdownMenu.classList.add('hidden');
        userProfileBtn.classList.remove('active');
      }
    }
    
    // 隐藏下拉菜单
    function hideDropdown() {
      userDropdownMenu.classList.add('hidden');
      userProfileBtn.classList.remove('active');
    }
    
    // 用户头像按钮点击事件
    userProfileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
    
    // 账户设置按钮点击事件
    if (accountSettingsBtn) {
      accountSettingsBtn.addEventListener('click', () => {
        hideDropdown();
        // 打开账户设置模态框
        const modal = document.getElementById('account-settings-modal');
        if (modal) {
          modal.classList.remove('hidden');
          document.body.classList.add('is-modal-open'); // 添加模态框打开状态类
          // 更新账户信息
          updateAccountSettingsModal();
        }
      });
    }
    
    // 退出账号按钮点击事件
    if (dropdownLogoutBtn) {
      dropdownLogoutBtn.addEventListener('click', async () => {
        hideDropdown();
        try {
          await fetch('/logout', { method: 'POST' });
          window.location.href = '/login';
    } catch (error) {
          console.error('退出登录失败:', error);
        }
      });
    }
    
    // 点击外部区域关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!userProfileBtn.contains(e.target) && !userDropdownMenu.contains(e.target)) {
        hideDropdown();
      }
    });
    
    // ESC键关闭下拉菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !userDropdownMenu.classList.contains('hidden')) {
        hideDropdown();
      }
    });
  }

  // ==================== 设置模态框功能 ====================

  // 更新设置模态框信息
  function updateSettingsModal() {
    // 已存在：加载 & 回显通用设置
    loadGeneralSettings();
    // 新增：订阅区与切页初始化
    initSettingsTabs();
    populateSubscriptionSection();
    initSubscriptionButtons();
    // 新增：初始化面板内保存按钮
    initPanelSaveButtons();
  }

  // ==================== 账户设置模态框功能 ====================

  // 更新账户设置模态框信息
  async function updateAccountSettingsModal() {
    try {
      const response = await fetch('/api/user/status');
      if (response.ok) {
        const data = await response.json();
        if (data.isLoggedIn) {
          // 更新用户信息
          const profileAvatar = document.getElementById('profile-avatar-display');
          const profileUsername = document.getElementById('profile-username');
          const profileEmail = document.getElementById('profile-email');
          const profileJoinDate = document.getElementById('profile-join-date');
          
          if (profileAvatar) {
            // 设置用户头像 - 优先使用保存的头像，否则使用用户名首字母
            if (data.user.avatar_path) {
              profileAvatar.style.backgroundImage = `url(${data.user.avatar_path})`;
              profileAvatar.style.backgroundSize = 'cover';
              profileAvatar.style.backgroundPosition = 'center';
              profileAvatar.style.backgroundRepeat = 'no-repeat';
              profileAvatar.textContent = '';
              profileAvatar.style.color = 'transparent';
            } else {
              profileAvatar.style.backgroundImage = '';
              profileAvatar.style.backgroundSize = '';
              profileAvatar.style.backgroundPosition = '';
              profileAvatar.style.backgroundRepeat = '';
              profileAvatar.style.color = '';
              profileAvatar.textContent = data.user.username.charAt(0).toUpperCase();
            }
          }
          if (profileUsername) {
            profileUsername.textContent = data.user.username;
          }
          if (profileEmail) {
            profileEmail.textContent = data.user.email || '未绑定';
          }
          if (profileJoinDate) {
            // 这里可以添加注册时间，如果后端提供的话
            profileJoinDate.textContent = data.user.created_at || '--';
          }
          
          // 更新两步验证状态
          const twoFactorStatus = document.getElementById('two-factor-status');
          if (twoFactorStatus) {
            const statusBadge = twoFactorStatus.querySelector('.status-badge');
            if (data.user.email && data.user.is_verified) {
            statusBadge.className = 'status-badge verified';
            statusBadge.textContent = '已启用';
          } else {
            statusBadge.className = 'status-badge disabled';
              statusBadge.textContent = '未启用';
            }
          }
        }
      }
    } catch (error) {
      console.error('更新账户设置信息失败:', error);
    }
  }

  // 初始化账户设置模态框事件
  function initAccountSettingsModal() {
    const accountModal = document.getElementById('account-settings-modal');
    const closeAccountModal = document.getElementById('close-account-settings-modal');
    const editProfileModal = document.getElementById('edit-profile-modal');
    const closeEditProfileModal = document.getElementById('close-edit-profile-modal');
    const changePasswordModal = document.getElementById('change-password-modal');
    const closeChangePasswordModal = document.getElementById('close-change-password-modal');
    
    // 关闭账户设置模态框
    closeAccountModal?.addEventListener('click', () => {
      accountModal?.classList.add('hidden');
      document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
    });

    // 点击模态框外部关闭
    accountModal?.addEventListener('click', (e) => {
      if (e.target === accountModal) {
        accountModal.classList.add('hidden');
        document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
      }
    });

    // ESC键关闭账户设置模态框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (accountModal && !accountModal.classList.contains('hidden')) {
          accountModal.classList.add('hidden');
          document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
        }
        if (editProfileModal && !editProfileModal.classList.contains('hidden')) {
          editProfileModal.classList.add('hidden');
        }
        if (changePasswordModal && !changePasswordModal.classList.contains('hidden')) {
          changePasswordModal.classList.add('hidden');
        }
      }
    });

    // 编辑个人信息按钮
    const editProfileBtn = document.getElementById('edit-profile-btn');
    editProfileBtn?.addEventListener('click', () => {
      // 获取当前用户信息并填充到编辑表单
      const currentUsername = document.getElementById('profile-username')?.textContent || '';
      const currentAvatar = document.getElementById('profile-avatar-display')?.textContent || 'U';
      
      document.getElementById('edit-username-input').value = currentUsername;
      document.getElementById('avatar-preview').textContent = currentAvatar;
      
      editProfileModal?.classList.remove('hidden');
      document.body.classList.add('is-modal-open'); // 添加模态框打开状态类
    });

    // 关闭编辑个人信息模态框
    closeEditProfileModal?.addEventListener('click', () => {
      editProfileModal?.classList.add('hidden');
      document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
    });

    editProfileModal?.addEventListener('click', (e) => {
      if (e.target === editProfileModal) {
        editProfileModal.classList.add('hidden');
        document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
      }
    });

    // 更换头像功能
    const changeAvatarBtn = document.getElementById('change-avatar-btn');
    const avatarUploadInput = document.getElementById('avatar-upload-input');
    
    changeAvatarBtn?.addEventListener('click', () => {
      avatarUploadInput?.click();
    });

    avatarUploadInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // 验证文件类型
        if (!file.type.startsWith('image/')) {
          showMessage('请选择图片文件', 'error');
          return;
        }
        
        // 验证文件大小 (2MB)
        if (file.size > 2 * 1024 * 1024) {
          showMessage('图片大小不能超过2MB', 'error');
          return;
        }
        
        // 预览头像
        const reader = new FileReader();
        reader.onload = (e) => {
          const avatarPreview = document.getElementById('avatar-preview');
          if (avatarPreview) {
            // 设置背景图片
            avatarPreview.style.backgroundImage = `url(${e.target.result})`;
            avatarPreview.style.backgroundSize = 'cover';
            avatarPreview.style.backgroundPosition = 'center';
            avatarPreview.style.backgroundRepeat = 'no-repeat';
            
            // 完全清除文字内容
            avatarPreview.textContent = '';
            
            // 移除可能的内联样式冲突，确保文字不可见
            avatarPreview.style.color = 'transparent';
            
            // 存储头像数据，用于保存时上传
            avatarPreview.dataset.avatarData = e.target.result;
            avatarPreview.dataset.hasNewAvatar = 'true';
          }
        };
        reader.readAsDataURL(file);
        
        showMessage('头像已选择，点击保存以应用更改', 'info');
      }
    });

    // 取消编辑个人信息
    const cancelProfileEdit = document.getElementById('cancel-profile-edit');
    cancelProfileEdit?.addEventListener('click', () => {
      editProfileModal?.classList.add('hidden');
    });

    // 保存个人信息
    const saveProfileBtn = document.getElementById('save-profile-btn');
    saveProfileBtn?.addEventListener('click', async () => {
      const newUsername = document.getElementById('edit-username-input')?.value.trim();
      const avatarPreview = document.getElementById('avatar-preview');
      const hasNewAvatar = avatarPreview?.dataset.hasNewAvatar === 'true';
      
      if (!newUsername) {
        showMessage('用户名不能为空', 'error');
        return;
      }
      
      if (newUsername.length < 2 || newUsername.length > 20) {
        showMessage('用户名长度应在2-20个字符之间', 'error');
        return;
      }
      
      try {
        setBtnLoading(saveProfileBtn, '保存中...');
        
        // 构建要保存的数据
        const updateData = {
          username: newUsername
        };
        
        if (hasNewAvatar) {
          updateData.avatar = avatarPreview.dataset.avatarData;
        }
        
        // 这里添加保存用户信息的API调用
        // 实际项目中应该调用真实的API
        let response;
        let useMockResponse = false;
        
        try {
          response = await fetch('/api/user/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          });
          
          // 检查响应内容类型，如果不是JSON则使用模拟响应
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            console.warn('API返回非JSON响应，使用模拟响应');
            useMockResponse = true;
          }
          
        } catch (fetchError) {
          // 如果API不存在或网络错误，使用模拟响应
          console.warn('API调用失败，使用模拟响应:', fetchError);
          useMockResponse = true;
        }
        
        // 统一的界面更新函数
        const updateUserInterface = () => {
          const profileUsername = document.getElementById('profile-username');
          const profileAvatar = document.getElementById('profile-avatar-display');
          const sidebarAvatar = document.getElementById('user-avatar'); // 侧边栏头像
          
          // 更新用户名
          if (profileUsername) profileUsername.textContent = newUsername;
          
          // 更新头像显示 - 确保文字完全清除
          const updateAvatarElement = (element, avatarData, hasNewAvatar) => {
            if (!element) return;
            
            if (hasNewAvatar && avatarData) {
              // 设置背景图片
              element.style.backgroundImage = `url(${avatarData})`;
              element.style.backgroundSize = 'cover';
              element.style.backgroundPosition = 'center';
              element.style.backgroundRepeat = 'no-repeat';
              // 完全清除文字内容
              element.textContent = '';
              // 移除可能的内联样式冲突
              element.style.color = 'transparent';
            } else {
              // 清除背景图片，显示文字头像
              element.style.backgroundImage = '';
              element.style.backgroundSize = '';
              element.style.backgroundPosition = '';
              element.style.backgroundRepeat = '';
              element.style.color = '';
              element.textContent = newUsername.charAt(0).toUpperCase();
            }
          };
          
          // 更新账户设置中的头像
          if (profileAvatar) {
            updateAvatarElement(profileAvatar, avatarPreview.dataset.avatarData, hasNewAvatar);
          }
          
          // 更新侧边栏头像
          if (sidebarAvatar) {
            console.log('找到侧边栏头像元素:', sidebarAvatar);
            updateAvatarElement(sidebarAvatar, avatarPreview.dataset.avatarData, hasNewAvatar);
          } else {
            console.warn('未找到侧边栏头像元素 (id="user-avatar")');
          }
          
          // 更新其他可能显示用户名的地方（使用更精确的选择器）
          const additionalAvatarSelectors = [
            '[id="user-avatar"]',
            '[id="profile-avatar-display"]',
            '[id*="user-avatar"]',
            '[id*="profile-avatar"]'
          ];
          
          additionalAvatarSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
              if (element.id !== 'avatar-preview') {
                updateAvatarElement(element, avatarPreview.dataset.avatarData, hasNewAvatar);
              }
            });
          });
          
          // 清除头像数据
          if (avatarPreview) {
            delete avatarPreview.dataset.avatarData;
            delete avatarPreview.dataset.hasNewAvatar;
          }
        };

        if (response.ok && !useMockResponse) {
          // 真实API调用成功
          updateUserInterface();
          showMessage('个人信息已更新', 'success');
          editProfileModal?.classList.add('hidden');
          
        } else if (useMockResponse) {
          // 使用模拟响应，直接更新界面
          console.log('使用模拟响应更新用户信息:', updateData);
          updateUserInterface();
          showMessage('个人信息已更新（模拟模式）', 'success');
          editProfileModal?.classList.add('hidden');
          
        } else {
          // 真实API调用失败
          let errorMessage = '保存失败';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (jsonError) {
            console.warn('无法解析错误响应:', jsonError);
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }
        
      } catch (error) {
        showMessage(error.message || '保存失败，请重试', 'error');
        console.error('保存个人信息失败:', error);
      } finally {
        resetBtn(saveProfileBtn);
      }
    });

    // 修改密码按钮
    const modifyPasswordBtn = document.getElementById('modify-password-btn');
    modifyPasswordBtn?.addEventListener('click', () => {
      // 清空密码表单
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-new-password').value = '';
      
      changePasswordModal?.classList.remove('hidden');
      document.body.classList.add('is-modal-open'); // 添加模态框打开状态类
    });

    // 关闭修改密码模态框
    closeChangePasswordModal?.addEventListener('click', () => {
      changePasswordModal?.classList.add('hidden');
      document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
    });

    changePasswordModal?.addEventListener('click', (e) => {
      if (e.target === changePasswordModal) {
        changePasswordModal.classList.add('hidden');
        document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
      }
    });

    // 取消修改密码
    const cancelPasswordChange = document.getElementById('cancel-password-change');
    cancelPasswordChange?.addEventListener('click', () => {
      changePasswordModal?.classList.add('hidden');
      document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
    });

    // 保存新密码
    const savePasswordBtn = document.getElementById('save-password-btn');
    savePasswordBtn?.addEventListener('click', async () => {
      const currentPassword = document.getElementById('current-password')?.value;
      const newPassword = document.getElementById('new-password')?.value;
      const confirmNewPassword = document.getElementById('confirm-new-password')?.value;
      
      if (!currentPassword) {
        showMessage('请输入当前密码', 'error');
        return;
      }
      
      if (!newPassword) {
        showMessage('请输入新密码', 'error');
        return;
      }
      
      if (newPassword.length < 8) {
        showMessage('新密码长度至少8位', 'error');
        return;
      }
      
      if (newPassword !== confirmNewPassword) {
        showMessage('两次输入的新密码不一致', 'error');
        return;
      }
      
      if (currentPassword === newPassword) {
        showMessage('新密码不能与当前密码相同', 'error');
        return;
      }

      try {
        setBtnLoading(savePasswordBtn, '修改中...');
        
        // 这里添加修改密码的API调用
        const response = await fetch('/api/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword
          })
        });
        
        if (response.ok) {
          showMessage('密码修改成功', 'success');
          changePasswordModal?.classList.add('hidden');
          document.body.classList.remove('is-modal-open'); // 移除模态框打开状态类
        } else {
          const data = await response.json();
          showMessage(data.error || '密码修改失败', 'error');
        }
        
      } catch (error) {
        showMessage('网络错误，请稍后重试', 'error');
        console.error('修改密码失败:', error);
      } finally {
        resetBtn(savePasswordBtn);
      }
    });

    // 退出登录按钮
    const accountLogoutBtn = document.getElementById('account-logout-btn');
    accountLogoutBtn?.addEventListener('click', async () => {
      if (confirm('确定要退出登录吗？')) {
        try {
          await fetch('/logout', { method: 'POST' });
          window.location.href = '/login';
        } catch (error) {
          console.error('退出登录失败:', error);
          showMessage('退出登录失败，请重试', 'error');
        }
      }
    });
  }
  
  // 加载通用设置
  function loadGeneralSettings() {
    // 主题设置
    const themeSelect = document.getElementById('theme-select');
    const savedThemeRaw = localStorage.getItem('theme-preference') || 'system';
    const savedTheme = (savedThemeRaw === 'auto') ? 'system' : savedThemeRaw; // 兼容旧值
    if (themeSelect) {
      themeSelect.value = savedTheme;
    }
    
    // 侧边栏设置
    const sidebarSelect = document.getElementById('sidebar-select');
    const savedSidebar = localStorage.getItem('sidebar-preference') || 'expanded';
    if (sidebarSelect) {
      sidebarSelect.value = savedSidebar;
      applySidebarSettings(savedSidebar);
    }
    
    // 自动播放设置
    const autoPlayToggle = document.getElementById('auto-play-toggle');
    const savedAutoPlay = localStorage.getItem('auto-play-enabled') === 'true';
    if (autoPlayToggle) {
      autoPlayToggle.checked = savedAutoPlay;
    }
    
    // 默认音量设置
    const defaultVolume = document.getElementById('default-volume');
    const volumeDisplay = document.getElementById('default-volume-value');
    const savedVolume = localStorage.getItem('default-volume') || '100';
    if (defaultVolume) defaultVolume.value = savedVolume;
    if (volumeDisplay) volumeDisplay.textContent = savedVolume + '%';
    defaultVolume?.addEventListener('input', (e) => {
      if (volumeDisplay) volumeDisplay.textContent = e.target.value + '%';
    });
    

  }
  
  // 保存通用设置
  function saveGeneralSettings() {
    try {
      // 保存主题设置
      const themeSelect = document.getElementById('theme-select');
      if (themeSelect) {
        const themeVal = themeSelect.value === 'auto' ? 'system' : themeSelect.value;
        localStorage.setItem('theme-preference', themeVal);
        applyThemeSettings(themeVal);
      }
      
      // 保存侧边栏设置
      const sidebarSelect = document.getElementById('sidebar-select');
      if (sidebarSelect) {
        localStorage.setItem('sidebar-preference', sidebarSelect.value);
        applySidebarSettings(sidebarSelect.value);
      }
      
      // 保存自动播放设置
      const autoPlayToggle = document.getElementById('auto-play-toggle');
      if (autoPlayToggle) {
        localStorage.setItem('auto-play-enabled', autoPlayToggle.checked);
      }
      
      // 保存默认音量设置
      const defaultVolume = document.getElementById('default-volume');
      if (defaultVolume) {
        localStorage.setItem('default-volume', defaultVolume.value);
        // 立即应用到当前播放器
        const volumeValue = parseFloat(defaultVolume.value) / 100;
        playerManager?.setVolume(volumeValue);
      }
      

            
      showMessage('设置已保存', 'success');
      
      // 保存成功后自动关闭设置面板
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal) {
        settingsModal.classList.add('hidden');
      }
      
      } catch (error) {
      console.error('保存设置失败:', error);
      showMessage('保存设置失败', 'error');
    }
  }
  
  // 应用主题设置
  function applyThemeSettings(theme) {
    // 兼容旧值'auto'
    const t = (theme === 'auto') ? 'system' : theme;
    if (t === 'light') {
      document.documentElement.classList.remove('dark', 'auto-theme');
    } else if (t === 'dark') {
      document.documentElement.classList.remove('auto-theme');
      document.documentElement.classList.add('dark');
    } else { // 'system'
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('auto-theme'); // 深/浅由 CSS + 媒体查询接管
      // 立即与系统同步一次（可选，保证切换瞬间也对）
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }

  // 应用侧边栏设置
  function applySidebarSettings(preference) {
    const sidebar = document.querySelector('.lh-sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    if (!sidebar) return;
    
    switch (preference) {
      case 'collapsed':
        sidebar.classList.add('is-collapsed');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        break;
      case 'expanded':
        sidebar.classList.remove('is-collapsed');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
        break;
      case 'auto':
        // 根据屏幕宽度自动决定
        const shouldCollapse = window.innerWidth < 1024;
        if (shouldCollapse) {
          sidebar.classList.add('is-collapsed');
          if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
      } else {
          sidebar.classList.remove('is-collapsed');
          if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
        }
        break;
    }
  }

  // 加载并应用所有设置
  function loadAndApplyAllSettings() {
    // 主题设置
    const savedThemeRaw2 = localStorage.getItem('theme-preference') || 'system';
    const savedTheme2 = (savedThemeRaw2 === 'auto') ? 'system' : savedThemeRaw2;
    applyThemeSettings(savedTheme2);
    
    // 为system主题模式添加系统主题监听
    if (savedTheme2 === 'system') {
      const systemThemeListener = (e) => {
        if (document.documentElement.classList.contains('auto-theme')) {
          if (e.matches) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
      };
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', systemThemeListener);
    }
    
    // 侧边栏设置
    const savedSidebar = localStorage.getItem('sidebar-preference') || 'expanded';
    applySidebarSettings(savedSidebar);
    
    // 监听窗口大小变化，用于auto模式的侧边栏
    if (savedSidebar === 'auto') {
      const autoResizeListener = () => applySidebarSettings('auto');
      window.addEventListener('resize', autoResizeListener);
    }
    
    // 注意：音量和自动播放设置会在各自的初始化函数中处理
  }

  // ==================== 两列式设置：切换分组 ====================
  
  // ---------- 两列式设置：切换分组 ----------
  function initSettingsTabs(){
    const catItems = document.querySelectorAll('.settings-cat-item');
    const panels = document.querySelectorAll('.settings-panel');

    catItems.forEach(btn=>{
      btn.addEventListener('click',()=>{
        const target = btn.dataset.target;
        // 左侧激活
        catItems.forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        // 右侧面板
        panels.forEach(p=>{
          p.classList.toggle('hidden', p.id !== target);
        });
        
        // 切换到订阅面板时自动刷新积分
        if (target === 'billing-panel') {
          refreshCreditsDisplay();
        }
      });
    });
    
    // 注入后的首屏拉回顶部
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ---------- 订阅区：从后端拉取积分与计划（修正版，默认免费版） ----------
  async function populateSubscriptionSection(){
    try{
      const res = await fetch('/api/user/status', { credentials: 'include' });
      if(!res.ok) return;
      const data = await res.json();
      if(!data.isLoggedIn) return;

      const planLabelEl = document.getElementById('settings-plan-label');
      const creditEl    = document.getElementById('settings-credit-balance');

      // 计划映射：默认 free → 免费版
      const PLAN_LABELS = { free: '免费版', lite: '创作者', pro: '专业版' };

      // 使用统一的套餐解析函数
      const plan = extractPlanFromStatus(data);
      const label = PLAN_LABELS[plan] || '免费版';

      if (planLabelEl) planLabelEl.textContent = label;
      
      // 修复积分显示：从 data.user.credits 获取积分
      if (creditEl) {
        const credits = data.user?.credits ?? 0;
        creditEl.textContent = credits.toString();
      }

      // 根据用户套餐动态调整按钮显示
      const upgradeBtn = document.getElementById('settings-upgrade-btn');
      const manageRow = document.getElementById('settings-manage-subscription-row');
      
      if (upgradeBtn) {
        if (plan === 'pro') {
          // 专业版用户：将"升级"按钮替换为"管理订阅"
          upgradeBtn.textContent = '管理订阅';
          upgradeBtn.className = 'btn-secondary';
          upgradeBtn.onclick = () => {
            // 调用管理订阅功能
            if (typeof openBillingPortal === 'function') {
              openBillingPortal();
            }
          };
          
          // 隐藏下面重复的"管理订阅"按钮行
          if (manageRow) {
            manageRow.style.display = 'none';
          }
        } else {
          // 非专业版用户：显示"升级"按钮
          upgradeBtn.textContent = '升级';
          upgradeBtn.className = 'btn-primary';
          upgradeBtn.onclick = () => {
            // 复用原有的升级逻辑
            if (typeof openBilling === 'function') {
              openBilling();
              setTimeout(() => {
                refreshCreditsDisplay();
              }, 1000);
            } else {
              showMessage('即将开放在线订阅，请联系管理员开通', 'info');
            }
          };
          
          // 显示下面的"管理订阅"按钮行（如果用户是 lite）
          if (manageRow) {
            manageRow.style.display = (plan === 'lite') ? 'block' : 'none';
          }
        }
      }

      // 统一调用 renderPlanUI 来管理订阅状态
      renderPlanUI(plan);
    }catch(e){ console.error(e); }
  }

  // "升级"和"充值"按钮
  function initSubscriptionButtons(){
    // 注意：升级按钮的点击事件现在在 populateSubscriptionSection 中动态设置
    // 这里只处理充值按钮

    document.getElementById('settings-buy-credits')?.addEventListener('click', ()=>{
      if(typeof openBilling === 'function'){ 
        openBilling('credits'); 
        // 充值操作后延迟刷新积分显示
        setTimeout(() => {
          refreshCreditsDisplay();
        }, 1000);
      }
      else{
        showMessage('即将开放充值，请联系管理员', 'info');
      }
    });
  }

  // 实时刷新积分显示
  async function refreshCreditsDisplay() {
    try {
      const res = await fetch('/api/user/status', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.isLoggedIn) return;

      // 获取积分值
      const credits = data.user?.credits ?? 0;

      // 更新设置面板中的积分显示
      const creditEl = document.getElementById('settings-credit-balance');
      if (creditEl) {
        creditEl.textContent = credits.toString();
      }

      // 同时更新侧边栏积分徽章
      const sidebarBadge = document.getElementById('credits-badge');
      if (sidebarBadge) {
        sidebarBadge.textContent = credits.toString();
      }
    } catch (e) {
      console.error('刷新积分显示失败:', e);
    }
  }

  // 初始化面板内保存按钮
  function initPanelSaveButtons() {
    // 界面设置保存按钮
    document.getElementById('save-ui-settings')?.addEventListener('click', () => {
      saveGeneralSettings();
    });
    
    // 播放设置保存按钮
    document.getElementById('save-playback-settings')?.addEventListener('click', () => {
      saveGeneralSettings();
    });
  }

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

  // 轻路由：支持前进/后退
  function navigateToHistoryDetail(id) {
    // 更新地址（可直接用 hash，简单耐用）
    location.hash = `#history/${id}`;
  }

  window.addEventListener('hashchange', routeFromHash);
  document.addEventListener('DOMContentLoaded', routeFromHash);

  function routeFromHash() {
    console.log('路由处理中，当前hash:', location.hash);
    // 修复：兼容有无前导斜杠的两种格式
    const m = location.hash.match(/^#\/?history\/([a-zA-Z0-9-]+)$/);
    if (m) {
      const id = m[1];
      console.log('匹配到历史详情路由，ID:', id);
      openHistoryDetail(id);
    } else {
      console.log('回到主页');
      // 回到主页
      showPage('home');
    }
  }

    function showPage(which) {
    const home   = getHomeEl();
    const detail = getDetailEl();

    // 只操作 class，不直接修改 style
    if (which === 'detail') {
      home?.classList.add('hidden');
      detail?.classList.remove('hidden');
    } else {
      detail?.classList.add('hidden');
      home?.classList.remove('hidden');
    }
  }

  // 拉取详情 + 渲染
  async function openHistoryDetail(id) {
    console.log('开始加载历史详情，ID:', id);
    try {
      const res = await fetch(`/api/history/${id}`, { credentials: 'include' });
      const json = await res.json();
      console.log('API响应:', json);
      if (!json.ok) throw new Error(json.error || '加载失败');
      
      // 先切换到详情页
      showPage('detail');
      
      // 等待页面切换完成后再渲染内容
      requestAnimationFrame(() => {
        renderHistoryDetail(json.data);
      });
      
    } catch (err) {
      console.error('加载详情失败:', err);
      showMessage('加载详情失败', 'error');
      // 新增：如果失败，回退到主页
      location.hash = '';
    }
  }

  // 获取来源提示信息
  function getSourceTooltip(sourceType, sourceTitle, sourceUrl) {
    switch (sourceType) {
      case 'url':
        return `链接: ${sourceTitle || sourceUrl || '外部网页'} (点击跳转)`;
      case 'pdf':
        return `PDF文件: ${sourceTitle || '文档'} (点击打开)`;
      case 'text':
        return `文本输入: ${sourceTitle || '手动输入'} (点击查看原始文本)`;
      case 'manual':
        return `手动输入: ${sourceTitle || '用户输入'} (点击查看原始文本)`;
      default:
        return `原始输入内容: ${sourceTitle || '手动输入'} (点击查看原始文本)`;
    }
  }

  // 处理信息来源点击
  function handleSourceClick(sourceType, sourceUrl, sourceContent, item = null) {
    console.log('🔍 handleSourceClick 被调用:', { sourceType, sourceUrl, sourceContent });
    
    switch (sourceType) {
      case 'url':
        if (sourceUrl) {
          console.log('🌐 打开URL:', sourceUrl);
          window.open(sourceUrl, '_blank', 'noopener,noreferrer');
        } else {
          console.warn('⚠️ URL为空，无法跳转');
        }
        break;
      case 'pdf':
        if (sourceUrl) {
          console.log('📄 打开PDF:', sourceUrl);
          // 对于PDF文件，直接在新窗口打开
          window.open(sourceUrl, '_blank', 'noopener,noreferrer');
        } else {
          console.warn('⚠️ PDF路径为空，无法打开');
          // 如果没有PDF路径，显示原始内容
          showSourceContent(sourceContent, item);
        }
        break;
      case 'text':
      case 'manual':
      default:
        console.log('📝 显示文本内容');
        showSourceContent(sourceContent, item);
        break;
    }
  }

  // 显示来源内容在右侧边栏
  function showSourceContent(content, item = null) {
    let sidebar = document.getElementById('source-sidebar');
    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.id = 'source-sidebar';
      sidebar.className = 'source-sidebar';
      document.body.appendChild(sidebar);
    }
    
    // 处理内容显示
    let displayContent = content;
    if (!content || content === '暂无原始输入内容') {
      // 如果没有原始输入内容，只显示提示信息，不显示脚本预览
      displayContent = '⚠️ 系统提示：此音频没有保存原始输入内容\n\n🔍 可能的原因：\n1. 这是历史数据，在添加原始输入保存功能之前创建\n2. 系统升级后，新创建的音频将自动保存原始输入\n3. 数据字段不匹配\n\n💡 建议：\n- 新创建的音频将自动保存原始输入内容\n- 历史数据暂时无法显示原始输入';
    } else {
      // 如果有原始输入内容，只显示原始输入内容
      displayContent = '📝 原始输入内容：\n\n' + content;
    }
    
    sidebar.innerHTML = `
      <div class="sidebar-header">
        <h3>原始输入内容</h3>
        <button class="close-sidebar" id="btn-close-sidebar">×</button>
      </div>
      <div class="sidebar-content">
        <pre>${displayContent}</pre>
      </div>
    `;
    
    // 确保关闭按钮事件绑定
    const closeBtn = sidebar.querySelector('#btn-close-sidebar');
    if (closeBtn) {
      // 移除之前的事件监听器（如果有）
      closeBtn.replaceWith(closeBtn.cloneNode(true));
      const newCloseBtn = sidebar.querySelector('#btn-close-sidebar');
      
      newCloseBtn.addEventListener('click', () => {
        console.log('🔍 侧边栏关闭按钮被点击（动态绑定）');
        closeSourceSidebar();
      });
      console.log('✅ 侧边栏关闭按钮事件已重新绑定');
    }
    
    sidebar.classList.add('show');
  }

  // 关闭来源内容边栏
  function closeSourceSidebar() {
    const sidebar = document.getElementById('source-sidebar');
    if (sidebar) {
      sidebar.classList.remove('show');
      console.log('✅ 侧边栏已关闭');
    } else {
      console.error('❌ 侧边栏元素未找到');
    }
  }

  function renderHistoryDetail(item) {
    console.log('开始渲染详情页，数据:', item);
    const el = getDetailEl();
    if (!el) {
      console.error('❌ 无法渲染：详情页容器不存在');
      // fallback: 动态创建容器（可选，但最好在 HTML 预置）
      const fallbackEl = document.createElement('div');
      fallbackEl.id = 'route-history-detail';
      fallbackEl.className = 'page hidden';
      document.querySelector('.content-rail')?.appendChild(fallbackEl); // 假设有 .content-rail
      console.log('🔧 已创建备用容器');
      el = fallbackEl;
    }

    // 检查数据字段
    console.log('数据字段检查:', {
      title: item.title,
      script_full_length: item.script_full ? item.script_full.length : 0,
      script_full_preview: item.script_full ? item.script_full.substring(0, 100) + '...' : 'null',
      audio_filename: item.audio_filename,
      mode: item.mode,
      voice_name: item.voice_name,
      duration: item.duration,
      play_count: item.play_count,
      timestamp: item.timestamp,
      thumbnail_filename: item.thumbnail_filename,
      source_url: item.source_url,
      source_title: item.source_title,
      source_type: item.source_type,
      // 添加可能的原始输入字段
      input_text: item.input_text,
      original_text: item.original_text,
      source_content: item.source_content,
      user_input: item.user_input,
      raw_text: item.raw_text,
      prompt: item.prompt,
      // 显示所有可用字段
      allFields: Object.keys(item)
    });

    const title = (item.title && item.title.trim()) || '新作品';
    const duration = item.duration ? formatDuration(item.duration) : '未知';          // 你现有的格式函数
    const when = item.timestamp ? new Date(item.timestamp).toLocaleString() : '未知时间';
    const src = item.thumbnail_filename
      ? `/static/card-thumbnail/${item.thumbnail_filename}`
      : '/static/card-thumbnail/1.jpg';
    
    // 安全处理脚本内容
    let safeScriptContent = '';
    if (item.script_full && typeof item.script_full === 'string') {
      // 移除可能的控制字符和特殊格式
      safeScriptContent = item.script_full
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 移除控制字符
        .replace(/\r\n/g, '\n') // 统一换行符
        .trim();
      console.log('脚本内容处理完成，长度:', safeScriptContent.length);
    } else {
      safeScriptContent = '暂无脚本内容';
      console.log('脚本内容为空或格式错误');
    }

    const sourceLabel =
      item.source_type === 'url' ? (item.source_title || item.source_url || '外部链接')
      : item.source_type === 'pdf' ? (item.source_title || 'PDF 文件')
      : '手动输入';

    // 用于播放器：尝试找到该音频在 playlist 中的索引
    let trackIndex = -1;
    if (playerManager && Array.isArray(playerManager.playlist)) {
      trackIndex = playerManager.playlist.findIndex(t => t.audio_filename === item.audio_filename);
    }

    const htmlContent = `
      <div class="history-detail-container">
        <button class="detail-back-btn" id="btn-back-library">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          返回资料库
        </button>

        <div class="detail-header">
          <img src="${src}" alt="封面图" class="detail-thumbnail" />
          <div class="detail-content">
            <h1 class="detail-title">${escapeHtml(title)}</h1>
            
            <div class="detail-metadata">
              <div class="metadata-item">
                <svg t="1756629621057" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7655" width="24" height="24"><path d="M578.730667 133.461333a128 128 0 0 0-133.461334 0l-213.333333 130.346667a127.914667 127.914667 0 0 0-43.861333 44.8l321.109333 187.349333 2.56 1.578667c0.768-0.554667 1.621333-1.066667 2.474667-1.578667l321.578666-187.605333a127.914667 127.914667 0 0 0-43.733333-44.544l-213.333333-130.346667zM173.013333 348.586667A128 128 0 0 0 170.666667 373.034667v277.930666a128 128 0 0 0 61.269333 109.226667l213.333333 130.346667c13.824 8.448 28.885333 14.08 44.330667 16.810666v-374.058666a48 48 0 0 1-1.28-0.725334l-315.306667-183.893333z m362.112 183.893333a43.392 43.392 0 0 1-3.712 1.962667v373.333333c16.469333-2.517333 32.597333-8.277333 47.36-17.28l213.333334-130.346667A128 128 0 0 0 853.333333 650.965333V373.034667c0-8.362667-0.853333-16.64-2.389333-24.704l-315.818667 184.234666zM422.997333 97.109333a170.666667 170.666667 0 0 1 178.005334 0l213.333333 130.346667A170.666667 170.666667 0 0 1 896 373.034667v277.930666a170.666667 170.666667 0 0 1-81.664 145.621334l-213.333333 130.346666a170.666667 170.666667 0 0 1-178.005334 0l-213.333333-130.346666A170.666667 170.666667 0 0 1 128 650.965333V373.034667A170.666667 170.666667 0 0 1 209.664 227.413333l213.333333-130.346666z" fill="#2c2c2c" fill-opacity=".65" p-id="7656"></path></svg>
                <span>${item.mode || '未知'}</span>
              </div>
              <span class="metadata-divider">·</span>
              <div class="metadata-item">
               <svg t="1756629688839" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8861" width="24" height="24"><path d="M743.125333 280.874667v462.250666H650.666667V280.874667h92.458666z m-369.792 0v462.250666H280.874667V280.874667H373.333333z m-184.874666 138.666666v184.917334H96V419.541333h92.458667z m739.541333 0v184.917334h-92.458667V419.541333h92.458667z m-369.792-277.333333v739.584h-92.416V142.208h92.416z" fill="#2c2c2c" p-id="8862"></path></svg>
                <span>${item.voice_name || '未知'}</span>
              </div>
              <span class="metadata-divider">·</span>
              <div class="metadata-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12,6 12,12 16,14"/>
                </svg>
                <span>${duration}</span>
              </div>
              <span class="metadata-divider">·</span>
              <div class="metadata-item">
                <svg t="1756629787519" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10082" width="24" height="24"><path d="M50.176 563.2c0-254.464 206.336-460.8 460.8-460.8s460.8 206.336 460.8 460.8v247.296c0 63.488-51.712 115.2-115.2 115.2h-57.344c-63.488 0-115.2-51.712-115.2-115.2v-172.544c0-63.488 51.712-115.2 115.2-115.2h88.064c-20.48-189.952-181.248-337.92-376.32-337.92-195.584 0-356.352 147.968-376.32 337.92h88.064c63.488 0 115.2 51.712 115.2 115.2v172.544c0 63.488-51.712 115.2-115.2 115.2H165.376c-63.488 0-115.2-51.712-115.2-115.2V563.2z m839.168 41.984H798.72c-17.92 0-32.768 14.848-32.768 32.768v172.544c0 17.92 14.848 32.768 32.768 32.768h57.344c17.92 0 32.768-14.848 32.768-32.768v-205.312z m-756.736 0v205.312c0 17.92 14.848 32.768 32.768 32.768h57.344c17.92 0 32.768-14.848 32.768-32.768v-172.544c0-17.92-14.848-32.768-32.768-32.768H132.608z m0 0" p-id="10083"></path></svg>
                <span>${item.play_count ?? 0}</span>
              </div>
              <span class="metadata-divider">·</span>
              <div class="metadata-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <span class="source-info" 
                      data-source-type="${item.input_type || item.source_type || 'text'}" 
                      data-source-url="${item.source_url || (item.input_type === 'url' ? item.original_input : (item.input_type === 'pdf' ? item.source_url : ''))}" 
                      data-source-title="${item.source_title || ''}"
                      data-source-content="${item.original_input || item.prompt || item.input || item.text || item.content || item.raw_input || item.user_prompt || item.original_prompt || item.input_text || item.original_text || item.source_content || item.user_input || item.raw_text || '暂无原始输入内容'}"
                      title="${getSourceTooltip(item.input_type || item.source_type, item.source_title, item.source_url || (item.input_type === 'url' ? item.original_input : (item.input_type === 'pdf' ? item.source_url : '')))}"
                      style="cursor: pointer; text-decoration: underline; color: var(--accent);">
                  信息来源
                </span>
              </div>
            </div>

            <div class="detail-actions">
              <button class="detail-action-btn" id="btn-play-detail">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
                ${trackIndex >= 0 ? '播放' : '播放'}
              </button>
              <a class="detail-action-btn" href="/history_audio/${encodeURIComponent(item.audio_filename)}" download>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7,10 12,15 17,10"/>
                  <line x1="12" x2="12" y1="15" y2="3"/>
                </svg>
                下载
              </a>
              <button class="detail-action-btn" id="btn-copy-script">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                复制
              </button> 
            </div>
          </div>
        </div>

        <div class="detail-script-section">
          <h2 class="detail-script-title">脚本内容:</h2>
          <div class="detail-script-content">${escapeHtml(safeScriptContent)}</div>
        </div>
      </div>
      
      <!-- 信息来源侧边栏 -->
      <div id="source-sidebar" class="source-sidebar">
        <div class="sidebar-header">
          <h3>原始输入内容</h3>
          <button class="close-sidebar" id="btn-close-sidebar">×</button>
        </div>
        <div id="source-content" class="sidebar-content">
          <pre>点击"信息来源"查看原始输入内容</pre>
        </div>
      </div>
    `;
    
    console.log('准备设置的HTML内容长度:', htmlContent.length);
    console.log('HTML内容预览:', htmlContent.substring(0, 200) + '...');
    console.log('设置前的容器内容:', el.innerHTML);
    
    try {
      // 更安全、更稳定的注入方式
      const tpl = document.createElement('template');
      tpl.innerHTML = htmlContent.trim();

      // 清空并替换子树（避免局部拼接的奇怪状态）
      el.replaceChildren(tpl.content.cloneNode(true));


      

      
      console.log('✅ 详情页节点已挂载：', el.childElementCount, '个直系子节点');
      

      
    } catch (error) {
      console.error('❌ HTML内容设置失败:', error);
      // 尝试设置简单的测试内容
      el.innerHTML = '<div style="padding:20px;background:#f0f0f0;border:2px solid red;"><h2>内容设置失败</h2><p>错误: ' + error.message + '</p></div>';
    }
    

    


    // 交互绑定
    el.querySelector('#btn-back-library')?.addEventListener('click', () => {
      location.hash = '#history-library'; // 或清空 hash 返回主页
      showPage('home');
    });

    el.querySelector('#btn-toggle-fold')?.addEventListener('click', () => {
      const pre = el.querySelector('#script-body');
      if (!pre) return;
      const folded = pre.style.maxHeight;
      pre.style.maxHeight = folded ? '' : '420px';
      pre.style.overflow = folded ? '' : 'auto';
    });

    el.querySelector('#btn-copy-script')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(safeScriptContent);
        showMessage('已复制脚本');
      } catch { showMessage('复制失败', 'error'); }
    });

    el.querySelector('#btn-copy-link')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.source_url || '');
        showMessage('已复制来源链接');
      } catch { showMessage('复制失败', 'error'); }
    });

    el.querySelector('#btn-play-detail')?.addEventListener('click', () => {
      if (trackIndex >= 0) {
        // 如果已经在播放列表中，使用播放管理器
        playerManager.playTrackAtIndex(trackIndex);
      } else {
        // 临时单曲播放，先停止当前播放
        if (playerManager.isPlaying) {
          playerManager.audio.pause();
          playerManager.isPlaying = false;
          playerManager.updateUI();
        }
        
        // 设置新的音频源并播放
        playerManager.audio.src = `/history_audio/${item.audio_filename}`;
        
        // 自动 seek 到首音到达时间（留 50ms 保护余量）
        const seekToOnset = () => {
          try {
            const onsetMs = Number(item?.speech_onset_ms || 0);
            if (onsetMs > 0 && !isNaN(onsetMs)) {
              const t = Math.max(0, onsetMs/1000 - 0.05); // 留 50ms 保护余量
              if (playerManager.audio.currentTime < t) playerManager.audio.currentTime = t;
            }
          } catch {}
        };
        playerManager.audio.addEventListener('loadedmetadata', seekToOnset, { once: true });
        playerManager.audio.addEventListener('play', seekToOnset, { once: true });
        
        playerManager.audio.play().then(() => {
          document.getElementById('global-player')?.classList.remove('hidden');
          playerManager.isPlaying = true;
          playerManager.updateUI();
          console.log('✅ 详情页音频开始播放');
        }).catch(error => {
          console.error('❌ 播放失败:', error);
          showMessage('播放失败', 'error');
        });
      }
    });

    // 添加信息来源点击事件
    el.querySelector('.source-info')?.addEventListener('click', (e) => {
      const sourceType = e.target.dataset.sourceType;
      const sourceUrl = e.target.dataset.sourceUrl;
      const sourceContent = e.target.dataset.sourceContent;
      
      // 添加调试信息
      console.log('信息来源点击事件:', {
        sourceType,
        sourceUrl,
        sourceContent,
        contentLength: sourceContent ? sourceContent.length : 0,
        // 显示所有数据字段的值
        allDataFields: {
          prompt: e.target.dataset.sourceContent,
          input: e.target.dataset.sourceContent,
          text: e.target.dataset.sourceContent,
          content: e.target.dataset.sourceContent,
          raw_input: e.target.dataset.sourceContent,
          user_prompt: e.target.dataset.sourceContent,
          original_prompt: e.target.dataset.sourceContent,
          input_text: e.target.dataset.sourceContent,
          original_text: e.target.dataset.sourceContent,
          source_content: e.target.dataset.sourceContent,
          user_input: e.target.dataset.sourceContent,
          raw_text: e.target.dataset.sourceContent
        }
      });
      
      // 手动输出完整的数据字段检查
      console.log('🔍 手动数据字段检查:', {
        title: e.target.closest('.history-detail-container')?.querySelector('.detail-title')?.textContent,
        script_full: e.target.closest('.history-detail-container')?.querySelector('.detail-script-content')?.textContent?.substring(0, 100) + '...',
        // 尝试从DOM中获取更多信息
        allAvailableData: e.target.dataset
      });
      
      // 如果内容仍然是脚本内容，显示警告
      if (sourceContent && sourceContent.includes('[S1]') && sourceContent.includes('[S2]')) {
        console.warn('⚠️ 警告：当前显示的内容仍然是播客脚本，不是原始输入文本！');
        console.warn('请检查数据字段名称是否正确。');
      }
      
      // 传递item数据给handleSourceClick函数
      console.log('🔍 调用handleSourceClick，传递的数据:', {
        sourceType,
        sourceUrl,
        sourceContent,
        item: item ? {
          id: item.id,
          title: item.title,
          hasScript: !!item.script_full,
          scriptLength: item.script_full ? item.script_full.length : 0
        } : 'null'
      });
      
      handleSourceClick(sourceType, sourceUrl, sourceContent, item);
    });

    // 添加侧边栏关闭按钮事件
    // 注意：侧边栏在document.body中，不在详情页容器内
    const closeBtn = document.querySelector('#btn-close-sidebar');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        console.log('🔍 侧边栏关闭按钮被点击');
        closeSourceSidebar();
      });
      console.log('✅ 侧边栏关闭按钮事件已绑定');
    } else {
      console.warn('⚠️ 侧边栏关闭按钮未找到，将在侧边栏显示时重新绑定');
    }
    
    // 注入后的首屏拉回顶部
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // 一个更安全的 HTML 转义函数
  function escapeHtml(s='') {
    if (typeof s !== 'string') return '';
    
    // 创建临时元素来安全转义HTML
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  
})();

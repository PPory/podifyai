'use strict';

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
      <div class="history-thumbnail">
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

    // 缩略图：用 DOM 操作设置 style，避免 innerHTML 注入
    const thumbEl = card.querySelector('.history-thumbnail');
    if (thumbEl) {
      if (item.thumbnail_filename && /^[\w.\-]+$/.test(item.thumbnail_filename)) {
        thumbEl.style.backgroundImage = `url('/static/card-thumbnail/${item.thumbnail_filename}')`;
      } else {
        thumbEl.style.backgroundColor = '#f0f0f0';
      }
    }

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


  // 轻路由：支持前进/后退
  function navigateToHistoryDetail(id) {
    // 更新地址（可直接用 hash，简单耐用）
    location.hash = `#history/${id}`;
  }

  window.addEventListener('hashchange', routeFromHash);

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

    const title = pickTitleLike(item);
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

'use strict';

function bootApp() {
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

      const mobileDrawer = document.getElementById('mobile-drawer');
      const mobileDrawerBackdrop = document.getElementById('mobile-drawer-backdrop');
      const mobileNavToggle = document.getElementById('mobile-nav-toggle');
      const mobileDrawerClose = document.getElementById('mobile-drawer-close');
      const mobileHomeButton = document.getElementById('mobile-home-btn');
      const mobileNewCreationButton = document.getElementById('mobile-new-creation');
      const mobileNavHome = document.getElementById('mobile-nav-home');
      const mobileNavNew = document.getElementById('mobile-nav-new');
      const mobileNavCredits = document.getElementById('mobile-nav-credits');
      const mobileNavSettings = document.getElementById('mobile-nav-settings');
      const mobileNavItems = Array.from(document.querySelectorAll('.mobile-drawer-item[data-mobile-key]'));

      const openMobileDrawer = () => {
        if (window.innerWidth > 768) return;
        mobileDrawer?.classList.add('is-open');
        mobileDrawerBackdrop?.classList.add('is-open');
        mobileDrawer?.setAttribute('aria-hidden', 'false');
        mobileDrawerBackdrop?.setAttribute('aria-hidden', 'false');
        document.body.classList.add('mobile-drawer-open');
      };

      const closeMobileDrawer = () => {
        mobileDrawer?.classList.remove('is-open');
        mobileDrawerBackdrop?.classList.remove('is-open');
        mobileDrawer?.setAttribute('aria-hidden', 'true');
        mobileDrawerBackdrop?.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('mobile-drawer-open');
      };

      const syncMobileActive = (key) => {
        mobileNavItems.forEach(item => {
          item.classList.toggle('is-active', Boolean(key) && item.dataset.mobileKey === key);
        });
      };

      const resolveDesktopNav = (el) => {
        if (!el) return null;
        if (el.closest('.lh-sidebar')) return el;
        const key = el.dataset.mobileKey;
        if (!key) return el;
        return document.querySelector(`.lh-sidebar [data-mobile-key="${key}"]`) || el;
      };

      // ScrollSpy：根据视口中线命中高亮
      const navLinks = Array.from(document.querySelectorAll('.lh-sidebar .nav-item[href^="#"]'));
      const sections = navLinks
        .map(a => ({ a, el: document.querySelector(a.getAttribute('href')) }))
        .filter(x => x.el);
      
      let userClicked = false; // 用户是否手动点击了导航项
      let lastUserClick = 0; // 最后一次用户点击的时间戳
      
      const setActive = (a, isUserClick = false) => {
        const desktopTarget = resolveDesktopNav(a);
        const all = document.querySelectorAll('.lh-sidebar .nav-item');
        all.forEach(n => n.classList.remove('is-active'));
        if (desktopTarget) {
          desktopTarget.classList.add('is-active');
        }
        syncMobileActive(desktopTarget?.dataset.mobileKey || a?.dataset.mobileKey || null);
        
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

    const homeButton = document.getElementById('sidebar-search');
    const newCreationButton = document.getElementById('nav-new-creation');
    const getHomeButton = () => document.getElementById('sidebar-search');

    const forceScrollToTop = () => {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });

        setTimeout(() => {
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        }, 100);

        setTimeout(() => {
          const firstElement = document.body.firstElementChild;
          if (firstElement) {
            firstElement.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }
        }, 200);

        setTimeout(() => {
          window.scrollTo(0, 0);
        }, 300);
      } catch (error) {
        console.error('滚动执行出错:', error);
      }
    };

    const goHomeView = () => {
      if (typeof showPage === 'function') {
        showPage('home');
      }
      if (typeof closeSourceSidebar === 'function') {
        closeSourceSidebar();
      }
      if (window.location.hash) {
        history.pushState(null, null, `${window.location.pathname}${window.location.search}`);
      }
    };

    const focusMainComposer = () => {
      if (mainTextarea) {
        mainTextarea.focus();
      }
    };

    const openCreditsPanel = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      closeMobileDrawer();
      const creditsButton = document.getElementById('nav-credits');
      if (creditsButton) {
        setActive(creditsButton, true);
      }
      openBilling();
    };

    const handleHomeNavigation = (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMobileDrawer();
      goHomeView();
      forceScrollToTop();
      focusMainComposer();
      const currentHomeButton = getHomeButton();
      if (currentHomeButton) {
        setActive(currentHomeButton, true);
      }
    };

    const beginNewCreation = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      closeMobileDrawer();

      const ok = resetCreationDraft({
        confirmIfDirty: true,
        promptText: '是否清空当前内容开始新创作？'
      });
      if (!ok) return false;

      goHomeView();
      forceScrollToTop();
      focusMainComposer();
      const currentHomeButton = getHomeButton();
      if (currentHomeButton) {
        setActive(currentHomeButton, true);
      }
      return true;
    };

    const isTextInputTarget = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    };

    // 键盘快捷键: N 新建
    document.addEventListener('keydown', (e) => {
      if (isTextInputTarget(e.target)) return;
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        beginNewCreation();
      }
    }, true);

    newCreationButton?.addEventListener('click', beginNewCreation);
    mobileNewCreationButton?.addEventListener('click', beginNewCreation);
    mobileHomeButton?.addEventListener('click', handleHomeNavigation);
    mobileNavHome?.addEventListener('click', handleHomeNavigation);
    mobileNavNew?.addEventListener('click', beginNewCreation);
    mobileNavCredits?.addEventListener('click', openCreditsPanel);

    mobileNavToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMobileDrawer();
    });

    mobileDrawerClose?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMobileDrawer();
    });

    mobileDrawerBackdrop?.addEventListener('click', closeMobileDrawer);

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        closeMobileDrawer();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileDrawer?.classList.contains('is-open')) {
        closeMobileDrawer();
      }
    });

    const setupHelpAndFeedbackModals = () => {
      const helpModal = document.getElementById('help-modal');
      const feedbackModal = document.getElementById('feedback-modal');
      const helpBtns = [
        document.getElementById('nav-help'),
        document.getElementById('mobile-nav-help')
      ].filter(Boolean);
      const feedbackBtns = [
        document.getElementById('nav-feedback'),
        document.getElementById('mobile-nav-feedback')
      ].filter(Boolean);
      const closeBtns = document.querySelectorAll('[data-close-modal="help-modal"], [data-close-modal="feedback-modal"]');

      const openModal = (modal, trigger) => {
        if (!modal) return;
        closeMobileDrawer();
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('is-modal-open');
        if (trigger) setActive(trigger, true);
      };

      const closeModal = (modal) => {
        if (!modal) return;
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('is-modal-open');
      };

      helpBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          openModal(helpModal, btn);
        });
      });

      feedbackBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          openModal(feedbackModal, btn);
        });
      });

      closeBtns.forEach(btn => btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-close-modal');
        closeModal(document.getElementById(id));
      }));

      [helpModal, feedbackModal].forEach(modal => modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal(modal);
        }
      }));

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (helpModal && !helpModal.classList.contains('hidden')) {
            closeModal(helpModal);
          } else if (feedbackModal && !feedbackModal.classList.contains('hidden')) {
            closeModal(feedbackModal);
          }
        }
      });

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
          closeModal(feedbackModal);
        } catch (err) {
          const mailto = `mailto:support@podify.ai?subject=${encodeURIComponent('PodifyAI 用户反馈')}` +
                         `&body=${encodeURIComponent(payload.message + (payload.email ? `\n\n联系方式：${payload.email}` : ''))}`;
          window.location.href = mailto;
          closeModal(feedbackModal);
        }
      });
    };

    setupHelpAndFeedbackModals();

    // 点击"设置"打开设置模态框
    const openSettingsModal = () => {
      const modal = document.getElementById('settings-modal');
      modal?.classList.remove('hidden');
      document.body.classList.add('is-modal-open'); // 添加模态框打开状态类
      // 设置设置为激活状态
      setActive(document.getElementById('nav-settings'), true);
      // 更新设置信息
      updateSettingsModal();
    };

    document.getElementById('nav-settings')?.addEventListener('click', openSettingsModal);
    mobileNavSettings?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMobileDrawer();
      openSettingsModal();
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

    // 点击"主页"回到首页并聚焦主输入框
    if (homeButton) {
      // 移除可能存在的旧事件监听器
      const newHomeButton = homeButton.cloneNode(true);
      homeButton.parentNode.replaceChild(newHomeButton, homeButton);
      
      // 重新绑定事件
      newHomeButton.addEventListener('click', handleHomeNavigation);
      
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

    const scrollToLibrary = () => {
      goHomeView();
      requestAnimationFrame(() => {
        historyLibrarySection?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      });
    };

    // 为资料库导航项添加点击事件
    const libraryNavItems = Array.from(document.querySelectorAll('a[href="#history-library"]'));
    libraryNavItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (item.id === 'mobile-nav-library') {
          e.preventDefault();
          e.stopPropagation();
          closeMobileDrawer();
          setActive(item, true);
          scrollToLibrary();
          return;
        }
        setActive(item, true);
      });
    });

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
    document.getElementById('nav-credits')?.addEventListener('click', openCreditsPanel);

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
    const closePlayerBtn = document.getElementById('gp-close-player-btn');
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

    closePlayerBtn?.addEventListener('click', () => {
      document.querySelector('.volume-popover')?.classList.remove('open');
      playlistPanel?.classList.remove('visible');
      moreOptionsMenu.classList.add('hidden');
      playerManager?.stopPlayback();
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

    // --- 启动流程 ---
    checkLoginStatusAndSetupUI();
}

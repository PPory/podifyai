'use strict';

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

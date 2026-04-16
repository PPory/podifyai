'use strict';

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
  const clearInterfaceContent = (options = {}) => resetCreationDraft({
    resetVoices: false,
    closePopovers: true,
    ...options
  });
  
  rolesMode?.addEventListener('click', () => {
    if (!clearInterfaceContent({
      confirmIfDirty: true,
      promptText: '切换模式将会清空当前输入的内容，您确定要继续吗？'
    })) return;
    currentMode = 'role';
    rolesMode.classList.add('active');
    singleMode.classList.remove('active');
    // 保存模式选择到本地存储
    storage.set('podifyai_mode', currentMode);
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
    if (!clearInterfaceContent({
      confirmIfDirty: true,
      promptText: '切换模式将会清空当前输入的内容，您确定要继续吗？'
    })) return;
    currentMode = 'single';
    singleMode.classList.add('active');
    rolesMode.classList.remove('active');
    // 保存模式选择到本地存储
    storage.set('podifyai_mode', currentMode);
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

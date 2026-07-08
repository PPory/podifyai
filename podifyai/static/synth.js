'use strict';

  // ==================== 播客按钮逻辑（恢复） ====================
  
  // 统一编排：生成并创建卡片
  async function composeAndCreatePodcast({ scriptText, voiceName, title, originalInput, inputType }) {
    const effectiveTitle = normalizeDraftTitle(title) || getCurrentDraftTitle();

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
      payload.sourceTitle = effectiveTitle || '外部链接';  // 设置来源标题
    } else if (inputType === 'pdf' && window.pdfFilename) {
      // 如果是PDF类型，设置PDF文件路径
      payload.sourceUrl = `/pdf_storage/${window.pdfFilename}`;  // PDF文件访问路径
      payload.sourceTitle = effectiveTitle || 'PDF文档';  // 设置来源标题
      console.log('📄 传递PDF文件信息:', { sourceUrl: payload.sourceUrl, sourceTitle: payload.sourceTitle });
    }
    
    if (effectiveTitle) {
      payload.title = effectiveTitle;
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
      
      const currentTitle = getCurrentDraftTitle();
      
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
        voice_id: s1Id,
        s1_voice_id: s1Id,
        s2_voice_id: s2Id,
        originalInput,
        inputType
      };

      if (currentTitle) {
        body.title = currentTitle;
      }
      
      if (currentMode === 'single') {
        body.voiceName = selectedVoices.s1;
      } else {
        body.s1_voice_name = selectedVoices.s1;
        body.s2_voice_name = selectedVoices.s2;
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
      if (err.paymentRequired) {
        showMessage('积分不足，请前往「设置」充值后再试', 'error');
      } else {
        showMessage(`合成失败：${err.message || err}`, 'error');
      }
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

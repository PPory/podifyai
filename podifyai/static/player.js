'use strict';

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
  

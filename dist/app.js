(()=>{
  const catalog=[
    ['01','阿卜杜拉'],['02','开往北京的火车'],['03','凌晨计程车'],['04','少女'],['05','少年锦时'],['06','小行迹'],['07','十九岁'],['08','雨后的绽放（翻唱）'],['09','阿刁'],['10','南方姑娘'],['11','三十岁的女人'],['12','吉姆餐厅'],['13','背影'],['14','玛丽'],['15','署前街少年'],['16','朵'],['17','船长'],['18','彩虹下面'],['19','理想'],['20','难受'],['21','小屋'],['22','咬春'],['23','画'],['24','未给姐姐递出的信'],['25','人家（含乐队介绍与独奏）'],['26','我们的时光'],['27','鼓楼'],['28','成都'],['29','程艾影'],['30','我记得'],['31','辞行']
  ].map(([number,title])=>({id:`${number} ${title}`,number,title,artistId:'zhaolei',artist:'赵雷',album:'鸟巢现场',audioUrl:`audio/${number}.mp3`,lyricsUrl:`lyrics/${number}.lrc`})).concat(globalThis.LIZHI_TRACKS || []);
  const $ = selector => document.querySelector(selector);
  const audio = $('#audio'), progress = $('#progress'), lyricsBox = $('#lyrics');
  const lyricViews = [lyricsBox, $('#miniLyrics')];
  const trackList = $('#trackList'), toastEl = $('#toast'), viewPager = $('#viewPager');
  const queueDialog = $('#playbackQueueDialog'), queueList = $('#playbackQueueList');
  const tracks = catalog, validIds = new Set(catalog.map(track => track.id));
  const libraryTabs = ['zhaolei', 'lizhi', 'all'];
  let libraryFilter = 'zhaolei';
  let libraryTransition;
  let playbackQueue = libraryIndexes();
  let queueSource = libraryFilter;
  const playModes = {
    sequence: { label: '顺序', name: '顺序播放', icon: '→' },
    single: { label: '单曲', name: '单曲循环', icon: '↻' },
    shuffle: { label: '随机', name: '随机循环', icon: '⤨' }
  };
  let current = -1, generation = 0, playbackIntent = 0, wantsPlay = false;
  let loadingAudio = false, audioFailed = false, audioUrl = '', trackRequest;
  let failedDownload = null, automaticRecoveryUsed = false;
  let nextAudio = null, plannedNext = -1;
  let lyrics = [], activeLine = -1, offset = 0, pendingSeek = null, scrub = null;
  let displayMode = 'cover', playMode = 'sequence', shuffleHistory = [], swipeRaf = 0, toastTimer;

  // Storage can be unavailable in a private window; playback must still work.
  function readPreference(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function savePreference(key, value) { try { localStorage.setItem(key, value); } catch {} }
  function cleanLegacyStorage() {
    try {
      localStorage.removeItem('albumCover'); localStorage.removeItem('trackOrder');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('offset:') && !validIds.has(key.slice(7))) localStorage.removeItem(key);
      }
      if (readPreference('legacyAudioCleared') === '1') return;
      const request = indexedDB.deleteDatabase('lyrics-player');
      request.onsuccess = () => savePreference('legacyAudioCleared', '1');
    } catch {}
  }
  function duration() {
    return audioUrl && audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    seconds = Math.max(0, Math.floor(seconds));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function paintTime(seconds) {
    progress.value = String(seconds);
    $('#currentTime').textContent = formatTime(seconds);
    progress.setAttribute('aria-valuetext', `${formatTime(seconds)} / ${formatTime(duration())}`);
  }
  function syncTimeline() {
    const total = duration();
    progress.disabled = !total;
    progress.max = String(total || 0);
    $('#duration').textContent = formatTime(total);
    if (!scrub) paintTime(pendingSeek ?? audio.currentTime ?? 0);
  }
  function updatePlayButton() {
    const playing = wantsPlay || (!loadingAudio && !!audioUrl && !audio.paused);
    $('#playButton').textContent = playing ? '❚❚' : '▶';
    $('#playButton').setAttribute('aria-label', playing ? '暂停' : '播放');
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
  }
  async function startPlayback() {
    if (!wantsPlay || loadingAudio || !audioUrl) return;
    const track = generation, intent = playbackIntent;
    try { await audio.play(); }
    catch (error) {
      if (track !== generation || intent !== playbackIntent || !wantsPlay) return;
      wantsPlay = false;
      updatePlayButton();
      if (error.name === 'NotAllowedError') setTrackStatus('歌曲已准备好，请点播放继续');
      if (error.name !== 'AbortError') showToast(error.name === 'NotAllowedError' ? '歌曲已准备好，点播放即可收听' : '暂时无法播放，请点播放重试');
    }
  }
  function requestPlayback() {
    wantsPlay = true; playbackIntent++;
    updatePlayButton();
    void startPlayback();
  }
  function pausePlayback() {
    wantsPlay = false; playbackIntent++;
    if (failedDownload) failedDownload.resume = false;
    audio.pause(); updatePlayButton();
  }
  function updateMediaMetadata(track) {
    if (!navigator.mediaSession || !globalThis.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title, artist: track.artist, album: track.album,
        artwork: [{ src: new URL(track.artistId === 'lizhi' ? 'cover-lizhi.jpg' : 'cover.jpg', document.baseURI).href, type: 'image/jpeg' }]
      });
      navigator.mediaSession.setPositionState?.();
    } catch {}
  }
  function updateMediaPosition() {
    const total = duration();
    if (!total || !navigator.mediaSession?.setPositionState) return;
    try {
      navigator.mediaSession.setPositionState({ duration: total, playbackRate: audio.playbackRate || 1, position: Math.max(0, Math.min(total, pendingSeek ?? audio.currentTime)) });
    } catch {}
  }
  function seekTo(seconds) {
    if (!Number.isFinite(seconds) || current < 0) return;
    pendingSeek = Math.max(0, seconds);
    applyPendingSeek();
  }
  function applyPendingSeek() {
    const total = duration();
    if (pendingSeek === null || !total) return;
    const target = Math.min(total, pendingSeek);
    pendingSeek = target;
    try {
      audio.currentTime = target;
      paintTime(target);
      activeLine = -2; updateActive(target);
    } catch { /* Metadata is not ready yet; retry on loadedmetadata/canplay. */ }
  }
  function finishScrub() {
    const gesture = scrub; scrub = null;
    if (gesture?.generation === generation) seekTo(gesture.value);
    else syncTimeline();
  }
  function resetAudio() {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = '';
  }
  function setTrackStatus(message) {
    $('#trackMeta').textContent = message;
    $('#lyricsMeta').textContent = message;
  }
  function downloadError(code, details = {}) {
    return Object.assign(new Error(code), { code, retryable: false, ...details });
  }
  function waitToRetry(signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(downloadError('cancelled')); return; }
      const abort = () => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        reject(downloadError('cancelled'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort); resolve();
      }, 1000);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  async function downloadAudio(track, signal, onProgress, onRetry, canRetry = () => true) {
    let lastError;
    let sources = [...new Set([track.audioUrl, track.audioFallbackUrl].filter(Boolean))];
    for (let round = 0; round < 2 && sources.length; round++) {
      if (round) {
        if (!canRetry()) throw lastError;
        onRetry?.(); await waitToRetry(signal);
        if (!canRetry()) throw lastError;
      }
      const retrySources = [];
      for (const url of sources) {
        if (signal.aborted) throw downloadError('cancelled');
        if (!canRetry()) throw lastError || downloadError('cancelled');
        const request = new AbortController();
        let timer, rejectTimeout, timedOut = false, stage = 'headers', received = 0;
        const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
        const abort = () => { rejectTimeout(downloadError('cancelled')); request.abort(); };
        const armTimeout = ms => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            timedOut = true;
            rejectTimeout(downloadError('timeout', { retryable: true, stage }));
            request.abort();
          }, ms);
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          armTimeout(30000);
          const response = await Promise.race([fetch(url, { signal: request.signal, ...(round ? { cache: 'reload' } : {}) }), timeout]);
          if (!response.ok) throw downloadError('http', {
            status: response.status,
            retryable: [408, 425, 429].includes(response.status) || response.status >= 500
          });
          const contentType = response.headers?.get('content-type') || '';
          if (/^(?:text\/|application\/(?:json|problem\+json|xml)(?:[;\s]|$))/i.test(contentType)) {
            throw downloadError('invalid', { contentType });
          }
          stage = 'body';
          let blob;
          if (response.body?.getReader) {
            const reader = response.body.getReader(), chunks = [];
            const total = Number(response.headers.get('content-length'));
            try {
              while (true) {
                // Time out a stalled connection, not a slow download still making progress.
                armTimeout(30000);
                const { done, value } = await Promise.race([reader.read(), timeout]);
                if (done) break;
                chunks.push(value); received += value.byteLength;
                if (total > 0) onProgress?.(Math.min(99, Math.floor(received / total * 100)));
              }
            } finally { reader.releaseLock(); }
            if (total > 0 && received < total) throw downloadError('incomplete', { retryable: true });
            // Every catalog resource is an MP3. Raw hosts can return octet-stream;
            // normalize only the Blob label, preserving every downloaded byte.
            blob = new Blob(chunks, { type: 'audio/mpeg' });
          } else {
            armTimeout(60000);
            blob = await Promise.race([response.blob(), timeout]);
            if (blob.type !== 'audio/mpeg' && typeof blob.slice === 'function') blob = blob.slice(0, blob.size, 'audio/mpeg');
          }
          if (signal.aborted) throw downloadError('cancelled');
          if (!blob.size) throw downloadError('empty', { retryable: true });
          return blob;
        } catch (error) {
          request.abort();
          if (signal.aborted) throw error;
          lastError = timedOut ? downloadError('timeout', { retryable: true, stage })
            : typeof error.retryable === 'boolean' ? error
            : downloadError(navigator.onLine === false ? 'offline' : 'network', { retryable: true, stage });
          lastError.stage ??= stage;
          lastError.sourceHost = new URL(url, document.baseURI).hostname;
          lastError.receivedBytes = received;
          if (lastError.retryable) retrySources.push(url);
        } finally {
          clearTimeout(timer); signal.removeEventListener('abort', abort);
        }
      }
      sources = retrySources;
    }
    throw lastError || downloadError('unavailable');
  }
  function clearNextAudio() {
    nextAudio?.controller.abort(); nextAudio = null;
  }
  function nextIndex() {
    if (playMode === 'single') return -1;
    if (playMode === 'shuffle') {
      if (plannedNext !== current && playbackQueue.includes(plannedNext)) return plannedNext;
      const choices = playbackQueue.filter(index => index !== current);
      plannedNext = choices.length ? choices[Math.floor(Math.random() * choices.length)] : -1;
      return plannedNext;
    }
    const position = playbackQueue.indexOf(current);
    return position >= 0 ? playbackQueue[position + 1] ?? -1 : -1;
  }
  function prepareNextAudio() {
    if (current < 0 || audio.paused || loadingAudio || audioFailed) return;
    const index = nextIndex();
    if (index < 0) { clearNextAudio(); return; }
    if (nextAudio?.index === index) return;
    clearNextAudio();
    const job = { index, controller: new AbortController(), blob: null, promise: null, adopted: false, error: null };
    nextAudio = job;
    // Keep only one upcoming Blob, and create its object URL only when it becomes current.
    job.promise = downloadAudio(tracks[index], job.controller.signal, null, null, () => job.adopted || !audio.paused).then(blob => {
      if (job.controller.signal.aborted) return null;
      job.blob = blob; return blob;
    }).catch(error => {
      // A later playing/online event may retry; a stale failure must not clear a newer job.
      if (!job.controller.signal.aborted) job.error = error;
      if (nextAudio === job) nextAudio = null;
      return null;
    });
  }
  function installAudio(blob) {
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl; audio.load();
    loadingAudio = false;
    const track = tracks[current];
    setTrackStatus([track.artist, track.album].filter(Boolean).join(' · '));
    $('#playerView').setAttribute('aria-busy', 'false');
    if (wantsPlay) void startPlayback();
  }
  async function loadAudio(track, token, signal, prepared) {
    const abortPrepared = () => prepared?.controller.abort();
    signal.addEventListener('abort', abortPrepared, { once: true });
    try {
      // A ready next song starts in the ended event's call stack, without a background fetch.
      if (prepared?.blob) { installAudio(prepared.blob); return; }
      let blob = prepared ? await prepared.promise : null;
      if (token !== generation || signal.aborted) return;
      // An adopted prefetch has already spent this song's retry budget.
      // Preserve its error rather than silently starting the same requests again.
      if (!blob && prepared?.error) throw prepared.error;
      if (!blob) blob = await downloadAudio(track, signal, percent => {
        if (token === generation && !signal.aborted) setTrackStatus(`正在加载歌曲… ${percent}%`);
      }, () => {
        if (token === generation && !signal.aborted) setTrackStatus('连接不稳定，正在重新连接…');
      });
      if (token !== generation || signal.aborted) return;
      installAudio(blob);
    } catch (error) {
      if (token !== generation || signal.aborted) return;
      failedDownload = { generation: token, resume: wantsPlay, retryable: !!error.retryable && !automaticRecoveryUsed };
      loadingAudio = false; audioFailed = true; wantsPlay = false;
      const reason = error.code === 'timeout' ? '连接超时'
        : error.code === 'offline' ? '网络已断开'
        : error.code === 'http' ? '歌曲服务暂时不可用'
        : error.code === 'invalid' ? '歌曲资源异常' : '歌曲加载失败';
      setTrackStatus(`${reason}，点播放重试`);
      $('#playerView').setAttribute('aria-busy', 'false');
      updatePlayButton(); showToast(`${reason}，请点播放重试`);
      console.warn('Audio download failed', { trackId: track.id, code: error.code || 'unknown',
        status: error.status, stage: error.stage, sourceHost: error.sourceHost, receivedBytes: error.receivedBytes });
    } finally {
      signal.removeEventListener('abort', abortPrepared);
    }
  }
  function loadTrack(index, autoplay = true, automaticRecovery = false) {
    if (index < 0 || index >= tracks.length) return;
    globalThis.LyricShare?.cancelPress();
    const prepared = nextAudio?.index === index ? nextAudio : null;
    if (prepared) { nextAudio = null; prepared.adopted = true; } else clearNextAudio();
    plannedNext = -1;
    generation++; playbackIntent++;
    trackRequest?.abort(); trackRequest = new AbortController();
    current = index; wantsPlay = autoplay; loadingAudio = true; audioFailed = false;
    failedDownload = null; automaticRecoveryUsed = automaticRecovery;
    pendingSeek = null; scrub = null;
    resetAudio();
    const track = tracks[index];
    const isLizhi = track.artistId === 'lizhi';
    $('#coverArt').src = isLizhi ? 'cover-lizhi.jpg' : 'cover.jpg';
    $('#coverArt').alt = isLizhi ? '李志《我爱南京》封面' : '赵雷「没有信号」风筝封面';
    $('#playerStage').dataset.artist = track.artistId;
    updateMediaMetadata(track);
    const storedOffset = Number(readPreference('offset:' + track.id) ?? 0);
    offset = Number.isFinite(storedOffset) ? Math.max(-10, Math.min(10, storedOffset)) : 0;
    lyrics = []; activeLine = -1;
    lyricViews.forEach(box => { box.scrollTop = 0; });
    renderLyrics('正在加载歌词…');
    $('#trackTitle').textContent = track.title;
    $('#lyricsTitle').textContent = track.title;
    setTrackStatus('正在加载歌曲…');
    $('#playerView').setAttribute('aria-busy', 'true');
    syncTimeline(); paintTime(0); updatePlayButton(); renderLibrary(); renderPlaybackQueue(); closeLibrary();
    void loadLyrics(track, generation, trackRequest.signal);
    void loadAudio(track, generation, trackRequest.signal, prepared);
  }
  async function loadLyrics(track, token, signal) {
    if (!track.lyricsUrl) {
      if (token !== generation || signal.aborted) return;
      lyrics = []; activeLine = -2; renderLyrics('这首歌暂无歌词');
      return;
    }
    let text = '';
    try {
      const response = await fetch(track.lyricsUrl, { signal });
      if (!response.ok) throw new Error('lyrics unavailable');
      text = await response.text();
    } catch {}
    if (token !== generation || signal.aborted) return;
    lyrics = parseLrc(text); activeLine = -2; renderLyrics(); updateActive();
  }
  function parseLrc(text) {
    const lines = [], match = text.match(/\[offset:([+-]?\d+)\]/i);
    const fileOffset = match ? Number(match[1]) / 1000 : 0;
    for (const line of text.split(/\r?\n/)) {
      const stamps = [...line.matchAll(/\[(\d+):(\d{1,2}(?:\.\d+)?)\]/g)];
      const value = line.replace(/\[[^\]]+\]/g, '').trim();
      if (!value) continue;
      for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + fileOffset, text: value });
    }
    return lines.sort((a, b) => a.time - b.time);
  }
  function renderLyrics(message = '歌词暂时无法加载，请检查网络后重试。') {
    const token = generation;
    const shareDisabled = !lyrics.some(line => !/^（.*）$/.test(line.text));
    $('#lyricShareButton').disabled = shareDisabled;
    $('#coverShareButton').disabled = shareDisabled;
    lyricViews.forEach(box => {
      box.replaceChildren();
      if (!lyrics.length) {
        const note = document.createElement('div'); note.className = 'no-lyrics'; note.textContent = message;
        box.append(note); return;
      }
      lyrics.forEach((line, index) => {
        const element = document.createElement(box === lyricsBox ? 'button' : 'p');
        element.className = 'lyric-line' + (/^（.*）$/.test(line.text) ? ' note' : '');
        element.textContent = line.text; element.dataset.index = index;
        const gesture = globalThis.LyricShare?.bindLine(element, () => { if (token === generation) openLyricShare(index); });
        if (box === lyricsBox) element.onclick = () => { if (gesture?.consumeClick() || token !== generation) return; seekTo(line.time - offset); requestPlayback(); };
        box.append(element);
      });
    });
  }
  function openLyricShare(index = activeLine) {
    if (current < 0) return;
    globalThis.LyricShare?.open({ track: tracks[current], lines: lyrics, selectedIndex: index });
  }
  function libraryIndexes() {
    return tracks.reduce((indexes, track, index) => {
      if (libraryFilter === 'all' || track.artistId === libraryFilter) indexes.push(index);
      return indexes;
    }, []);
  }
  function setLibraryFilter(filter) {
    if (!libraryTabs.includes(filter) || filter === libraryFilter) return;
    const direction = libraryTabs.indexOf(filter) > libraryTabs.indexOf(libraryFilter) ? 1 : -1;
    libraryTransition?.cancel();
    libraryFilter = filter;
    $('#libraryTabs').dataset.active = filter;
    libraryTabs.forEach(id => {
      const selected = id === filter, tab = $('#tab-' + id);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    });
    $('#libraryPanel').setAttribute('aria-labelledby', 'tab-' + filter);
    $('#libraryPanel').scrollTop = 0;
    renderLibrary();
    if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      libraryTransition = $('#libraryPanel').animate?.([
        { opacity: .25, transform: `translateX(${direction * 22}px)` },
        { opacity: 1, transform: 'translateX(0)' }
      ], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
  function renderLibrary() {
    trackList.replaceChildren();
    const indexes = libraryIndexes();
    $('#libraryEmpty').classList.toggle('hidden', indexes.length > 0);
    $('#libraryEmpty').textContent = libraryFilter === 'lizhi' ? '李志的歌曲待添加' : '暂无歌曲';
    indexes.forEach(index => {
      const track = tracks[index];
      const button = document.createElement('button');
      button.className = 'track' + (index === current ? ' active' : '');
      button.innerHTML = `<span class="track-index">${track.number}</span><span class="track-name"></span><span class="track-state"></span>`;
      button.querySelector('.track-name').textContent = track.title;
      button.querySelector('.track-state').textContent = track.lyricsUrl ? '有歌词' : '暂无歌词';
      button.title = [track.title, track.artist, track.album].filter(Boolean).join(' · ');
      button.onclick = () => { playbackQueue = [...indexes]; queueSource = libraryFilter; shuffleHistory = []; loadTrack(index); };
      trackList.append(button);
    });
  }
  function renderPlaybackQueue() {
    const restoreFocus = queueDialog.open && queueList.contains(document.activeElement);
    const labels = { zhaolei: '赵雷', lizhi: '李志', all: '全部' };
    $('#queueSummary').textContent = `${labels[queueSource]} · ${playbackQueue.length} 首`;
    queueList.replaceChildren();
    playbackQueue.forEach((index, position) => {
      const track = tracks[index], selected = index === current;
      const button = document.createElement('button');
      button.className = 'track' + (selected ? ' active' : '');
      button.innerHTML = `<span class="track-index">${String(position + 1).padStart(2, '0')}</span><span class="track-name"></span><span class="track-state"></span>`;
      button.querySelector('.track-name').textContent = track.title;
      button.querySelector('.track-state').textContent = selected ? '当前' : track.artist;
      if (selected) button.setAttribute('aria-current', 'true');
      button.onclick = () => {
        shuffleHistory = [];
        if (index === current && !audioFailed && !audio.error) requestPlayback();
        else loadTrack(index);
      };
      queueList.append(button);
    });
    if (restoreFocus) queueList.querySelector('.active')?.focus({ preventScroll: true });
  }
  function openPlaybackQueue() {
    closeLibrary(); renderPlaybackQueue();
    if (!queueDialog.open) queueDialog.showModal();
    $('#queueButton').setAttribute('aria-expanded', 'true');
    const selected = queueList.querySelector('.active');
    if (selected) queueList.scrollTop = Math.max(0, selected.offsetTop - queueList.offsetTop - queueList.clientHeight / 3);
  }
  function setPlayMode(mode, announce = false) {
    const next = Object.hasOwn(playModes, mode) ? mode : 'sequence';
    if (next !== playMode) { shuffleHistory = []; plannedNext = -1; clearNextAudio(); }
    playMode = next;
    const data = playModes[playMode]; savePreference('playMode', playMode);
    $('#modeIcon').textContent = data.icon; $('#modeLabel').textContent = data.label;
    $('#modeButton').setAttribute('aria-label', data.name); $('#modeButton').title = data.name;
    if (announce) showToast(data.name);
    prepareNextAudio();
  }
  function cyclePlayMode() {
    const order = ['sequence', 'single', 'shuffle'];
    setPlayMode(order[(order.indexOf(playMode) + 1) % order.length], true);
  }
  function playRandomNext() {
    if (!playbackQueue.length) return;
    const next = nextIndex();
    if (next < 0) { seekTo(0); requestPlayback(); return; }
    shuffleHistory.push(current);
    loadTrack(next);
  }
  function playPrevious() {
    if (playMode === 'shuffle' && shuffleHistory.length) { loadTrack(shuffleHistory.pop()); return; }
    const position = playbackQueue.indexOf(current);
    if (position > 0) loadTrack(playbackQueue[position - 1]); else showToast('已经是第一首');
  }
  function playNext() {
    if (playMode === 'shuffle') { playRandomNext(); return; }
    const position = playbackQueue.indexOf(current);
    if (position >= 0 && position < playbackQueue.length - 1) loadTrack(playbackQueue[position + 1]); else showToast('已经是最后一首');
  }
  function handleEnded() {
    if (!audio.ended || !audioUrl) return;
    if (playMode === 'single') { seekTo(0); requestPlayback(); return; }
    if (playMode === 'shuffle') { playRandomNext(); return; }
    const position = playbackQueue.indexOf(current);
    if (position >= 0 && position < playbackQueue.length - 1) loadTrack(playbackQueue[position + 1]);
    else { wantsPlay = false; updatePlayButton(); }
  }
  function updatePagerState() {
    swipeRaf = 0;
    const next = viewPager.scrollLeft >= viewPager.clientWidth / 2 ? 'lyrics' : 'cover';
    $('#coverDot').classList.toggle('active', next === 'cover');
    $('#lyricsDot').classList.toggle('active', next === 'lyrics');
    if (next !== displayMode) {
      displayMode = next;
      activeLine = -2; updateActive();
    }
  }
  function updateActive(time = pendingSeek ?? audio.currentTime) {
    if (!lyrics.length) return;
    const target = time + offset;
    let next = -1;
    for (let i = 0; i < lyrics.length; i++) { if (lyrics[i].time <= target) next = i; else break; }
    if (next === activeLine) return;
    activeLine = next;
    lyricViews.forEach(box => {
      box.querySelector('.active')?.classList.remove('active');
      if (next < 0) { box.scrollTop = 0; return; }
      const line = box.children[next]; line.classList.add('active');
      const top = Math.max(0, line.offsetTop - (box.clientHeight - line.offsetHeight) / 2);
      const visible = box === lyricsBox ? displayMode === 'lyrics' : displayMode === 'cover';
      box.scrollTo({ top, behavior: visible ? 'smooth' : 'auto' });
    });
  }
  function showToast(message) {
    clearTimeout(toastTimer); toastEl.textContent = message; toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  function closeLibrary() {
    $('#sidebar').classList.remove('open'); $('#shade').classList.remove('show');
    $('#libraryButton').setAttribute('aria-expanded', 'false');
  }
  function openLibrary() {
    $('#sidebar').classList.add('open'); $('#shade').classList.add('show');
    $('#libraryButton').setAttribute('aria-expanded', 'true');
    $('#tab-' + libraryFilter).focus({ preventScroll: true });
  }

  $('#playButton').onclick = () => {
    if (audioFailed || audio.error) { loadTrack(current, true); return; }
    if (wantsPlay || !audio.paused) pausePlayback(); else requestPlayback();
  };
  $('#prevButton').onclick = playPrevious; $('#nextButton').onclick = playNext;
  progress.addEventListener('input', () => {
    if (progress.disabled) return;
    scrub = { generation, value: Number(progress.value) };
    seekTo(scrub.value);
  });
  progress.addEventListener('change', finishScrub);
  progress.addEventListener('pointerup', finishScrub);
  progress.addEventListener('pointercancel', finishScrub);
  progress.addEventListener('blur', finishScrub);
  function mediaReady() {
    if (!audioUrl || audio.src !== audioUrl) return;
    syncTimeline(); applyPendingSeek(); updateMediaPosition();
  }
  audio.addEventListener('loadedmetadata', mediaReady);
  audio.addEventListener('durationchange', mediaReady);
  audio.addEventListener('canplay', () => { if (pendingSeek !== null && !audio.seeking) applyPendingSeek(); });
  audio.addEventListener('seeked', () => {
    if (pendingSeek !== null && Math.abs(audio.currentTime - pendingSeek) < .25) pendingSeek = null;
    if (!scrub) paintTime(pendingSeek ?? audio.currentTime);
    activeLine = -2; updateActive();
  });
  audio.addEventListener('timeupdate', () => {
    if (!scrub && pendingSeek === null) paintTime(audio.currentTime);
    updateActive(); updateMediaPosition();
  });
  audio.addEventListener('playing', prepareNextAudio);
  addEventListener('online', () => {
    const failed = failedDownload;
    if (audioFailed && failed?.generation === generation && failed.resume && failed.retryable) {
      failedDownload = null;
      loadTrack(current, true, true);
    } else prepareNextAudio();
  });
  audio.addEventListener('play', () => {
    if (audioUrl && !loadingAudio && !audio.paused) {
      wantsPlay = true;
      setTrackStatus([tracks[current].artist, tracks[current].album].filter(Boolean).join(' · '));
    }
    updatePlayButton();
  });
  audio.addEventListener('pause', () => {
    // Phone media controls/headphones can pause audio outside our own button.
    // Ignore reset/load pauses and the pause event preceding natural completion.
    if (audioUrl && !loadingAudio && audio.readyState >= 1 && audio.paused && !audio.ended) {
      wantsPlay = false; playbackIntent++;
    }
    updatePlayButton();
  });
  audio.addEventListener('ended', handleEnded);
  audio.addEventListener('error', () => {
    if (!audioUrl || loadingAudio || !audio.error) return;
    audioFailed = true; wantsPlay = false; updatePlayButton();
    syncTimeline();
    setTrackStatus('歌曲播放失败，点播放重试');
    showToast('歌曲暂时无法播放，请重试');
  });
  $('#libraryButton').onclick = () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#shade').classList.toggle('show', open);
    $('#libraryButton').setAttribute('aria-expanded', String(open));
  };
  $('#queueButton').onclick = openPlaybackQueue;
  $('#queueLibraryButton').onclick = () => { queueDialog.close(); openLibrary(); };
  $('#lyricShareButton').onclick = () => openLyricShare();
  $('#coverShareButton').onclick = () => openLyricShare();
  $('#closeQueueButton').onclick = () => queueDialog.close();
  queueDialog.addEventListener('close', () => $('#queueButton').setAttribute('aria-expanded', 'false'));
  queueDialog.addEventListener('click', event => {
    if (event.target !== queueDialog) return;
    const rect = queueDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) queueDialog.close();
  });
  $('#shade').onclick = closeLibrary;
  addEventListener('keydown', event => { if (event.key === 'Escape') closeLibrary(); });
  $('#modeButton').onclick = cyclePlayMode;
  libraryTabs.forEach((id, index) => {
    const tab = $('#tab-' + id);
    tab.onclick = () => setLibraryFilter(id);
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % libraryTabs.length;
      else if (event.key === 'ArrowLeft') next = (index + libraryTabs.length - 1) % libraryTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = libraryTabs.length - 1;
      else return;
      event.preventDefault();
      setLibraryFilter(libraryTabs[next]); $('#tab-' + libraryTabs[next]).focus();
    });
  });
  viewPager.addEventListener('scroll', () => { if (!swipeRaf) swipeRaf = requestAnimationFrame(updatePagerState); }, { passive: true });
  addEventListener('resize', () => {
    viewPager.scrollTo({ left: displayMode === 'lyrics' ? viewPager.clientWidth : 0, behavior: 'auto' });
    activeLine = -2; updateActive();
  });

  if (navigator.mediaSession) {
    const actions = {
      play: () => { if (audioFailed || audio.error) loadTrack(current, true); else requestPlayback(); },
      pause: pausePlayback, stop: pausePlayback,
      previoustrack: playPrevious, nexttrack: playNext,
      seekto: details => { if (Number.isFinite(details.seekTime)) seekTo(details.seekTime); }
    };
    for (const [action, handler] of Object.entries(actions)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
  }
  cleanLegacyStorage(); setPlayMode(readPreference('playMode') || 'sequence'); loadTrack(0, false);
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

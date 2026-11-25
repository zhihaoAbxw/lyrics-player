(() => {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#lyricShareDialog'), selection = $('#shareSelection');
  let press = null, revision = 0, snapshot = null, selected = new Set();
  let imageUrl = '', imageBlob = null, shareFile = null, nativeSharePending = false;
  let videoUrl = '', videoFile = null, videoController = null;
  const isLyric = text => text.trim() && !/^（.*）$/.test(text.trim());

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }
  function bindLine(element, open) {
    let suppressClick = false;
    element.addEventListener('pointerdown', event => {
      cancelPress(); suppressClick = false;
      if (event.isPrimary === false || event.button > 0) return;
      const gesture = { element, x: event.clientX, y: event.clientY, timer: null };
      gesture.timer = setTimeout(() => {
        if (press !== gesture) return;
        press = null; suppressClick = true; open();
      }, 550);
      press = gesture;
    });
    element.addEventListener('pointermove', event => {
      if (press?.element === element && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        suppressClick = true; cancelPress();
      }
    });
    element.addEventListener('pointerup', () => { if (press?.element === element) cancelPress(); });
    element.addEventListener('pointercancel', () => { suppressClick = true; if (press?.element === element) cancelPress(); });
    element.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && press?.element === element) cancelPress(); });
    element.addEventListener('contextmenu', event => {
      event.preventDefault(); cancelPress();
      if (!suppressClick) { suppressClick = true; open(); }
    });
    return { consumeClick() { const result = suppressClick; suppressClick = false; return result; } };
  }
  for (const id of ['#lyrics', '#miniLyrics', '#viewPager']) $(id).addEventListener('scroll', cancelPress, { passive: true });
  addEventListener('blur', cancelPress);
  addEventListener('pointerup', cancelPress);
  addEventListener('pointercancel', cancelPress);

  function clearImage() {
    videoController?.abort(); videoController = null;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = ''; videoFile = null; imageBlob = null;
    $('#saveStatusVideo').removeAttribute('href'); $('#saveStatusVideo').classList.add('hidden');
    $('#statusVideoButton').textContent = '生成视频'; $('#statusVideoButton').disabled = false;
    $('#shareImage').removeAttribute('src'); $('#saveShareImage').removeAttribute('href');
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = ''; shareFile = null;
  }
  function updateCount() {
    $('#shareCount').textContent = `已选 ${selected.size} 句`;
    $('#generateShareButton').disabled = !selected.size;
  }
  function showSelection() {
    revision++; clearImage();
    $('#shareTitle').textContent = '歌词海报'; $('#shareStatus').textContent = '';
    $('#shareSelection').classList.remove('hidden'); $('#shareSelectionActions').classList.remove('hidden');
    $('#sharePreview').classList.add('hidden'); $('#sharePreviewActions').classList.add('hidden');
    selection.querySelectorAll('input').forEach(input => { input.disabled = false; });
    $('#generateShareButton').textContent = '生成图片'; updateCount();
  }
  function open({ track, lines, selectedIndex = -1 }) {
    cancelPress();
    const entries = lines.map((line, index) => ({ text: line.text, index })).filter(line => isLyric(line.text));
    if (!entries.length) return;
    snapshot = { title: track.title, artist: track.artist, album: track.album, artistId: track.artistId, entries };
    selected = new Set(entries.some(line => line.index === selectedIndex) ? [selectedIndex] : []);
    $('#shareSubtitle').textContent = `${snapshot.title} · ${snapshot.artist}`;
    selection.replaceChildren();
    for (const line of entries) {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      label.className = 'share-line'; input.type = 'checkbox'; input.checked = selected.has(line.index);
      input.onchange = () => { if (input.checked) selected.add(line.index); else selected.delete(line.index); updateCount(); };
      text.textContent = line.text; label.append(input, text); selection.append(label);
    }
    showSelection();
    if (!dialog.open) dialog.showModal();
    const row = selection.children[entries.findIndex(line => selected.has(line.index))];
    if (row) selection.scrollTop = Math.max(0, row.offsetTop - selection.offsetTop - selection.clientHeight / 3);
    else selection.scrollTop = 0;
  }

  function loadCover(path) {
    return new Promise(resolve => {
      const image = new Image();
      const timer = setTimeout(() => { image.onload = image.onerror = null; resolve(null); }, 5000);
      image.onload = () => { clearTimeout(timer); resolve(image); };
      image.onerror = () => { clearTimeout(timer); resolve(null); };
      image.src = new URL(path, document.baseURI).href;
    });
  }
  async function createCard(song, lines) {
    const cover = await loadCover(song.artistId === 'lizhi' ? 'cover-lizhi.jpg' : 'cover.jpg');
    return LyricCard.render(song, lines, cover);
  }
  async function generate() {
    if (!snapshot || !selected.size) return;
    const token = ++revision, song = snapshot;
    const lines = song.entries.filter(line => selected.has(line.index)).map(line => line.text);
    $('#generateShareButton').disabled = true; $('#generateShareButton').textContent = '正在生成…'; $('#shareStatus').textContent = '';
    selection.querySelectorAll('input').forEach(input => { input.disabled = true; });
    try {
      const blob = await createCard(song, lines);
      if (token !== revision || !dialog.open) return;
      clearImage(); imageBlob = blob; imageUrl = URL.createObjectURL(blob);
      const filename = `${song.artist}-${song.title}-歌词分享.jpg`.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
      $('#shareImage').src = imageUrl; $('#shareImage').alt = `${song.title} · ${song.artist}的歌词分享图片`;
      $('#saveShareImage').href = imageUrl; $('#saveShareImage').download = filename;
      // Use a fresh simple name for native receivers; the download keeps the readable song name.
      shareFile = typeof File === 'function' ? new File([blob], `lyrics-${Date.now()}-${token}.jpg`, { type: blob.type, lastModified: Date.now() }) : null;
      let canShare = false;
      try { canShare = !!(shareFile && navigator.share && navigator.canShare?.({ files: [shareFile] })); } catch {}
      $('#nativeShareButton').classList.toggle('hidden', !canShare);
      const supportsVideo = !!globalThis.LyricVideo?.isSupported();
      $('#statusVideoButton').classList.toggle('hidden', !supportsVideo);
      updateShareButtons();
      $('#shareTitle').textContent = '分享图片';
      $('#shareSelection').classList.add('hidden'); $('#shareSelectionActions').classList.add('hidden');
      $('#sharePreview').classList.remove('hidden'); $('#sharePreviewActions').classList.remove('hidden'); $('#sharePreview').scrollTop = 0;
      $('#saveShareImage').focus({ preventScroll: true });
    } catch (error) {
      if (token !== revision || !dialog.open) return;
      $('#shareStatus').textContent = error.message || '图片生成失败，请重试';
    } finally {
      if (token === revision) {
        $('#generateShareButton').textContent = '生成图片'; updateCount();
        selection.querySelectorAll('input').forEach(input => { input.disabled = false; });
      }
    }
  }
  $('#generateShareButton').onclick = generate;
  $('#editShareButton').onclick = showSelection;
  $('#closeShareButton').onclick = () => dialog.close();
  $('#saveShareImage').onclick = () => { $('#shareStatus').textContent = '已请求保存；也可以长按上方图片保存。'; };
  function updateShareButtons() {
    $('#nativeShareButton').disabled = nativeSharePending;
    $('#statusVideoButton').disabled = nativeSharePending || !!videoController;
  }
  async function share(file, video = false) {
    if (!file || nativeSharePending) return;
    const token = revision;
    nativeSharePending = true; updateShareButtons(); $('#shareStatus').textContent = '';
    // Chrome 155's native image share adds its page URL to EXTRA_TEXT on the
    // Android system sheet. Web Share excludes that automatic addition, so
    // supply the same metadata here while keeping one prepared JPEG stream.
    // Dispatch remains inside this tap, before any await.
    try {
      const data = { files: [file] };
      if (!video) {
        const page = new URL(document.baseURI);
        if (page.protocol === 'https:' || page.protocol === 'http:') data.url = page.href;
      }
      await navigator.share(data);
    }
    catch (error) {
      if (token === revision && error.name !== 'AbortError') $('#shareStatus').textContent = video
        ? '暂时无法分享视频，可点“保存视频”后从相册发布。'
        : '暂时无法调用系统分享，请保存图片后从微信朋友圈或状态中选图。';
    } finally { nativeSharePending = false; updateShareButtons(); }
  }
  $('#nativeShareButton').onclick = () => share(shareFile);
  $('#statusVideoButton').onclick = async () => {
    if (nativeSharePending || videoController) return;
    if (videoFile) return share(videoFile, true);
    if (!imageBlob || !globalThis.LyricVideo?.isSupported()) return;
    const token = revision, controller = new AbortController(); videoController = controller;
    updateShareButtons(); $('#statusVideoButton').textContent = '正在生成…';
    $('#shareStatus').textContent = '正在生成 4 秒静音视频，请保持页面打开…';
    try {
      const blob = await LyricVideo.create(imageBlob, { signal: controller.signal });
      if (token !== revision || !dialog.open || controller.signal.aborted) return;
      videoUrl = URL.createObjectURL(blob);
      const save = $('#saveStatusVideo'); save.href = videoUrl;
      save.download = $('#saveShareImage').download.replace(/\.jpg$/i, '-状态.mp4');
      save.classList.remove('hidden');
      const file = typeof File === 'function' ? new File([blob], `lyrics-status-${Date.now()}-${token}.mp4`, { type: 'video/mp4', lastModified: Date.now() }) : null;
      let canShare = false;
      try { canShare = !!(file && navigator.share && navigator.canShare?.({ files: [file] })); } catch {}
      videoFile = canShare ? file : null;
      $('#statusVideoButton').classList.toggle('hidden', !canShare);
      $('#statusVideoButton').textContent = '分享视频';
      $('#shareStatus').textContent = canShare
        ? '已生成 4 秒静音视频，可分享或保存。微信状态直接接收仍有兼容问题。'
        : '已生成静音 MP4。此浏览器不能直接分享视频，可保存后从相册发布。';
    } catch (error) {
      if (token === revision && !controller.signal.aborted) {
        $('#shareStatus').textContent = error.message || '视频生成失败，仍可保存图片';
        $('#statusVideoButton').textContent = '重试生成视频';
      }
    } finally {
      if (videoController === controller) { videoController = null; updateShareButtons(); }
    }
  };
  dialog.addEventListener('close', () => { revision++; cancelPress(); clearImage(); snapshot = null; selected.clear(); });
  globalThis.LyricShare = { open, bindLine, cancelPress };
})();

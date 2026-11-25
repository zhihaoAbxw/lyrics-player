(() => {
  'use strict';

  const WIDTH = 1080, BASE_HEIGHT = 1440, MARGIN = 88, TEXT_WIDTH = WIDTH - MARGIN * 2;
  const FONT = '"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif';
  const OPENING = /[（(【[《〈“‘]$/;
  const CLOSING = /^[，。！？；：、）)】\]》〉”’…,.!?;:]/;

  // Measure with the same font used for drawing, and keep Chinese punctuation
  // with its neighbouring text rather than at the start of a wrapped row.
  function wrap(context, value, width) {
    const rows = [];
    for (const paragraph of String(value ?? '').split('\n')) {
      let row = '';
      for (const character of Array.from(paragraph)) {
        if (!row || context.measureText(row + character).width <= width) {
          row += character;
          continue;
        }
        const characters = Array.from(row);
        let split = characters.length;
        const space = characters.lastIndexOf(' ');
        if (space > characters.length * 0.4) split = space + 1;
        else if ((OPENING.test(row) || CLOSING.test(character)) && split > 1) split--;
        rows.push(characters.slice(0, split).join('').trimEnd());
        row = characters.slice(split).join('').trimStart() + character;
      }
      if (row.trim()) rows.push(row.trimEnd());
    }
    // A single trailing character looks accidental. Move a few characters from
    // the preceding row without changing the text or its reading order.
    if (rows.length > 1 && Array.from(rows.at(-1)).length < 3) {
      const previous = Array.from(rows.at(-2)), last = rows.at(-1);
      if (previous.length > 5 && !/\s/.test(previous.slice(-3).join('') + last)) {
        const suffix = previous.slice(-3).join('');
        if (context.measureText(suffix + last).width <= width) {
          rows[rows.length - 2] = previous.slice(0, -3).join('');
          rows[rows.length - 1] = suffix + last;
        }
      }
    }
    return rows;
  }

  async function render(song, lines, cover) {
    const lyrics = lines.map(line => String(line).trim()).filter(Boolean);
    if (!lyrics.length) throw new Error('请先选择要分享的歌词');

    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成图片，请换个浏览器再试');

    const size = lyrics.length <= 2 ? 72 : lyrics.length <= 4 ? 64 : lyrics.length <= 8 ? 58 : 52;
    const lineHeight = Math.round(size * 1.5), paragraphGap = 22;
    context.font = `400 ${size}px ${FONT}`;
    const paragraphs = lyrics.map(line => wrap(context, line, TEXT_WIDTH));
    const lyricsHeight = paragraphs.reduce((height, rows) => height + rows.length * lineHeight, 0)
      + Math.max(0, paragraphs.length - 1) * paragraphGap;

    const hasCover = !!(cover?.naturalWidth > 0 && cover?.naturalHeight > 0);
    const coverSize = 224, headerGap = 40;
    const metadataX = hasCover ? MARGIN + coverSize + headerGap : MARGIN;
    const metadataWidth = WIDTH - MARGIN - metadataX;
    context.font = `500 48px ${FONT}`;
    const titleRows = wrap(context, song.title || '未命名歌曲', metadataWidth);
    context.font = `400 30px ${FONT}`;
    const artistRows = wrap(context, song.artist || '', metadataWidth);
    const metadataHeight = titleRows.length * 66 + (artistRows.length ? 18 + artistRows.length * 44 : 0);
    const headerHeight = Math.max(hasCover ? coverSize : 0, metadataHeight);
    const bodyTop = MARGIN + headerHeight + 112;
    const footerSpace = 180;
    // Most cards use the familiar 3:4 portrait. Extra selections extend the
    // paper instead of clipping lyrics or shrinking them into unreadable text.
    const height = Math.max(BASE_HEIGHT, Math.ceil(bodyTop + lyricsHeight + footerSpace));
    if (height > 15000) throw new Error('选择的歌词太多，请减少几句后再生成');

    canvas.width = WIDTH; canvas.height = height;
    context.fillStyle = '#f7f5ee'; context.fillRect(0, 0, WIDTH, height);
    if (hasCover) {
      const side = Math.min(cover.naturalWidth, cover.naturalHeight);
      context.drawImage(cover, (cover.naturalWidth - side) / 2, (cover.naturalHeight - side) / 2,
        side, side, MARGIN, MARGIN, coverSize, coverSize);
    }

    context.textBaseline = 'top'; context.textAlign = 'left';
    context.fillStyle = '#293d43'; context.font = `500 48px ${FONT}`;
    let y = MARGIN + Math.max(0, (headerHeight - metadataHeight) / 2);
    for (const row of titleRows) { context.fillText(row, metadataX, y); y += 66; }
    context.fillStyle = '#687b7e'; context.font = `400 30px ${FONT}`;
    if (artistRows.length) {
      y += 18;
      for (const row of artistRows) { context.fillText(row, metadataX, y); y += 44; }
    }

    // A quiet, generous text area; no frames, fake paper texture or ornaments.
    context.fillStyle = '#293d43'; context.font = `400 ${size}px ${FONT}`;
    y = bodyTop + Math.max(0, (height - footerSpace - bodyTop - lyricsHeight) / 2);
    for (let index = 0; index < paragraphs.length; index++) {
      for (const row of paragraphs[index]) {
        context.fillText(row, MARGIN, y); y += lineHeight;
      }
      if (index < paragraphs.length - 1) y += paragraphGap;
    }

    context.fillStyle = '#d9dfd9'; context.fillRect(MARGIN, height - 130, TEXT_WIDTH, 1);
    context.fillStyle = '#788885'; context.font = `400 23px ${FONT}`;
    context.fillText('歌词随身听', MARGIN, height - 94);
    context.textAlign = 'right';
    context.fillText('© abx', WIDTH - MARGIN, height - 94);

    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob?.size && blob.type === 'image/jpeg') resolve(blob);
      else reject(new Error('JPG 图片生成失败，请重试'));
    }, 'image/jpeg', 0.95));
  }

  globalThis.LyricCard = Object.freeze({ render });
})();

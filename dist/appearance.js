(() => {
  const range = document.querySelector('#progress');
  const audio = document.querySelector('#audio');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const darkAppearance = matchMedia('(prefers-color-scheme: dark)');

  function updateProgressAppearance() {
    const max = Number(range.max);
    const percent = max > 0 ? Math.max(0, Math.min(100, Number(range.value) / max * 100)) : 0;
    range.style.setProperty('--progress', `${percent}%`);
  }

  function updateThemeColor() {
    themeColor?.setAttribute('content', darkAppearance.matches ? '#151518' : '#f1f1f5');
  }

  range.addEventListener('input', updateProgressAppearance);
  range.addEventListener('change', updateProgressAppearance);
  for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) {
    audio.addEventListener(event, updateProgressAppearance);
  }
  darkAppearance.addEventListener('change', updateThemeColor);
  updateProgressAppearance();
  updateThemeColor();
})();

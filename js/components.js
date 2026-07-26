// Reusable UI components: star rating, tag input, image lightbox
(function (global) {
  'use strict';

  // ===== Star Rating (interactive) =====
  // Mount an interactive star rating into container
  // onChange(value) called with new value (0-5, supports .5)
  function mountStarRating(container, value, onChange) {
    container.innerHTML = '';
    container.className = 'stars stars-interactive';
    let current = Number(value) || 0;
    function build() {
      container.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        // full star (right half = full)
        const fullEl = document.createElement('i');
        fullEl.className = 'star';
        fullEl.dataset.value = String(i);
        fullEl.textContent = '★';
        // half (left half = i-0.5)
        const halfEl = document.createElement('i');
        halfEl.className = 'star';
        halfEl.dataset.value = String(i - 0.5);
        // We need a clickable region for the left half
        // Use overlay approach: each star has two click zones
        const starWrap = document.createElement('span');
        starWrap.style.position = 'relative';
        starWrap.style.display = 'inline-block';
        starWrap.style.width = '1em';
        starWrap.style.overflow = 'hidden';

        // background (empty)
        const bg = document.createElement('i');
        bg.className = 'star';
        bg.style.color = 'var(--empty-color)';
        bg.textContent = '★';

        // overlay (filled based on current)
        const overlay = document.createElement('i');
        overlay.className = 'star';
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.overflow = 'hidden';
        overlay.style.color = 'var(--star-color)';
        overlay.style.pointerEvents = 'none';
        let filledPct = 0;
        if (current >= i) filledPct = 100;
        else if (current >= i - 0.5) filledPct = 50;
        overlay.style.width = filledPct + '%';
        overlay.textContent = '★';

        // half click zone (left half)
        const halfZone = document.createElement('span');
        halfZone.style.position = 'absolute';
        halfZone.style.left = '0';
        halfZone.style.top = '0';
        halfZone.style.width = '50%';
        halfZone.style.height = '100%';
        halfZone.style.cursor = 'pointer';
        halfZone.title = String(i - 0.5);
        halfZone.onclick = (e) => {
          e.stopPropagation();
          current = i - 0.5;
          if (onChange) onChange(current);
          build();
        };
        // full click zone (right half)
        const fullZone = document.createElement('span');
        fullZone.style.position = 'absolute';
        fullZone.style.left = '50%';
        fullZone.style.top = '0';
        fullZone.style.width = '50%';
        fullZone.style.height = '100%';
        fullZone.style.cursor = 'pointer';
        fullZone.title = String(i);
        fullZone.onclick = (e) => {
          e.stopPropagation();
          current = i;
          if (onChange) onChange(current);
          build();
        };

        starWrap.appendChild(bg);
        starWrap.appendChild(overlay);
        starWrap.appendChild(halfZone);
        starWrap.appendChild(fullZone);
        container.appendChild(starWrap);
      }
    }
    build();
    return {
      get value() { return current; },
      set value(v) { current = Number(v) || 0; build(); }
    };
  }

  // ===== Tag Input =====
  // Mount a tag input into container
  // tags: initial array of strings; onChange(newTagsArray)
  function mountTagInput(container, tags, onChange) {
    let list = Array.isArray(tags) ? [...tags] : [];
    container.className = 'tag-input';
    function render() {
      container.innerHTML = '';
      list.forEach((tag, idx) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        const label = document.createElement('span');
        label.textContent = tag;
        const remove = document.createElement('span');
        remove.className = 'remove';
        remove.textContent = '×';
        remove.onclick = () => {
          list.splice(idx, 1);
          if (onChange) onChange(list);
          render();
        };
        chip.appendChild(label);
        chip.appendChild(remove);
        container.appendChild(chip);
      });
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = list.length ? '' : '输入标签后回车';
      input.style.minWidth = list.length ? '40px' : '100%';
      function commit() {
        const v = input.value.trim();
        if (v && !list.includes(v)) {
          list.push(v);
          if (onChange) onChange(list);
          render();
        } else {
          input.value = '';
        }
      }
      input.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Backspace' && input.value === '' && list.length > 0) {
          list.pop();
          if (onChange) onChange(list);
          render();
        }
      };
      input.onblur = () => { if (input.value.trim()) commit(); };
      container.appendChild(input);
      input.focus();
    }
    render();
    return {
      get value() { return list; },
      set value(v) { list = Array.isArray(v) ? [...v] : []; render(); }
    };
  }

  // ===== Image lightbox =====
  function openLightbox(src, alt) {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal image-modal';
    const img = document.createElement('img');
    img.src = src;
    if (alt) img.alt = alt;
    modal.appendChild(img);
    overlay.appendChild(modal);
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    function close() {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    }
    overlay.onclick = (e) => { if (e.target === overlay || e.target === img) close(); };
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
  }

  // ===== Loading indicator =====
  function mountSpinner(container, text) {
    container.innerHTML = `<div class="loading">${text || '加载中...'}</div>`;
  }

  global.Components = {
    mountStarRating,
    mountTagInput,
    openLightbox,
    mountSpinner
  };
})(window);

// Kadr — Minimalist High-End SaaS Client Logic

document.addEventListener('DOMContentLoaded', () => {
  // 1. Mobile Menu Drawer Navigation
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  if (mobileMenuBtn && mobileDrawer) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileDrawer.classList.toggle('open');
    });

    mobileDrawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('open');
      });
    });
  }

  // 2. Pure Typographic Preset Switcher Engine
  const presetPills = document.querySelectorAll('.preset-pill-btn');
  const dynamicQuote = document.getElementById('dynamicTypographyQuote');
  const presetActiveLabel = document.getElementById('presetActiveLabel');
  const btnMorphCycle = document.getElementById('btnMorphCycle');

  const presetConfigs = {
    mrbeast: {
      className: 'preset-mrbeast-pop',
      label: 'MrBeast Pop — Punchy bounce scale with dynamic red stroke',
      phrases: [
        'UNLOCK <span style="color: #facc15;">MILLIONS</span> OF VIEWS WITH AI',
        'THIS VIDEO <span style="color: #ef4444;">EXPLODED</span> TO 10M CLIPS',
        'STOP <span style="color: #facc15;">WASTING</span> HOURS EDITING'
      ]
    },
    hormozi: {
      className: 'preset-hormozi-box',
      label: 'Hormozi Box — High-retention yellow emphasis with blue highlight jumps',
      phrases: [
        'STOP PAYING <span class="hormozi-badge">$30/MO</span> FOR SAAS',
        'GET <span class="hormozi-badge">10X</span> RETENTION INSTANTLY',
        'RUN IT <span class="hormozi-badge">LOCALLY</span> ON YOUR GPU'
      ]
    },
    vox: {
      className: 'preset-vox-editorial',
      label: 'Vox Editorial — Elegant editorial serif with animated highlighter',
      phrases: [
        'The future of video creation is <span class="vox-marker">local-first.</span>',
        'Zero cloud waitlists, <span class="vox-marker">instant AI.</span>',
        'Studio-grade exports <span class="vox-marker">without limits.</span>'
      ]
    },
    neon: {
      className: 'preset-neon-cyber',
      label: 'Neon Cyberpunk — Cyan luminescent monospace with hardware glow',
      phrases: [
        'NVENC GPU // <span style="color: #ffffff;">16X ACCELERATED</span>',
        'WHISPER TURBO // <span style="color: #ffffff;">0.00ms SYNC</span>',
        'HARDWARE PIPELINE // <span style="color: #ffffff;">ONLINE</span>'
      ]
    }
  };

  let currentPreset = 'mrbeast';
  let phraseIndex = 0;
  let autoLoopInterval = null;

  function renderPhrase(animate = true) {
    if (!dynamicQuote) return;
    const config = presetConfigs[currentPreset];
    const phrase = config.phrases[phraseIndex % config.phrases.length];

    if (animate) {
      dynamicQuote.style.opacity = '0';
      dynamicQuote.style.transform = 'translateY(6px)';
      setTimeout(() => {
        dynamicQuote.className = config.className;
        dynamicQuote.innerHTML = phrase;
        dynamicQuote.style.transition = 'opacity 220ms ease, transform 220ms ease';
        dynamicQuote.style.opacity = '1';
        dynamicQuote.style.transform = 'translateY(0)';
      }, 120);
    } else {
      dynamicQuote.className = config.className;
      dynamicQuote.innerHTML = phrase;
    }

    if (presetActiveLabel) {
      presetActiveLabel.textContent = config.label;
    }
  }

  function startAutoCycle() {
    if (autoLoopInterval) clearInterval(autoLoopInterval);
    autoLoopInterval = setInterval(() => {
      phraseIndex++;
      renderPhrase(true);
    }, 3200);
  }

  // Handle Preset Pill Clicks
  presetPills.forEach(pill => {
    pill.addEventListener('click', () => {
      presetPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      const key = pill.getAttribute('data-preset');
      if (presetConfigs[key]) {
        currentPreset = key;
        phraseIndex = 0;
        renderPhrase(true);
        startAutoCycle();
      }
    });
  });

  // Handle Manual Phrase Cycling Button
  if (btnMorphCycle) {
    btnMorphCycle.addEventListener('click', () => {
      phraseIndex++;
      renderPhrase(true);
      startAutoCycle();
    });
  }

  // Initial render & timer start
  renderPhrase(false);
  startAutoCycle();

  // 3. FAQ Accordion Logic
  const faqRows = document.querySelectorAll('.faq-row-item');
  faqRows.forEach(row => {
    const trigger = row.querySelector('.faq-trigger-btn');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
      const isOpen = row.classList.contains('open');
      faqRows.forEach(r => r.classList.remove('open'));
      if (!isOpen) {
        row.classList.add('open');
      }
    });
  });

  // 4. OS Auto-Detection for Downloads
  const userAgent = window.navigator.userAgent.toLowerCase();
  const winCard = document.getElementById('dl-card-win');
  const macCard = document.getElementById('dl-card-mac');

  if (userAgent.indexOf('mac') !== -1 && macCard) {
    macCard.classList.add('featured');
    if (winCard) winCard.classList.remove('featured');
  } else if (winCard) {
    winCard.classList.add('featured');
  }

  // 5. Copy Git Clone Command
  const copyBtn = document.getElementById('btnCopyGit');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText('git clone https://github.com/Raymond0385/YT.git').then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'COPIED!';
        setTimeout(() => {
          copyBtn.textContent = original;
        }, 2000);
      });
    });
  }

  // 6. Smooth Anchor Scrolling with 76px Navbar Offset
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || !targetId.startsWith('#')) return;
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerOffset = 76;
        const elementPosition = targetEl.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
});

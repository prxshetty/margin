// ── Intersection Observer for Scroll Entry Animations ──
document.addEventListener('DOMContentLoaded', () => {
  const animatedElements = document.querySelectorAll('.fade-in-up, .hero-text-reveal, .header-reveal');
  
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };
  
  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  
  animatedElements.forEach(el => observer.observe(el));
});

// ── Sticky Header Scroll State Toggle ──
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header.home-header');
  const hero = document.querySelector('.hero-section');
  if (header && hero) {
    const heroBottom = () => hero.offsetTop + hero.offsetHeight;
    const handleScroll = () => {
      if (window.scrollY >= heroBottom()) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }
});

// ── Quick Start Setup Tab Switcher & Code Copy ──
document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.setup-tab');
  const contents = document.querySelectorAll('.setup-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const activeTab = tab.getAttribute('data-tab');
      
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`tab-${activeTab}`).classList.add('active');
    });
  });

  // Code Block Copy Button
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const commandText = btn.getAttribute('data-clipboard');
      navigator.clipboard.writeText(commandText).then(() => {
        const copyIcon = btn.querySelector('.copy-icon');
        const checkIcon = btn.querySelector('.check-icon');
        
        if (copyIcon && checkIcon) {
          copyIcon.style.display = 'none';
          checkIcon.style.display = 'block';
          btn.style.borderColor = 'var(--accent-green)';
          btn.style.color = 'var(--accent-green)';
          
          setTimeout(() => {
            copyIcon.style.display = 'block';
            checkIcon.style.display = 'none';
            btn.style.borderColor = '';
            btn.style.color = '';
          }, 2000);
        }
      }).catch(err => {
        console.error('Failed to copy text: ', err);
      });
    });
  });
});

// ── Interactive Workspace Mockup State Controller ──
document.addEventListener('DOMContentLoaded', () => {
  const editorContent = document.getElementById('mock-editor');
  const mockupInput = document.getElementById('mockup-input');
  const selectionChip = document.getElementById('mockup-selection-chip');
  const bubbleUser = document.getElementById('bubble-user');
  const bubbleUserText = document.getElementById('bubble-user-text');
  const bubbleAi = document.getElementById('bubble-ai');
  const bubbleAiLabel = document.getElementById('bubble-ai-label');
  const bubbleAiText = document.getElementById('bubble-ai-text');

  let demoState = 'idle'; // 'idle' | 'running' | 'done'
  let autoplayTimer = null;
  let textInterval = null;
  let statusInterval = null;
  const originalEditorHTML = editorContent.innerHTML;

  const resetDemo = () => {
    if (autoplayTimer) clearTimeout(autoplayTimer);
    if (textInterval) clearInterval(textInterval);
    if (statusInterval) clearInterval(statusInterval);
    
    editorContent.innerHTML = originalEditorHTML;
    if (mockupInput) mockupInput.textContent = '';
    selectionChip.style.display = 'none';
    bubbleUser.style.display = 'none';
    bubbleAi.style.display = 'none';
    
    const target = document.getElementById('selection-target');
    if (target) {
      target.classList.remove('editor-highlight');
    }
    demoState = 'idle';
  };

  const runDemo = () => {
    if (demoState !== 'idle') return;
    
    demoState = 'running';
    
    // 1. Highlight target text
    const target = document.getElementById('selection-target');
    if (target) {
      target.classList.add('editor-highlight');
    }
    
    // 2. Typewriter animation into input card
    const instruction = 'Rewrite to be more descriptive and gothic.';
    let instIndex = 0;
    if (mockupInput) mockupInput.textContent = '';
    selectionChip.style.display = 'inline-flex';
    
    textInterval = setInterval(() => {
      if (instIndex < instruction.length) {
        if (mockupInput) mockupInput.textContent += instruction[instIndex];
        instIndex++;
      } else {
        clearInterval(textInterval);
        
        // 3. Show user bubble after typing instruction
        autoplayTimer = setTimeout(() => {
          if (mockupInput) mockupInput.textContent = '';
          selectionChip.style.display = 'none';
          bubbleUserText.textContent = instruction;
          bubbleUser.style.display = 'block';
          
          // 4. Show AI response bubble + stream into editor
          autoplayTimer = setTimeout(() => {
            bubbleAi.style.display = 'block';
            
            const newText = 'The sky hung heavy, a bruised violet shroud over the decaying floor. Kaelen picked his way through the rot, cold seeping deep into his marrow.';
            let charIndex = 0;
            if (target) {
              target.textContent = '';
            }
            
            statusInterval = setInterval(() => {
              if (charIndex < newText.length) {
                if (target) {
                  target.textContent += newText[charIndex];
                }
                charIndex++;
              } else {
                clearInterval(statusInterval);
                
                // 5. Done state
                demoState = 'done';
                bubbleAiLabel.textContent = 'Applied';
                bubbleAiText.textContent = 'Replaced selection with new beat prose.';
                if (target) {
                  target.classList.remove('editor-highlight');
                }
              }
            }, 20);
          }, 600);
        }, 400);
      }
    }, 25);
  };

  // Allow simulated file selection in mockup sidebar
  const files = document.querySelectorAll('.mockup-file');
  files.forEach(f => {
    f.addEventListener('click', () => {
      files.forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      
      const fileId = f.id;
      if (fileId === 'file-kaelen') {
        editorContent.innerHTML = `<h2>Kaelen — Character Profile</h2>
          <p><strong>Archetype:</strong> Reluctant Explorer / Ranger</p>
          <p><strong>Speech Habits:</strong> Formal, terse, soft-spoken, rarely uses contractions.</p>
          <p><strong>Physical Description:</strong> Tall, weathered features, eyes that shift restlessly between trees. Wears a frayed dark green cloak.</p>`;
      } else if (fileId === 'file-chapter-1') {
        editorContent.innerHTML = originalEditorHTML;
      } else if (fileId === 'file-chapter-2') {
        editorContent.innerHTML = `<h2>Chapter 2 — The Cold Hearth</h2>
          <p>The chimney of the abandoned outpost stood like an old bone pointing at the gray sky. Kaelen knelt beside the hearth, scraping away damp charcoal.</p>
          <p>He found nothing but moldering bark. "No one has sought shelter here for months," he said, blowing the soot from his fingers.</p>`;
      } else if (fileId === 'file-eldoria') {
        editorContent.innerHTML = `<h2>Eldoria — World Bible</h2>
          <p><strong>Geography:</strong> A fractured continent of mist-choked valleys, ancient pine forests, and black obsidian spires rising from the snow.</p>
          <p><strong>Era:</strong> Post-cataclysm, the Godthaw — a period marked by retreating glacial sheets revealing long-forgotten stone cities.</p>
          <p><strong>Lore:</strong> The remnants of the spires hum with residual energy, attracting scouts, relic hunters, and scholars seeking lost magic.</p>`;
      } else if (fileId === 'file-gothic') {
        editorContent.innerHTML = `<h2>Gothic Prose — Style Guide</h2>
          <p><strong>Tone:</strong> Melancholic, ornate, weather-driven. Infuse descriptions of landscapes with emotional weights and a lingering sense of historical grief.</p>
          <p><strong>Devices:</strong> Pathetic fallacy, archaic diction, long compound sentences. Construct clauses that build tension and mimic the slow passage of time.</p>
          <p><strong>Focus:</strong> Prioritize sensory details of decay, dampness, and shifting shadows to build atmospheric dread. The environment must feel like a living, breathing antagonist.</p>`;
      } else if (fileId === 'file-voice') {
        editorContent.innerHTML = `<h2>Character Voice — Notes</h2>
          <p><strong>Kaelen:</strong> Terse, dry. Avoids metaphors. Speaks in short, declarative sentences.</p>
          <p><strong>Narrator:</strong> Omniscient, lyrical. Mirrors the emotional weight of scenes.</p>
          <p><strong>Dialogue:</strong> Keep conversations grounded and brief. Dialogue should serve to reveal tension rather than expose exposition.</p>`;
      }
    });
  });

  // Autoplay the demo when the mockup enters the viewport
  const mockup = document.querySelector('.hero-window');
  if (mockup) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && demoState === 'idle') {
          runDemo();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    observer.observe(mockup);
  }
});

// ── Favicon Dynamic Inversion (Light/Dark mode tabs) ──
document.addEventListener('DOMContentLoaded', () => {
  const favicon = document.querySelector('link[rel="icon"]');
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let invertedCache = null;

  if (!favicon) return;

  function getInvertedFavicon(src, callback) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Invert R, G, B color channels, keep alpha
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      ctx.putImageData(imgData, 0, 0);
      callback(canvas.toDataURL());
    };
    img.src = src;
  }

  function updateFavicon() {
    if (mediaQuery.matches) {
      favicon.href = 'assets/logo.png';
    } else {
      if (invertedCache) {
        favicon.href = invertedCache;
      } else {
        getInvertedFavicon('assets/logo.png', (dataUrl) => {
          invertedCache = dataUrl;
          if (!mediaQuery.matches) {
            favicon.href = dataUrl;
          }
        });
      }
    }
  }

  mediaQuery.addEventListener('change', updateFavicon);
  updateFavicon();
});

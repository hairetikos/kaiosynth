// Virtual keyboard (C2..C6). Integrates microtuning tooltips & note events.
export function buildVirtualKeyboard(container, {
  start=36, end=84, root=60,
  getFreqForMidi,
  onNoteOn,
  onNoteOff
}) {
  container.innerHTML = '';
  container.style.display='flex';
  container.style.userSelect='none';
  container.style.height='60px';
  container.style.position='relative';

  const active = new Set();

  function midiName(m) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[m%12] + Math.floor(m/12 - 1);
  }

  for (let m=start; m<=end; m++) {
    const note = m%12;
    const isBlack = [1,3,6,8,10].includes(note);
    const key = document.createElement('div');
    key.className = 'vk-key';
    key.dataset.midi = m;
    key.textContent = isBlack ? '' : midiName(m);
    key.style.flex = isBlack ? '0 0 24px' : '0 0 32px';
    key.style.marginLeft = isBlack ? '-16px' : '0';
    key.style.zIndex = isBlack ? '2':'1';
    key.style.position='relative';
    key.style.display='flex';
    key.style.alignItems='flex-end';
    key.style.justifyContent='center';
    key.style.fontSize='10px';
    key.style.padding='2px';
    key.style.boxSizing='border-box';
    key.style.cursor='pointer';
    key.style.border = '1px solid #222';
    key.style.borderRadius = '3px';
    key.style.background = isBlack ? '#1b2433' : '#fafafa';
    key.style.color = isBlack ? '#eee' : '#222';
    if (!isBlack) key.style.boxShadow='inset 0 1px 2px #999';
    if (m===root) key.style.outline='2px solid #f39c12';

    const freq = getFreqForMidi ? getFreqForMidi(m) : 440*Math.pow(2,(m-69)/12);
    key.title = `${midiName(m)}  •  ${freq.toFixed(2)} Hz`;

    let down=false;
    const press = (vel=0.9)=>{
      if (down) return;
      down=true;
      active.add(m);
      key.style.background = isBlack ? '#31415f' : '#d0e2ff';
      onNoteOn && onNoteOn(m, vel);
    };
    const release = ()=>{
      if (!down) return;
      down=false;
      active.delete(m);
      key.style.background = isBlack ? '#1b2433' : '#fafafa';
      onNoteOff && onNoteOff(m);
    };

    key.addEventListener('mousedown', e=> { e.preventDefault(); press(); });
    window.addEventListener('mouseup', e=> release());
    key.addEventListener('mouseleave', e=> { if (down && e.buttons===0) release(); });

    key.addEventListener('touchstart', e=> { e.preventDefault(); press(1.0); }, {passive:false});
    key.addEventListener('touchend', e=> { e.preventDefault(); release(); }, {passive:false});

    container.appendChild(key);
  }

  return {
    highlight(m) {
      const el = container.querySelector(`.vk-key[data-midi="${m}"]`);
      if (el) el.classList.add('vk-ext-active');
    },
    setRoot(r) {
      container.querySelectorAll('.vk-key').forEach(k=>{
        k.style.outline='none';
      });
      const el = container.querySelector(`.vk-key[data-midi="${r}"]`);
      if (el) el.style.outline='2px solid #f39c12';
    },
    refreshTooltips() {
      container.querySelectorAll('.vk-key').forEach(k=>{
        const m = parseInt(k.dataset.midi);
        const freq = getFreqForMidi ? getFreqForMidi(m) : 440*Math.pow(2,(m-69)/12);
        k.title = `${midiName(m)}  •  ${freq.toFixed(2)} Hz`;
      });
    }
  };
}

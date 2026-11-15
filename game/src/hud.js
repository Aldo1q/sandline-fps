// The DOM HUD: health, ammo, money, timer, score, kill feed, crosshair,
// hitmarker, bomb status, plant bar, buy menu, banners and the minimap. It
// never touches the simulation; main.js pushes numbers in and reads the play
// and buy callbacks out. All reads are cached so the DOM is only written when
// a value actually changes.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playBtn = $('play');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorRow = $('armor-row');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const aliveValue = $('alive-value');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombStatus = $('bomb-status');
  const bombTimer = $('bomb-timer');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const buyMenu = $('buy-menu');
  const buyGrid = $('buy-grid');
  const buyMoney = $('buy-money');
  const damageFlash = $('damage-flash');
  const minimap = $('minimap');
  const mmCtx = minimap.getContext('2d');

  let lastHealth = -1;
  let lastArmor = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';
  let lastAlive = '';
  let hitTimer = 0;

  const OVERLAY_COPY = {
    start: {
      title: 'SANDLINE',
      copy: 'Dustline Yard. You are Vanguard — plant the bomb at A or B, or clear every Raider. Buy between rounds, stop to aim, and mind the corners.',
      action: 'Click to play',
    },
    paused: {
      title: 'SANDLINE',
      copy: 'Paused. Click to resume.',
      action: 'Click to resume',
    },
    match: {
      title: 'Match over',
      copy: '',
      action: 'Play again',
    },
  };

  function setHealth(hp, armor) {
    const h = Math.round(hp);
    if (h !== lastHealth) {
      lastHealth = h;
      healthFill.style.width = `${h}%`;
      healthNum.textContent = String(h);
      healthFill.classList.toggle('low', h <= 30);
    }
    const a = Math.round(armor);
    if (a !== lastArmor) {
      lastArmor = a;
      armorRow.style.display = a > 0 ? '' : 'none';
      armorNum.textContent = String(a);
    }
  }

  function setAmmo(mag, reserve, name) {
    if (mag !== lastMag || reserve !== lastReserve) {
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoMag.parentElement.classList.toggle('empty', mag === 0);
    }
    if (name !== lastWeapon) {
      lastWeapon = name;
      weaponName.textContent = name;
    }
  }

  function setMoney(m) {
    if (m === lastMoney) return;
    lastMoney = m;
    moneyValue.textContent = `$${m}`;
    if (buyMoney) buyMoney.textContent = `$${m}`;
  }

  function setTimer(seconds, phase) {
    const s = Math.max(0, Math.ceil(seconds));
    if (s === lastTimer) return;
    lastTimer = s;
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    timerValue.textContent = `${mm}:${ss}`;
    timerValue.parentElement.classList.toggle('buy-phase', phase === 'buy');
  }

  function setScore(a, d, round) {
    const text = `Vanguard ${a} — ${d} Raiders · Round ${round}`;
    if (text === lastScore) return;
    lastScore = text;
    scoreValue.textContent = text;
  }

  function setAlive(a, d) {
    const text = `▲ ${a}  ·  ▼ ${d}`;
    if (text === lastAlive) return;
    lastAlive = text;
    aliveValue.textContent = text;
  }

  function killfeedAdd(text, good) {
    const div = document.createElement('div');
    div.className = good ? 'kill good' : 'kill';
    div.textContent = text;
    killfeed.prepend(div);
    while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
    setTimeout(() => {
      div.classList.add('fade');
      setTimeout(() => div.remove(), 600);
    }, 3800);
  }

  function hitMarker(killed) {
    hitmarker.classList.add('on');
    hitmarker.style.transform = killed
      ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)'
      : 'translate(-50%, -50%) rotate(45deg)';
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => {
      hitmarker.classList.remove('on');
      hitmarker.style.transform = '';
    }, 110);
  }

  function setSpread(px) {
    crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
  }

  function flashDamage() {
    damageFlash.classList.remove('on');
    void damageFlash.offsetWidth;
    damageFlash.classList.add('on');
  }

  function showBanner(title, sub, good) {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    banner.classList.toggle('good', !!good);
    banner.classList.toggle('bad', !good);
    banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
  }

  function showBomb(seconds) {
    bombStatus.hidden = false;
    bombTimer.textContent = `${Math.max(0, seconds).toFixed(1)}s`;
  }

  function hideBomb() {
    bombStatus.hidden = true;
  }

  function showPlant(label, progress) {
    plantBar.hidden = false;
    plantLabel.textContent = label;
    plantFill.style.width = `${Math.round(progress * 100)}%`;
  }

  function hidePlant() {
    plantBar.hidden = true;
  }

  function showOverlay(mode, extra) {
    const text = OVERLAY_COPY[mode];
    overlayTitle.textContent = text.title;
    overlayCopy.textContent = mode === 'match' ? extra || '' : text.copy;
    playBtn.textContent = text.action;
    overlay.hidden = false;
    playBtn.focus();
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  // Buy menu: rebuilt each time it opens; rows are buttons, number keys 1-6 buy.
  function showBuy(shop, money, owned, grenades) {
    buyGrid.innerHTML = '';
    shop.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-item';
      const have = item.kind === 'weapon' ? (owned[item.id] ? 'Owned' : '')
        : item.kind === 'grenade' ? `Carrying ${grenades[item.id] || 0}/2`
          : item.kind === 'armor' ? '' : '';
      btn.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${item.name}</span><span class="buy-have">${have}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      btn.disabled = money < item.price;
      btn.addEventListener('click', () => onBuy(item.id));
      buyGrid.appendChild(btn);
    });
    setMoney(money);
    buyMenu.hidden = false;
  }

  function hideBuy() {
    buyMenu.hidden = true;
  }

  let onBuy = () => {};
  let onPlayHandler = () => {};

  // Minimap: walls as blocks, sites as rings, player as a wedge, teammates as
  // teal dots, enemies as rust dots only while recently seen.
  function drawMinimap(map, playerPos, playerYaw, teammates, enemies, sites, bomb) {
    const w = minimap.width;
    const h = minimap.height;
    const sx = w / (map.maxX - map.minX);
    const sz = h / (map.maxZ - map.minZ);
    const X = (x) => (x - map.minX) * sx;
    const Z = (z) => (z - map.minZ) * sz;
    mmCtx.clearRect(0, 0, w, h);
    mmCtx.fillStyle = 'rgba(20,18,14,0.85)';
    mmCtx.fillRect(0, 0, w, h);
    mmCtx.fillStyle = 'rgba(201,168,106,0.25)';
    for (const c of map.colliders) {
      mmCtx.fillRect(X(c.min.x), Z(c.min.z), Math.max(1, (c.max.x - c.min.x) * sx), Math.max(1, (c.max.z - c.min.z) * sz));
    }
    for (const key of Object.keys(sites)) {
      const s = sites[key];
      mmCtx.strokeStyle = key === 'A' ? '#2fb3a3' : '#b0542f';
      mmCtx.lineWidth = 1.5;
      mmCtx.beginPath();
      mmCtx.arc(X(s.center.x), Z(s.center.z), s.radius * sx, 0, Math.PI * 2);
      mmCtx.stroke();
      mmCtx.fillStyle = key === 'A' ? '#2fb3a3' : '#b0542f';
      mmCtx.font = 'bold 11px system-ui, sans-serif';
      mmCtx.textAlign = 'center';
      mmCtx.fillText(key, X(s.center.x), Z(s.center.z) + 4);
    }
    if (bomb && bomb.planted) {
      mmCtx.fillStyle = '#ff5a3c';
      mmCtx.beginPath();
      mmCtx.arc(X(bomb.position.x), Z(bomb.position.z), 4, 0, Math.PI * 2);
      mmCtx.fill();
    }
    mmCtx.fillStyle = '#2fb3a3';
    for (const t of teammates) {
      if (!t.alive) continue;
      mmCtx.beginPath();
      mmCtx.arc(X(t.pos.x), Z(t.pos.z), 2.5, 0, Math.PI * 2);
      mmCtx.fill();
    }
    mmCtx.fillStyle = '#b0542f';
    for (const e of enemies) {
      if (!e.alive || !e.seenRecently) continue;
      mmCtx.beginPath();
      mmCtx.arc(X(e.pos.x), Z(e.pos.z), 2.5, 0, Math.PI * 2);
      mmCtx.fill();
    }
    // Player wedge.
    mmCtx.save();
    mmCtx.translate(X(playerPos.x), Z(playerPos.z));
    mmCtx.rotate(Math.atan2(-Math.sin(playerYaw), -Math.cos(playerYaw)) + Math.PI / 2);
    mmCtx.fillStyle = '#efe7d6';
    mmCtx.beginPath();
    mmCtx.moveTo(0, -6);
    mmCtx.lineTo(4, 5);
    mmCtx.lineTo(-4, 5);
    mmCtx.closePath();
    mmCtx.fill();
    mmCtx.restore();
  }

  return {
    setHealth,
    setAmmo,
    setMoney,
    setTimer,
    setScore,
    setAlive,
    killfeedAdd,
    hitMarker,
    setSpread,
    flashDamage,
    showBanner,
    hideBanner,
    showBomb,
    hideBomb,
    showPlant,
    hidePlant,
    showOverlay,
    hideOverlay,
    showBuy,
    hideBuy,
    drawMinimap,
    onPlay(handler) {
      onPlayHandler = handler;
      playBtn.addEventListener('click', () => onPlayHandler());
    },
    setOnBuy(handler) {
      onBuy = handler;
    },
  };
}

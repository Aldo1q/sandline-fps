// The DOM HUD: health, ammo, money, timer, score, kill feed, crosshair,
// hitmarker, bomb status, plant bar, buy menu, banners and the minimap. It
// never touches the simulation; main.js pushes numbers in and reads the play
// and buy callbacks out. All reads are cached so the DOM is only written when
// a value actually changes.
import * as THREE from 'three';

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
  const radioFeed = $('radio-feed');
  const dmgDir = $('dmg-dir');
  const flashOverlay = $('flash-overlay');
  const loadoutEl = $('loadout');
  const planEl = $('plan-bar');
  const hudRoot = $('hud');
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
  let lastLoadout = '';
  let hitTimer = 0;
  let dmgTimer = 0;
  let flashTimer = 0;

  // Floating damage popups: 4 pooled divs projected from world space, so a
  // "HEAD 100" floats over the enemy that was hit. Pooled, never allocated
  // per hit; updatePopups() is called once per frame by main.js.
  const popups = [];
  for (let i = 0; i < 4; i += 1) {
    const el = document.createElement('div');
    el.className = 'dmg-pop';
    el.style.display = 'none';
    hudRoot.appendChild(el);
    popups.push({ el, pos: new THREE.Vector3(), left: 0 });
  }
  let popupIdx = 0;
  const projVec = new THREE.Vector3();

  function showDamagePopup(x, y, z, text, head) {
    const p = popups[popupIdx];
    popupIdx = (popupIdx + 1) % popups.length;
    p.pos.set(x, y, z);
    // Head hits float above the helmet, never over the vest/torso.
    if (head) p.pos.y += 0.5;
    p.el.textContent = text;
    p.el.classList.toggle('head', !!head);
    p.el.style.display = '';
    p.left = 1.1;
  }

  function updatePopups(camera, dt) {
    for (const p of popups) {
      if (p.left <= 0) continue;
      p.left -= dt;
      if (p.left <= 0) {
        p.el.style.display = 'none';
        continue;
      }
      projVec.copy(p.pos).project(camera);
      if (projVec.z > 1) {
        p.el.style.display = 'none';
        p.left = 0;
        continue;
      }
      p.el.style.display = '';
      p.el.style.left = `${(projVec.x * 0.5 + 0.5) * window.innerWidth}px`;
      p.el.style.top = `${(-projVec.y * 0.5 + 0.5) * window.innerHeight - (1.1 - p.left) * 40}px`;
      p.el.style.opacity = String(Math.min(1, p.left / 0.4));
    }
  }

  // Team plan line under the top bar: "PLAN: PUSH SITE A — YOU: ENTRY".
  function setPlan(text) {
    planEl.textContent = text;
  }

  // Bottom-centre loadout: weapon slots (owned, current highlighted) and
  // grenade counts, plus cash — the buy economy at a glance, mid-round.
  function setLoadout(owned, current, grenades, money) {
    const slots = ['pistol', 'rifle', 'smg', 'sniper']
      .map((id, i) => `${i + 1} ${owned[id] ? (id === current ? `[${id.toUpperCase()}]` : id.toUpperCase()) : '—'}`)
      .join('  ');
    const text = `CASH $${money} · ${slots} · G Frag ×${grenades.frag || 0}  T Smoke ×${grenades.smoke || 0}  F Flash ×${grenades.flash || 0}`;
    if (text === lastLoadout) return;
    lastLoadout = text;
    loadoutEl.textContent = text;
  }

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
    const text = `Vanguard ${a} — ${d} Raiders · Round ${round} of 9`;
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

  // Radio callouts from the bots: who saw what, where. Teal = Vanguard,
  // rust = Raiders. Kept to four lines so it never covers the fight.
  function radioAdd(text, team) {
    const div = document.createElement('div');
    div.className = `radio ${team === 'attack' ? 'attack' : 'defend'}`;
    div.textContent = text;
    radioFeed.prepend(div);
    while (radioFeed.children.length > 4) radioFeed.removeChild(radioFeed.lastChild);
    setTimeout(() => {
      div.classList.add('fade');
      setTimeout(() => div.remove(), 600);
    }, 5000);
  }

  // Damage direction: a red arc at screen centre rotated toward the shooter,
  // so the player knows which way to turn. angleDeg 0 = straight ahead.
  function damageFrom(angleDeg) {
    dmgDir.style.transform = `translate(-50%, -50%) rotate(${Math.round(angleDeg)}deg)`;
    dmgDir.classList.add('on');
    clearTimeout(dmgTimer);
    dmgTimer = setTimeout(() => dmgDir.classList.remove('on'), 700);
  }

  // Flashbang white-out: strength 0..1, fades back over ~1.4 s.
  function flashWhite(strength) {
    flashOverlay.style.transition = 'none';
    flashOverlay.style.opacity = String(Math.min(1, strength));
    void flashOverlay.offsetWidth;
    flashOverlay.style.transition = '';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashOverlay.style.opacity = '0'; }, 80);
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
    radioAdd,
    damageFrom,
    flashWhite,
    showDamagePopup,
    updatePopups,
    setPlan,
    setLoadout,
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

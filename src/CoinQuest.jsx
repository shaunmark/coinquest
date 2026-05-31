import React, { useState, useRef, useCallback, useMemo } from "react";

/* ============================================================
   CoinQuest v3 — pixel-art high-fantasy expense tracker
   Tabs: QUEST · LOOT · SETTINGS
   PROGRESSION MODEL (fixed):
   - Logging an expense: drains daily budget + gives XP. NO dragon damage.
   - END DAY settles the day: saved = max(0, budget - spent).
       damage = round(saved * dmgMult), applied 1:1 with real gold saved.
       over budget => 0 damage + small dragon regen.
   - New day: spent->0, streak updates (under=+1, over=reset unless streakGuard).
   - Dragon HP = savings goal, persists across days. Kill = goal reached.
   - Loot = equippable buffs (dmgMult / xpMult / streakGuard / crit).
   - Rewards page: owned items + LOCKED silhouettes (collection drive).
   - WebAudio SFX, no asset files.
   NOTE: prototype — emoji placeholder art, no persistence (Dexie next).
   ============================================================ */

const RARITIES = {
  common:    { label: "Common",    color: "#9b9b9b", glow: "#bfbfbf", weight: 58 },
  rare:      { label: "Rare",      color: "#3aa0ff", glow: "#7cc4ff", weight: 26 },
  epic:      { label: "Epic",      color: "#b169ff", glow: "#d3a6ff", weight: 12 },
  legendary: { label: "Legendary", color: "#ffb43a", glow: "#ffd98a", weight: 4  },
};

const CATALOG = [
  { key: "blade",  icon: "🗡️", name: "Frugal Blade",      buff: "dmgMult",     val: 0.15, rarity: "common",    desc: "+15% damage from savings" },
  { key: "shield", icon: "🛡️", name: "Budget Bulwark",    buff: "streakGuard", val: 1,    rarity: "rare",      desc: "Survive 1 over-budget day" },
  { key: "scroll", icon: "📜", name: "Scroll of Saving",  buff: "xpMult",      val: 0.20, rarity: "rare",      desc: "+20% XP from logging" },
  { key: "ring",   icon: "💍", name: "Ring of Restraint", buff: "dmgMult",     val: 0.25, rarity: "epic",      desc: "+25% damage from savings" },
  { key: "potion", icon: "🧪", name: "Potion of Patience", buff: "xpMult",     val: 0.40, rarity: "epic",      desc: "+40% XP from logging" },
  { key: "orb",    icon: "🔮", name: "Orb of Oversight",   buff: "crit",       val: 0.20, rarity: "epic",      desc: "20% chance to double damage" },
  { key: "crown",  icon: "👑", name: "Crown of Coin",      buff: "dmgMult",     val: 0.50, rarity: "legendary", desc: "+50% damage from savings" },
  { key: "urn",    icon: "⚱️", name: "Vault Urn",          buff: "crit",        val: 0.40, rarity: "legendary", desc: "40% chance to double damage" },
];

const CATEGORIES = [
  { key: "food",   label: "Food",     icon: "🍖" },
  { key: "travel", label: "Travel",   icon: "🐎" },
  { key: "magic",  label: "Supplies", icon: "✨" },
  { key: "tavern", label: "Leisure",  icon: "🍺" },
];

function xpForLevel(lvl) { return 100 + (lvl - 1) * 60; }

function rollRarity() {
  const total = Object.values(RARITIES).reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const [k, r] of Object.entries(RARITIES)) { if (roll < r.weight) return k; roll -= r.weight; }
  return "common";
}
function rollLoot() {
  const targetRarity = rollRarity();
  const pool = CATALOG.filter((c) => c.rarity === targetRarity);
  const base = pool.length ? pool[Math.floor(Math.random() * pool.length)]
                           : CATALOG[Math.floor(Math.random() * CATALOG.length)];
  return { ...base, id: Math.random().toString(36).slice(2) };
}

function useSfx() {
  const ctxRef = useRef(null);
  const ensure = () => {
    if (!ctxRef.current) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctxRef.current = new AC(); }
    return ctxRef.current;
  };
  const blip = useCallback((f = 440, d = 0.08, t = "square", v = 0.07) => {
    const ctx = ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = t; o.frequency.value = f;
    g.gain.setValueAtTime(v, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + d);
  }, []);
  const chime = useCallback((ns) => ns.forEach((n, i) => setTimeout(() => blip(n, 0.16, "triangle", 0.09), i * 90)), [blip]);
  return {
    logTick: () => blip(660, 0.06, "square", 0.06),
    hit:     () => blip(180, 0.09, "sawtooth", 0.07),
    fail:    () => blip(110, 0.18, "sawtooth", 0.06),
    levelUp: () => chime([523, 659, 784, 1046]),
    rattle:  () => { for (let i = 0; i < 6; i++) setTimeout(() => blip(120 + Math.random() * 60, 0.05, "square", 0.05), i * 70); },
    burst:   () => chime([392, 523, 784]),
    slay:    () => chime([523, 659, 784, 659, 1046, 1318]),
  };
}

function Burst({ color }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 30 }}>
      {Array.from({ length: 18 }).map((_, i) => {
        const a = (i / 18) * Math.PI * 2, d = 60 + Math.random() * 50;
        return <span key={i} style={{
          position: "absolute", left: "50%", top: "50%", width: 8, height: 8, background: color,
          transform: "translate(-50%,-50%)", animation: "cq-shard 700ms ease-out forwards",
          "--tx": `${Math.cos(a) * d}px`, "--ty": `${Math.sin(a) * d}px`,
        }} />;
      })}
    </div>
  );
}

function ItemSlot({ item, big, locked, equipped, onClick }) {
  const r = RARITIES[item.rarity];
  const sz = big ? 86 : 54;
  return (
    <div onClick={onClick} title={locked ? "Locked" : `${item.name} · ${r.label}`} style={{
      width: sz, height: sz, display: "grid", placeItems: "center", fontSize: big ? 40 : 26,
      background: "#241836", cursor: onClick ? "pointer" : "default",
      border: `3px solid ${locked ? "#3a2e5c" : r.color}`,
      boxShadow: locked ? "none" : `0 0 ${big ? 22 : 10}px ${r.glow}66, inset 0 0 0 2px #0d0818`,
      position: "relative", filter: locked ? "brightness(0.25) grayscale(1)" : "none",
      outline: equipped ? "2px solid #7be08f" : "none", outlineOffset: 2,
    }}>
      {locked ? "❔" : item.icon}
      {equipped && <span style={{ position: "absolute", bottom: -2, right: -2, fontSize: 10, background: "#1a1228", color: "#7be08f", padding: "0 2px" }}>✓</span>}
    </div>
  );
}

const PANEL = { background: "#1a1228", border: "3px solid #4a3a6b", padding: 16, position: "relative" };

export default function CoinQuest() {
  const sfx = useSfx();
  const [tab, setTab] = useState("quest");

  const [budget, setBudget] = useState(1000);
  const [goal, setGoal] = useState(5000);
  const [cur, setCur] = useState("gold");

  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [spent, setSpent] = useState(0);
  const [day, setDay] = useState(1);
  const [streak, setStreak] = useState(0);
  const [log, setLog] = useState([]);
  const [dayMsg, setDayMsg] = useState(null);

  const [inventory, setInventory] = useState([]);
  const [equipped, setEquipped] = useState([]);
  const [chestReady, setChestReady] = useState(false);
  const [chestState, setChestState] = useState("idle");
  const [drop, setDrop] = useState(null);
  const [logsSinceChest, setLogsSinceChest] = useState(0);
  const [combo, setCombo] = useState(0);
  const [firstLogDay, setFirstLogDay] = useState(0); // last day a first-log bonus was given
  const [pops, setPops] = useState([]); // floating +XP / bonus labels

  const [dragonHp, setDragonHp] = useState(5000);
  const [dragonMax, setDragonMax] = useState(5000);
  const [dragonTier, setDragonTier] = useState(1);
  const [slain, setSlain] = useState(false);

  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState(false);
  const [hitFx, setHitFx] = useState(false);
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState(CATEGORIES[0]);

  const need = xpForLevel(level);
  const xpPct = Math.min(100, Math.round((xp / need) * 100));
  const remaining = budget - spent;                       // can go negative (over budget)
  const budgetPct = Math.min(100, Math.round((spent / budget) * 100));
  const dragonPct = Math.max(0, Math.round((dragonHp / dragonMax) * 100));
  const projectedSave = Math.max(0, budget - spent);      // what END DAY would bank right now

  const buffs = useMemo(() => {
    const eq = inventory.filter((it) => equipped.includes(it.id));
    let dmgMult = 1, xpMult = 1, crit = 0, streakGuard = 0;
    eq.forEach((it) => {
      if (it.buff === "dmgMult") dmgMult += it.val;
      if (it.buff === "xpMult") xpMult += it.val;
      if (it.buff === "crit") crit += it.val;
      if (it.buff === "streakGuard") streakGuard += it.val;
    });
    return { dmgMult, xpMult, crit, streakGuard, eq };
  }, [inventory, equipped]);

  const projectedDmg = Math.round(projectedSave * buffs.dmgMult);

  const gainXp = useCallback((amt) => {
    const scaled = Math.round(amt * buffs.xpMult);
    setXp((prev) => {
      let total = prev + scaled, lvl = level, leveled = false;
      while (total >= xpForLevel(lvl)) { total -= xpForLevel(lvl); lvl++; leveled = true; }
      if (leveled) {
        setLevel(lvl); setShake(true); setFlash(true); sfx.levelUp();
        setTimeout(() => setShake(false), 500); setTimeout(() => setFlash(false), 350);
      }
      return total;
    });
  }, [level, sfx, buffs.xpMult]);

  // spawn a floating label near the log button
  const spawnPop = useCallback((text, color) => {
    const id = Math.random().toString(36).slice(2);
    const x = 40 + Math.random() * 20; // small horizontal jitter (%)
    setPops((p) => [...p, { id, text, color, x }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 900);
  }, []);

  // Logging drains budget + grants XP. NO dragon damage. Now with combo + first-log bonus + pops.
  const logExpense = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    sfx.logTick();
    const newSpent = spent + val;
    setSpent(newSpent);
    setLog((l) => [{ id: Math.random().toString(36).slice(2), cat, val }, ...l].slice(0, 8));

    // base XP (small — the real prize is END DAY)
    let earned = 10 + (newSpent <= budget ? 6 : 0);

    // first log of the day = habit bonus
    let firstBonus = 0;
    if (firstLogDay !== day) {
      firstBonus = 25;
      setFirstLogDay(day);
      spawnPop("DAILY FIRST LOG +25", "#ffd76b");
    }

    // combo: each consecutive log this session ramps a multiplier (caps x5)
    const newCombo = combo + 1;
    setCombo(newCombo);
    const mult = Math.min(5, 1 + (newCombo - 1) * 0.25); // x1, x1.25, x1.5 … x5
    const comboXp = Math.round(earned * mult);

    // mini-crit: small chance of a bonus coin
    let crit = 0;
    if (Math.random() < 0.12) { crit = 15; spawnPop("✦ BONUS COIN +15", "#7cc4ff"); sfx.burst(); }

    const totalThisLog = comboXp + firstBonus + crit;
    gainXp(totalThisLog);
    spawnPop(`+${Math.round(comboXp * buffs.xpMult)} XP${newCombo > 1 ? `  COMBO x${mult.toFixed(2).replace(/\.?0+$/, "")}` : ""}`, "#7be08f");

    setAmount("");
    const n = logsSinceChest + 1;
    if (n >= 3) { setChestReady(true); setLogsSinceChest(0); } else setLogsSinceChest(n);
  };

  // END DAY: the ONLY place the dragon takes damage. 1:1 with real gold saved.
  const endDay = () => {
    const saved = Math.max(0, budget - spent);
    const overBudget = spent > budget;

    if (saved > 0 && !slain) {
      let dmg = saved * buffs.dmgMult;
      const crit = Math.random() < buffs.crit;
      if (crit) dmg *= 2;
      dmg = Math.round(dmg);
      sfx.hit(); setHitFx(true); setTimeout(() => setHitFx(false), 260);
      setDragonHp((hp) => {
        const next = hp - dmg;
        if (next <= 0) { setSlain(true); sfx.slay(); return 0; }
        return next;
      });
      setDayMsg({ ok: true, text: `Saved ${saved} ${cur} → ${crit ? "CRIT! " : ""}${dmg} damage to dragon` });
    } else if (overBudget) {
      // over budget: no damage, light regen so it visibly stings
      sfx.fail();
      const regen = Math.round(dragonMax * 0.03);
      setDragonHp((hp) => Math.min(dragonMax, hp + regen));
      setDayMsg({ ok: false, text: `Over budget by ${spent - budget} ${cur} → dragon heals ${regen} HP` });
    } else {
      setDayMsg({ ok: true, text: `Broke even — no savings, no damage` });
    }

    // streak: under-or-equal budget extends; over budget resets unless guard
    if (!overBudget) {
      setStreak((s) => s + 1);
      gainXp(8);
    } else if (buffs.streakGuard > 0) {
      setDayMsg({ ok: false, text: `Over budget — Budget Bulwark protected your streak!` });
    } else {
      setStreak(0);
    }

    // roll to new day
    setSpent(0); setDay((d) => d + 1); setLog([]); setCombo(0);
    setTimeout(() => setDayMsg(null), 4000);
  };

  const openChest = () => {
    if (chestState !== "idle") return;
    setChestState("rattling"); sfx.rattle();
    setTimeout(() => {
      const loot = rollLoot();
      setDrop(loot);
      setInventory((inv) => [loot, ...inv].slice(0, 30));
      setChestState("open"); sfx.burst(); gainXp(15);
    }, 900);
  };
  const closeChest = () => { setChestState("idle"); setDrop(null); setChestReady(false); };

  const toggleEquip = (id) => {
    setEquipped((eq) => eq.includes(id) ? eq.filter((x) => x !== id) : eq.length >= 3 ? eq : [...eq, id]);
  };

  const nextDragon = () => {
    const t = dragonTier + 1, hp = Math.round(goal * (1 + t * 0.4));
    setDragonTier(t); setDragonMax(hp); setDragonHp(hp); setSlain(false);
  };

  const applySettings = (b, g, c) => {
    setBudget(b); setGoal(g); setCur(c);
    if (!slain && day === 1 && spent === 0) { setDragonMax(g); setDragonHp(g); }
  };

  const resetGame = () => {
    setLevel(1); setXp(0); setSpent(0); setDay(1); setStreak(0); setLog([]); setDayMsg(null);
    setCombo(0); setFirstLogDay(0); setPops([]);
    setInventory([]); setEquipped([]); setChestReady(false); setChestState("idle"); setDrop(null); setLogsSinceChest(0);
    setDragonTier(1); setDragonMax(goal); setDragonHp(goal); setSlain(false); setTab("quest");
  };

  const foundKeys = new Set(inventory.map((it) => it.key));
  const goalTooSmall = goal < budget;
  const estDays = projectedSave > 0 ? Math.ceil(dragonHp / Math.max(1, projectedDmg)) : null;

  return (
    <div style={{ fontFamily: 'ui-monospace,"Courier New",monospace', maxWidth: 760, margin: "0 auto", color: "#e8e0ff", background: "#120c1f" }}>
      <style>{`
        @keyframes cq-shard { to { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(.3); opacity:0 } }
        @keyframes cq-shake { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-4px,2px)} 40%{transform:translate(4px,-2px)} 60%{transform:translate(-3px,-2px)} 80%{transform:translate(3px,2px)} }
        @keyframes cq-rattle { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-6deg)} 75%{transform:rotate(6deg)} }
        @keyframes cq-pop { 0%{transform:scale(.4);opacity:0} 60%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
        @keyframes cq-hit { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }
        @keyframes cq-float { 0%{transform:translateY(0);opacity:1} 100%{transform:translateY(-40px);opacity:0} }
        .cq-btn { font-family:inherit;cursor:pointer;color:#ffd76b;background:#2a1f47;border:3px solid #6b5a9b;padding:10px 14px;font-size:12px;letter-spacing:1px;transition:transform .08s }
        .cq-btn:hover{background:#382a5e} .cq-btn:active{transform:scale(.96)}
        .cq-input{font-family:inherit;background:#0d0818;border:3px solid #4a3a6b;color:#e8e0ff;padding:10px;font-size:14px;width:100%;box-sizing:border-box}
        .cq-scan::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 2px,transparent 2px 4px)}
      `}</style>

      <div style={{ textAlign: "center", padding: "16px 0 6px" }}>
        <div style={{ color: "#ffd76b", fontSize: 22, letterSpacing: 3, textShadow: "2px 2px 0 #6b2a8b" }}>⚔ COINQUEST ⚔</div>
        <div style={{ color: "#9b8bd4", fontSize: 11, marginTop: 4 }}>Day {day}</div>
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 12px" }}>
        {[["quest", "⚔ QUEST"], ["loot", "🎁 LOOT"], ["settings", "⚙ SETTINGS"]].map(([k, lbl]) => (
          <button key={k} className="cq-btn" onClick={() => setTab(k)}
            style={{ flex: 1, borderColor: tab === k ? "#ffd76b" : "#6b5a9b", color: tab === k ? "#ffd76b" : "#9b8bd4" }}>{lbl}</button>
        ))}
      </div>

      {tab === "quest" && (
        <div>
          <div className="cq-scan" style={{ ...PANEL, margin: "8px 12px", animation: shake ? "cq-shake 500ms" : "none" }}>
            {flash && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: .5, animation: "cq-shard 350ms forwards", zIndex: 5 }} />}
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div style={{ width: 72, height: 72, flex: "none", display: "grid", placeItems: "center", fontSize: 36, background: "conic-gradient(from 0deg,#3a2e5c,#2a2042)", border: "3px solid #6b5a9b" }}>🧙</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#ffd76b", fontSize: 14, letterSpacing: 1 }}>SIR LEDGER</div>
                <div style={{ color: "#9b8bd4", fontSize: 11, margin: "3px 0 8px" }}>Lv {level} · 🔥{streak} day streak · ⚡{buffs.eq.length}/3 gear</div>
                <div style={{ fontSize: 10, color: "#7be08f", marginBottom: 3 }}>XP {xp} / {need}</div>
                <div style={{ height: 16, background: "#0d0818", border: "3px solid #4a3a6b", padding: 2 }}>
                  <div key={xpPct} style={{ height: "100%", width: `${xpPct}%`, background: "repeating-linear-gradient(90deg,#5ddc7a 0 6px,#3eb85e 6px 12px)", transition: "width 500ms cubic-bezier(.34,1.56,.64,1)" }} />
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, color: remaining < 0 ? "#ff6b6b" : "#ffd76b", marginBottom: 3 }}>
                TODAY — spent {spent} / {budget} {cur} · {remaining >= 0 ? `${remaining} left` : `OVER by ${-remaining}`}
              </div>
              <div style={{ height: 16, background: "#0d0818", border: "3px solid #4a3a6b", padding: 2 }}>
                <div style={{ height: "100%", width: `${100 - budgetPct}%`, background: budgetPct >= 100 ? "#a32d2d" : "repeating-linear-gradient(90deg,#ff8c42 0 6px,#e05a1d 6px 12px)", transition: "width 400ms ease" }} />
              </div>
            </div>
          </div>

          <div className="cq-scan" style={{ ...PANEL, margin: "8px 12px", textAlign: "center", overflow: "hidden" }}>
            <div style={{ color: "#ff8c8c", fontSize: 12, letterSpacing: 1, marginBottom: 8 }}>🐉 SAVINGS DRAGON · TIER {dragonTier}</div>
            {hitFx && <Burst color="#ff6b6b" />}
            <div style={{ fontSize: 60, animation: hitFx ? "cq-hit 260ms" : "none", filter: slain ? "grayscale(1) brightness(.4)" : "none", display: "inline-block" }}>{slain ? "💀" : "🐉"}</div>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: "#ff8c8c", marginBottom: 3 }}>HP {Math.max(0, dragonHp)} / {dragonMax}</div>
              <div style={{ height: 18, background: "#0d0818", border: "3px solid #4a3a6b", padding: 2 }}>
                <div style={{ height: "100%", width: `${dragonPct}%`, background: "repeating-linear-gradient(90deg,#e24b4a 0 6px,#a32d2d 6px 12px)", transition: "width 400ms ease" }} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: "#9b8bd4", marginTop: 8 }}>
              {slain ? "SLAIN! savings goal reached 🎉"
                : `dragon HP = your savings goal · only END DAY savings deal damage · dmg ×${buffs.dmgMult.toFixed(2)}${buffs.crit ? ` · crit ${Math.round(buffs.crit * 100)}%` : ""}`}
            </div>
            {slain && <button className="cq-btn" onClick={nextDragon} style={{ marginTop: 10 }}>SUMMON NEXT DRAGON</button>}
          </div>

          <div style={{ ...PANEL, margin: "8px 12px", overflow: "visible" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ color: "#ffd76b", fontSize: 12, letterSpacing: 1 }}>⊹ RECORD A SPENDING ⊹</div>
              {combo > 1 && <div style={{ color: "#7be08f", fontSize: 11 }}>COMBO x{Math.min(5, 1 + (combo - 1) * 0.25).toFixed(2).replace(/\.?0+$/, "")}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {CATEGORIES.map((c) => (
                <button key={c.key} onClick={() => setCat(c)} className="cq-btn" style={{ borderColor: cat.key === c.key ? "#ffd76b" : "#6b5a9b", flex: "1 1 100px" }}>{c.icon} {c.label}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, position: "relative" }}>
              <input className="cq-input" type="number" placeholder={`${cur} spent…`} value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && logExpense()} />
              <button className="cq-btn" onClick={logExpense} style={{ flex: "none" }}>+ LOG</button>
              {pops.map((p) => (
                <div key={p.id} style={{ position: "absolute", left: `${p.x}%`, top: -6, fontSize: 11, color: p.color, pointerEvents: "none", animation: "cq-float 900ms ease-out forwards", whiteSpace: "nowrap", textShadow: "1px 1px 0 #0d0818" }}>{p.text}</div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#7be08f", marginTop: 8 }}>first log of day +25 · combo ramps to x5 · ~12% bonus-coin chance · dragon hit only at END DAY</div>
          </div>

          {log.length > 0 && (
            <div style={{ ...PANEL, margin: "8px 12px" }}>
              <div style={{ color: "#9b8bd4", fontSize: 11, marginBottom: 8 }}>TODAY'S LOG</div>
              {log.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                  <span>{e.cat.icon} {e.cat.label}</span><span style={{ color: "#ffd76b" }}>−{e.val} {cur}</span>
                </div>
              ))}
            </div>
          )}

          {/* END DAY settlement */}
          <div style={{ ...PANEL, margin: "8px 12px" }}>
            <div style={{ color: "#ffd76b", fontSize: 12, letterSpacing: 1, marginBottom: 8 }}>🌙 END THE DAY</div>
            <div style={{ fontSize: 11, color: "#9b8bd4", marginBottom: 10 }}>
              {remaining >= 0
                ? <>Would bank <b style={{ color: "#7be08f" }}>{projectedSave} {cur}</b> → <b style={{ color: "#ff8c8c" }}>{projectedDmg} damage</b>{estDays && !slain ? ` · ~${estDays} such days to slay` : ""}</>
                : <b style={{ color: "#ff6b6b" }}>Over budget — no damage, dragon will heal</b>}
            </div>
            <button className="cq-btn" onClick={endDay} style={{ width: "100%", borderColor: "#ff8c8c", color: "#ff8c8c" }}>⚔ END DAY & STRIKE DRAGON</button>
            {dayMsg && (
              <div style={{ marginTop: 10, fontSize: 11, color: dayMsg.ok ? "#7be08f" : "#ff8c8c", border: `2px solid ${dayMsg.ok ? "#3eb85e" : "#a32d2d"}`, padding: 8 }}>{dayMsg.text}</div>
            )}
          </div>

          <div style={{ ...PANEL, margin: "8px 12px 16px", textAlign: "center" }}>
            <div style={{ color: "#ffd76b", fontSize: 12, marginBottom: 12, letterSpacing: 1 }}>✦ TREASURE ✦</div>
            {chestState === "open" && drop && <Burst color={RARITIES[drop.rarity].glow} />}
            {chestState !== "open" && (
              <div onClick={chestReady ? openChest : undefined} style={{ fontSize: 64, cursor: chestReady ? "pointer" : "default", filter: chestReady ? "none" : "grayscale(1) brightness(.5)", animation: chestState === "rattling" ? "cq-rattle 180ms infinite" : "none", display: "inline-block" }}>🎁</div>
            )}
            {chestState === "open" && drop && (
              <div style={{ display: "grid", placeItems: "center", gap: 8, position: "relative", zIndex: 40 }}>
                <div style={{ animation: "cq-pop 500ms ease-out" }}><ItemSlot item={drop} big /></div>
                <div style={{ color: RARITIES[drop.rarity].glow, fontSize: 14, letterSpacing: 1 }}>{RARITIES[drop.rarity].label.toUpperCase()}!</div>
                <div style={{ color: "#e8e0ff", fontSize: 13 }}>{drop.name}</div>
                <div style={{ color: "#7be08f", fontSize: 11 }}>{drop.desc}</div>
                <button className="cq-btn" onClick={closeChest} style={{ marginTop: 6 }}>CLAIM</button>
              </div>
            )}
            {chestState === "idle" && <div style={{ fontSize: 11, color: chestReady ? "#7be08f" : "#6b5a9b", marginTop: 8 }}>{chestReady ? "▶ tap to open!" : "log 3 spendings to earn a chest"}</div>}
          </div>
        </div>
      )}

      {tab === "loot" && (
        <div>
          <div style={{ ...PANEL, margin: "8px 12px" }}>
            <div style={{ color: "#ffd76b", fontSize: 12, letterSpacing: 1, marginBottom: 6 }}>ACTIVE BUFFS</div>
            <div style={{ fontSize: 11, color: "#7be08f", lineHeight: 1.8 }}>
              damage ×{buffs.dmgMult.toFixed(2)} · XP ×{buffs.xpMult.toFixed(2)} · crit {Math.round(buffs.crit * 100)}% · streak guard {buffs.streakGuard}
            </div>
            <div style={{ fontSize: 10, color: "#9b8bd4", marginTop: 6 }}>equip up to 3 · tap an owned item to equip/unequip</div>
          </div>
          <div style={{ ...PANEL, margin: "8px 12px 20px" }}>
            <div style={{ color: "#ffd76b", fontSize: 12, letterSpacing: 1, marginBottom: 12 }}>COLLECTION — {foundKeys.size} / {CATALOG.length} discovered</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(72px,1fr))", gap: 12 }}>
              {CATALOG.map((c) => {
                const owned = inventory.find((it) => it.key === c.key);
                const locked = !owned;
                const isEq = owned && equipped.includes(owned.id);
                return (
                  <div key={c.key} style={{ textAlign: "center" }}>
                    <div style={{ display: "grid", placeItems: "center" }}>
                      <ItemSlot item={c} locked={locked} equipped={isEq} onClick={owned ? () => toggleEquip(owned.id) : undefined} />
                    </div>
                    <div style={{ fontSize: 9, color: locked ? "#5a4a7b" : RARITIES[c.rarity].glow, marginTop: 4, lineHeight: 1.3 }}>{locked ? "???" : c.name}</div>
                    {!locked && <div style={{ fontSize: 8, color: "#7be08f", marginTop: 2 }}>{c.desc}</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: "#9b8bd4", marginTop: 14 }}>locked items show as silhouettes — open chests to discover them</div>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <SettingsTab budget={budget} goal={goal} cur={cur} tooSmall={goalTooSmall} onApply={applySettings} onReset={resetGame} />
      )}
    </div>
  );
}

function SettingsTab({ budget, goal, cur, tooSmall, onApply, onReset }) {
  const [b, setB] = useState(budget);
  const [g, setG] = useState(goal);
  const [c, setC] = useState(cur);
  const [confirmReset, setConfirmReset] = useState(false);
  const warn = g < b;
  return (
    <div>
      <div style={{ ...PANEL, margin: "8px 12px" }}>
        <div style={{ color: "#ffd76b", fontSize: 12, letterSpacing: 1, marginBottom: 14 }}>⚙ ADVENTURE SETTINGS</div>
        <label style={{ fontSize: 11, color: "#9b8bd4" }}>DAILY BUDGET — resets each day</label>
        <input className="cq-input" type="number" value={b} onChange={(e) => setB(Number(e.target.value) || 0)} style={{ margin: "6px 0 16px" }} />
        <label style={{ fontSize: 11, color: "#9b8bd4" }}>SAVINGS GOAL — total to save (= dragon HP)</label>
        <input className="cq-input" type="number" value={g} onChange={(e) => setG(Number(e.target.value) || 0)} style={{ margin: "6px 0 6px" }} />
        {warn && <div style={{ fontSize: 10, color: "#ff8c8c", marginBottom: 12 }}>⚠ goal is smaller than a day's budget — dragon dies in one day. Set a goal you save toward over many days.</div>}
        <label style={{ fontSize: 11, color: "#9b8bd4" }}>CURRENCY LABEL</label>
        <div style={{ display: "flex", gap: 8, margin: "6px 0 16px" }}>
          {["gold", "$", "£", "€"].map((x) => (
            <button key={x} className="cq-btn" onClick={() => setC(x)} style={{ flex: 1, borderColor: c === x ? "#ffd76b" : "#6b5a9b" }}>{x}</button>
          ))}
        </div>
        <button className="cq-btn" onClick={() => onApply(b, g, c)} style={{ width: "100%", borderColor: "#7be08f", color: "#7be08f" }}>SAVE SETTINGS</button>
        <div style={{ fontSize: 10, color: "#9b8bd4", marginTop: 8 }}>note: goal applies to the dragon only on a fresh game (Day 1, nothing spent)</div>
      </div>

      <div style={{ ...PANEL, margin: "8px 12px 20px", borderColor: "#a32d2d" }}>
        <div style={{ color: "#ff8c8c", fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>⚠ DANGER ZONE</div>
        {!confirmReset ? (
          <button className="cq-btn" onClick={() => setConfirmReset(true)} style={{ width: "100%", borderColor: "#a32d2d", color: "#ff8c8c" }}>RESET ALL PROGRESS</button>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: "#ff8c8c", marginBottom: 10 }}>This wipes level, loot, dragon, day, and log. Cannot be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="cq-btn" onClick={() => setConfirmReset(false)} style={{ flex: 1 }}>CANCEL</button>
              <button className="cq-btn" onClick={() => { onReset(); setConfirmReset(false); }} style={{ flex: 1, borderColor: "#a32d2d", color: "#ff8c8c" }}>CONFIRM WIPE</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

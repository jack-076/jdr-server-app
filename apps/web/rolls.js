(() => {
  const list = /** @type {HTMLOListElement} */ (document.getElementById("roll-log-list"));
  const status = /** @type {HTMLElement} */ (document.getElementById("roll-log-status"));
  const isHost = window.location.pathname === "/host";
  let version = 0;
  let rolling = false;

  function key() { return isHost ? hostKeyInput.value || null : playerToken; }
  function clear() { version++; list.replaceChildren(); status.textContent = ""; }

  async function refresh() {
    const access = key();
    if (!access) { clear(); return; }
    const current = ++version;
    try {
      const response = await fetch("/api/rolls", { headers: { Authorization: `Bearer ${access}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Lecture des jets refusée.");
      const result = await response.json();
      if (current !== version || access !== key()) return;
      list.replaceChildren();
      for (const roll of result.rolls.slice().reverse()) {
        const item = document.createElement("li");
        item.className = "roll-card";
        const signed = roll.modifier >= 0 ? `+${roll.modifier}` : String(roll.modifier);
        const dice = Array.isArray(roll.dice) ? `d${roll.sides} [${roll.dice.join(", ")}]` : `d20 ${roll.die}`;
        const name = document.createElement("div"); name.className = "roll-card-name"; name.textContent = roll.character;
        const label = document.createElement("div"); label.className = "roll-card-label"; label.textContent = roll.skill;
        const result = document.createElement("div"); result.className = "roll-card-result"; result.textContent = `◆ ${dice} ${signed} ⇒ ${roll.total}`;
        item.append(name, label, result);
        list.append(item);
      }
      status.textContent = result.rolls.length ? "" : "Aucun jet pour cette partie.";
    } catch (error) {
      if (current === version && access === key()) status.textContent = "Impossible de charger les jets.";
      console.error(error);
    }
  }

  /** @param {Record<string, string | number>} payload */
  async function sendRoll(payload) {
    const access = key();
    if (!access || rolling) return;
    rolling = true; status.textContent = "Lancer en cours...";
    try {
      const response = await fetch("/api/rolls", {
        method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      if (access !== key()) return;
      if (!response.ok) { status.textContent = result.error || "Lancer refusé."; return; }
      await refresh();
    } catch (error) {
      if (access === key()) status.textContent = "Lancer non confirmé. Vérifie la liste avant de réessayer.";
      console.error(error);
    } finally { rolling = false; }
  }

  /** @param {string} profileId @param {string} skillId */
  function rollSkill(profileId, skillId) { return sendRoll({ profileId, skillId }); }
  /** @param {string} profileId @param {string} attackId @param {'attack' | 'damage'} kind @param {number} bonusIndex */
  function rollAttack(profileId, attackId, kind, bonusIndex) { return sendRoll({ profileId, attackId, kind, bonusIndex }); }

  window.RollView = { refresh, clear, rollSkill, rollAttack };
  void refresh();
})();

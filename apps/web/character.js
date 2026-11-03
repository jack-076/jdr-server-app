(() => {
  const panel = /** @type {HTMLElement} */ (document.getElementById("character-panel"));
  const header = /** @type {HTMLElement} */ (document.getElementById("character-header"));
  const open = /** @type {HTMLButtonElement} */ (document.getElementById("character-open"));
  const close = /** @type {HTMLButtonElement} */ (document.getElementById("character-close"));
  const profile = /** @type {HTMLSelectElement} */ (document.getElementById("character-profile"));
  const profileLabel = /** @type {HTMLElement} */ (document.getElementById("character-profile-label"));
  const form = /** @type {HTMLFormElement} */ (document.getElementById("character-form"));
  const name = /** @type {HTMLInputElement} */ (document.getElementById("character-name"));
  const level = /** @type {HTMLInputElement} */ (document.getElementById("character-level"));
  const hpCurrent = /** @type {HTMLInputElement} */ (document.getElementById("character-hp-current"));
  const hpMaximum = /** @type {HTMLInputElement} */ (document.getElementById("character-hp-maximum"));
  const hpTemporary = /** @type {HTMLInputElement} */ (document.getElementById("character-hp-temporary"));
  const hpNonlethal = /** @type {HTMLInputElement} */ (document.getElementById("character-hp-nonlethal"));
  const armorPenalty = /** @type {HTMLInputElement} */ (document.getElementById("character-armor-penalty"));
  const fields = /** @type {HTMLElement} */ (document.getElementById("character-abilities"));
  const save = /** @type {HTMLButtonElement} */ (document.getElementById("character-save"));
  const reload = /** @type {HTMLButtonElement} */ (document.getElementById("character-reload"));
  const status = /** @type {HTMLElement} */ (document.getElementById("character-status"));
  const summary = /** @type {HTMLElement} */ (document.getElementById("character-summary"));
  const attributes = /** @type {HTMLElement} */ (document.getElementById("character-attributes"));
  const summaryTab = /** @type {HTMLButtonElement} */ (document.getElementById("character-tab-summary"));
  const attributesTab = /** @type {HTMLButtonElement} */ (document.getElementById("character-tab-attributes"));
  const other = /** @type {HTMLElement} */ (document.getElementById("character-other"));
  const portrait = /** @type {HTMLElement} */ (document.getElementById("character-portrait"));
  const title = /** @type {HTMLElement} */ (document.getElementById("character-title"));
  const extraTabs = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("[data-character-tab]"));
  const identityInputs = /** @type {NodeListOf<HTMLInputElement>} */ (panel.querySelectorAll("[data-character-identity]"));
  const movementInputs = /** @type {NodeListOf<HTMLInputElement>} */ (panel.querySelectorAll("[data-character-movement]"));
  const isHost = window.location.pathname === "/host";
  const definitions = [["strength", "Force"], ["dexterity", "Dextérité"], ["constitution", "Constitution"],
    ["intelligence", "Intelligence"], ["wisdom", "Sagesse"], ["charisma", "Charisme"]];
  /** @type {Map<string, {input: HTMLInputElement, output: HTMLOutputElement}>} */
  const controls = new Map();
  /** @type {Map<string, Record<string, HTMLInputElement>>} */
  const adjustmentControls = new Map();
  /** @type {Record<string, {damage: number, drain: number, penalty: number}>} */
  let abilityAdjustments = {};
  let revision = 0;
  let dirty = false;
  let busy = false;
  let loaded = false;
  let generation = 0;
  let selectedId = "";
  /** @typedef {{id: string, name: string, group: 'adventure' | 'background', ability: string, ranks: number, classSkill: boolean, armorPenalty: boolean, trainedOnly: boolean, misc: number}} Skill */
  /** @type {Skill[]} */
  let skillData = [];
  let armorPenaltyValue = 0;
  let biographyData = { appearance: "", history: "" };
  let notesData = "";
  /** @typedef {{id: string, name: string, category: string, quantity: number, weight: number, equipped: boolean, description: string}} InventoryItem */
  /** @type {{items: InventoryItem[], currency: Record<string, number>}} */
  let inventoryData = { items: [], currency: { pp: 0, gp: 0, sp: 0, cp: 0 } };
  /** @type {Record<string, number>} */
  let combatData = {};
  /** @typedef {{id: string, name: string, category: string, bonus: string, damage: string, range: string}} Attack */
  /** @type {Attack[]} */
  let attacksData = [];
  /** @typedef {{id: string, name: string, level: number, cost: number, action: string, description: string}} Spell */
  /** @type {{points: {current: number, maximum: number}, entries: Spell[]}} */
  let spellsData = { points: { current: 0, maximum: 0 }, entries: [] };
  /** @typedef {{id: string, name: string, category: string, action: string, description: string, uses: {current: number, maximum: number} | null}} Feature */
  /** @type {Feature[]} */
  let featuresData = [];
  /** @typedef {{id: string, name: string, category: string, duration: string, active: boolean, description: string}} Effect */
  /** @type {{conditions: string[], entries: Effect[]}} */
  let effectsData = { conditions: [], entries: [] };
  let activeTab = "summary";
  /** @type {{id: number, offsetX: number, offsetY: number} | null} */
  let windowDrag = null;

  /** @param {number} left @param {number} top */
  function positionWindow(left, top) {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    panel.style.left = `${Math.max(0, Math.min(maxLeft, left))}px`;
    panel.style.top = `${Math.max(0, Math.min(maxTop, top))}px`;
    panel.style.transform = "none";
  }
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || (event.target instanceof Element && event.target.closest("button"))) return;
    const rect = panel.getBoundingClientRect();
    windowDrag = { id: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    positionWindow(rect.left, rect.top);
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  header.addEventListener("pointermove", (event) => {
    if (!windowDrag || event.pointerId !== windowDrag.id) return;
    positionWindow(event.clientX - windowDrag.offsetX, event.clientY - windowDrag.offsetY);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    header.addEventListener(type, (event) => {
      if (windowDrag?.id !== /** @type {PointerEvent} */ (event).pointerId) return;
      const id = windowDrag.id; windowDrag = null;
      if (header.hasPointerCapture(id)) header.releasePointerCapture(id);
    });
  }
  window.addEventListener("resize", () => {
    if (!panel.hidden && panel.style.transform === "none") {
      const rect = panel.getBoundingClientRect(); positionWindow(rect.left, rect.top);
    }
  });

  function accessKey() { return isHost ? hostKeyInput.value : playerToken; }
  function permittedId() { return isHost ? selectedId : currentPlayerProfile?.id || ""; }
  function updatePortrait() {
    const id = permittedId();
    const url = id && window.TokenView ? window.TokenView.profileImage(id) : null;
    portrait.style.backgroundImage = url ? `url("${url}")` : "";
    portrait.textContent = url ? "" : "♟";
  }
  function updateSave() {
    save.disabled = busy || !loaded || !permittedId();
    name.disabled = busy || !loaded;
    for (const input of [level, hpCurrent, hpMaximum, hpTemporary, hpNonlethal, armorPenalty]) input.disabled = busy || !loaded;
    for (const input of [...identityInputs, ...movementInputs]) input.disabled = busy || !loaded;
    profile.disabled = busy;
    reload.disabled = busy;
    for (const control of controls.values()) control.input.disabled = busy || !loaded;
    for (const fields of adjustmentControls.values()) for (const input of Object.values(fields)) input.disabled = busy || !loaded;
    for (const control of other.querySelectorAll("input, select, button, textarea")) {
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLButtonElement || control instanceof HTMLTextAreaElement) control.disabled = busy || !loaded;
    }
    updateSkillRollButtons();
  }
  function closePanel() { generation++; panel.hidden = true; selectedId = ""; dirty = false; loaded = false; busy = false; form.reset(); updateSave(); }
  for (const [id, labelText] of definitions) {
    const wrapper = document.createElement("div");
    wrapper.className = "character-ability";
    const label = document.createElement("span");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "number"; input.min = "0"; input.max = "1000"; input.step = "1"; input.required = true;
    input.setAttribute("aria-label", `Valeur ${labelText}`);
    const output = document.createElement("output");
    input.addEventListener("input", () => {
      updateAbilityOutput(id);
      refreshSkillTotals();
    });
    /** @type {Record<string, HTMLInputElement>} */
    const adjustmentInputs = {};
    for (const [field, labelName] of [["damage", "Dégâts"], ["drain", "Affaiblissement"], ["penalty", "Malus"]]) {
      const adjustment = document.createElement("input"); adjustment.type = "number"; adjustment.min = "0"; adjustment.max = "1000"; adjustment.step = "1"; adjustment.required = true;
      adjustment.setAttribute("aria-label", `${labelName} ${labelText}`);
      adjustment.addEventListener("input", () => {
        const values = abilityAdjustments[id];
        if (values && (field === "damage" || field === "drain" || field === "penalty")) values[field] = adjustment.valueAsNumber;
        updateAbilityOutput(id);
        refreshSkillTotals();
      });
      adjustmentInputs[field] = adjustment;
    }
    wrapper.append(label, input, output, ...Object.values(adjustmentInputs));
    fields.append(wrapper);
    controls.set(id, { input, output });
    adjustmentControls.set(id, adjustmentInputs);
  }

  async function load() {
    const id = permittedId();
    const key = accessKey();
    if (!id || !key) { status.textContent = "Choisis un profil."; return; }
    const current = ++generation;
    loaded = false; busy = true; updateSave(); status.textContent = "Chargement...";
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Lecture refusée");
      const { character } = await response.json();
      if (current !== generation || id !== permittedId() || key !== accessKey()) return;
      name.value = character.name;
      for (const input of identityInputs) {
        const field = input.dataset.characterIdentity;
        if (field) input.value = character.identity[field];
      }
      for (const input of movementInputs) {
        const field = input.dataset.characterMovement;
        if (field) input.value = character.movement[field];
      }
      title.textContent = character.name || "Fiche de personnage";
      updatePortrait();
      level.value = String(character.level);
      hpCurrent.value = String(character.hitPoints.current);
      hpMaximum.value = String(character.hitPoints.maximum);
      hpTemporary.value = String(character.hitPoints.temporary);
      hpNonlethal.value = String(character.hitPoints.nonlethal);
      skillData = character.skills;
      abilityAdjustments = character.abilityAdjustments;
      for (const [field, inputs] of adjustmentControls) {
        for (const [kind, input] of Object.entries(inputs)) input.value = String(abilityAdjustments[field][/** @type {'damage' | 'drain' | 'penalty'} */ (kind)]);
      }
      armorPenaltyValue = character.armorCheckPenalty;
      armorPenalty.value = String(armorPenaltyValue);
      biographyData = character.biography;
      notesData = character.notes;
      inventoryData = character.inventory;
      combatData = character.combat;
      attacksData = character.attacks;
      spellsData = character.spells;
      featuresData = character.features;
      effectsData = character.effects;
      updateCombatSummary();
      revision = character.revision;
      for (const [field, control] of controls) {
        control.input.value = String(character.scores[field]);
        control.input.dispatchEvent(new Event("input"));
      }
      loaded = true; dirty = false; status.textContent = "Fiche chargée.";
      if (!other.hidden) renderPreview(activeTab);
    } catch (error) {
      if (current === generation) status.textContent = "Impossible de charger la fiche.";
      console.error(error);
    } finally {
      if (current === generation) { busy = false; updateSave(); }
    }
  }
  /** @param {string} [requestedId] */
  async function openFor(requestedId) {
    if (!isHost && requestedId && currentPlayerProfile?.id !== requestedId) return;
    if (!panel.hidden) {
      if (!requestedId || requestedId === permittedId()) return;
      if (dirty || busy) {
        status.textContent = "Enregistre ou recharge la fiche avant d'en ouvrir une autre.";
        return;
      }
    }
    panel.hidden = false;
    if (!isHost) { selectedId = currentPlayerProfile?.id || ""; await load(); return; }
    const key = accessKey();
    if (!key) return;
    const current = ++generation;
    busy = true; loaded = false; updateSave();
    try {
      const response = await fetch("/api/profiles", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Profils indisponibles");
      const result = await response.json();
      if (current !== generation || panel.hidden || key !== accessKey()) return;
      profile.replaceChildren();
      for (const item of result.profiles) {
        const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; profile.append(option);
      }
      selectedId = requestedId || currentHostProfile?.id || result.profiles[0]?.id || "";
      if (!result.profiles.some(/** @param {{id: string}} item */ (item) => item.id === selectedId)) {
        selectedId = "";
        status.textContent = "Profil introuvable.";
        return;
      }
      profile.value = selectedId; profile.hidden = false; profileLabel.hidden = false;
      await load();
    } catch (error) { if (current === generation) status.textContent = "Impossible de charger les profils."; console.error(error); }
    finally { if (current === generation) { busy = false; updateSave(); } }
  }
  open.addEventListener("click", () => { void openFor(); });
  /** @param {string} tab */
  function showTab(tab) {
    activeTab = tab;
    summary.hidden = tab !== "summary"; attributes.hidden = tab !== "attributes";
    other.hidden = tab === "summary" || tab === "attributes";
    summaryTab.setAttribute("aria-pressed", String(tab === "summary"));
    attributesTab.setAttribute("aria-pressed", String(tab === "attributes"));
    for (const button of extraTabs) button.setAttribute("aria-pressed", String(button.dataset.characterTab === tab));
    if (!other.hidden) renderPreview(tab);
  }
  summaryTab.addEventListener("click", () => showTab("summary"));
  attributesTab.addEventListener("click", () => showTab("attributes"));
  for (const button of extraTabs) button.addEventListener("click", () => showTab(button.dataset.characterTab || "summary"));
  /** @param {string} text @param {string} className */
  function previewElement(text, className) {
    const node = document.createElement("div"); node.className = className; node.textContent = text; return node;
  }
  /** @type {'adventure' | 'background'} */
  let skillGroup = "adventure";

  /** @param {string} ability @returns {number | null} */
  function adjustedModifier(ability) {
    const score = controls.get(ability)?.input.valueAsNumber;
    const adjustment = abilityAdjustments[ability];
    if (score === undefined || !Number.isSafeInteger(score) || score < 0 || !adjustment ||
        Object.values(adjustment).some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
    return PathfinderAbilities.adjustedAbilityModifier(score, adjustment);
  }

  /** @param {string} ability */
  function updateAbilityOutput(ability) {
    const output = controls.get(ability)?.output;
    if (!output) return;
    const modifier = adjustedModifier(ability);
    output.textContent = modifier === null ? "Valeur invalide" : `Modificateur : ${modifier >= 0 ? "+" : ""}${modifier}`;
  }

  function refreshSkillTotals() {
    for (const row of other.querySelectorAll("[data-skill-id]")) {
      const id = /** @type {HTMLElement} */ (row).dataset.skillId;
      const skill = skillData.find((item) => item.id === id);
      const result = row.querySelector("output");
      if (!skill || !result) continue;
      const modifier = adjustedModifier(skill.ability);
      if (modifier === null) { result.textContent = "—"; continue; }
      const total = modifier + skill.ranks + (skill.classSkill && skill.ranks > 0 ? 3 : 0) + skill.misc + (skill.armorPenalty ? armorPenaltyValue : 0);
      result.textContent = `${total >= 0 ? "+" : ""}${total}`;
      result.title = skill.trainedOnly && skill.ranks === 0 ? "Compétence utilisable uniquement si formée" : "Modificateur de compétence";
    }
    const count = other.querySelector("[data-skill-count]");
    if (count) count.textContent = `Rangs Aventure : ${skillData.filter((s) => s.group === "adventure").reduce((n, s) => n + s.ranks, 0)}   |   Rangs Background : ${skillData.filter((s) => s.group === "background").reduce((n, s) => n + s.ranks, 0)}`;
    updateSkillRollButtons();
  }

  function updateSkillRollButtons() {
    for (const button of other.querySelectorAll("button[data-skill-roll]")) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const skill = skillData.find((item) => item.id === button.dataset.skillRoll);
      const untrained = !!skill && skill.trainedOnly && skill.ranks === 0;
      const invalid = !!skill && adjustedModifier(skill.ability) === null;
      button.disabled = busy || !loaded || dirty || !permittedId() || !skill || untrained || invalid;
      button.title = invalid ? "Caractéristique invalide." : untrained ? "Cette compétence nécessite au moins un rang." : dirty ? "Enregistre la fiche avant de lancer." : "Lancer un jet public";
    }
    for (const button of other.querySelectorAll("button[data-attack-roll]")) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const attack = attacksData.find((item) => item.id === button.dataset.attackRoll);
      const value = button.dataset.rollKind === "attack" ? attack?.bonus.trim() : attack?.damage.trim();
      button.disabled = busy || !loaded || dirty || !permittedId() || !attack || !value;
      button.title = dirty ? "Enregistre la fiche avant de lancer." : !value ? "Renseigne la valeur correspondante." : "Lancer un jet public";
    }
  }

  function renderSkills() {
    other.replaceChildren();
    const info = previewElement("Les totaux incluent la caractéristique, les rangs, le bonus de classe et les modificateurs saisis.", "sheet-preview-notice");
    const counts = previewElement("", "sheet-preview-stats"); counts.dataset.skillCount = "true";
    const switcher = document.createElement("div"); switcher.className = "sheet-skill-tabs";
    for (const [label, group] of /** @type {[string, 'adventure' | 'background'][]} */ ([["Aventure", "adventure"], ["Background", "background"]])) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label;
      button.setAttribute("aria-pressed", String(group === skillGroup));
      button.addEventListener("click", () => { skillGroup = group; renderSkills(); }); switcher.append(button);
    }
    const table = document.createElement("div"); table.className = "sheet-skill-table";
    const headings = document.createElement("div"); headings.className = "sheet-skill-row sheet-skill-head";
    for (const text of ["Compétence", "Total", "Rangs", "Classe", "Armure", "Formé", "Caract.", "Divers", ""]) headings.append(previewElement(text, ""));
    table.append(headings);
    for (const skill of skillData.filter((item) => item.group === skillGroup)) {
      const row = document.createElement("div"); row.className = "sheet-skill-row"; row.dataset.skillId = skill.id;
      const label = document.createElement("span"); label.textContent = skill.name;
      const total = document.createElement("output"); total.setAttribute("aria-label", `Total ${skill.name}`);
      const result = document.createElement("div"); result.className = "sheet-skill-result";
      const roll = document.createElement("button"); roll.type = "button"; roll.textContent = "d20"; roll.dataset.skillRoll = skill.id;
      roll.setAttribute("aria-label", `Lancer ${skill.name}`);
      roll.addEventListener("click", () => {
        const id = permittedId();
        if (dirty || busy || !id || !window.RollView) return;
        void window.RollView.rollSkill(id, skill.id);
      });
      result.append(roll, total);
      const ranks = document.createElement("input"); ranks.type = "number"; ranks.min = "0"; ranks.max = "1000"; ranks.step = "1"; ranks.value = String(skill.ranks); ranks.required = true; ranks.setAttribute("aria-label", `Rangs ${skill.name}`);
      ranks.addEventListener("input", () => { skill.ranks = ranks.valueAsNumber; dirty = true; refreshSkillTotals(); });
      /** @param {'classSkill' | 'armorPenalty' | 'trainedOnly'} field @param {string} description */
      function checkbox(field, description) {
        const input = document.createElement("input"); input.type = "checkbox"; input.checked = skill[field]; input.setAttribute("aria-label", `${description} ${skill.name}`);
        input.addEventListener("change", () => { skill[field] = input.checked; dirty = true; refreshSkillTotals(); }); return input;
      }
      const ability = document.createElement("select"); ability.setAttribute("aria-label", `Caractéristique ${skill.name}`);
      for (const [id, text] of definitions) { const option = document.createElement("option"); option.value = id; option.textContent = text.slice(0, 3); ability.append(option); }
      ability.value = skill.ability; ability.addEventListener("change", () => { skill.ability = ability.value; dirty = true; refreshSkillTotals(); });
      const misc = document.createElement("input"); misc.type = "number"; misc.min = "-1000"; misc.max = "1000"; misc.step = "1"; misc.value = String(skill.misc); misc.required = true; misc.setAttribute("aria-label", `Divers ${skill.name}`);
      misc.addEventListener("input", () => { skill.misc = misc.valueAsNumber; dirty = true; refreshSkillTotals(); });
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = `Supprimer ${skill.name}`;
      remove.addEventListener("click", () => { skillData = skillData.filter((item) => item.id !== skill.id); dirty = true; renderSkills(); });
      row.append(label, result, ranks, checkbox("classSkill", "Compétence de classe"), checkbox("armorPenalty", "Malus d'armure"), checkbox("trainedOnly", "Formation requise"), ability, misc, remove);
      table.append(row);
    }
    const addRow = document.createElement("div"); addRow.className = "sheet-skill-add";
    const skillName = document.createElement("input"); skillName.placeholder = "Nom ou spécialité de la compétence"; skillName.maxLength = 80; skillName.setAttribute("aria-label", "Nom de la nouvelle compétence");
    const add = document.createElement("button"); add.type = "button"; add.textContent = "+ Ajouter";
    add.addEventListener("click", () => {
      const name = skillName.value.trim();
      if (!name) { status.textContent = "Saisis le nom de la compétence."; return; }
      if (skillData.length >= 100) { status.textContent = "La limite de 100 compétences est atteinte."; return; }
      skillData.push({ id: crypto.randomUUID(), name, group: skillGroup, ability: "intelligence", ranks: 0, classSkill: false, armorPenalty: false, trainedOnly: false, misc: 0 });
      dirty = true; renderSkills();
    });
    addRow.append(skillName, add); other.append(info, counts, switcher, table, addRow);
    refreshSkillTotals(); updateSave();
  }

  const inventoryCategories = [
    ["weapon", "Armes"], ["armor", "Armures et boucliers"], ["equipment", "Équipement"],
    ["consumable", "Consommables"], ["gear", "Matériel"], ["ammunition", "Munitions"],
    ["misc", "Divers"], ["trade", "Marchandises"], ["container", "Conteneurs"],
  ];

  function updateInventoryWeight() {
    const total = inventoryData.items.reduce((sum, item) => sum + item.quantity * item.weight, 0);
    const output = other.querySelector("[data-inventory-weight]");
    if (output) output.textContent = Number.isFinite(total) ? `Poids des objets : ${Number(total.toFixed(2))} lb (monnaie exclue)` : "Poids invalide";
  }

  function renderInventory() {
    other.replaceChildren();
    const money = document.createElement("div"); money.className = "sheet-currency";
    for (const [coin, label] of [["pp", "PP"], ["gp", "PO"], ["sp", "PA"], ["cp", "PC"]]) {
      const wrapper = document.createElement("label"); wrapper.textContent = label;
      const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "1000000000"; input.step = "1"; input.required = true;
      input.value = String(inventoryData.currency[coin]); input.setAttribute("aria-label", `Monnaie ${label}`);
      input.addEventListener("input", () => { inventoryData.currency[coin] = input.valueAsNumber; dirty = true; });
      wrapper.append(input); money.append(wrapper);
    }
    other.append(previewElement("Monnaie", "sheet-preview-heading"), money);
    const weight = previewElement("", "sheet-preview-stats"); weight.dataset.inventoryWeight = "true"; other.append(weight);
    const addRow = document.createElement("div"); addRow.className = "sheet-inventory-add";
    const newName = document.createElement("input"); newName.placeholder = "Nom de l'objet"; newName.maxLength = 80; newName.setAttribute("aria-label", "Nom du nouvel objet");
    const category = document.createElement("select"); category.setAttribute("aria-label", "Catégorie du nouvel objet");
    for (const [value, label] of inventoryCategories) { const option = document.createElement("option"); option.value = value; option.textContent = label; category.append(option); }
    const add = document.createElement("button"); add.type = "button"; add.textContent = "+ Ajouter";
    add.addEventListener("click", () => {
      const name = newName.value.trim();
      if (!name) { status.textContent = "Saisis le nom de l'objet."; return; }
      if (inventoryData.items.length >= 100) { status.textContent = "La limite de 100 objets est atteinte."; return; }
      inventoryData.items.push({ id: crypto.randomUUID(), name, category: category.value, quantity: 1, weight: 0, equipped: false, description: "" });
      dirty = true; renderInventory();
    });
    addRow.append(newName, category, add); other.append(addRow);
    for (const [value, label] of inventoryCategories) {
      other.append(previewElement(label, "sheet-preview-heading"));
      const items = inventoryData.items.filter((item) => item.category === value);
      if (items.length === 0) { other.append(previewElement("Aucun objet", "sheet-preview-empty")); continue; }
      const headings = document.createElement("div"); headings.className = "sheet-inventory-row sheet-inventory-head";
      for (const text of ["Nom", "Qté", "Poids (lb)", "Équipé", ""]) headings.append(previewElement(text, ""));
      other.append(headings);
      for (const item of items) {
        const wrapper = document.createElement("div"); wrapper.className = "sheet-inventory-entry"; wrapper.dataset.itemId = item.id;
        const row = document.createElement("div"); row.className = "sheet-inventory-row";
        const itemName = document.createElement("input"); itemName.value = item.name; itemName.maxLength = 80; itemName.required = true; itemName.setAttribute("aria-label", "Nom de l'objet");
        itemName.addEventListener("input", () => { item.name = itemName.value; dirty = true; });
        const quantity = document.createElement("input"); quantity.type = "number"; quantity.min = "0"; quantity.max = "100000"; quantity.step = "1"; quantity.required = true; quantity.value = String(item.quantity); quantity.setAttribute("aria-label", `Quantité ${item.name}`);
        quantity.addEventListener("input", () => { item.quantity = quantity.valueAsNumber; dirty = true; updateInventoryWeight(); });
        const itemWeight = document.createElement("input"); itemWeight.type = "number"; itemWeight.min = "0"; itemWeight.max = "100000"; itemWeight.step = "any"; itemWeight.required = true; itemWeight.value = String(item.weight); itemWeight.setAttribute("aria-label", `Poids unitaire ${item.name} en livres`);
        itemWeight.addEventListener("input", () => { item.weight = itemWeight.valueAsNumber; dirty = true; updateInventoryWeight(); });
        const equippedLabel = document.createElement("label"); equippedLabel.className = "sheet-item-equipped"; equippedLabel.textContent = "Équipé";
        const equipped = document.createElement("input"); equipped.type = "checkbox"; equipped.checked = item.equipped; equipped.setAttribute("aria-label", `Équipé ${item.name}`);
        equipped.addEventListener("change", () => { item.equipped = equipped.checked; dirty = true; }); equippedLabel.append(equipped);
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = `Supprimer ${item.name}`;
        remove.addEventListener("click", () => { inventoryData.items = inventoryData.items.filter((entry) => entry.id !== item.id); dirty = true; renderInventory(); });
        row.append(itemName, quantity, itemWeight, equippedLabel, remove);
        const description = document.createElement("textarea"); description.placeholder = "Description ou notes (facultatif)"; description.maxLength = 500; description.value = item.description; description.setAttribute("aria-label", `Description ${item.name}`);
        description.addEventListener("input", () => { item.description = description.value; dirty = true; });
        const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Description"; details.append(summary, description);
        wrapper.append(row, details); other.append(wrapper);
      }
    }
    updateInventoryWeight(); updateSave();
  }

  const combatSections = [
    ["Attaque", [["baseAttack", "Bonus de base à l'attaque"], ["maneuverBonus", "BMO"], ["melee", "Corps à corps"], ["ranged", "À distance"], ["initiative", "Initiative"]]],
    ["Défenses", [["armorClass", "Classe d'armure"], ["touch", "Contact"], ["flatFooted", "Pris au dépourvu"], ["maneuverDefense", "DMD"], ["flatFootedManeuverDefense", "DMD pris au dépourvu"]]],
    ["Jets de sauvegarde", [["fortitude", "Vigueur"], ["reflex", "Réflexes"], ["will", "Volonté"], ["spellResistance", "Résistance aux sorts"]]],
  ];

  function updateCombatSummary() {
    for (const output of panel.querySelectorAll("[data-combat-display]")) {
      const field = /** @type {HTMLElement} */ (output).dataset.combatDisplay;
      output.textContent = field && Number.isSafeInteger(combatData[field]) ? String(combatData[field]) : "—";
    }
  }

  function renderCombat() {
    other.replaceChildren();
    other.append(previewElement("Les valeurs sont saisies manuellement. Les jets publics utilisent les valeurs enregistrées ; effets et critiques automatiques restent à développer.", "sheet-preview-notice"));
    for (const [section, entries] of /** @type {Array<[string, string[][]]>} */ (combatSections)) {
      other.append(previewElement(section, "sheet-preview-heading"));
      const row = document.createElement("div"); row.className = "sheet-combat-fields";
      for (const [field, labelText] of entries) {
        const label = document.createElement("label"); label.textContent = labelText;
        const input = document.createElement("input"); input.type = "number"; input.min = "-10000"; input.max = "10000"; input.step = "1"; input.required = true;
        input.value = String(combatData[field]); input.setAttribute("aria-label", labelText);
        input.addEventListener("input", () => { combatData[field] = input.valueAsNumber; dirty = true; updateCombatSummary(); });
        label.append(input); row.append(label);
      }
      other.append(row);
    }
    const categories = [["weapon", "Attaques d'armes"], ["natural", "Attaques naturelles"], ["class", "Capacités de classe"],
      ["ancestry", "Capacités raciales"], ["item", "Objets"], ["misc", "Divers"]];
    const addRow = document.createElement("div"); addRow.className = "sheet-inventory-add";
    const newName = document.createElement("input"); newName.maxLength = 80; newName.placeholder = "Nom de l'attaque"; newName.setAttribute("aria-label", "Nom de la nouvelle attaque");
    const category = document.createElement("select"); category.setAttribute("aria-label", "Catégorie de la nouvelle attaque");
    for (const [id, label] of categories) { const option = document.createElement("option"); option.value = id; option.textContent = label; category.append(option); }
    const add = document.createElement("button"); add.type = "button"; add.textContent = "+ Ajouter";
    add.addEventListener("click", () => {
      const name = newName.value.trim();
      if (!name) { status.textContent = "Saisis le nom de l'attaque."; return; }
      if (attacksData.length >= 100) { status.textContent = "La limite de 100 attaques est atteinte."; return; }
      attacksData.push({ id: crypto.randomUUID(), name, category: category.value, bonus: "", damage: "", range: "" });
      dirty = true; renderCombat();
    });
    addRow.append(newName, category, add); other.append(addRow);
    for (const [categoryId, categoryLabel] of categories) {
      other.append(previewElement(categoryLabel, "sheet-preview-heading"));
      const attacks = attacksData.filter((attack) => attack.category === categoryId);
      if (attacks.length === 0) { other.append(previewElement("Aucune attaque", "sheet-preview-empty")); continue; }
      const heading = document.createElement("div"); heading.className = "sheet-attack-row sheet-inventory-head";
      for (const text of ["Nom", "Bonus d'attaque", "Dégâts", "Portée", ""]) heading.append(previewElement(text, ""));
      other.append(heading);
      for (const attack of attacks) {
        const row = document.createElement("div"); row.className = "sheet-attack-row"; row.dataset.attackId = attack.id;
        const bonusChoice = document.createElement("select"); bonusChoice.setAttribute("aria-label", `Bonus utilisé ${attack.name}`);
        function updateBonuses() {
          bonusChoice.replaceChildren();
          for (const [index, value] of attack.bonus.split("/").entries()) {
            const option = document.createElement("option"); option.value = String(index); option.textContent = value.trim() || "Bonus manquant"; bonusChoice.append(option);
          }
        }
        bonusChoice.addEventListener("input", (event) => event.stopPropagation());
        bonusChoice.addEventListener("change", (event) => event.stopPropagation());
        updateBonuses();
        /** @param {'name' | 'bonus' | 'damage' | 'range'} key @param {string} label @param {number} max */
        function field(key, label, max) {
          const input = document.createElement("input"); input.type = "text"; input.maxLength = max; input.value = attack[key];
          input.setAttribute("aria-label", `${label} ${attack.name}`); input.placeholder = label;
          if (key === "name") input.required = true;
          input.addEventListener("input", () => { attack[key] = input.value; dirty = true; if (key === "bonus") updateBonuses(); }); return input;
        }
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = `Supprimer ${attack.name}`;
        remove.addEventListener("click", () => { attacksData = attacksData.filter((item) => item.id !== attack.id); dirty = true; renderCombat(); });
        row.append(field("name", "Nom", 80), field("bonus", "Bonus", 60), field("damage", "Dégâts", 80), field("range", "Portée", 40), remove);
        const actions = document.createElement("div"); actions.className = "sheet-attack-actions";
        for (const [kind, label] of /** @type {Array<['attack' | 'damage', string]>} */ ([["attack", "Lancer l'attaque"], ["damage", "Lancer les dégâts"]])) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label;
          button.dataset.attackRoll = attack.id; button.dataset.rollKind = kind;
          button.addEventListener("click", () => {
            const id = permittedId();
            if (dirty || busy || !id || !window.RollView) return;
            void window.RollView.rollAttack(id, attack.id, kind, Number(bonusChoice.value));
          });
          actions.append(button);
        }
        actions.prepend(bonusChoice);
        other.append(row, actions);
      }
    }
    updateSave();
  }

  function renderSpells() {
    other.replaceChildren();
    other.append(previewElement("La liste et les points de magie sont saisis manuellement. Les effets et les dépenses automatiques restent à développer.", "sheet-preview-notice"));
    const points = document.createElement("div"); points.className = "sheet-spell-points";
    for (const [field, labelText] of /** @type {Array<['current' | 'maximum', string]>} */ ([["current", "Points de magie actuels"], ["maximum", "Points de magie maximum"]])) {
      const label = document.createElement("label"); label.textContent = labelText;
      const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "1000000"; input.step = "1"; input.required = true;
      input.value = String(spellsData.points[field]); input.setAttribute("aria-label", labelText);
      input.addEventListener("input", () => { spellsData.points[field] = input.valueAsNumber; dirty = true; });
      label.append(input); points.append(label);
    }
    other.append(previewElement("Points de magie", "sheet-preview-heading"), points);
    const addRow = document.createElement("div"); addRow.className = "sheet-inventory-add";
    const newName = document.createElement("input"); newName.maxLength = 80; newName.placeholder = "Nom du sort ou de la capacité"; newName.setAttribute("aria-label", "Nom du nouveau sort");
    const level = document.createElement("select"); level.setAttribute("aria-label", "Niveau du nouveau sort");
    for (let value = 0; value <= 9; value++) { const option = document.createElement("option"); option.value = String(value); option.textContent = value === 0 ? "Tours / niveau 0" : `Niveau ${value}`; level.append(option); }
    const add = document.createElement("button"); add.type = "button"; add.textContent = "+ Ajouter";
    add.addEventListener("click", () => {
      const name = newName.value.trim();
      if (!name) { status.textContent = "Saisis le nom du sort ou de la capacité."; return; }
      if (spellsData.entries.length >= 100) { status.textContent = "La limite de 100 sorts est atteinte."; return; }
      spellsData.entries.push({ id: crypto.randomUUID(), name, level: Number(level.value), cost: 0, action: "", description: "" });
      dirty = true; renderSpells();
    });
    addRow.append(newName, level, add); other.append(addRow);
    for (let value = 0; value <= 9; value++) {
      other.append(previewElement(value === 0 ? "Tours de magie / niveau 0" : `Niveau ${value}`, "sheet-preview-heading"));
      const entries = spellsData.entries.filter((spell) => spell.level === value);
      if (!entries.length) { other.append(previewElement("Aucun sort ou capacité", "sheet-preview-empty")); continue; }
      const headings = document.createElement("div"); headings.className = "sheet-spell-row sheet-inventory-head";
      for (const text of ["Nom", "Points", "Action", "Niveau", ""]) headings.append(previewElement(text, ""));
      other.append(headings);
      for (const spell of entries) {
        const wrapper = document.createElement("div"); wrapper.className = "sheet-spell-entry"; wrapper.dataset.spellId = spell.id;
        const row = document.createElement("div"); row.className = "sheet-spell-row";
        const name = document.createElement("input"); name.type = "text"; name.maxLength = 80; name.required = true; name.value = spell.name; name.setAttribute("aria-label", `Nom du sort ${spell.name}`);
        name.addEventListener("input", () => { spell.name = name.value; dirty = true; });
        const cost = document.createElement("input"); cost.type = "number"; cost.min = "0"; cost.max = "1000000"; cost.step = "1"; cost.required = true; cost.value = String(spell.cost); cost.setAttribute("aria-label", `Coût en points ${spell.name}`);
        cost.addEventListener("input", () => { spell.cost = cost.valueAsNumber; dirty = true; });
        const action = document.createElement("input"); action.type = "text"; action.maxLength = 60; action.value = spell.action; action.setAttribute("aria-label", `Action ${spell.name}`);
        action.addEventListener("input", () => { spell.action = action.value; dirty = true; });
        const spellLevel = document.createElement("select"); spellLevel.setAttribute("aria-label", `Niveau ${spell.name}`);
        for (let number = 0; number <= 9; number++) { const option = document.createElement("option"); option.value = String(number); option.textContent = String(number); spellLevel.append(option); }
        spellLevel.value = String(spell.level);
        spellLevel.addEventListener("change", () => { spell.level = Number(spellLevel.value); dirty = true; renderSpells(); });
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = `Supprimer ${spell.name}`;
        remove.addEventListener("click", () => { spellsData.entries = spellsData.entries.filter((item) => item.id !== spell.id); dirty = true; renderSpells(); });
        row.append(name, cost, action, spellLevel, remove);
        const description = document.createElement("textarea"); description.placeholder = "Description ou notes (facultatif)"; description.maxLength = 500; description.value = spell.description; description.setAttribute("aria-label", `Description ${spell.name}`);
        description.addEventListener("input", () => { spell.description = description.value; dirty = true; });
        const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Description"; details.append(summary, description);
        wrapper.append(row, details); other.append(wrapper);
      }
    }
    updateSave();
  }

  function renderFeatures() {
    other.replaceChildren();
    other.append(previewElement("Les capacités et leurs utilisations sont saisies manuellement ; leurs effets ne sont pas encore appliqués automatiquement.", "sheet-preview-notice"));
    const categories = [["class", "Capacités de classe"], ["feat", "Dons"], ["trait", "Traits"], ["ancestry", "Traits raciaux"],
      ["template", "Archétypes"], ["martial", "Disciplines martiales"], ["misc", "Divers"]];
    const addRow = document.createElement("div"); addRow.className = "sheet-inventory-add";
    const newName = document.createElement("input"); newName.maxLength = 80; newName.placeholder = "Nom de la capacité"; newName.setAttribute("aria-label", "Nom de la nouvelle capacité");
    const category = document.createElement("select"); category.setAttribute("aria-label", "Catégorie de la nouvelle capacité");
    for (const [id, label] of categories) { const option = document.createElement("option"); option.value = id; option.textContent = label; category.append(option); }
    const add = document.createElement("button"); add.type = "button"; add.textContent = "+ Ajouter";
    add.addEventListener("click", () => {
      const name = newName.value.trim();
      if (!name) { status.textContent = "Saisis le nom de la capacité."; return; }
      if (featuresData.length >= 100) { status.textContent = "La limite de 100 capacités est atteinte."; return; }
      featuresData.push({ id: crypto.randomUUID(), name, category: category.value, action: "", description: "", uses: null });
      dirty = true; renderFeatures();
    });
    addRow.append(newName, category, add); other.append(addRow);
    for (const [categoryId, categoryLabel] of categories) {
      other.append(previewElement(categoryLabel, "sheet-preview-heading"));
      const features = featuresData.filter((feature) => feature.category === categoryId);
      if (!features.length) { other.append(previewElement("Aucune capacité", "sheet-preview-empty")); continue; }
      for (const feature of features) {
        const wrapper = document.createElement("div"); wrapper.className = "sheet-feature-entry"; wrapper.dataset.featureId = feature.id;
        const row = document.createElement("div"); row.className = "sheet-feature-row";
        const name = document.createElement("input"); name.type = "text"; name.maxLength = 80; name.required = true; name.value = feature.name; name.setAttribute("aria-label", `Nom de la capacité ${feature.name}`);
        name.addEventListener("input", () => { feature.name = name.value; dirty = true; });
        const action = document.createElement("input"); action.type = "text"; action.maxLength = 60; action.value = feature.action; action.placeholder = "Action"; action.setAttribute("aria-label", `Action ${feature.name}`);
        action.addEventListener("input", () => { feature.action = action.value; dirty = true; });
        const usesLabel = document.createElement("label"); usesLabel.className = "sheet-feature-uses"; usesLabel.textContent = "Utilisations";
        const usesEnabled = document.createElement("input"); usesEnabled.type = "checkbox"; usesEnabled.checked = feature.uses !== null; usesEnabled.setAttribute("aria-label", `Utilisations limitées ${feature.name}`);
        usesEnabled.addEventListener("change", () => { feature.uses = usesEnabled.checked ? { current: 0, maximum: 0 } : null; dirty = true; renderFeatures(); });
        usesLabel.append(usesEnabled);
        const uses = document.createElement("span"); uses.className = "sheet-feature-count";
        if (feature.uses) {
          for (const [field, labelText] of /** @type {Array<['current' | 'maximum', string]>} */ ([["current", "Utilisations restantes"], ["maximum", "Utilisations maximum"]])) {
            if (field === "maximum") uses.append(document.createTextNode(" / "));
            const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "1000000"; input.step = "1"; input.required = true;
            input.value = String(feature.uses[field]); input.setAttribute("aria-label", `${labelText} ${feature.name}`);
            input.addEventListener("input", () => { if (feature.uses) feature.uses[field] = input.valueAsNumber; dirty = true; }); uses.append(input);
          }
        } else uses.textContent = "Sans limite";
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = `Supprimer ${feature.name}`;
        remove.addEventListener("click", () => { featuresData = featuresData.filter((item) => item.id !== feature.id); dirty = true; renderFeatures(); });
        row.append(name, action, usesLabel, uses, remove);
        const description = document.createElement("textarea"); description.placeholder = "Description ou notes (facultatif)"; description.maxLength = 500; description.value = feature.description; description.setAttribute("aria-label", `Description ${feature.name}`);
        description.addEventListener("input", () => { feature.description = description.value; dirty = true; });
        const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Description"; details.append(summary, description);
        wrapper.append(row, details); other.append(wrapper);
      }
    }
    updateSave();
  }
  function renderEffects() {
    other.replaceChildren();
    other.append(previewElement("États et effets sont suivis manuellement. Ils ne modifient pas encore les valeurs ni la carte automatiquement.", "sheet-preview-notice"));
    const conditions = [
      ["bleeding", "Saignement"], ["blinded", "Aveuglé"], ["burrowing", "Enfouissement"], ["confused", "Confus"],
      ["cowering", "Recroquevillé"], ["cursed", "Maudit"], ["dazed", "Hébété"], ["dazzled", "Ébloui"], ["deafened", "Sourd"],
      ["disabled", "Hors de combat"], ["dying", "Mourant"], ["entangled", "Enchevêtré"], ["exhausted", "Épuisé"], ["fatigued", "Fatigué"],
      ["flat-footed", "Pris au dépourvu"], ["flying", "En vol"], ["frightened", "Effrayé"], ["grappled", "Agrippé"], ["helpless", "Sans défense"],
      ["hovering", "Vol stationnaire"], ["incorporeal", "Intangible"], ["invisible", "Invisible"], ["nauseated", "Nauséeux"],
      ["off-balance", "Déséquilibré"], ["panicked", "Paniqué"], ["paralyzed", "Paralysé"], ["petrified", "Pétrifié"], ["pinned", "Immobilisé"],
      ["prone", "À terre"], ["shaken", "Secoué"], ["sickened", "Malade"], ["sleeping", "Endormi"], ["staggered", "Chancelant"],
      ["stunned", "Étourdi"], ["swimming", "En nage"], ["unconscious", "Inconscient"],
    ];
    const grid = document.createElement("div"); grid.className = "sheet-condition-grid";
    for (const [id, text] of conditions) {
      const label = document.createElement("label"); label.className = "sheet-condition";
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = effectsData.conditions.includes(id); input.setAttribute("aria-label", text);
      input.addEventListener("change", () => {
        effectsData.conditions = input.checked ? [...effectsData.conditions, id] : effectsData.conditions.filter((item) => item !== id); dirty = true;
      });
      label.append(input, document.createTextNode(text)); grid.append(label);
    }
    other.append(previewElement("États et conditions", "sheet-preview-heading"), grid);
    const categories = [["temporary", "Effets temporaires"], ["spell", "Sorts"], ["item", "Objets"], ["feature", "Capacités"],
      ["permanent", "Effets permanents"], ["misc", "Divers"], ["stance", "Postures"]];
    const addRow = document.createElement("div"); addRow.className = "sheet-inventory-add";
    const newName = document.createElement("input"); newName.maxLength = 80; newName.placeholder = "Nom de l'effet"; newName.setAttribute("aria-label", "Nom du nouvel effet");
    const category = document.createElement("select"); category.setAttribute("aria-label", "Catégorie du nouvel effet");
    for (const [id, label] of categories) { const option = document.createElement("option"); option.value = id; option.textContent = label; category.append(option); }
    const add = document.createElement("button"); add.type = "button"; add.textContent = "+ Ajouter";
    add.addEventListener("click", () => {
      const name = newName.value.trim();
      if (!name) { status.textContent = "Saisis le nom de l'effet."; return; }
      if (effectsData.entries.length >= 100) { status.textContent = "La limite de 100 effets est atteinte."; return; }
      effectsData.entries.push({ id: crypto.randomUUID(), name, category: category.value, duration: "", active: false, description: "" });
      dirty = true; renderEffects();
    });
    addRow.append(newName, category, add); other.append(addRow);
    for (const [categoryId, categoryLabel] of categories) {
      other.append(previewElement(categoryLabel, "sheet-preview-heading"));
      const effects = effectsData.entries.filter((effect) => effect.category === categoryId);
      if (!effects.length) { other.append(previewElement("Aucun effet", "sheet-preview-empty")); continue; }
      for (const effect of effects) {
        const wrapper = document.createElement("div"); wrapper.className = "sheet-effect-entry"; wrapper.dataset.effectId = effect.id;
        const row = document.createElement("div"); row.className = "sheet-effect-row";
        const name = document.createElement("input"); name.type = "text"; name.maxLength = 80; name.required = true; name.value = effect.name; name.setAttribute("aria-label", `Nom de l'effet ${effect.name}`);
        name.addEventListener("input", () => { effect.name = name.value; dirty = true; });
        const duration = document.createElement("input"); duration.type = "text"; duration.maxLength = 60; duration.value = effect.duration; duration.placeholder = "Durée"; duration.setAttribute("aria-label", `Durée ${effect.name}`);
        duration.addEventListener("input", () => { effect.duration = duration.value; dirty = true; });
        const activeLabel = document.createElement("label"); activeLabel.className = "sheet-item-equipped"; activeLabel.textContent = "Actif";
        const active = document.createElement("input"); active.type = "checkbox"; active.checked = effect.active; active.setAttribute("aria-label", `Effet actif ${effect.name}`);
        active.addEventListener("change", () => { effect.active = active.checked; dirty = true; }); activeLabel.append(active);
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = `Supprimer ${effect.name}`;
        remove.addEventListener("click", () => { effectsData.entries = effectsData.entries.filter((item) => item.id !== effect.id); dirty = true; renderEffects(); });
        row.append(name, duration, activeLabel, remove);
        const description = document.createElement("textarea"); description.placeholder = "Description ou notes (facultatif)"; description.maxLength = 500; description.value = effect.description; description.setAttribute("aria-label", `Description ${effect.name}`);
        description.addEventListener("input", () => { effect.description = description.value; dirty = true; });
        const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Description"; details.append(summary, description);
        wrapper.append(row, details); other.append(wrapper);
      }
    }
    updateSave();
  }

  /** @param {string} tab */
  function renderPreview(tab) {
    other.replaceChildren();
    if (tab === "skills") { renderSkills(); return; }
    if (tab === "inventory") { renderInventory(); return; }
    if (tab === "combat") { renderCombat(); return; }
    if (tab === "spells") { renderSpells(); return; }
    if (tab === "features") { renderFeatures(); return; }
    if (tab === "buffs") { renderEffects(); return; }
    if (tab === "biography" || tab === "notes") {
      /** @type {Array<{label: string, key: 'appearance' | 'history' | 'notes', max: number}>} */
      const sections = tab === "biography" ? [{ label: "Apparence", key: "appearance", max: 2000 }, { label: "Histoire du personnage", key: "history", max: 4000 }] : [{ label: "Notes du personnage", key: "notes", max: 4000 }];
      for (const section of sections) {
        const label = document.createElement("label"); label.className = "sheet-text-section";
        const heading = document.createElement("span"); heading.textContent = section.label; heading.className = "sheet-preview-heading";
        const input = document.createElement("textarea"); input.maxLength = section.max;
        input.value = section.key === "notes" ? notesData : biographyData[section.key];
        input.addEventListener("input", () => {
          if (section.key === "notes") notesData = input.value; else biographyData[section.key] = input.value;
          dirty = true;
        });
        label.append(heading, input); other.append(label);
      }
      updateSave(); return;
    }
    other.append(previewElement("Présentation à vérifier - contenu et règles à développer", "sheet-preview-notice"));
    /** @type {Record<string, string[]>} */
    const groups = {
      combat: ["Attaques d'armes", "Attaques naturelles", "Capacités de classe", "Capacités raciales", "Objets", "Divers", "Défenses", "Notes de jets de sauvegarde", "Notes de classe d'armure"],
      inventory: ["Monnaie", "Armes", "Armures et boucliers", "Équipement", "Consommables", "Matériel", "Munitions", "Divers", "Marchandises", "Conteneurs", "Charge transportée"],
      features: ["Capacités de classe", "Dons", "Traits", "Traits raciaux", "Archétypes", "Disciplines martiales", "Divers"],
      spells: ["Points de magie Spheres", "Tours de magie", "Niveau 1", "Niveau 2", "Niveau 3", "Niveau 4", "Niveau 5", "Niveau 6", "Niveau 7", "Niveau 8", "Niveau 9"],
      buffs: ["États et conditions", "Effets temporaires", "Sorts", "Objets", "Capacités", "Effets permanents", "Divers", "Postures"],
      biography: ["Biographie", "Apparence", "Histoire du personnage"],
      notes: ["Notes du personnage"],
      settings: ["Configuration de base", "Caractéristiques associées", "Jets de sauvegarde", "Combat", "Défense", "Options Spheres", "Bonus de la partie"],
    };
    if (tab === "combat") other.append(previewElement("BBA             BMO             Corps à corps             Distance             Initiative", "sheet-preview-stats"));
    if (tab === "spells") other.append(previewElement("Concentration          Niveau de lanceur          Courte          Moyenne          Longue", "sheet-preview-stats"));
    for (const label of groups[tab] || []) {
      other.append(previewElement(label, "sheet-preview-heading"));
      other.append(previewElement("À venir", "sheet-preview-empty"));
    }
  }
  close.addEventListener("click", closePanel);
  profile.addEventListener("change", () => {
    if (dirty) { profile.value = selectedId; status.textContent = "Enregistre ou recharge la fiche avant de changer de profil."; return; }
    selectedId = profile.value; void load();
  });
  reload.addEventListener("click", () => { void load(); });
  form.addEventListener("input", () => { dirty = true; updateSkillRollButtons(); });
  form.addEventListener("change", () => { dirty = true; updateSkillRollButtons(); });
  armorPenalty.addEventListener("input", () => { armorPenaltyValue = armorPenalty.valueAsNumber; refreshSkillTotals(); });
  name.addEventListener("input", () => { title.textContent = name.value.trim() || "Fiche de personnage"; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = permittedId(); const key = accessKey();
    if (!id || !key || busy) return;
    const scores = Object.fromEntries([...controls].map(([field, control]) => [field, control.input.valueAsNumber]));
    const identity = Object.fromEntries([...identityInputs].map((input) => [input.dataset.characterIdentity, input.value]));
    const movement = Object.fromEntries([...movementInputs].map((input) => [input.dataset.characterMovement, input.value]));
    const current = ++generation; busy = true; updateSave();
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.value, scores, abilityAdjustments, revision, level: level.valueAsNumber, skills: skillData, armorCheckPenalty: armorPenaltyValue, inventory: inventoryData, combat: combatData, attacks: attacksData, spells: spellsData, features: featuresData, effects: effectsData, identity, movement,
          biography: biographyData, notes: notesData,
          hitPoints: { current: hpCurrent.valueAsNumber, maximum: hpMaximum.valueAsNumber,
            temporary: hpTemporary.valueAsNumber, nonlethal: hpNonlethal.valueAsNumber } }), signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      if (current !== generation || id !== permittedId() || key !== accessKey()) return;
      if (!response.ok) { status.textContent = result.error || "Enregistrement refusé."; return; }
      revision = result.character.revision; dirty = false; status.textContent = "Fiche enregistrée.";
    } catch (error) { if (current === generation) status.textContent = "Enregistrement non confirmé. Recharge la fiche avant de réessayer."; console.error(error); }
    finally { if (current === generation) { busy = false; updateSave(); } }
  });
  window.CharacterView = {
    close: closePanel,
    openFor,
    updatePortrait,
    updated: () => {
      if (panel.hidden || busy) return;
      if (dirty) status.textContent = "Une fiche a changé. Enregistre ou recharge pour vérifier les modifications.";
      else void load();
    },
  };
})();

(() => {
    const layer = document.getElementById("board-tokens");
    const viewport = document.getElementById("board-viewport");
    const manager = document.getElementById("token-manager");
    const form = document.getElementById("token-form");
    const nameInput = document.getElementById("token-name");
    const ownerInput = document.getElementById("token-owner");
    const createButton = document.getElementById("token-create");
    const deleteButton = document.getElementById("token-delete");
    const status = document.getElementById("token-status");
    const isHostPage = window.location.pathname === "/host";
    let state = { map: null, tokens: [] };
    let selectedId = null;
    let version = 0;
    let drag = null;
    let busy = false;
    let refreshQueued = false;
    const tokenElements = new Map();

    manager.hidden = !isHostPage;

    function key() {
        return isHostPage ? hostKeyInput.value || null : playerToken;
    }

    function hasVisibleMap() {
        return state.map !== null && window.MapView && window.MapView.currentId() === state.map.id;
    }

    function canMove(token) {
        return isHostPage || (currentPlayerProfile !== null && token.ownerProfileId !== null &&
            currentPlayerProfile.id === token.ownerProfileId);
    }

    function updateControls() {
        const enabled = isHostPage && !!key() && hasVisibleMap() && !busy && drag === null;
        nameInput.disabled = !enabled;
        ownerInput.disabled = !enabled;
        createButton.disabled = !enabled;
        deleteButton.disabled = !enabled || !selectedId;
    }

    function selectToken(id) {
        selectedId = id;
        render();
    }

    function render() {
        if (drag) return;
        if (!hasVisibleMap()) {
            layer.replaceChildren();
            tokenElements.clear();
            updateControls();
            return;
        }
        const activeIds = new Set(state.tokens.map((token) => token.id));
        for (const [id, button] of tokenElements) {
            if (!activeIds.has(id)) {
                button.remove();
                tokenElements.delete(id);
            }
        }
        for (const token of state.tokens) {
            let button = tokenElements.get(token.id);
            if (!button) {
                button = document.createElement("button");
                button.type = "button";
                const nameLabel = document.createElement("span");
                nameLabel.className = "board-token-name";
                button.append(nameLabel);
                button.addEventListener("click", () => selectToken(token.id));
                button.addEventListener("pointerdown", (event) => {
                    const current = state.tokens.find((item) => item.id === token.id);
                    if (current) startDrag(event, button, current);
                });
                button.addEventListener("pointermove", moveDrag);
                button.addEventListener("pointerup", finishDrag);
                button.addEventListener("pointercancel", cancelDrag);
                button.addEventListener("lostpointercapture", cancelDrag);
                button.addEventListener("keydown", (event) => {
                    const current = state.tokens.find((item) => item.id === token.id);
                    if (current) moveWithKeyboard(event, current);
                });
                tokenElements.set(token.id, button);
                layer.append(button);
            }
            button.className = selectedId === token.id ? "board-token selected" : "board-token";
            button.firstChild.textContent = token.name;
            button.setAttribute("data-initial", Array.from(token.name)[0].toUpperCase());
            button.title = token.name;
            button.setAttribute("aria-label", `${token.name}${canMove(token) ? ", pion déplaçable" : ", pion d'un autre joueur"}`);
            button.setAttribute("aria-pressed", selectedId === token.id ? "true" : "false");
            button.style.left = `${token.x}px`;
            button.style.top = `${token.y}px`;
        }
        updateControls();
    }

    function clear() {
        version++;
        drag = null;
        state = { map: null, tokens: [] };
        selectedId = null;
        refreshQueued = false;
        status.textContent = "";
        layer.replaceChildren();
        tokenElements.clear();
        render();
    }

    async function refresh() {
        if (drag || busy) {
            refreshQueued = true;
            return;
        }
        const checkedKey = key();
        if (!checkedKey) return;
        const currentVersion = ++version;
        try {
            const response = await fetch("/api/tokens", {
                headers: { Authorization: `Bearer ${checkedKey}` },
                cache: "no-store",
                signal: AbortSignal.timeout(5000),
            });
            if (currentVersion !== version || checkedKey !== key()) return;
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            const result = await response.json();
            if (currentVersion !== version || checkedKey !== key()) return;
            if (drag || busy) {
                refreshQueued = true;
                return;
            }
            state = { map: result.map, tokens: result.tokens };
            if (!state.tokens.some((token) => token.id === selectedId)) selectedId = null;
            render();
        } catch (error) {
            if (currentVersion === version && checkedKey === key()) {
                status.textContent = "Impossible de charger les pions. Reconnexion en cours ou recharge nécessaire.";
            }
            console.error(error);
        }
    }

    async function refreshAfterAction() {
        busy = false;
        refreshQueued = false;
        updateControls();
        await refresh();
    }

    function startDrag(event, button, token) {
        if (event.button !== 0 || event.isPrimary === false || !canMove(token) || busy || drag || !hasVisibleMap()) return;
        event.preventDefault();
        event.stopPropagation();
        button.focus({ preventScroll: true });
        selectedId = token.id;
        // Le fantôme n'existe que dans cette page et ne reçoit aucun événement.
        const ghost = document.createElement("div");
        ghost.className = "board-token board-token-ghost";
        ghost.setAttribute("aria-hidden", "true");
        ghost.setAttribute("data-initial", Array.from(token.name)[0].toUpperCase());
        ghost.style.left = `${token.x}px`;
        ghost.style.top = `${token.y}px`;
        const ghostLabel = document.createElement("span");
        ghostLabel.className = "board-token-name";
        ghostLabel.textContent = token.name;
        ghost.append(ghostLabel);
        layer.append(ghost);
        drag = {
            id: token.id, mapId: state.map.id, pointerId: event.pointerId, button, ghost,
            startX: event.clientX, startY: event.clientY,
            originX: token.x, originY: token.y, x: token.x, y: token.y,
        };
        button.dataset.dragging = "true";
        button.setPointerCapture(event.pointerId);
        updateControls();
    }

    function moveDrag(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!state.map || state.map.id !== drag.mapId || !window.MapView || window.MapView.currentId() !== drag.mapId) {
            cancelDrag();
            void refresh();
            return;
        }
        const zoom = window.BoardCamera.getZoom();
        drag.x = window.JdrGrid.snapToGrid(drag.originX + (event.clientX - drag.startX) / zoom, state.map.width);
        drag.y = window.JdrGrid.snapToGrid(drag.originY + (event.clientY - drag.startY) / zoom, state.map.height);
        drag.ghost.style.left = `${drag.x}px`;
        drag.ghost.style.top = `${drag.y}px`;
    }

    function finishDrag(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
            moveDrag(event);
            if (!drag) return;
        }
        const completed = drag;
        drag = null;
        completed.ghost.remove();
        completed.button.dataset.dragging = "false";
        if (completed.button.hasPointerCapture(completed.pointerId)) {
            completed.button.releasePointerCapture(completed.pointerId);
        }
        if (completed.x === completed.originX && completed.y === completed.originY) {
            render();
            if (refreshQueued) { refreshQueued = false; void refresh(); }
            return;
        }
        // Conserver la position affichée pendant la confirmation du serveur.
        const token = state.tokens.find((item) => item.id === completed.id);
        if (token && state.map?.id === completed.mapId) {
            token.x = completed.x;
            token.y = completed.y;
        }
        render();
        void sendMove(completed.id, completed.mapId, completed.x, completed.y);
    }

    function cancelDrag(event) {
        if (!drag || (event && event.pointerId !== drag.pointerId)) return;
        const cancelled = drag;
        drag = null;
        cancelled.ghost.remove();
        cancelled.button.dataset.dragging = "false";
        if (cancelled.button.hasPointerCapture(cancelled.pointerId)) {
            cancelled.button.releasePointerCapture(cancelled.pointerId);
        }
        render();
        if (refreshQueued) { refreshQueued = false; void refresh(); }
    }

    async function sendMove(id, mapId, x, y) {
        const checkedKey = key();
        if (!checkedKey || busy) return;
        busy = true;
        updateControls();
        try {
            const response = await fetch(`/api/tokens/${encodeURIComponent(id)}`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${checkedKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ mapId, x, y }),
                signal: AbortSignal.timeout(5000),
            });
            const result = await response.json();
            if (checkedKey !== key()) return;
            if (!response.ok) {
                status.textContent = result.error || "Impossible de déplacer le pion.";
            } else {
                const index = state.map?.id === mapId ? state.tokens.findIndex((item) => item.id === id) : -1;
                if (index !== -1) state.tokens[index] = result.token;
                status.textContent = "";
            }
        } catch (error) {
            if (checkedKey === key()) status.textContent = "Déplacement non confirmé. La position sera vérifiée.";
            console.error(error);
        } finally {
            await refreshAfterAction();
        }
    }

    function moveWithKeyboard(event, token) {
        if (!canMove(token) || busy || drag || !hasVisibleMap() || event.ctrlKey || event.altKey || event.metaKey) return;
        const size = window.JdrGrid.GRID_SIZE;
        const delta = {
            ArrowLeft: [-size, 0], ArrowRight: [size, 0], ArrowUp: [0, -size], ArrowDown: [0, size],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        selectedId = token.id;
        const x = window.JdrGrid.snapToGrid(token.x + delta[0], state.map.width);
        const y = window.JdrGrid.snapToGrid(token.y + delta[1], state.map.height);
        if (x !== token.x || y !== token.y) void sendMove(token.id, state.map.id, x, y);
    }

    async function loadOwners() {
        if (!isHostPage || !key()) return;
        const checkedKey = key();
        try {
            const response = await fetch("/api/profiles", {
                headers: { Authorization: `Bearer ${checkedKey}` },
                cache: "no-store", signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            const result = await response.json();
            if (checkedKey !== key()) return;
            const selected = ownerInput.value;
            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "Meneur uniquement";
            ownerInput.replaceChildren(placeholder);
            for (const profile of result.profiles) {
                const option = document.createElement("option");
                option.value = profile.id;
                option.textContent = profile.name;
                ownerInput.append(option);
            }
            ownerInput.value = result.profiles.some((profile) => profile.id === selected) ? selected : "";
        } catch (error) {
            status.textContent = "Impossible de charger les profils pour les pions.";
            console.error(error);
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (createButton.disabled || !hasVisibleMap() || busy) return;
        const name = nameInput.value.trim();
        if (!name || name.length > 40) {
            status.textContent = "Le nom du pion doit contenir entre 1 et 40 caractères.";
            return;
        }
        const checkedKey = key();
        const mapId = state.map.id;
        busy = true;
        updateControls();
        try {
            const response = await fetch("/api/tokens", {
                method: "POST",
                headers: { Authorization: `Bearer ${checkedKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ mapId, name, ownerProfileId: ownerInput.value || null,
                    x: window.JdrGrid.snapToGrid(state.map.width / 2, state.map.width),
                    y: window.JdrGrid.snapToGrid(state.map.height / 2, state.map.height) }),
                signal: AbortSignal.timeout(5000),
            });
            const result = await response.json();
            if (checkedKey !== key()) return;
            if (!response.ok) {
                status.textContent = result.error || "Impossible de créer le pion.";
                return;
            }
            nameInput.value = "";
            selectedId = result.token.id;
            status.textContent = "Pion ajouté.";
        } catch (error) {
            if (checkedKey === key()) status.textContent = "Création non confirmée. Vérifie la liste avant de réessayer.";
            console.error(error);
        } finally {
            await refreshAfterAction();
        }
    });

    deleteButton.addEventListener("click", async () => {
        if (deleteButton.disabled || !selectedId || !hasVisibleMap() || busy) return;
        const checkedKey = key();
        const mapId = state.map.id;
        const id = selectedId;
        busy = true;
        updateControls();
        try {
            const response = await fetch(`/api/tokens/${encodeURIComponent(id)}?mapId=${encodeURIComponent(mapId)}`, {
                method: "DELETE", headers: { Authorization: `Bearer ${checkedKey}` },
                signal: AbortSignal.timeout(5000),
            });
            const result = await response.json();
            if (checkedKey !== key()) return;
            if (!response.ok) {
                status.textContent = result.error || "Impossible de supprimer le pion.";
            } else {
                selectedId = null;
                status.textContent = "Pion supprimé.";
            }
        } catch (error) {
            if (checkedKey === key()) status.textContent = "Suppression non confirmée. La liste sera vérifiée.";
            console.error(error);
        } finally {
            await refreshAfterAction();
        }
    });

    viewport.addEventListener("map-loaded", () => {
        if (drag && (!window.MapView || window.MapView.currentId() !== drag.mapId)) cancelDrag();
        render();
    });
    ownerInput.addEventListener("focus", () => { void loadOwners(); });
    window.addEventListener("blur", () => cancelDrag());
    window.TokenView = { refresh, clear, updatePermissions: () => { if (!busy && !drag) render(); } };
    updateControls();
    void refresh();
    void loadOwners();
})();

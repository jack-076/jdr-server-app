(() => {
    const viewport = /** @type {HTMLElement} */ (document.getElementById("board-viewport"));
    const mapImage = /** @type {HTMLImageElement} */ (document.getElementById("board-map"));
    const grid = /** @type {HTMLElement} */ (document.getElementById("board-grid"));
    const tokens = /** @type {HTMLElement} */ (document.getElementById("board-tokens"));
    const reset = /** @type {HTMLButtonElement} */ (document.getElementById("board-reset"));
    const minZoom = 0.25;
    const maxZoom = 3;
    let minimumZoom = minZoom;
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    /** @type {{id: number, x: number, y: number} | null} */
    let drag = null;
    let fitPending = false;

    // Cette vue reste locale : aucun mouvement n'est envoyé au serveur.
    function render() {
        const cellSize = window.JdrGrid.GRID_SIZE * zoom;
        grid.style.backgroundSize = `${cellSize}px ${cellSize}px`;
        grid.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
        mapImage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
        tokens.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
    }

    /** @param {number} factor @param {number} x @param {number} y */
    function changeZoom(factor, x, y) {
        const next = Math.min(maxZoom, Math.max(minimumZoom, zoom * factor));
        const ratio = next / zoom;
        // Le point sous le curseur reste au même endroit à l'écran.
        offsetX = x - (x - offsetX) * ratio;
        offsetY = y - (y - offsetY) * ratio;
        zoom = next;
        render();
    }

    /** @param {number} factor */
    function zoomAtCenter(factor) {
        const rect = viewport.getBoundingClientRect();
        changeZoom(factor, rect.width / 2, rect.height / 2);
    }

    function stopDrag() {
        const pointerId = drag?.id;
        drag = null;
        viewport.dataset.dragging = "false";
        if (pointerId !== undefined && viewport.hasPointerCapture(pointerId)) {
            viewport.releasePointerCapture(pointerId);
        }
    }

    function resetView() {
        stopDrag();
        if (!mapImage.hidden && fitMap()) return;
        zoom = 1;
        minimumZoom = minZoom;
        offsetX = 0;
        offsetY = 0;
        render();
    }

    function fitMap() {
        const rect = viewport.getBoundingClientRect();
        if (!rect.width || !rect.height || !mapImage.naturalWidth || !mapImage.naturalHeight) {
            fitPending = true;
            return false;
        }
        zoom = Math.min(maxZoom, Math.max(0.01, Math.min(
            rect.width / mapImage.naturalWidth,
            rect.height / mapImage.naturalHeight
        ) * 0.9));
        minimumZoom = Math.min(minZoom, zoom);
        offsetX = (rect.width - mapImage.naturalWidth * zoom) / 2;
        offsetY = (rect.height - mapImage.naturalHeight * zoom) / 2;
        fitPending = false;
        render();
        return true;
    }

    viewport.addEventListener("map-loaded", () => { fitPending = true; fitMap(); });
    viewport.addEventListener("table-opened", () => { if (fitPending) fitMap(); });

    reset.addEventListener("click", resetView);

    viewport.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
        const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
        changeZoom(Math.exp(-delta * 0.002), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    viewport.addEventListener("contextmenu", (event) => event.preventDefault());

    viewport.addEventListener("pointerdown", (event) => {
        const panButton = event.pointerType === "touch" ? 0 : 2;
        if (event.button !== panButton || drag !== null || event.isPrimary === false) return;
        event.preventDefault();
        viewport.focus({ preventScroll: true });
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        viewport.setPointerCapture(event.pointerId);
        viewport.dataset.dragging = "true";
    });

    viewport.addEventListener("pointermove", (event) => {
        if (drag === null || drag.id !== event.pointerId) return;
        offsetX += event.clientX - drag.x;
        offsetY += event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        render();
    });

    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
        viewport.addEventListener(name, (event) => {
            if (drag?.id === /** @type {PointerEvent} */ (event).pointerId) stopDrag();
        });
    }
    window.addEventListener("blur", stopDrag);

    viewport.addEventListener("keydown", (event) => {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        switch (event.key) {
            case "ArrowLeft": offsetX += 40; break;
            case "ArrowRight": offsetX -= 40; break;
            case "ArrowUp": offsetY += 40; break;
            case "ArrowDown": offsetY -= 40; break;
            case "+": case "=": zoomAtCenter(1.2); break;
            case "-": zoomAtCenter(1 / 1.2); break;
            case "0": resetView(); break;
            case "Escape": stopDrag(); break;
            default: return;
        }
        event.preventDefault();
        render();
    });

    window.BoardCamera = { getZoom: () => zoom };
    render();
})();

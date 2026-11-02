(() => {
    const chooseButton = document.getElementById("map-choose");
    const trainingButton = document.getElementById("map-training");
    const fileInput = document.getElementById("map-file");
    const status = document.getElementById("map-status");
    const image = document.getElementById("board-map");
    const emptyMessage = document.getElementById("board-empty-message");
    const viewport = document.getElementById("board-viewport");
    const isHostPage = window.location.pathname === "/host";
    let version = 0;
    let currentId = null;
    let objectUrl = null;
    let uploading = false;

    chooseButton.hidden = !isHostPage;
    trainingButton.hidden = !isHostPage;

    function setBusy(busy) {
        uploading = busy;
        chooseButton.disabled = busy;
        trainingButton.disabled = busy;
    }

    function accessKey() {
        return isHostPage ? hostKeyInput.value || null : playerToken;
    }

    function clear() {
        version++;
        currentId = null;
        image.hidden = true;
        image.removeAttribute("src");
        emptyMessage.hidden = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        status.textContent = "";
    }

    async function refresh(retry = 0) {
        const key = accessKey();
        if (!key) return;
        const requestVersion = ++version;
        const isCurrent = () => requestVersion === version && key === accessKey();
        let candidateUrl = null;
        try {
            const options = {
                headers: { Authorization: `Bearer ${key}` },
                cache: "no-store",
                signal: AbortSignal.timeout(15000),
            };
            const response = await fetch("/api/map", options);
            if (!isCurrent()) return;
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            const result = await response.json();
            if (!isCurrent()) return;
            if (!result.map) {
                clear();
                return;
            }
            if (result.map.id === currentId) {
                status.textContent = "";
                return;
            }
            const imageResponse = await fetch(`/api/map/image?id=${encodeURIComponent(result.map.id)}`, options);
            if (!isCurrent()) return;
            if (imageResponse.status === 404) {
                // La carte a pu changer entre la lecture des métadonnées et l'image.
                if (retry < 1 && isCurrent()) await refresh(retry + 1);
                else if (isCurrent()) status.textContent = "La carte a changé. Recharge la page pour réessayer.";
                return;
            }
            if (!imageResponse.ok) throw new Error(`Erreur HTTP ${imageResponse.status}`);
            const blob = await imageResponse.blob();
            if (!isCurrent()) return;
            candidateUrl = URL.createObjectURL(blob);
            const decoded = new Image();
            await new Promise((resolve, reject) => {
                decoded.onload = resolve;
                decoded.onerror = () => reject(new Error("Image illisible"));
                decoded.src = candidateUrl;
            });
            if (!isCurrent()) return;
            const previousUrl = objectUrl;
            objectUrl = candidateUrl;
            candidateUrl = null;
            currentId = result.map.id;
            let fitted = false;
            const fit = () => {
                if (fitted || currentId !== result.map.id) return;
                fitted = true;
                viewport.dispatchEvent(new Event("map-loaded"));
            };
            image.addEventListener("load", fit, { once: true });
            image.src = objectUrl;
            image.hidden = false;
            emptyMessage.hidden = true;
            status.textContent = "";
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            if (image.complete && image.naturalWidth) fit();
        } catch (error) {
            if (isCurrent()) status.textContent = "Impossible de charger la carte. Réessaie après reconnexion.";
            console.error(error);
        } finally {
            if (candidateUrl) URL.revokeObjectURL(candidateUrl);
        }
    }

    chooseButton.addEventListener("click", () => { if (!uploading) fileInput.click(); });
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file || uploading) return;
        if (!["image/png", "image/jpeg"].includes(file.type)) {
            status.textContent = "Choisis une image PNG ou JPEG.";
            fileInput.value = "";
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            status.textContent = "La carte dépasse 10 Mio.";
            fileInput.value = "";
            return;
        }
        setBusy(true);
        status.textContent = "Import de la carte...";
        try {
            if (typeof createImageBitmap === "function") {
                let bitmap;
                try {
                    bitmap = await createImageBitmap(file);
                    if (!bitmap.width || !bitmap.height || bitmap.width > 16384 || bitmap.height > 16384 ||
                        bitmap.width * bitmap.height > 40000000) {
                        status.textContent = "Les dimensions de cette carte sont trop grandes.";
                        return;
                    }
                } catch {
                    status.textContent = "Cette image est illisible.";
                    return;
                } finally {
                    if (bitmap) bitmap.close();
                }
            }
            const response = await fetch("/api/map", {
                method: "PUT",
                headers: { Authorization: `Bearer ${accessKey()}`, "Content-Type": file.type },
                body: file,
                signal: AbortSignal.timeout(30000),
            });
            const result = await response.json();
            if (!response.ok) {
                status.textContent = result.error || "Import impossible.";
                return;
            }
            await refresh();
        } catch (error) {
            status.textContent = "Import non confirmé. Recharge la page pour vérifier la carte.";
            console.error(error);
        } finally {
            setBusy(false);
            fileInput.value = "";
        }
    });

    trainingButton.addEventListener("click", async () => {
        if (uploading) return;
        setBusy(true);
        status.textContent = "Chargement du terrain d'entraînement...";
        try {
            const response = await fetch("/api/map/training", {
                method: "POST",
                headers: { Authorization: `Bearer ${accessKey()}` },
                signal: AbortSignal.timeout(30000),
            });
            const result = await response.json();
            if (!response.ok) {
                status.textContent = result.error || "Chargement impossible.";
                return;
            }
            await refresh();
        } catch (error) {
            status.textContent = "Chargement non confirmé. Recharge la page pour vérifier la carte.";
            console.error(error);
        } finally {
            setBusy(false);
        }
    });

    window.MapView = { refresh, clear, currentId: () => currentId };
    void refresh();
})();

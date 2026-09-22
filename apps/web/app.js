const statusElement = document.getElementById("session-status");
const refreshButton = document.getElementById("refresh-session");
const hostKeyInput = document.getElementById("host-key");
const startButton = document.getElementById("start-session");
const stopButton = document.getElementById("stop-session");
const hostMessage = document.getElementById("host-message");
const invitationButton = document.getElementById("get-invitation");
const invitationInput = document.getElementById("invitation-token");
const joinForm = document.getElementById("join-form");
const joinInput = document.getElementById("join-token");
const joinButton = document.getElementById("join-session");
const playerMessage = document.getElementById("player-message");
const checkAccessButton = document.getElementById("check-access");

let playerToken = null;

refreshButton.addEventListener("click", refreshSession);

async function refreshSession() {
    refreshButton.disabled = true;
    statusElement.textContent = "Chargement…";

    try {
        const response = await fetch("/api/session", {
            cache: "no-store",
        });

        if  (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const session= await response.json();

        statusElement.textContent =
            session.status === "running"
            ? "Partie en cours"
            : "Partie arrêtée";
    } catch (error) {
        statusElement.textContent = "Impossible de contacter le serveur.";
        console.error(error);
    } finally {
        refreshButton.disabled = false;
    }
}

async function changeSession(action) {
    const key = hostKeyInput.value.trim();

    if (!/^[a-f0-9]{64}$/.test(key)) {
        hostMessage.textContent = "Saisis la clé du meneur.";
        return;
    }

    startButton.disabled = true;
    stopButton.disabled = true;
    invitationButton.disabled = true;
    invitationInput.value = "";
    hostMessage.textContent = "Action en cours…";

    try {
        const response = await fetch(`/api/session/${action}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
            },
            cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok) {
            hostMessage.textContent =result.error || "Action refusée.";
            return;
        }

        hostMessage.textContent =
            action === "start" ? "Partie démarrée." : "Partie arrêtée.";

        await refreshSession();
    }   catch (error) {
        hostMessage.textContent =
            "Réponse indisponible. Actualise l’état avant de réessayer.";
        console.error(error);
    }   finally {
        startButton.disabled = false;
        stopButton.disabled = false;
        invitationButton.disabled = false;
    }
}

async function getInvitation() {
    invitationInput.value = "";

    const key = hostKeyInput.value.trim();

    if (!/^[a-f0-9]{64}$/.test(key)) {
        hostMessage.textContent = "Saisis la clé du meneur.";
        return;
    }

    invitationButton.disabled = true;
    startButton.disabled = true;
    stopButton.disabled = true;
    hostMessage.textContent = "Génération de l’invitation…";

    try {
        const response = await fetch("/api/session/invitation", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
            },
            cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
            hostMessage.textContent = result.error || "Invitation indisponible.";
            return;
        }

        invitationInput.value = result.invitationToken;
        hostMessage.textContent = "Invitation prête à partager à un joueur.";
    }   catch (error) {
        hostMessage.textContent = "Impossible de générer l’invitation.";
        console.error(error);
    }   finally {
        invitationButton.disabled = false;
        startButton.disabled = false;
        stopButton.disabled = false;
    }
}

async function joinSession(event) {
    event.preventDefault();

    if (joinButton.disabled || playerToken !== null) {
        return;
    }

    const invitation = joinInput.value.trim();

    if (!/^[a-f0-9]{64}$/.test(invitation)) {
        playerMessage.textContent = "Saisis la clé d’invitation.";
        return;
    }

    joinButton.disabled = true;
    playerMessage.textContent = "Connexion en cours…";

    try {
        const response = await fetch("/api/session/join", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${invitation}`,
            },
            cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
            playerMessage.textContent = result.error || "Connexion refusée.";
            return;
        }

        playerToken = result.playerToken;
        joinInput.value = "";
        joinInput.disabled = true;
        checkAccessButton.disabled = false;

        playerMessage.textContent = `Partie rejointe. Joueur : ${result.playerId}`;

        await refreshSession();
    }   catch (error) {
            playerMessage.textContent = "Réponse indisponible : la connexion n’a pas pu être confirmée.";
            console.error(error);
        }   finally {
            joinButton.disabled = playerToken !== null;
        }
}

async function checkPlayerAccess() {
    if (playerToken === null || checkAccessButton.disabled) {
        return;
    }

    checkAccessButton.disabled = true;
    playerMessage.textContent = "Vérification de l’accès…";

    try {
        const response = await fetch("/api/session/me", {
            headers: {
                Authorization: `Bearer ${playerToken}`,
            },
            cache: "no-store",
        });

        if (response.status === 401) {
            playerToken = null;
            joinInput.value = "";
            joinInput.disabled = false;
            joinButton.disabled = false;

            playerMessage.textContent = "Accès expiré ou révoqué. Demande une nouvelle invitation.";

            await refreshSession();
            return;
        }

        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const result = await response.json();

        playerMessage.textContent = `Accès valide. Joueur : ${result.playerId}`;

        await refreshSession();
    }   catch (error) {
        playerMessage.textContent = "Vérification impossible. Réessaie lorsque le serveur est accessible.";
        console.error(error);
    }   finally {
        checkAccessButton.disabled = playerToken === null;
    }
}

startButton.addEventListener("click", () => changeSession("start"));
stopButton.addEventListener("click", () => changeSession("stop"));
invitationButton.addEventListener("click", getInvitation);
checkAccessButton.addEventListener("click", checkPlayerAccess);
joinForm.addEventListener("submit", joinSession);

refreshSession();

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
const loadProfilesButton = document.getElementById("load-profiles");
const profilesMessage = document.getElementById("profiles-message");
const profilesList = document.getElementById("profiles-list");
const createProfileForm = document.getElementById("create-profile-form");
const profileNameInput = document.getElementById("profile-name");
const createProfileButton = document.getElementById("create-profile");
const createProfileMessage = document.getElementById("create-profile-message");

let playerToken = null;
let sessionRevision = 0;
let accessCheckPending = false;
let accessCheckRunning = false;

function revokePlayerAccess() {
    savePlayerToken(null);
    joinInput.value = "";
    joinInput.disabled = false;
    joinButton.disabled = false;
    checkAccessButton.disabled = true;
    playerMessage.textContent = "Accès expiré ou révoqué. Demande une nouvelle invitation.";
}

function savePlayerToken(token) {
    playerToken = token;

    try {
        if (token === null) {
            sessionStorage.removeItem("jdr.playerToken");
        } else {
            sessionStorage.setItem("jdr.playerToken", token);
        }
    } catch {
        console.warn("Le stockage de l'accès joueur es indisponible.");
    }
}

function restorePlayerToken() {
    let savedToken;

    try {
        savedToken = sessionStorage.getItem("jdr.playerToken");
    } catch {
        return;
    }

    if (
        typeof savedToken !== "string" || !/^[a-f0-9]{64}$/.test(savedToken)
    ) {
        return;
    }

    playerToken = savedToken;
    joinInput.value = "";
    joinInput.disabled = true;
    joinButton.disabled = true;
    checkAccessButton.disabled = false;

    playerMessage.textContent = "Vérification de l'accès enregistré ...";
}

refreshButton.addEventListener("click", refreshSession);

async function refreshSession() {
    if (refreshButton.disabled) {
        return;
    }
    refreshButton.disabled = true;
    const revision = sessionRevision;
    statusElement.textContent = "Chargement…";

    try {
        const response = await fetch("/api/session", {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        });

        if  (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const session= await response.json();

        if (revision !== sessionRevision) {
            return;
        }

        statusElement.textContent =
            session.status === "running"
            ? "Partie en cours"
            : "Partie arrêtée";
    } catch (error) {
        if (revision === sessionRevision) {
            statusElement.textContent = "Impossible de contacter le serveur.";
        }
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
            signal: AbortSignal.timeout(5000),
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
            signal: AbortSignal.timeout(5000),
        });

        const result = await response.json();

        if (!response.ok) {
            hostMessage.textContent = result.error || "Invitation indisponible.";
            return;
        }

        const invitationUrl = new URL("/", window.location.origin);
        invitationUrl.hash = `invitation=${result.invitationToken}`;

        invitationInput.value = invitationUrl.href;
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
            signal: AbortSignal.timeout(5000),
        });

        const result = await response.json();

        if (!response.ok) {
            playerMessage.textContent = result.error || "Connexion refusée.";
            return;
        }

        savePlayerToken(result.playerToken);
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

async function checkPlayerAccess({ silent = false} = {}) {
    if (playerToken === null) {
        return;
    }
    if (accessCheckRunning) {
        accessCheckPending = true;
        return;
    }

    const checkedToken = playerToken;
    const revision = sessionRevision;
    const isCurrent = () => checkedToken === playerToken && revision === sessionRevision;
    accessCheckRunning = true;
    checkAccessButton.disabled = true;
    if (!silent) {
        playerMessage.textContent = "Vérification de l’accès…";
    }

    try {
        const response = await fetch("/api/session/me", {
            headers: {
                Authorization: `Bearer ${checkedToken}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        });

        if (!isCurrent()) {
            return;
        }

        if (response.status === 401) {
            revokePlayerAccess();

            if (!silent) {
                await refreshSession();
            }
            return;
        }

        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!isCurrent()) {
            return;
        }

        const message = `Accès valide. Joueur : ${result.playerId}`;

        if (playerMessage.textContent !== message) {
            playerMessage.textContent = message;
        }

        if (!silent) {
            await refreshSession();
        }

    }   catch (error) {
        if (isCurrent()) {
            playerMessage.textContent = "Vérification impossible. Réessaie lorsque le serveur est accessible.";
        }
        console.error(error);
    }   finally {
        accessCheckRunning = false;
        checkAccessButton.disabled = playerToken === null;
        if (accessCheckPending) {
            accessCheckPending = false;
            await checkPlayerAccess({ silent: true });
        }
    }
}

function loadInvitationFromUrl() {
    const parameters = new URLSearchParams(
        window.location.hash.slice(1)
    );

    const invitation = parameters.get("invitation");

    if (invitation === null) {
        return;
    }

    window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
    );

    if (!/^[a-f0-9]{64}$/.test(invitation)) {
        playerMessage.textContent = "lien d'invitation mal formé.";
        return;
    }

    joinInput.value = invitation;
    playerMessage.textContent =
    "Invitation chargée. Clique sur Rejoindre pour entrer dans la partie.";

    joinButton.focus();
}

async function loadProfiles() {
    if (loadProfilesButton.disabled) {
        return;
    }

    profilesList.replaceChildren();

    const key = hostKeyInput.value.trim();

    if (!/^[a-f0-9]{64}$/.test(key)) {
        profilesMessage.textContent = "Saisis la clé du meneur.";
        return;
    }

    loadProfilesButton.disabled = true;
    profilesMessage.textContent = "Chargement des profils…";

    try {
        const response = await fetch("/api/profiles", {
            headers: {
                Authorization: `Bearer ${key}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        });

        const result = await response.json();

        if (!response.ok) {
            profilesMessage.textContent = result.error || "Accès refusé.";
            return;
        }

        for (const profile of result.profiles) {
            const item = document.createElement("li");
            item.textContent = profile.name;
            profilesList.append(item);
        }

        profilesMessage.textContent = result.profiles.length === 0
            ? "Aucun profil créé."
            : `${result.profiles.length} profil(s) enregistré(s).`;
    } catch (error) {
        profilesMessage.textContent = "Impossible de charger les profils.";
        console.error(error);
    } finally {
        loadProfilesButton.disabled = false;
    }
}

async function createPlayerProfile(event) {
    event.preventDefault();

    if (createProfileButton.disabled) {
        return;
    }

    const key = hostKeyInput.value.trim();
    const name = profileNameInput.value.trim();

    if (!/^[a-f0-9]{64}$/.test(key)) {
        createProfileMessage.textContent = "Saisis la clé du meneur.";
        return;
    }

    if (name.length < 1 || name.length > 40) {
        createProfileMessage.textContent =
            "Le pseudo doit contenir entre 1 et 40 caractères.";
        return;
    }

    if (loadProfilesButton.disabled) {
        createProfileMessage.textContent = "Attends la fin du chargement des profils.";
        return;
    }

    createProfileButton.disabled = true;
    profileNameInput.disabled = true;
    loadProfilesButton.disabled = true;
    createProfileMessage.textContent = "Création du profil…";

    try {
        const response = await fetch("/api/profiles", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ name }),
            signal: AbortSignal.timeout(5000),
        });

        const result = await response.json();

        if (!response.ok) {
            createProfileMessage.textContent =
                result.error || "Impossible de créer le profil.";
            return;
        }

        profileNameInput.value = "";
        createProfileMessage.textContent =
            `Le profil « ${result.profile.name} » a été créé.`;

        loadProfilesButton.disabled = false;
        await loadProfiles();
    } catch (error) {
        createProfileMessage.textContent =
            "Création non confirmée. Charge les profils avant de réessayer.";
        console.error(error);
    } finally {
        createProfileButton.disabled = false;
        profileNameInput.disabled = false;
        loadProfilesButton.disabled = false;
    }
}

createProfileForm.addEventListener("submit", createPlayerProfile);
loadProfilesButton.addEventListener("click", loadProfiles);
startButton.addEventListener("click", () => changeSession("start"));
stopButton.addEventListener("click", () => changeSession("stop"));
invitationButton.addEventListener("click", getInvitation);
checkAccessButton.addEventListener("click", checkPlayerAccess);
joinForm.addEventListener("submit", joinSession);

function connectSessionEvents() {
  const events = new EventSource("/api/events");

  events.addEventListener("session", (event) => {
    const session = JSON.parse(event.data);
    sessionRevision += 1;

    const message =
      session.status === "running"
        ? "Partie en cours"
        : "Partie arrêtée";

    if (statusElement.textContent !== message) {
      statusElement.textContent = message;
    }

    if (session.status === "stopped" && playerToken !== null) {
      revokePlayerAccess();
    } else if (playerToken !== null) {
      checkPlayerAccess({ silent: true });
    }
  });

  events.addEventListener("error", () => {
    sessionRevision += 1;
    statusElement.textContent =
      "Connexion interrompue. Reconnexion en cours…";
  });
}

async function maintainPlayerPresence() {
  try {
    if (playerToken !== null) {
      await checkPlayerAccess({ silent: true });
    }
  } finally {
    setTimeout(maintainPlayerPresence, 60000);
  }
}

loadInvitationFromUrl();
restorePlayerToken();
connectSessionEvents();
maintainPlayerPresence();

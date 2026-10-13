const statusElement = document.getElementById("session-status");
let sessionRefreshPending = false;
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
const selectProfileForm = document.getElementById("select-profile-form");
const playerProfileSelect = document.getElementById("player-profile");
const selectProfileButton = document.getElementById("select-profile");
const playerProfileMessage = document.getElementById("player-profile-message");
const changeProfileButton = document.getElementById("change-profile");
const cancelProfileChangeButton = document.getElementById("cancel-profile-change");

let playerToken = null;
let sessionRevision = 0;
let accessCheckPending = false;
let accessCheckRunning = false;
let profileSelectionPending = false;
let playerProfilesLoaded = false;
let currentPlayerProfile = null;
let profileChangeMode = false;

function revokePlayerAccess() {
    savePlayerToken(null);
    playerProfilesLoaded = false;
    joinInput.value = "";
    joinInput.disabled = false;
    joinButton.disabled = false;
    checkAccessButton.disabled = true;
    playerProfileSelect.replaceChildren();
    playerProfileSelect.disabled = true;
    selectProfileButton.disabled = true;
    playerProfileMessage.textContent = "";
    currentPlayerProfile = null;
    profileChangeMode = false;
    updateSelectProfileButton();
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



async function refreshSession() {
    if (sessionRefreshPending) {
        return;
    }
    sessionRefreshPending = true;
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
        sessionRefreshPending = false;
    }
}

async function changeSession(action) {
    const key = hostKeyInput.value.trim();

    if (!/^[a-f0-9]{64}$/.test(key)) {
        hostMessage.textContent = "Ouvre la page du meneur depuis le lancement du serveur.";
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
            "Réponse indisponible. Recharge la page avant de réessayer.";
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
        hostMessage.textContent = "Ouvre la page du meneur depuis le lancement du serveur.";
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
        await loadPlayerProfiles();
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

        if (!playerProfilesLoaded) {
            await loadPlayerProfiles(result.profileId);
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

    savePlayerToken(null);
    joinButton.disabled = false;
    joinInput.value = invitation;
    void joinSession({ preventDefault() {} });
}

async function loadProfiles() {
    if (loadProfilesButton.disabled) {
        return;
    }

    profilesList.replaceChildren();

    const key = hostKeyInput.value.trim();

    if (!/^[a-f0-9]{64}$/.test(key)) {
        profilesMessage.textContent = "Ouvre la page du meneur depuis le lancement du serveur.";
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
        createProfileMessage.textContent = "Ouvre la page du meneur depuis le lancement du serveur.";
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
selectProfileForm.addEventListener("submit", selectPlayerProfile);
playerProfileSelect.addEventListener("change", updateSelectProfileButton);

changeProfileButton.addEventListener("click", () => {
    if (currentPlayerProfile === null || profileSelectionPending) {
        return;
    }

    profileChangeMode = true;
    updateSelectProfileButton();
    playerProfileMessage.textContent =
        "Choisis un autre profil, puis confirme le changement.";
    playerProfileSelect.focus();
});

cancelProfileChangeButton.addEventListener("click", () => {
    if (currentPlayerProfile === null || profileSelectionPending) {
        return;
    }

    profileChangeMode = false;
    playerProfileSelect.value = currentPlayerProfile.id;
    updateSelectProfileButton();
    playerProfileMessage.textContent =
        `Tu utilises le profil "${currentPlayerProfile.name}".`;
});

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

async function loadPlayerProfiles(selectedProfileId = null) {
    if (playerToken === null) {
        return;
    }

    const checkedToken = playerToken;
    playerProfileMessage.textContent = "Chargement des profils…";

    try {
        const response = await fetch("/api/profiles", {
            headers: {
                Authorization: `Bearer ${checkedToken}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        });

        if (checkedToken !== playerToken) {
            return;
        }

        if (response.status === 401) {
            revokePlayerAccess();
            return;
        }

        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const result = await response.json();

        if (checkedToken !== playerToken) {
            return;
        }

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choisis ton profil";

        playerProfileSelect.replaceChildren(placeholder);

        for (const profile of result.profiles) {
            const option = document.createElement("option");
            option.value = profile.id;
            option.textContent = profile.name;
            playerProfileSelect.append(option);
        }

        const currentProfile = result.profiles.find(
            (profile) => profile.id === selectedProfileId
        );

        currentPlayerProfile = currentProfile || null;
        profileChangeMode = false;

        playerProfilesLoaded = result.profiles.length > 0;
        playerProfileSelect.disabled = result.profiles.length === 0;

        if (currentProfile) {
            playerProfileSelect.value = currentProfile.id;
            playerProfileMessage.textContent =
                `Tu utilises le profil "${currentProfile.name}".`;
        } else {
            playerProfileMessage.textContent = result.profiles.length === 0
                ? "Le meneur n'a pas encore créé de profil."
                : "Choisis ton profil.";
        }

        updateSelectProfileButton();

    } catch (error) {
        if (checkedToken === playerToken) {
            playerProfileMessage.textContent =
                "Impossible de charger les profils. Clique sur Vérifier mon accès pour réessayer.";
        }
        console.error(error);
    }
}

function updateSelectProfileButton() {
    const connected = playerToken !== null;
    const hasProfile = currentPlayerProfile !== null;
    const editing = !hasProfile || profileChangeMode;

    playerProfileSelect.disabled =
        !connected ||
        !playerProfilesLoaded ||
        !editing ||
        profileSelectionPending;

    selectProfileButton.hidden = !editing;
    selectProfileButton.disabled =
        playerProfileSelect.disabled ||
        playerProfileSelect.value === "";

    selectProfileButton.textContent = hasProfile
        ? "Confirmer le changement"
        : "Utiliser ce profil";

    changeProfileButton.hidden = !connected || !hasProfile || editing;
    changeProfileButton.disabled = profileSelectionPending;

    cancelProfileChangeButton.hidden =
        !connected || !hasProfile || !profileChangeMode;
    cancelProfileChangeButton.disabled = profileSelectionPending;
}

async function selectPlayerProfile(event) {
    event.preventDefault();

    if (playerToken === null || profileSelectionPending) {
        return;
    }

    const profileId = playerProfileSelect.value;

    if (profileId === "") {
        playerProfileMessage.textContent = "Choisis un profil.";
        return;
    }

    const checkedToken = playerToken;
    profileSelectionPending = true;
    updateSelectProfileButton();
    playerProfileMessage.textContent = "Réservation du profil...";

    try {
        const response = await fetch("/api/session/profile", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${checkedToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ profileId }),
            signal: AbortSignal.timeout(5000),
        });

        if (checkedToken !== playerToken) {
            return;
        }

        if (response.status === 401) {
            revokePlayerAccess();
            return;
        }

        const result = await response.json();

        if (checkedToken !== playerToken) {
            return;
        }

        if (!response.ok) {
            playerProfileMessage.textContent =
                result.error || "Impossible de sélectionner ce profil.";
            return;
        }

        playerProfileSelect.value = result.profile.id;
        currentPlayerProfile = result.profile;
        profileChangeMode = false;
        playerProfileMessage.textContent =
            `Tu utilises le profil "${result.profile.name}".`;

    } catch (error) {
        if (checkedToken === playerToken) {
            playerProfileMessage.textContent =
                "Réservation du profil non confirmée. La réponse du serveur n’a pas pu être reçue.";
        }
        console.error(error);
    } finally {
        profileSelectionPending = false;
        updateSelectProfileButton();
    }
}

initializeHostAccess();
if (window.location.pathname !== "/host") {
    restorePlayerToken();
    loadInvitationFromUrl();
}
connectSessionEvents();
maintainPlayerPresence();


function initializeHostAccess() {
    const isHostPage = window.location.pathname === "/host";
    document.getElementById("host-controls").hidden = !isHostPage;
    document.getElementById("player-controls").hidden = isHostPage;
    if (!isHostPage) return;

    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const suppliedKey = parameters.get("host");
    let key = suppliedKey;
    if (suppliedKey !== null) {
        window.history.replaceState(null, "", window.location.pathname);
    }
    try {
        if (suppliedKey === null) key = sessionStorage.getItem("jdr.hostKey");
        if (typeof key === "string" && /^[a-f0-9]{64}$/.test(key)) {
            sessionStorage.setItem("jdr.hostKey", key);
        }
    } catch {
        // L'accès fonctionne pour cette page même si le stockage est indisponible.
    }
    if (typeof key === "string" && /^[a-f0-9]{64}$/.test(key)) {
        hostKeyInput.value = key;
        hostMessage.textContent = "Accès du meneur prêt.";
    } else {
        hostMessage.textContent = "Ouvre le lien privé affiché au lancement du serveur.";
    }
}

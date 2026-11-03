const campaignTitle = /** @type {HTMLElement} */ (document.getElementById("campaign-title"));
const campaignDescription = /** @type {HTMLElement} */ (document.getElementById("campaign-description"));
const campaignMessage = /** @type {HTMLElement} */ (document.getElementById("campaign-message"));
const campaignForm = /** @type {HTMLFormElement} */ (document.getElementById("campaign-form"));
const campaignTitleInput = /** @type {HTMLInputElement} */ (document.getElementById("campaign-title-input"));
const campaignDescriptionInput = /** @type {HTMLTextAreaElement} */ (document.getElementById("campaign-description-input"));
const saveCampaignButton = /** @type {HTMLButtonElement} */ (document.getElementById("save-campaign"));
const campaignSaveMessage = /** @type {HTMLElement} */ (document.getElementById("campaign-save-message"));
const statusElement = /** @type {HTMLElement} */ (document.getElementById("session-status"));
let sessionRefreshPending = false;
const hostKeyInput = /** @type {HTMLInputElement} */ (document.getElementById("host-key"));
const startButton = /** @type {HTMLButtonElement} */ (document.getElementById("start-session"));
const stopButton = /** @type {HTMLButtonElement} */ (document.getElementById("stop-session"));
const hostMessage = /** @type {HTMLElement} */ (document.getElementById("host-message"));
const invitationButton = /** @type {HTMLButtonElement} */ (document.getElementById("get-invitation"));
const invitationInput = /** @type {HTMLInputElement} */ (document.getElementById("invitation-token"));
const joinForm = /** @type {HTMLFormElement} */ (document.getElementById("join-form"));
const joinInput = /** @type {HTMLInputElement} */ (document.getElementById("join-token"));
const joinButton = /** @type {HTMLButtonElement} */ (document.getElementById("join-session"));
const playerMessage = /** @type {HTMLElement} */ (document.getElementById("player-message"));
const checkAccessButton = /** @type {HTMLButtonElement} */ (document.getElementById("check-access"));
const loadProfilesButton = /** @type {HTMLButtonElement} */ (document.getElementById("load-profiles"));
const profilesMessage = /** @type {HTMLElement} */ (document.getElementById("profiles-message"));
const profilesList = /** @type {HTMLElement} */ (document.getElementById("profiles-list"));
const createProfileForm = /** @type {HTMLFormElement} */ (document.getElementById("create-profile-form"));
const profileNameInput = /** @type {HTMLInputElement} */ (document.getElementById("profile-name"));
const createProfileButton = /** @type {HTMLButtonElement} */ (document.getElementById("create-profile"));
const createProfileMessage = /** @type {HTMLElement} */ (document.getElementById("create-profile-message"));
const selectProfileForm = /** @type {HTMLFormElement} */ (document.getElementById("select-profile-form"));
const playerProfileSelect = /** @type {HTMLSelectElement} */ (document.getElementById("player-profile"));
const selectProfileButton = /** @type {HTMLButtonElement} */ (document.getElementById("select-profile"));
const playerProfileMessage = /** @type {HTMLElement} */ (document.getElementById("player-profile-message"));
const changeProfileButton = /** @type {HTMLButtonElement} */ (document.getElementById("change-profile"));
const cancelProfileChangeButton = /** @type {HTMLButtonElement} */ (document.getElementById("cancel-profile-change"));

const gameTable = /** @type {HTMLElement} */ (document.getElementById("game-table"));
const openTableButton = /** @type {HTMLButtonElement} */ (document.getElementById("open-table"));
const tableTitle = /** @type {HTMLElement} */ (document.getElementById("table-title"));
const tableProfile = /** @type {HTMLElement} */ (document.getElementById("table-profile"));
const tableSessionStatus = /** @type {HTMLElement} */ (document.getElementById("table-session-status"));
const tableChangeProfileButton = /** @type {HTMLButtonElement} */ (document.getElementById("table-change-profile"));
let tableRequested = false;

const hostProfileForm = /** @type {HTMLFormElement} */ (document.getElementById("host-profile-form"));
const hostProfileSelect = /** @type {HTMLSelectElement} */ (document.getElementById("host-profile-select"));
const useHostProfileButton = /** @type {HTMLButtonElement} */ (document.getElementById("use-host-profile"));
const hostProfileMessage = /** @type {HTMLElement} */ (document.getElementById("host-profile-message"));
/** @typedef {{id: string, name: string, role?: "host" | "player"}} Profile */
/** @type {Profile | null} */
let currentHostProfile = null;

/** @type {string | null} */
let playerToken = null;
let sessionRevision = 0;
let accessCheckPending = false;
let accessCheckRunning = false;
let profileSelectionPending = false;
let playerProfilesLoaded = false;
/** @type {Profile | null} */
let currentPlayerProfile = null;
let profileChangeMode = false;
let campaignLoadVersion = 0;

function revokePlayerAccess() {
    if (window.CharacterView) window.CharacterView.close();
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

/** @param {string | null} token */
function savePlayerToken(token) {
    playerToken = token;
    if (window.RollView) {
        if (token === null) window.RollView.clear();
        else void window.RollView.refresh();
    }
    if (window.MapView) {
        if (token === null) window.MapView.clear();
        else void window.MapView.refresh();
    }
    if (window.TokenView) {
        if (token === null) window.TokenView.clear();
        else void window.TokenView.refresh();
    }

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
    void loadCampaign(playerToken);
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

/** @param {"start" | "stop"} action */
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

/** @param {{preventDefault(): void}} event */
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
        void loadCampaign(playerToken);

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

/** @param {Event} event */
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
        if (window.location.pathname === "/host") {
            await loadHostProfile({ openCurrent: false });
        }
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
checkAccessButton.addEventListener("click", () => { void checkPlayerAccess(); });
joinForm.addEventListener("submit", joinSession);
selectProfileForm.addEventListener("submit", selectPlayerProfile);
playerProfileSelect.addEventListener("change", updateSelectProfileButton);

function beginProfileChange() {
    if (currentPlayerProfile === null || profileSelectionPending) {
        return;
    }

    if (window.CharacterView) window.CharacterView.close();

    profileChangeMode = true;
    updateSelectProfileButton();
    playerProfileMessage.textContent =
        "Choisis un autre profil, puis confirme le changement.";
    showTable(false);
    playerProfileSelect.focus();
}

changeProfileButton.addEventListener("click", beginProfileChange);
tableChangeProfileButton.addEventListener("click", beginProfileChange);
openTableButton.addEventListener("click", () => showTable(true));
/** @type {HTMLElement} */ (document.getElementById("back-to-lobby")).addEventListener("click", () => showTable(false));

cancelProfileChangeButton.addEventListener("click", () => {
    if (currentPlayerProfile === null || profileSelectionPending) {
        return;
    }

    profileChangeMode = false;
    playerProfileSelect.value = currentPlayerProfile.id;
    updateSelectProfileButton();
    playerProfileMessage.textContent =
        `Tu utilises le profil "${currentPlayerProfile.name}".`;
    showTable(true);
});

function connectSessionEvents() {
  const events = new EventSource("/api/events");

  const refreshPlayerCampaign = () => {
    if (window.location.pathname !== "/host" && playerToken !== null) {
      void loadCampaign(playerToken, { silent: true });
    }
  };

  events.addEventListener("campaign-updated", refreshPlayerCampaign);
  events.addEventListener("map-updated", () => { if (window.MapView) void window.MapView.refresh(); });
  events.addEventListener("map-updated", () => { if (window.TokenView) void window.TokenView.refresh(); });
  events.addEventListener("tokens-updated", () => { if (window.TokenView) void window.TokenView.refresh(); });
  events.addEventListener("character-updated", () => { if (window.CharacterView) window.CharacterView.updated(); });
  events.addEventListener("rolls-updated", () => { if (window.RollView) void window.RollView.refresh(); });
  events.addEventListener("open", () => { if (window.RollView) void window.RollView.refresh(); });
  events.addEventListener("open", () => { if (window.CharacterView) window.CharacterView.updated(); });
  // Recharge aussi après une reconnexion pour rattraper les changements manqués.
  events.addEventListener("open", refreshPlayerCampaign);
  events.addEventListener("open", () => { if (window.MapView) void window.MapView.refresh(); });
  events.addEventListener("open", () => { if (window.TokenView) void window.TokenView.refresh(); });

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

    updateTableState();

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
    updateTableState();
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
            /** @param {Profile} profile */ (profile) => profile.id === selectedProfileId
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
        if (currentProfile) showTable(true);

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
    updateTableState();
    if (window.TokenView) window.TokenView.updatePermissions();
}

/** @param {Event} event */
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
        showTable(true);

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
    updateTableState();
    const isHostPage = window.location.pathname === "/host";
    /** @type {HTMLElement} */ (document.getElementById("app-layout")).className = isHostPage
        ? "app-layout host-page"
        : "app-layout";
    /** @type {HTMLElement} */ (document.getElementById("host-controls")).hidden = !isHostPage;
    /** @type {HTMLElement} */ (document.getElementById("player-controls")).hidden = isHostPage;
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
        updateTableState();
        void loadCampaign(key);
        void loadHostProfile();
    } else {
        hostMessage.textContent = "Ouvre le lien privé affiché au lancement du serveur.";
    }
}

/** @param {string | null} key */
async function loadCampaign(key, { silent = false } = {}) {
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) {
        return;
    }

    const version = ++campaignLoadVersion;
    const isCurrent = () => version === campaignLoadVersion && (
        window.location.pathname === "/host"
            ? key === hostKeyInput.value
            : key === playerToken
    );

    if (!silent) {
        campaignMessage.textContent = "Chargement de la campagne...";
    }

    try {
        const response = await fetch("/api/campaign", {
            headers: {
                Authorization: `Bearer ${key}`,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        });

        if (!isCurrent()) {
            return;
        }

        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!isCurrent()) {
            return;
        }

        campaignTitle.textContent = result.campaign.title;
        campaignDescription.textContent = result.campaign.description;
        updateTableState();
        campaignMessage.textContent = "";

        if (window.location.pathname === "/host") {
            campaignTitleInput.value = result.campaign.title;
            campaignDescriptionInput.value = result.campaign.description;
            saveCampaignButton.disabled = false;
        }

    } catch (error) {
        if (isCurrent()) {
            campaignMessage.textContent =
                "Impossible de charger la campagne. Recharge la page pour réessayer.";
        }
        console.error(error);
    }
}

/** @param {Event} event */
async function saveCampaign(event) {
    event.preventDefault();

    if (saveCampaignButton.disabled) {
        return;
    }

    const key = hostKeyInput.value.trim();
    const title = campaignTitleInput.value.trim();
    const description = campaignDescriptionInput.value;

    if (!/^[a-f0-9]{64}$/.test(key)) {
        campaignSaveMessage.textContent =
            "Ouvre la page privée du meneur depuis le lancement du serveur.";
        return;
    }

    if (title.length < 1 || title.length > 100 || description.length > 2000) {
        campaignSaveMessage.textContent =
            "Le titre doit contenir entre 1 et 100 caractères, et la description au maximum 2000.";
        return;
    }

    saveCampaignButton.disabled = true;
    campaignTitleInput.disabled = true;
    campaignDescriptionInput.disabled = true;
    campaignSaveMessage.textContent = "Enregistrement...";

    try {
        const response = await fetch("/api/campaign", {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ title, description }),
            signal: AbortSignal.timeout(5000),
        });

        const result = await response.json();

        if (!response.ok) {
            campaignSaveMessage.textContent =
                result.error || "Impossible de sauvegarder la campagne.";
            return;
        }

        campaignTitle.textContent = result.campaign.title;
        campaignDescription.textContent = result.campaign.description;
        updateTableState();
        campaignTitleInput.value = result.campaign.title;
        campaignDescriptionInput.value = result.campaign.description;
        campaignSaveMessage.textContent = "Campagne enregistrée.";
    } catch (error) {
        campaignSaveMessage.textContent =
            "Enregistrement non confirmé. Recharge la page pour vérifier la sauvegarde.";
        console.error(error);
    } finally {
        saveCampaignButton.disabled = false;
        campaignTitleInput.disabled = false;
        campaignDescriptionInput.disabled = false;
    }
}

campaignForm.addEventListener("submit", saveCampaign);


function updateTableState() {
    const isHost = window.location.pathname === "/host" &&
        /^[a-f0-9]{64}$/.test(hostKeyInput.value);
    const hasProfile = playerToken !== null && currentPlayerProfile !== null;
    const allowed = isHost ? currentHostProfile !== null : hasProfile;
    if (!allowed) tableRequested = false;

    openTableButton.disabled = !allowed || profileSelectionPending || profileChangeMode;
    gameTable.hidden = !tableRequested;
    /** @type {HTMLElement} */ (document.getElementById("app-layout")).hidden = tableRequested;
    tableTitle.textContent = campaignTitle.textContent;
    tableProfile.textContent = isHost
        ? currentHostProfile ? `${currentHostProfile.name} (MJ)` : ""
        : currentPlayerProfile && hasProfile ? currentPlayerProfile.name : "";
    tableSessionStatus.textContent = statusElement.textContent;
    tableChangeProfileButton.hidden = isHost || !hasProfile;
    tableChangeProfileButton.disabled = profileSelectionPending;
}

/** @param {boolean} open */
function showTable(open) {
    tableRequested = open;
    updateTableState();
    if (!gameTable.hidden) {
        tableTitle.focus();
        /** @type {HTMLElement} */ (document.getElementById("board-viewport")).dispatchEvent(new Event("table-opened"));
    }
}


async function loadHostProfile({ openCurrent = true } = {}) {
    const key = hostKeyInput.value;
    try {
        /** @type {RequestInit} */
        const options = {
            headers: { Authorization: `Bearer ${key}` },
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        };
        const [profilesResponse, currentResponse] = await Promise.all([
            fetch("/api/profiles", options),
            fetch("/api/host/profile", options),
        ]);
        if (!profilesResponse.ok || !currentResponse.ok) throw new Error("Accès au profil MJ refusé");
        const [profilesResult, currentResult] = await Promise.all([
            profilesResponse.json(), currentResponse.json(),
        ]);
        const profiles = profilesResult.profiles;
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choisis ton profil de meneur";
        hostProfileSelect.replaceChildren(placeholder);
        for (const profile of profiles) {
            const option = document.createElement("option");
            option.value = profile.id;
            option.textContent = profile.role === "host" ? `${profile.name} (meneur)` : profile.name;
            hostProfileSelect.append(option);
        }
        currentHostProfile = currentResult.profile;
        hostProfileSelect.value = currentHostProfile?.id || "";
        hostProfileSelect.disabled = profiles.length === 0;
        useHostProfileButton.disabled = profiles.length === 0;
        hostProfileMessage.textContent = currentHostProfile
            ? `Profil actif : "${currentHostProfile.name}". Droits de meneur.`
            : profiles.length ? "Choisis ton profil pour ouvrir la table. Il sera réservé au meneur." : "Crée d'abord un profil dans la liste ci-dessous.";
        updateTableState();
        if (currentHostProfile && openCurrent) showTable(true);
    } catch (error) {
        hostProfileMessage.textContent = "Impossible de charger le profil du meneur. Recharge la page pour réessayer.";
        console.error(error);
    }
}

hostProfileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (useHostProfileButton.disabled || !hostProfileSelect.value) return;
    useHostProfileButton.disabled = true;
    hostProfileSelect.disabled = true;
    hostProfileMessage.textContent = "Sélection du profil...";
    try {
        const response = await fetch("/api/host/profile", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${hostKeyInput.value}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ profileId: hostProfileSelect.value }),
            signal: AbortSignal.timeout(5000),
        });
        const result = await response.json();
        if (!response.ok) {
            hostProfileMessage.textContent = result.error || "Sélection refusée.";
            return;
        }
        currentHostProfile = result.profile;
        if (!currentHostProfile) throw new Error("Profil du meneur absent de la réponse.");
        hostProfileMessage.textContent = `Profil actif : "${currentHostProfile.name}". Droits de meneur.`;
        showTable(true);
    } catch (error) {
        hostProfileMessage.textContent = "Sélection non confirmée. Recharge la page pour vérifier.";
        console.error(error);
    } finally {
        useHostProfileButton.disabled = false;
        hostProfileSelect.disabled = false;
    }
});

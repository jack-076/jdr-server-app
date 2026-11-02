const {
    readFileSync,
    mkdirSync,
    writeFileSync,
    renameSync,
} = require("node:fs");
const path = require("node:path");

const dataDirectory = path.join(__dirname, "../../data");
const campaignFile = path.join(dataDirectory, "campaign.json");

function validateCampaign(data) {
    if (
        data === null ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        typeof data.title !== "string" ||
        typeof data.description !== "string"
    ) {
        const error = new Error("Le titre et la description doivent être du texte.");
        error.statusCode = 400;
        throw error;
    }

    const title = data.title.trim();

    if (
        title.length < 1 ||
        title.length > 100 ||
        data.description.length > 2000
    ) {
        const error = new Error(
            "Le titre doit contenir entre 1 et 100 caractères, et la description au maximum 2000."
        );
        error.statusCode = 400;
        throw error;
    }

    return {
        title,
        description: data.description,
    };
}

let campaign = {
    title: "Nouvelle campagne",
    description: "",
};

try {
    const content = readFileSync(campaignFile, "utf8");
    campaign = validateCampaign(JSON.parse(content));
} catch (error) {
    if (error.code !== "ENOENT") {
        throw error;
    }
}

function getCampaign() {
    return { ...campaign };
}

function updateCampaign(data) {
    const updatedCampaign = validateCampaign(data);
    const temporaryFile = `${campaignFile}.tmp`;

    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

    writeFileSync(
        temporaryFile,
        JSON.stringify(updatedCampaign, null, 2),
        { encoding: "utf8", mode: 0o600 }
    );

    renameSync(temporaryFile, campaignFile);
    campaign = updatedCampaign;

    return getCampaign();
}

module.exports = { getCampaign, updateCampaign };
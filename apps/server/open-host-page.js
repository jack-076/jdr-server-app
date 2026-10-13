const { spawn } = require("node:child_process");

function openHostPage(url) {
  const command = process.platform === "win32"
    ? "explorer.exe"
    : process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(command, [url], { stdio: "ignore", shell: false });
    const reportFailure = () => console.warn(
      "Ouverture automatique impossible. Ouvre le lien privé affiché dans le terminal."
    );
    child.once("error", reportFailure);
    child.once("exit", (code) => { if (code !== null && code !== 0) reportFailure(); });
    child.unref();
  } catch {
    console.warn("Ouvre le lien privé du meneur affiché dans le terminal.");
  }
}

module.exports = { openHostPage };

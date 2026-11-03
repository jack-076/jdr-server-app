/**
 * @param {import("node:http").IncomingMessage} request
 * @param {number} maxBytes
 * @param {number} [timeoutMs]
 * @param {string} [tooLargeMessage]
 * @returns {Promise<Buffer>}
 */
function readBytes(request, maxBytes, timeoutMs = 30000, tooLargeMessage = "La carte dépasse 10 Mio.") {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let finished = false;
    const timer = setTimeout(() => fail("L'envoi de la carte a pris trop de temps.", 408), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
    }
    /** @param {string} message @param {number} statusCode */
    function fail(message, statusCode) {
      if (finished) return;
      finished = true;
      cleanup();
      request.resume();
      const error = Object.assign(new Error(message), { statusCode });
      reject(error);
    }
    /** @param {Buffer} chunk */
    function onData(chunk) {
      size += chunk.length;
      if (size > maxBytes) return fail(tooLargeMessage, 413);
      chunks.push(chunk);
    }
    function onEnd() {
      finished = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    }
    function onError() { fail("Impossible de lire la carte.", 400); }
    function onAborted() { fail("L'envoi de la carte a été interrompu.", 400); }
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

module.exports = { readBytes };

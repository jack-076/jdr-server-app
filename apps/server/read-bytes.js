function readBytes(request, maxBytes, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
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
    function fail(message, statusCode) {
      if (finished) return;
      finished = true;
      cleanup();
      request.resume();
      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > maxBytes) return fail("La carte dépasse 10 Mio.", 413);
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

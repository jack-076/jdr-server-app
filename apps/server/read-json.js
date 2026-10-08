function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    const timer = setTimeout(() => {
      fail("La requête a pris trop de temps.", 408);
    }, 5000);

    function cleanup() {
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
    }

    function fail(message, statusCode) {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();
      request.resume();

      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    }

    function onData(chunk) {
      size += chunk.length;

      if (size > 4096) {
        fail("Le contenu de la requête est trop volumineux.", 413);
        return;
      }

      chunks.push(chunk);
    }

    function onEnd() {
      let data;

      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        fail("Le contenu JSON est invalide.", 400);
        return;
      }

      finished = true;
      cleanup();
      resolve(data);
    }

    function onError() {
      fail("Impossible de lire la requête.", 400);
    }

    function onAborted() {
      fail("La requête a été interrompue.", 400);
    }

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

module.exports = { readJson };

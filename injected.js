(() => {
  const SOURCE = "sf-scrapbook-helper";

  function safeParse(text) {
    if (typeof text !== "string") {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function emitNetwork(url, payload) {
    window.postMessage(
      {
        source: SOURCE,
        type: "network_payload",
        url,
        payload,
        payloadType: "json"
      },
      "*"
    );
  }

  function emitText(url, text, contentType) {
    window.postMessage(
      {
        source: SOURCE,
        type: "network_payload",
        url,
        payload: text,
        payloadType: "text",
        contentType: contentType || ""
      },
      "*"
    );
  }

  const nativeFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);

    try {
      const clone = response.clone();
      const contentType = clone.headers.get("content-type") || "";

      const body = await clone.text();
      if (typeof body === "string" && body.length) {
        emitText(String(args[0]), body, contentType);
      }
      if (contentType.includes("application/json")) {
        const parsed = safeParse(body);
        if (parsed) {
          emitNetwork(String(args[0]), parsed);
        }
      }
    } catch {
      // Ignore parsing and clone errors to avoid breaking page flow.
    }

    return response;
  };

  const NativeXHR = window.XMLHttpRequest;
  const open = NativeXHR.prototype.open;
  const send = NativeXHR.prototype.send;

  NativeXHR.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__sfhUrl = url;
    return open.call(this, method, url, ...rest);
  };

  NativeXHR.prototype.send = function patchedSend(...args) {
    this.addEventListener("load", function onLoad() {
      try {
        const contentType = this.getResponseHeader("content-type") || "";
        if (typeof this.responseText !== "string" || !this.responseText.length) {
          return;
        }
        emitText(this.__sfhUrl || "", this.responseText, contentType);
        if (contentType.includes("application/json")) {
          const parsed = safeParse(this.responseText);
          if (parsed) {
            emitNetwork(this.__sfhUrl || "", parsed);
          }
        }
      } catch {
        // Ignore parsing and response errors.
      }
    });

    return send.call(this, ...args);
  };
})();

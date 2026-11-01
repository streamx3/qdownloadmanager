export class NativeClient {
  constructor(runtime, host, timeout = 15000) {
    this.runtime = runtime;
    this.host = host;
    this.timeout = timeout;
    this.port = null;
    this.pending = new Map();
  }
  connect() {
    if (this.port) return;
    const port = this.runtime.connectNative(this.host);
    this.port = port;
    port.onMessage.addListener(message => {
      if (this.port !== port) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.v !== 1) pending.reject(new Error("The native bridge uses an unsupported protocol."));
      else if (!message.ok) {
        const error = new Error(message.error?.message || "The desktop app rejected this request.");
        error.code = message.error?.code;
        pending.reject(error);
      } else pending.resolve(message);
    });
    port.onDisconnect.addListener(() => {
      const detail = this.runtime.lastError?.message;
      if (this.port !== port) return;
      this.port = null;
      this.rejectAll(new Error(detail ? `Chrome bridge unavailable: ${detail}` : "Chrome disconnected from the desktop bridge."));
    });
  }
  rejectAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  request(type, fields = {}) {
    try { this.connect(); } catch (error) { return Promise.reject(error); }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The desktop app did not respond. Check that it is still running."));
        // Reset a wedged stdio stream, so late replies cannot affect later work.
        const port = this.port;
        this.port = null;
        this.rejectAll(new Error("The connection timed out."));
        port?.disconnect();
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.port.postMessage({ ...fields, v: 1, id, type }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
}

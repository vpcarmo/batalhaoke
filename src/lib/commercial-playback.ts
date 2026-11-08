export function commercialPlaybackError(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
  return message.includes("commercial_quota_exhausted") || message.includes("Cota esgotada")
    ? "Cota esgotada. Regularize a conta ou adquira créditos para reproduzir."
    : "Reprodução bloqueada: não foi possível confirmar a autorização comercial. Verifique a conta e a conexão.";
}

/** A failed or expired permit cannot be revived by a late network response. */
export function createPlaybackPermit(onBlocked: (error: unknown) => void, timeoutMs = 12_000) {
  let closed = false;
  let metered = true;
  let timer: ReturnType<typeof setTimeout>;
  const revoke = (error: unknown) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    onBlocked(error);
  };
  const arm = () => {
    clearTimeout(timer);
    if (!metered) return;
    timer = setTimeout(() => revoke(new Error("authorization_timeout")), timeoutMs);
  };
  arm();
  return {
    confirm(validForMs = timeoutMs) {
      if (closed) return false;
      if (metered && validForMs <= 0) {
        revoke(new Error("authorization_timeout"));
        return false;
      }
      clearTimeout(timer);
      if (metered) timer = setTimeout(() => revoke(new Error("authorization_timeout")), validForMs);
      return true;
    },
    revoke,
    unmetered() {
      metered = false;
      clearTimeout(timer);
    },
    close() {
      closed = true;
      clearTimeout(timer);
    },
    get closed() {
      return closed;
    },
  };
}

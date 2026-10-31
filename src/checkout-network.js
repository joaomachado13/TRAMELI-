// Erros de rede podem acontecer depois de o servidor ter gravado o pedido.
// Nunca afirmar que a gravacao falhou, nem gerar uma nova chave ao tentar de novo.
export function checkoutIsOffline(connection = globalThis.navigator) {
  return connection?.onLine === false;
}

export function checkoutConnectionMessage(cause, { offline = false, weekly = false } = {}) {
  if (offline) return 'Sem conexão com a internet. Seus itens continuam aqui. Reconecte e tente novamente; não crie outro pedido.';
  const code = String(cause?.code || '').toUpperCase();
  const message = String(cause?.message || '');
  const networkFailure = cause?.name === 'AbortError'
    || cause?.name === 'TimeoutError'
    || cause?.name === 'TypeError'
    || ['0', 'NETWORK_ERROR', 'FETCH_ERROR', 'ETIMEDOUT', 'ECONNRESET'].includes(code)
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|connection lost|conex[aã]o|rede indispon[ií]vel/i.test(message);
  if (networkFailure) {
    return weekly
      ? 'A conexão caiu durante o envio. Alguns dias podem ter sido registrados. Confira Meus pedidos ao reconectar; ao tentar novamente, o sistema reutiliza as solicitações anteriores.'
      : 'A conexão caiu durante o envio. O pedido pode ter sido registrado. Confira Meus pedidos ao reconectar; se precisar tentar novamente, use este mesmo envio.';
  }
  return weekly
    ? `Não foi possível concluir a semana: ${message || 'verifique os dados e tente novamente.'}`
    : `Não foi possível registrar: ${message || 'verifique os dados e tente novamente.'}`;
}

export function findBrowserWallet(announcedWallets, injectedWallet) {
  // Prefer MetaMask discovered through EIP-6963 over competing extensions.
  const metaMask = announcedWallets.find(
    ({ info, provider }) => info?.rdns === "io.metamask" && provider?.request
  );
  if (metaMask) return metaMask.provider;

  const legacyWallets = injectedWallet?.providers ?? [];
  const legacyMetaMask = legacyWallets.find((wallet) => wallet.isMetaMask && wallet.request);
  if (legacyMetaMask) return legacyMetaMask;
  if (injectedWallet?.request) return injectedWallet;
  return announcedWallets.find(({ provider }) => provider?.request)?.provider ?? null;
}

export function describeConnectionError(error) {
  const code = error?.info?.error?.code ?? error?.code;
  if (Number(code) === 4001 || code === "ACTION_REJECTED") {
    return "You canceled the wallet connection. Try again when you are ready to approve it.";
  }
  if (Number(code) === -32002) {
    return "A request is already waiting in your wallet (-32002). Open the wallet extension from your browser toolbar and approve or reject that request. Retrying cannot open a second request.";
  }
  if (Number(code) === 4100) {
    return "Wallet access is not authorized (4100). Check this site's connection permissions in your wallet.";
  }
  if (Number(code) === 4900 || Number(code) === 4901) {
    return "Your wallet is disconnected from its network. Open the extension, check its connection, and refresh this page.";
  }
  return `Wallet connection failed${code !== undefined ? ` (${String(code)})` : ""}. Check your wallet extension for an error or a pending request.`;
}

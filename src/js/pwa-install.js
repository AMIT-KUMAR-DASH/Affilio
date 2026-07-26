let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('install-banner');
  if (banner && !localStorage.getItem('affilio_install_dismissed')) {
    banner.classList.add('show');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const installBtn = document.getElementById('install-btn');
  const dismissBtn = document.getElementById('dismiss-install');
  const banner = document.getElementById('install-banner');

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      banner?.classList.remove('show');
    });
  }
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      banner?.classList.remove('show');
      localStorage.setItem('affilio_install_dismissed', '1');
    });
  }
});

window.addEventListener('appinstalled', () => {
  document.getElementById('install-banner')?.classList.remove('show');
  deferredPrompt = null;
});

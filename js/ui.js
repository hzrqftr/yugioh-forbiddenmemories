(function () {
  const SIDEBAR_KEY = 'fm-sidebar-collapsed';
  const THEME_KEY = 'fm-theme';

  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const themeLabel = document.getElementById('theme-label');

    if (localStorage.getItem(SIDEBAR_KEY) === '1') {
      sidebar.classList.add('collapsed');
    }

    sidebarToggle?.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem(SIDEBAR_KEY, sidebar.classList.contains('collapsed') ? '1' : '0');
    });

    function updateThemeUI() {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (themeIcon) themeIcon.textContent = isLight ? '◑' : '○';
      if (themeLabel) themeLabel.textContent = isLight ? 'dark mode' : 'light mode';
    }

    updateThemeUI();

    themeToggle?.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (isLight) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem(THEME_KEY, 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem(THEME_KEY, 'light');
      }
      updateThemeUI();
    });
  });
})();

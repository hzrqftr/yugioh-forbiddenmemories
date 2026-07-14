(function () {
  const SIDEBAR_KEY = 'fm-sidebar-collapsed';
  const THEME_KEY = 'fm-theme';

  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const themeLabel = document.getElementById('theme-label');

    // ── Sidebar: off-canvas drawer on mobile, collapsible strip on desktop ──
    const mobileMQ = window.matchMedia('(max-width: 768px)');
    const isMobile = () => mobileMQ.matches;

    // Scrim tap dismisses the mobile drawer. Created once, shared by both pages.
    const scrim = document.createElement('div');
    scrim.className = 'sidebar-scrim';
    document.body.appendChild(scrim);

    function openDrawer() {
      sidebar.classList.add('mobile-open');
      document.body.classList.add('sidebar-open');
      sidebarToggle?.setAttribute('aria-expanded', 'true');
    }
    function closeDrawer() {
      sidebar.classList.remove('mobile-open');
      document.body.classList.remove('sidebar-open');
      sidebarToggle?.setAttribute('aria-expanded', 'false');
    }

    // Apply the correct state for the current breakpoint.
    function applyMode() {
      if (isMobile()) {
        // Desktop collapse is meaningless in the drawer; start hidden.
        sidebar.classList.remove('collapsed');
        closeDrawer();
      } else {
        // Leave the drawer, restore the user's saved desktop collapse.
        closeDrawer();
        sidebar.classList.toggle('collapsed', localStorage.getItem(SIDEBAR_KEY) === '1');
      }
    }
    applyMode();

    sidebarToggle?.addEventListener('click', () => {
      if (isMobile()) {
        sidebar.classList.contains('mobile-open') ? closeDrawer() : openDrawer();
      } else {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem(SIDEBAR_KEY, sidebar.classList.contains('collapsed') ? '1' : '0');
      }
    });

    scrim.addEventListener('click', closeDrawer);
    // Tapping a destination closes the drawer before the page navigates.
    sidebar.querySelectorAll('.nav-link').forEach((a) => a.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) closeDrawer();
    });
    mobileMQ.addEventListener('change', applyMode);

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

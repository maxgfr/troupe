// Dark is the primary theme (« régie avant le direct »); the stored choice
// wins, then prefers-color-scheme, then dark. Inlined in <head> so it runs
// before paint — no flash. Shared by the Next layout and the static demo.
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("troupe-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
